"""``GET /api/dashboard/decision-analytics`` and the rules behind it.

One small campus serves every test. Distances are real metres (the router
measures with Haversine), laid out so the shortest walk to the College runs
through the junction and a longer detour exists around the west side:

    detour --------------.
      |                  |
     gate --- junction --+-- college entrance
                 |
                 +---- cafe entrance        (walk + vehicle)

    annex entrance -> junction              (one-way, pointing away from it)
    library                                 (no entrance at all)
    gate --- cafe                           (inactive shortcut, ignored)
"""

from datetime import datetime, timedelta, timezone

import pytest
from flask import Flask

import dashboard as dashboard_route
from dashboard import dashboard_bp
from extensions import db
from model.app_user import AppUser, UserInfo
from model.building import Building
from model.building_type import BuildingType
from model.location import Location
from model.pathway import Pathway
from model.pathway_allowed_mode import PathwayAllowedMode
from model.route_node import RouteNode
from model.user_history import UserHistory
from services.decision_analytics import summarize_decision_analytics

NOW = datetime(2026, 10, 9, 4, 0, tzinfo=timezone.utc)

GATE, JUNCTION, COLLEGE_DOOR, CAFE_DOOR, ANNEX_DOOR, DETOUR = 1, 2, 3, 4, 5, 6
COLLEGE, CAFE, ANNEX, LIBRARY, CLOSED = 10, 20, 30, 40, 50


@pytest.fixture
def app(monkeypatch):
    app = Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI="sqlite://", SQLALCHEMY_TRACK_MODIFICATIONS=False, TESTING=True)
    db.init_app(app)
    app.register_blueprint(dashboard_bp)
    monkeypatch.setattr(dashboard_route, "admin_required", lambda: (object(), None))

    with app.app_context():
        db.session.execute(db.text("ATTACH DATABASE ':memory:' AS public"))
        db.metadata.create_all(db.engine)
        db.session.add_all([
            BuildingType(type_id=index, type_name=name, can_contain_locations=name in ("College", "Campus Services"))
            for index, name in enumerate(("College", "Campus Services", "Food", "Parking", "Facility"), start=1)
        ])
        seed_campus()
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def place(identifier, name, classification, **columns):
    type_row = BuildingType.query.filter_by(type_name=classification).first()
    db.session.add(Building(
        building_id=identifier, building_code=f"B{identifier}", building_name=name,
        classification=classification, type_id=type_row.type_id, status=columns.pop("status", "active"),
        **columns,
    ))


def node(identifier, lat, lng, name="Route Node", node_type="intersection", building_id=None, status="active"):
    db.session.add(RouteNode(
        node_id=identifier, latitude=lat, longitude=lng, name=name,
        node_type=node_type, building_id=building_id, status=status,
    ))


def pathway(identifier, source, target, modes, direction="Two Way", status="active", name=None):
    db.session.add(Pathway(
        pathway_id=identifier, source_node_id=source, destination_node_id=target, path_type="Walkway",
        name=name or f"Path {identifier}", status=status, direction=direction,
    ))
    db.session.add_all(PathwayAllowedMode(pathway_id=identifier, mode=mode) for mode in modes)


def seed_campus():
    place(COLLEGE, "College of Engineering", "College", description="Labs", keywords="coe", latitude=16.722, longitude=121.69)
    place(CAFE, "Cafe", "Food", description="Coffee", keywords="food", latitude=16.721, longitude=121.691)
    place(ANNEX, "Annex", "Campus Services", latitude=16.72, longitude=121.691)
    place(LIBRARY, "Library", "College")
    place(CLOSED, "Closed Hall", "College", status="inactive")
    db.session.add(Location(
        location_id=1, location_code="R1", location_name="Room 101", type_id=1,
        building_id=COLLEGE, status="active", created_at=NOW, updated_at=NOW,
    ))

    node(GATE, 16.720, 121.690, name="Main Gate")
    node(JUNCTION, 16.721, 121.690)
    node(COLLEGE_DOOR, 16.722, 121.690, node_type="Entrance", building_id=COLLEGE)
    node(CAFE_DOOR, 16.721, 121.691, node_type="Entrance", building_id=CAFE)
    node(ANNEX_DOOR, 16.720, 121.691, node_type="Entrance", building_id=ANNEX)
    node(DETOUR, 16.721, 121.688)

    pathway(100, GATE, JUNCTION, ("Walking", "Vehicle"), name="Gate road")
    pathway(101, JUNCTION, COLLEGE_DOOR, ("Walking",), name="College walk")
    pathway(102, JUNCTION, CAFE_DOOR, ("Walking", "Vehicle"), name="Cafe lane")
    pathway(103, ANNEX_DOOR, JUNCTION, ("Walking",), direction="One Way", name="Annex exit")
    pathway(104, GATE, CAFE_DOOR, ("Walking",), status="inactive", name="Old shortcut")
    pathway(105, GATE, DETOUR, ("Walking",), name="West path")
    pathway(106, DETOUR, COLLEGE_DOOR, ("Walking",), name="West path")


