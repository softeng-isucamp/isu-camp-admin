from datetime import datetime, timedelta, timezone

import pytest
from flask import Flask

import dashboard as dashboard_route
from dashboard import dashboard_bp
from extensions import db
from model.app_user import AppUser, UserInfo  # noqa: F401 - AppUser registers public.user
from model.building import Building
from model.location import Location
from model.path_point import PathPoint  # noqa: F401 - registers Pathway.path_points
from model.pathway import Pathway  # noqa: F401 - the summary route imports it
from model.pathway_allowed_mode import PathwayAllowedMode  # noqa: F401 - registers Pathway.allowed_modes
from model.route_node import RouteNode  # noqa: F401 - Pathway's foreign keys target it
from model.user_history import UserHistory
from services.dashboard_analytics import MANILA, manila_day, summarize_dashboard_analytics

# A fixed "now" so bucket boundaries are assertable. 2026-10-09 18:00 UTC is
# 2026-10-10 02:00 in Manila, which is the point of choosing it: the Manila day
# is already the next date, so any test that passes here would fail if the
# bucketing used UTC.
NOW = datetime(2026, 10, 9, 18, 0, tzinfo=timezone.utc)
TODAY_MANILA = NOW.astimezone(MANILA).date()


@pytest.fixture
def app(monkeypatch):
    app = Flask(__name__)
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite://",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        TESTING=True,
    )
    db.init_app(app)
    app.register_blueprint(dashboard_bp)
    monkeypatch.setattr(dashboard_route, "admin_required", lambda: (object(), None))

    with app.app_context():
        db.session.execute(db.text("ATTACH DATABASE ':memory:' AS public"))
        db.metadata.create_all(db.engine)
        yield app
        db.session.remove()
        db.drop_all()


def manila_noon(day_offset):
    """Noon Manila, ``day_offset`` days from the fixed today, as a UTC instant."""

    day = TODAY_MANILA + timedelta(days=day_offset)
    return datetime(day.year, day.month, day.day, 12, tzinfo=MANILA).astimezone(timezone.utc)


def add_building(identifier, name, **columns):
    db.session.add(Building(
        building_id=identifier,
        building_code=f"B{identifier}",
        building_name=name,
        classification=columns.pop("classification", "Building"),
        status=columns.pop("status", "active"),
        **columns,
    ))


def add_location(identifier, name, type_id=1, **columns):
    db.session.add(Location(
        location_id=identifier,
        location_code=f"L{identifier}",
        location_name=name,
        type_id=type_id,
        status=columns.pop("status", "active"),
        created_at=columns.pop("created_at", NOW),
        updated_at=columns.pop("updated_at", NOW),
        **columns,
    ))


def add_search(identifier, day_offset, user_id=None, building_id=None, location_id=None):
    db.session.add(UserHistory(
        id=identifier,
        user_id=user_id,
        building_id=building_id,
        location_id=location_id,
        created_at=manila_noon(day_offset),
    ))


# ==========================================
# MANILA BUCKETING
# ==========================================

def test_a_timestamp_late_in_the_utc_day_buckets_into_the_next_manila_day():
    """The whole reason bucketing is not done in UTC.

    17:00 UTC is already 01:00 the next morning in Manila, so a Search made
    then belongs to the following day's bucket.
    """

    assert manila_day(datetime(2026, 10, 9, 17, 0, tzinfo=timezone.utc)) == \
        datetime(2026, 10, 10).date()
    assert manila_day(datetime(2026, 10, 9, 15, 59, tzinfo=timezone.utc)) == \
        datetime(2026, 10, 9).date()


def test_a_naive_timestamp_is_read_as_utc():
    """Every writer in this repository stores UTC, with or without a tzinfo."""

    assert manila_day(datetime(2026, 10, 9, 17, 0)) == datetime(2026, 10, 10).date()


# ==========================================
# RANGES AND PERIODS
# ==========================================

