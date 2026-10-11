"""Aggregates for ``GET /api/dashboard/analytics``.

Serves the Analytics tab that shipped against a fixture. The response shape is
the frontend's ``DashboardAnalytics`` and is validated there by a Zod schema,
so the bucketing rules below deliberately mirror
``services/fixtures/dashboardAnalytics.ts`` rather than inventing their own:
daily buckets for week and month, seven-day buckets for all time, each bucket
labelled with its first Manila day, and the top eight destinations by Search.

Searches come from ``public."UserHistory"``, one row per navigation session -
see the Usage analytics section of CONTEXT.md for what counts as a Search.

Visits are a different event: a user arriving at the destination they
navigated to. The User App does not send one yet and nothing stores it, so
every Visit figure here is a structural zero rather than a measurement. That is
why ``visitsByAccountType`` and ``visitsByDestinationType`` still carry all
their keys, and why ``arrivalRate`` is zero rather than undefined: the charts
render empty instead of breaking, and the day an arrival event exists this
module is the only place that has to change.
"""

from datetime import datetime, timedelta, timezone

from extensions import db
from model.app_user import USER_TYPES, AppUser, UserInfo, normalize_user_type
from model.building import Building
from model.location import LOCATION_TYPE_IDS, LOCATION_TYPE_NAMES, Location
from model.user_history import UserHistory

# A fixed +08:00 rather than ZoneInfo("Asia/Manila"): the Philippines has not
# observed DST since 1978, so the offset is the whole of the rule, the frontend
# fixture buckets on the same fixed offset, and ZoneInfo needs the tzdata
# package on Windows, where this is developed. One offset, one answer, no
# dependency that can be missing on a teammate's machine.
MANILA = timezone(timedelta(hours=8))

# Days in the current period. None is every day there is data for.
RANGE_DAYS = {"week": 7, "month": 30, "all": None}

# All time is bucketed weekly so a long history stays a readable line.
RANGE_BUCKET_DAYS = {"week": 1, "month": 1, "all": 7}

TOP_DESTINATION_LIMIT = 8

# A Facility is a Building for the purpose of these charts, as the frontend's
# DestinationType says.
DESTINATION_TYPES = ("Building", "Room", "Laboratory", "Office", "Restroom")

COMPLETENESS_CHECKS = (
    ("photo", "Photo"),
    ("description", "Description"),
    ("keywords", "Search keywords"),
    ("mapPin", "Map pin"),
)

# A footprint needs three points to enclose anything, so a shorter ring counts
# as unplaced - matching the frontend's own completeness rule.
MINIMUM_POLYGON_POINTS = 3


def manila_day(moment):
    """The Manila calendar date a timestamp falls on."""

    if moment is None:
        return None
    # A naive timestamp is read as UTC, which is what the database stores and
    # what every writer in this repository passes.
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(MANILA).date()


def _day_span(start, end):
    """Every date from ``start`` to ``end`` inclusive."""

    return [start + timedelta(days=offset) for offset in range((end - start).days + 1)]


def _bucket_starts(days, size):
    """The first day of each bucket, in order."""

    return [days[index] for index in range(0, len(days), size)]


def _bucket_of(day, days, size):
    """Which bucket start a day belongs to, or None if it is outside the window."""

    try:
        position = days.index(day)
    except ValueError:
        return None
    return days[position - (position % size)]


def _history_rows(start=None, end=None):
    """Search rows in a Manila date window, as ``(day, user_id, building, location)``.

    Read into Python rather than grouped in SQL because the bucket boundaries
    are Manila dates while the column is UTC, and because the same rows feed
    four different groupings - day, user, destination and destination type.
    One pass over a table of this size is cheaper than four date-shifted
    aggregate queries, and it keeps the SQLite the tests run on honest.
    """

    query = db.session.query(
        UserHistory.created_at,
        UserHistory.user_id,
        UserHistory.building_id,
        UserHistory.location_id,
    )
    if start is not None:
        # One day of slack at each edge, because the UTC column and the Manila
        # window disagree by eight hours.
        query = query.filter(UserHistory.created_at >= _utc_floor(start))
    if end is not None:
        query = query.filter(UserHistory.created_at < _utc_ceiling(end))

    rows = []
    for created_at, user_id, building_id, location_id in query.all():
        day = manila_day(created_at)
        if day is None:
            continue
        if start is not None and day < start:
            continue
        if end is not None and day > end:
            continue
        rows.append((day, user_id, building_id, location_id))
    return rows