def summary(range_key="week"):
    return summarize_decision_analytics(range_key, now=NOW)


def check(result, key):
    return next(row for row in result["readiness"]["checks"] if row["key"] == key)


def ids(refs):
    return sorted(ref["id"] for ref in refs)


# ==========================================
# READINESS
# ==========================================

def test_readiness_counts_active_places_only(app):
    with app.app_context():
        result = summary()

    assert result["readiness"]["total"] == 4
    assert str(CLOSED) not in {ref["id"] for row in result["readiness"]["checks"] for ref in row["missing"]}


def test_an_entrance_counts_only_when_a_routable_pathway_touches_it(app):
    with app.app_context():
        entrance = check(summary(), "entrance")

    # The Annex door is on a one-way pathway, which still links it; the
    # Library has no entrance node at all.
    assert ids(entrance["missing"]) == [str(LIBRARY)]
    assert entrance["complete"] == 3


def test_indoor_rooms_apply_only_to_places_that_may_hold_them(app):
    with app.app_context():
        rooms = check(summary(), "rooms")

    # The Cafe is Food, so it is not asked to have rooms.
    assert rooms["total"] == 3
    assert ids(rooms["missing"]) == [str(ANNEX), str(LIBRARY)]


def test_each_check_lists_who_has_it_and_who_lacks_it_with_no_fully_ready_total(app):
    with app.app_context():
        result = summary()

    # A missing photo and a missing entrance are different problems, so the
    # response carries one count per check and no single "fully ready" number.
    assert "fullyReady" not in result["readiness"]
    photo = check(result, "photo")
    assert (photo["complete"], photo["total"]) == (0, 4)
    assert photo["have"] == []
    # Description and map position are set by the forms and the Map Editor, so they are not checks.
    assert [row["key"] for row in result["readiness"]["checks"]] == ["photo", "keywords", "entrance", "rooms"]
    assert check(result, "rooms")["label"] == "Indoor locations"
    for row in result["readiness"]["checks"]:
        assert row["complete"] + len(row["missing"]) == row["total"]
        assert len(row["have"]) == row["complete"]


# ==========================================
# REACH
# ==========================================

def test_reach_follows_modes_and_one_way_pathways_from_the_main_gate(app):
    with app.app_context():
        reach = summary()["reach"]

    assert reach["origin"] == "Main Gate"
    # College, Cafe and Annex have linked entrances; the Library does not.
    assert reach["total"] == 3
    modes = {row["mode"]: row for row in reach["modes"]}
    # The Annex's only pathway points away from the junction.
    assert ids(modes["Walking"]["unreachable"]) == [str(ANNEX)]
    assert modes["Walking"]["reachable"] == 2
    assert ids(modes["Walking"]["reachablePlaces"]) == sorted([str(COLLEGE), str(CAFE)])
    # One Vehicle bar stands for bicycle, motorcycle and car; the College walk is walking-only.
    assert list(modes) == ["Walking", "Vehicle"]
    assert modes["Vehicle"]["reachable"] == 1
    assert ids(modes["Vehicle"]["unreachable"]) == sorted([str(ANNEX), str(COLLEGE)])


def test_a_legacy_wheeled_permission_counts_as_vehicle(app):
    with app.app_context():
        # The College walk is rewritten as a stored "Car" permission: it now carries vehicles.
        PathwayAllowedMode.query.filter_by(pathway_id=101).delete()
        db.session.add(PathwayAllowedMode(pathway_id=101, mode="Car"))
        db.session.commit()
        modes = {row["mode"]: row for row in summary()["reach"]["modes"]}

    assert str(COLLEGE) in ids(modes["Vehicle"]["reachablePlaces"])


def test_no_unique_main_gate_means_reach_and_closures_are_not_measured(app):
    with app.app_context():
        node(99, 16.7, 121.7, name="gate")
        db.session.commit()
        result = summary()

    assert result["reach"] is None
    assert result["closures"] is None


# ==========================================
# CLOSURES
# ==========================================