@pytest.mark.parametrize("range_key, expected_buckets", (
    ("week", 7),
    ("month", 30),
))
def test_week_and_month_report_one_bucket_per_day(app, range_key, expected_buckets):
    with app.app_context():
        result = summarize_dashboard_analytics(range_key, now=NOW)

    assert len(result["timeline"]) == expected_buckets
    assert len(result["registrations"]) == expected_buckets
    assert result["timeline"][-1]["date"] == TODAY_MANILA.isoformat()
    assert result["range"] == range_key


def test_all_time_buckets_by_week_and_has_no_comparison_period(app):
    with app.app_context():
        add_search(1, -20, user_id=1)
        db.session.commit()

        result = summarize_dashboard_analytics("all", now=NOW)

    assert result["previous"] is None
    # 21 days of history in seven-day buckets.
    assert len(result["timeline"]) == 3
    assert result["timeline"][0]["date"] == (TODAY_MANILA - timedelta(days=20)).isoformat()


def test_all_time_with_no_data_still_returns_one_bucket(app):
    with app.app_context():
        result = summarize_dashboard_analytics("all", now=NOW)

    assert result["timeline"] == [{"date": TODAY_MANILA.isoformat(), "searches": 0, "visits": 0}]
    assert result["current"]["searches"] == 0
    assert result["previous"] is None


def test_the_previous_period_is_the_equal_window_before_it(app):
    with app.app_context():
        add_search(1, 0, user_id=1)
        add_search(2, -6, user_id=1)
        add_search(3, -7, user_id=2)    # first day of the previous week
        add_search(4, -13, user_id=2)   # last day of the previous week
        add_search(5, -14, user_id=3)   # older than both windows
        db.session.commit()

        result = summarize_dashboard_analytics("week", now=NOW)

    assert result["current"]["searches"] == 2
    assert result["previous"]["searches"] == 2


def test_searches_outside_the_window_are_excluded(app):
    with app.app_context():
        add_search(1, 0, user_id=1)
        add_search(2, -8, user_id=1)
        db.session.commit()

        result = summarize_dashboard_analytics("week", now=NOW)

    assert result["current"]["searches"] == 1
    assert sum(bucket["searches"] for bucket in result["timeline"]) == 1


# ==========================================
# TOTALS
# ==========================================

def test_active_users_counts_distinct_signed_in_users(app):
    with app.app_context():
        add_search(1, 0, user_id=7)
        add_search(2, -1, user_id=7)
        add_search(3, -2, user_id=8)
        add_search(4, -3, user_id=None)  # anonymous: a Search, but not a user
        db.session.commit()

        result = summarize_dashboard_analytics("week", now=NOW)

    assert result["current"]["searches"] == 4
    assert result["current"]["activeUsers"] == 2


def test_visits_are_zero_everywhere_because_no_arrival_event_exists(app):
    """Structural zeros, not measurements - the shape must still be complete."""

    with app.app_context():
        add_building(1, "Library")
        add_search(1, 0, user_id=1, building_id=1)
        db.session.commit()

        result = summarize_dashboard_analytics("week", now=NOW)

    assert result["current"]["visits"] == 0
    assert result["current"]["arrivalRate"] == 0
    assert result["visitsByAccountType"] == {"student": 0, "teacher": 0, "visitor": 0}
    assert result["visitsByDestinationType"] == {
        "Building": 0, "Room": 0, "Laboratory": 0, "Office": 0, "Restroom": 0,
    }
    assert all(bucket["visits"] == 0 for bucket in result["timeline"])
    assert result["topDestinations"][0]["visits"] == 0


def test_arrival_rate_does_not_divide_by_zero(app):
    with app.app_context():
        result = summarize_dashboard_analytics("week", now=NOW)

    assert result["current"]["arrivalRate"] == 0


# ==========================================
# TOP DESTINATIONS
# ==========================================