def _utc_floor(day):
    """The UTC instant Manila's ``day`` begins."""

    return datetime(day.year, day.month, day.day, tzinfo=MANILA).astimezone(timezone.utc)


def _utc_ceiling(day):
    """The UTC instant after Manila's ``day`` ends."""

    return _utc_floor(day + timedelta(days=1))


def search_window(days, now=None):
    """The UTC ``(start, end)`` of the last ``days`` Manila calendar days.

    Today and the ``days - 1`` days before it, the window the Analytics tab
    calls the current period. The Overview summary reads through this too, so
    the two screens count the same Searches.
    """

    today = manila_day(now or datetime.now(timezone.utc))
    return _utc_floor(today - timedelta(days=days - 1)), _utc_ceiling(today)


def _totals(rows):
    """Period totals for a set of Search rows.

    ``activeUsers`` counts signed-in users only: an anonymous row has no
    user_id to count, and counting them as one shared user would be worse than
    leaving them out.
    """

    searches = len(rows)
    users = {row[1] for row in rows if row[1] is not None}
    visits = 0  # No arrival event is recorded yet; see the module docstring.
    return {
        "activeUsers": len(users),
        "searches": searches,
        "visits": visits,
        "arrivalRate": (visits / searches) if searches else 0,
    }


def _app_accounts():
    """App accounts joined to their registration details.

    Registrations are counted from accounts that have registration details, so
    an orphan ``userInfo`` row with no account is not a registration. An account
    without details, or with an unrecognized type, still counts in Registered
    Users on the summary but not in the registrations chart.
    """

    return db.session.query(AppUser).join(UserInfo, AppUser.info_id == UserInfo.id)


def _earliest_day():
    """The first Manila day with any Search or registration, or None."""

    first_search = db.session.query(db.func.min(UserHistory.created_at)).scalar()
    first_signup = _app_accounts().with_entities(db.func.min(UserInfo.created_at)).scalar()
    days = [day for day in (manila_day(first_search), manila_day(first_signup)) if day]
    return min(days) if days else None


def _period(range_key, today):
    """``(days, previous_days)`` as inclusive lists of Manila dates.

    All time has no comparison baseline, so its previous period is empty - the
    response reports null for it.
    """

    length = RANGE_DAYS[range_key]

    if length is None:
        start = _earliest_day() or today
        # A window that starts after today would be empty; one day is the floor.
        return _day_span(min(start, today), today), []

    start = today - timedelta(days=length - 1)
    previous_end = start - timedelta(days=1)
    return _day_span(start, today), _day_span(previous_end - timedelta(days=length - 1), previous_end)


def _destination_names():
    """Lookup tables for naming a Search's destination.

    Keyed the way ``UserHistory`` points at them: a row with a location_id is
    an indoor Location, and a row with only a building_id is the Building
    itself.
    """

    buildings = {
        building.building_id: building
        for building in db.session.query(
            Building.building_id, Building.building_name, Building.classification
        ).all()
    }
    locations = {
        location.location_id: location
        for location in db.session.query(
            Location.location_id, Location.location_name, Location.type_id, Location.building_id
        ).all()
    }
    return buildings, locations


def _destination_of(row, buildings, locations):
    """``(identity_key, name, context, destination_type)`` for one Search row.

    The identity key matches the frontend's own ``Type:id`` convention, which
    is why a Building's key uses its classification: the directory treats
    Building and Facility as distinct subtypes of the same table.
    """

    _, _, building_id, location_id = row

    if location_id is not None:
        location = locations.get(location_id)
        if location is None:
            return None
        type_name = LOCATION_TYPE_NAMES.get(location.type_id)
        if type_name is None:
            return None
        parent = buildings.get(location.building_id)
        context = parent.building_name if parent else "Indoor Location"
        return f"{type_name}:{location_id}", location.location_name, context, type_name

    if building_id is not None:
        building = buildings.get(building_id)
        if building is None:
            return None
        classification = building.classification or "Building"
        return (
            f"{classification}:{building_id}",
            building.building_name,
            classification,
            "Building",
        )

    return None