def test_closure_impact_separates_cut_off_places_from_longer_walks(app):
    with app.app_context():
        closures = {row["pathway"]: row for row in summary()["closures"]}

    # The Cafe lane is the only way to the Cafe.
    assert ids(closures["Cafe lane"]["cutOff"]) == [str(CAFE)]
    assert closures["Cafe lane"]["longerTrip"] == 0
    # Without the Gate road both are still reached round the west path,
    # through the College, only further.
    assert closures["Gate road"]["cutOff"] == []
    assert closures["Gate road"]["longerTrip"] == 2
    assert ids(closures["Gate road"]["longerPlaces"]) == sorted([str(COLLEGE), str(CAFE)])
    assert closures["College walk"]["cutOff"] == []
    assert closures["College walk"]["longerTrip"] == 1
    # The inactive shortcut never counted, so it cannot be closed.
    assert "Old shortcut" not in closures
    # Rows that change nothing are left out, and the worst comes first.
    assert list(closures) == ["Cafe lane", "Gate road", "College walk"]


# ==========================================
# SEARCHES
# ==========================================

def add_accounts():
    db.session.add(UserInfo(id=1, created_at=NOW, user_type="Student"))
    db.session.add(AppUser(id=1, username="s1", info_id=1))
    db.session.add(UserInfo(id=2, created_at=NOW, user_type="Staff"))
    db.session.add(AppUser(id=2, username="t1", info_id=2))


def test_search_activity_is_a_daily_series_stacked_by_account_type(app):
    with app.app_context():
        add_accounts()
        db.session.add_all([
            UserHistory(id=1, user_id=1, building_id=COLLEGE, created_at=NOW),
            UserHistory(id=2, user_id=1, building_id=COLLEGE, location_id=1, created_at=NOW),
            UserHistory(id=3, user_id=2, building_id=CAFE, created_at=NOW - timedelta(days=2)),
            # No account (deleted): counted in the day's total, in no account type.
            UserHistory(id=4, user_id=None, building_id=CAFE, created_at=NOW),
            # Outside the week.
            UserHistory(id=5, user_id=1, building_id=CAFE, created_at=datetime(2026, 1, 1, tzinfo=timezone.utc)),
        ])
        db.session.commit()
        searches = summary()["searches"]

    assert searches["total"] == 4
    assert searches["byAccountType"] == {"student": 2, "teacher": 1, "visitor": 0}
    assert "byDestinationType" not in searches
    activity = searches["activity"]
    assert activity["bucket"] == "day"
    # Manila today (Oct 9, 12:00) and the six days before it.
    assert [point["date"] for point in activity["points"]] == [f"2026-10-{day:02d}" for day in range(3, 10)]
    today, two_days_ago = activity["points"][-1], activity["points"][4]
    assert today == {"date": "2026-10-09", "total": 3, "student": 2, "teacher": 0, "visitor": 0}
    assert two_days_ago == {"date": "2026-10-07", "total": 1, "student": 0, "teacher": 1, "visitor": 0}
    # Every search lands in exactly one bucket, and the types add up to byAccountType.
    assert sum(point["total"] for point in activity["points"]) == searches["total"]
    for name in ("student", "teacher", "visitor"):
        assert sum(point[name] for point in activity["points"]) == searches["byAccountType"][name]


def test_search_activity_is_weekly_for_all_time_and_for_a_year_and_buckets_by_manila_day(app):
    with app.app_context():
        db.session.add_all([
            # 2026-10-08 17:00 UTC is already Oct 9 in Manila.
            UserHistory(id=1, building_id=CAFE, created_at=datetime(2026, 10, 8, 17, 0, tzinfo=timezone.utc)),
            UserHistory(id=2, building_id=CAFE, created_at=datetime(2026, 9, 1, 3, 0, tzinfo=timezone.utc)),
        ])
        db.session.commit()
        everything, year = summary("all")["searches"]["activity"], summary("year-2026")["searches"]["activity"]

    assert everything["bucket"] == year["bucket"] == "week"
    # All time starts on the first search's Manila day, and each bucket is named by its first day.
    assert everything["points"][0]["date"] == "2026-09-01"
    assert everything["points"][0]["total"] == 1
    assert everything["points"][-1]["total"] == 1
    assert sum(point["total"] for point in everything["points"]) == 2
    assert year["points"][0]["date"] == "2026-01-01"
    assert sum(point["total"] for point in year["points"]) == 2