def test_top_destinations_rank_by_searches_and_name_the_destination(app):
    with app.app_context():
        add_building(1, "Library", classification="Building")
        add_building(2, "Gymnasium", classification="Facility")
        add_location(10, "Physics Lab", type_id=2, building_id=1)
        add_search(1, 0, user_id=1, building_id=1)
        add_search(2, -1, user_id=2, building_id=1)
        add_search(3, -1, user_id=2, building_id=2)
        add_search(4, -2, user_id=3, building_id=1, location_id=10)
        db.session.commit()

        result = summarize_dashboard_analytics("week", now=NOW)

    top = result["topDestinations"]
    assert [row["rank"] for row in top] == ["1", "2", "3"]
    assert top[0] == {
        "rank": "1", "locationId": "Building:1", "name": "Library",
        "context": "Building", "searches": 2, "visits": 0,
    }
    # A Facility keeps its own subtype in the identity key, matching the
    # directory's Type:id convention.
    assert {row["locationId"] for row in top} == {"Building:1", "Facility:2", "Laboratory:10"}
    # An indoor Location is placed in context by its parent Building.
    laboratory = next(row for row in top if row["locationId"] == "Laboratory:10")
    assert laboratory["context"] == "Library"


def test_top_destinations_are_capped_at_eight(app):
    with app.app_context():
        for identifier in range(1, 11):
            add_building(identifier, f"Building {identifier:02d}")
            for sequence in range(identifier):
                add_search(identifier * 100 + sequence, 0, user_id=1, building_id=identifier)
        db.session.commit()

        result = summarize_dashboard_analytics("week", now=NOW)

    assert len(result["topDestinations"]) == 8
    # Busiest first.
    assert result["topDestinations"][0]["name"] == "Building 10"


def test_a_search_for_a_deleted_destination_is_counted_but_not_ranked(app):
    """The Search happened; the row it pointed at is gone, so it cannot be named."""

    with app.app_context():
        add_search(1, 0, user_id=1, building_id=999)
        db.session.commit()

        result = summarize_dashboard_analytics("week", now=NOW)

    assert result["current"]["searches"] == 1
    assert result["topDestinations"] == []


# ==========================================
# REGISTRATIONS
# ==========================================

def test_registrations_split_by_account_type_per_bucket(app):
    with app.app_context():
        db.session.add_all([
            UserInfo(id=1, created_at=manila_noon(0), user_type="Student"),
            UserInfo(id=2, created_at=manila_noon(0), user_type="Staff"),
            UserInfo(id=3, created_at=manila_noon(-1), user_type="Visitor"),
        ])
        db.session.commit()

        result = summarize_dashboard_analytics("week", now=NOW)

    today = next(row for row in result["registrations"] if row["date"] == TODAY_MANILA.isoformat())
    # "Staff" is the User App's spelling for a teacher account.
    assert today == {"date": TODAY_MANILA.isoformat(), "student": 1, "teacher": 1, "visitor": 0}
    yesterday = next(
        row for row in result["registrations"]
        if row["date"] == (TODAY_MANILA - timedelta(days=1)).isoformat()
    )
    assert yesterday["visitor"] == 1


def test_an_unrecognized_account_type_is_left_out_rather_than_guessed(app):
    with app.app_context():
        db.session.add_all([
            UserInfo(id=1, created_at=manila_noon(0), user_type="Alumni"),
            UserInfo(id=2, created_at=manila_noon(0), user_type=None),
            UserInfo(id=3, created_at=manila_noon(0), user_type="Student"),
        ])
        db.session.commit()

        result = summarize_dashboard_analytics("week", now=NOW)

    today = next(row for row in result["registrations"] if row["date"] == TODAY_MANILA.isoformat())
    assert today["student"] == 1
    assert today["teacher"] == 0 and today["visitor"] == 0


# ==========================================
# DIRECTORY COMPLETENESS
# ==========================================