def _registrations(days, size):
    """App account signups per bucket, split by account type.

    An account whose stored type is absent or unrecognized is left out rather
    than guessed at, the same choice the dashboard summary makes, so a bucket's
    parts can add up to less than the accounts created that day.
    """

    buckets = {
        start: {name: 0 for name in USER_TYPES}
        for start in _bucket_starts(days, size)
    }
    if not days:
        return []

    rows = (
        _app_accounts()
        .with_entities(UserInfo.created_at, UserInfo.user_type)
        .filter(UserInfo.created_at.isnot(None))
        .filter(UserInfo.created_at >= _utc_floor(days[0]))
        .filter(UserInfo.created_at < _utc_ceiling(days[-1]))
        .all()
    )

    for created_at, stored_type in rows:
        name = normalize_user_type(stored_type)
        if name is None:
            continue
        bucket = _bucket_of(manila_day(created_at), days, size)
        if bucket is not None:
            buckets[bucket][name] += 1

    return [
        {"date": start.isoformat(), **buckets[start]}
        for start in _bucket_starts(days, size)
    ]


def _has_text(value):
    return bool(value and value.strip())


def _completeness():
    """How much of the active directory is fully described.

    Scoped to active records because an inactive one is not something the team
    is being asked to finish. Buildings may be placed by a footprint instead of
    a pin, which counts as placed - the same rule the frontend applies.
    """

    counts = {key: 0 for key, _ in COMPLETENESS_CHECKS}
    total = 0

    for building in Building.query.filter(Building.status == "active").all():
        total += 1
        if building.has_photo():
            counts["photo"] += 1
        if _has_text(building.description):
            counts["description"] += 1
        if _has_text(building.keywords):
            counts["keywords"] += 1
        pinned = building.latitude is not None and building.longitude is not None
        footprint = building.polygon_coordinates
        enclosed = isinstance(footprint, list) and len(footprint) >= MINIMUM_POLYGON_POINTS
        if pinned or enclosed:
            counts["mapPin"] += 1

    indoor = Location.query.filter(
        Location.status == "active",
        Location.type_id.in_(LOCATION_TYPE_IDS.values()),
    ).all()
    for location in indoor:
        total += 1
        if location.has_photo():
            counts["photo"] += 1
        if _has_text(location.description):
            counts["description"] += 1
        if _has_text(location.keywords):
            counts["keywords"] += 1
        if location.latitude is not None and location.longitude is not None:
            counts["mapPin"] += 1

    return [
        {"key": key, "label": label, "complete": counts[key], "total": total}
        for key, label in COMPLETENESS_CHECKS
    ], total


def summarize_dashboard_analytics(range_key, now=None):
    """The whole Analytics tab for one range, shaped as ``DashboardAnalytics``."""

    now = now or datetime.now(timezone.utc)
    today = manila_day(now)
    size = RANGE_BUCKET_DAYS[range_key]
    days, previous_days = _period(range_key, today)

    rows = _history_rows(days[0], days[-1]) if days else []
    previous_rows = (
        _history_rows(previous_days[0], previous_days[-1]) if previous_days else []
    )

    buildings, locations = _destination_names()

    searches_by_bucket = {start: 0 for start in _bucket_starts(days, size)}
    per_destination = {}
    for row in rows:
        bucket = _bucket_of(row[0], days, size)
        if bucket is not None:
            searches_by_bucket[bucket] += 1

        destination = _destination_of(row, buildings, locations)
        if destination is None:
            continue
        key, name, context, _ = destination
        entry = per_destination.setdefault(
            key, {"name": name, "context": context, "searches": 0, "visits": 0}
        )
        entry["searches"] += 1

    ranked = sorted(
        per_destination.items(),
        key=lambda item: (-item[1]["searches"], item[1]["name"].casefold(), item[0]),
    )
    top_destinations = [
        {
            "rank": str(index),
            "locationId": key,
            "name": entry["name"],
            "context": entry["context"],
            "searches": entry["searches"],
            "visits": entry["visits"],
        }
        for index, (key, entry) in enumerate(ranked[:TOP_DESTINATION_LIMIT], start=1)
        if entry["searches"] > 0
    ]

    checks, completeness_total = _completeness()

    return {
        "range": range_key,
        "current": _totals(rows),
        "previous": _totals(previous_rows) if previous_days else None,
        "timeline": [
            # Visits stay zero until an arrival event exists; the Searches half
            # of this series is real.
            {"date": start.isoformat(), "searches": searches_by_bucket[start], "visits": 0}
            for start in _bucket_starts(days, size)
        ],
        "visitsByAccountType": {name: 0 for name in USER_TYPES},
        "visitsByDestinationType": {name: 0 for name in DESTINATION_TYPES},
        "registrations": _registrations(days, size),
        "topDestinations": top_destinations,
        "completeness": checks,
        "completenessTotal": completeness_total,
    }