def test_marker_gap_counts_searches_for_destinations_without_markers_next_to_the_totals(app):
    ring = [[16.7, 121.7], [16.7, 121.701], [16.701, 121.701]]
    with app.app_context():
        place(60, "Pavilion", "Food", polygon_coordinates=ring)
        place(61, "Sliver", "Food", polygon_coordinates=ring[:2])
        for identifier, name, type_id, building, coordinates, status in (
            (2, "Room 102", 1, LIBRARY, {}, "active"),
            (3, "Dean's Office", 3, COLLEGE, {"latitude": 16.7221, "longitude": 121.6901}, "active"),
            (4, "Old Lab", 2, COLLEGE, {}, "inactive"),
            # Its building is inactive, so the app lists neither: not a destination anyone can reach.
            (5, "Closed Hall Room", 1, CLOSED, {"latitude": 16.7, "longitude": 121.7}, "active"),
            (6, "Orphan Room", 1, None, {}, "active"),
        ):
            db.session.add(Location(
                location_id=identifier, location_code=f"L{identifier}", location_name=name, type_id=type_id,
                building_id=building, status=status, created_at=NOW, updated_at=NOW, **coordinates,
            ))
        history = [
            (COLLEGE, None), (COLLEGE, None),      # Place with a point
            (60, None),                            # Place with only a footprint: on the map
            (61, None), (61, None),                # a two-point ring encloses nothing
            (LIBRARY, None),                       # no position at all
            (None, 1), (None, 1), (None, 1),       # Room 101: no marker, building on the map
            (None, 2),                             # Room 102: no marker, building not on the map
            (None, 3), (None, 3),                  # Office with its own marker
            (None, 4),                             # inactive Laboratory: not counted
            (None, 5), (None, 6),                  # room under an inactive building / with no building: not counted
            (None, 99),                            # deleted Location: not counted
            (CLOSED, None),                        # inactive Place: not counted
        ]
        db.session.add_all(
            UserHistory(id=index, building_id=building, location_id=location, created_at=NOW)
            for index, (building, location) in enumerate(history, start=1)
        )
        db.session.commit()
        searches = summary()["searches"]

    gap = {row["type"]: row for row in searches["markerGap"]}
    assert list(gap) == ["Building", "Room", "Laboratory", "Office", "Restroom"]

    places = gap["Building"]
    assert (places["searches"], places["withoutMarker"], places["notOnMap"]) == (6, 3, 3)
    assert [(row["id"], row["searches"]) for row in places["missing"]] == [("61", 2), (str(LIBRARY), 1)]
    assert [(row["id"], row["searches"]) for row in places["have"]] == [(str(COLLEGE), 2), ("60", 1)]

    # A Room with no marker is still shown at its building: only Room 102's
    # building is also off the map, so only its search leaves nothing to show.
    rooms = gap["Room"]
    assert (rooms["searches"], rooms["withoutMarker"], rooms["notOnMap"]) == (4, 4, 1)
    assert [(row["id"], row["name"], row["searches"]) for row in rooms["missing"]] == [
        ("1", "Room 101", 3), ("2", "Room 102", 1),
    ]
    assert rooms["have"] == []

    offices = gap["Office"]
    assert (offices["searches"], offices["withoutMarker"], offices["notOnMap"]) == (2, 0, 0)
    assert [row["id"] for row in offices["have"]] == ["3"] and offices["missing"] == []

    # The inactive Laboratory is not a destination anyone can reach.
    assert (gap["Laboratory"]["searches"], gap["Laboratory"]["missing"]) == (0, [])
    assert gap["Restroom"]["searches"] == 0


# ==========================================
# ROUTE
# ==========================================

def test_the_route_rejects_an_unknown_range(app):
    response = app.test_client().get("/api/dashboard/decision-analytics?range=year")

    assert response.status_code == 400
    assert response.get_json()["errors"] == {"range": "Choose week, month, all, or year-YYYY up to this year."}
    assert app.test_client().get("/api/dashboard/decision-analytics?range=year-2999").status_code == 400


def test_the_route_returns_the_summary(app):
    response = app.test_client().get("/api/dashboard/decision-analytics?range=month")

    assert response.status_code == 200
    body = response.get_json()
    assert body["success"] is True
    assert body["data"]["range"] == "month"
    assert set(body["data"]) == {"range", "firstAnalyticsYear", "readiness", "closures", "reach", "searches"}


def test_a_calendar_year_counts_only_searches_in_that_manila_year(app):
    with app.app_context():
        db.session.add_all([
            # 2025-12-31 17:00 UTC is already 2026-01-01 in Manila.
            UserHistory(id=1, building_id=CAFE, created_at=datetime(2025, 12, 31, 17, 0, tzinfo=timezone.utc)),
            UserHistory(id=2, building_id=CAFE, created_at=datetime(2025, 6, 1, tzinfo=timezone.utc)),
            UserHistory(id=3, building_id=CAFE, created_at=datetime(2025, 12, 31, 15, 0, tzinfo=timezone.utc)),
        ])
        db.session.commit()
        this_year = summary("year-2026")
        last_year = summary("year-2025")

    assert this_year["searches"]["total"] == 1
    assert last_year["searches"]["total"] == 2
    assert last_year["firstAnalyticsYear"] == 2025