def test_completeness_counts_each_field_over_the_active_directory(app):
    with app.app_context():
        add_building(1, "Library", description="Books", keywords="library books",
                     latitude=16.7, longitude=121.6)
        add_building(2, "Annex")  # nothing filled in, unplaced
        add_location(10, "Room 1", type_id=1, description="A room", keywords="room",
                     latitude=16.7, longitude=121.6)
        db.session.commit()

        result = summarize_dashboard_analytics("week", now=NOW)

    assert result["completenessTotal"] == 3
    checks = {check["key"]: check for check in result["completeness"]}
    assert [check["key"] for check in result["completeness"]] == \
        ["photo", "description", "keywords", "mapPin"]
    assert checks["description"]["complete"] == 2
    assert checks["keywords"]["complete"] == 2
    assert checks["mapPin"]["complete"] == 2
    assert checks["photo"]["complete"] == 0
    assert all(check["total"] == 3 for check in result["completeness"])
    assert [check["label"] for check in result["completeness"]] == \
        ["Photo", "Description", "Search keywords", "Map pin"]


def test_a_building_placed_by_footprint_counts_as_placed(app):
    """A Building can be on the map as a polygon instead of a pin."""

    with app.app_context():
        add_building(1, "Library", polygon_coordinates=[[1, 1], [2, 2], [3, 3]])
        add_building(2, "Annex", polygon_coordinates=[[1, 1], [2, 2]])  # not a ring
        db.session.commit()

        result = summarize_dashboard_analytics("week", now=NOW)

    checks = {check["key"]: check for check in result["completeness"]}
    assert checks["mapPin"]["complete"] == 1


def test_completeness_ignores_inactive_and_blank_text(app):
    with app.app_context():
        add_building(1, "Library", description="Books", status="active")
        add_building(2, "Retired", description="Books", status="inactive")
        add_location(10, "Room 1", type_id=1, description="   ", status="active")
        db.session.commit()

        result = summarize_dashboard_analytics("week", now=NOW)

    assert result["completenessTotal"] == 2
    checks = {check["key"]: check for check in result["completeness"]}
    # Whitespace is not a description.
    assert checks["description"]["complete"] == 1


# ==========================================
# ROUTE
# ==========================================

def test_route_serves_the_analytics_envelope(app):
    with app.app_context():
        add_building(1, "Library")
        add_search(1, 0, user_id=1, building_id=1)
        db.session.commit()

        response = app.test_client().get("/api/dashboard/analytics?range=month")
        body = response.get_json()

    assert response.status_code == 200
    assert body["success"] is True
    data = body["data"]
    assert data["range"] == "month"
    # The full contract the frontend's Zod schema requires.
    assert set(data) == {
        "range", "current", "previous", "timeline", "visitsByAccountType",
        "visitsByDestinationType", "registrations", "topDestinations",
        "completeness", "completenessTotal",
    }
    assert set(data["current"]) == {"activeUsers", "searches", "visits", "arrivalRate"}


def test_route_defaults_to_the_week_range(app):
    with app.app_context():
        response = app.test_client().get("/api/dashboard/analytics")

    assert response.status_code == 200
    assert response.get_json()["data"]["range"] == "week"


def test_route_rejects_an_unknown_range(app):
    with app.app_context():
        response = app.test_client().get("/api/dashboard/analytics?range=decade")

    assert response.status_code == 400
    assert response.get_json() == {"success": False, "message": "Invalid range."}


def test_route_requires_a_signed_in_admin(app, monkeypatch):
    from flask import jsonify

    monkeypatch.setattr(
        dashboard_route, "admin_required",
        lambda: (None, (jsonify({"success": False, "message": "Not authenticated"}), 401)),
    )

    with app.app_context():
        response = app.test_client().get("/api/dashboard/analytics")

    assert response.status_code == 401


def test_route_reports_a_failure_without_leaking_it(app, monkeypatch):
    def explode(*_args, **_kwargs):
        raise RuntimeError("the database went away")

    monkeypatch.setattr(dashboard_route, "summarize_dashboard_analytics", explode)

    with app.app_context():
        response = app.test_client().get("/api/dashboard/analytics")

    assert response.status_code == 500
    assert response.get_json() == {
        "success": False,
        "message": "Failed to load dashboard analytics.",
    }
