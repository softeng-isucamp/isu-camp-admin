from datetime import datetime, timedelta, timezone

import pytest
from flask import Flask

import dashboard as dashboard_module
from dashboard import dashboard_bp
from extensions import db
from model.audit_log import AuditLog
from model.app_user import AppUser, UserInfo
from model.building import Building
from model.location import Location
from model.path_point import PathPoint  # noqa: F401 - registers Pathway.path_points relationship
from model.pathway import Pathway
from model.pathway_allowed_mode import PathwayAllowedMode  # noqa: F401 - registers Pathway.allowed_modes relationship
from model.route_node import RouteNode
from model.user_history import UserHistory


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
    monkeypatch.setattr(dashboard_module, "admin_required", lambda: (object(), None))

    with app.app_context():
        db.session.execute(db.text("ATTACH DATABASE ':memory:' AS public"))
        db.metadata.create_all(db.engine)
        yield app
        db.session.remove()
        db.drop_all()


def test_dashboard_summarizes_counts_and_recent_activity(app):
    now = datetime.now(timezone.utc)
    with app.app_context():
        db.session.add_all([
            Building(building_id=1, building_code="ENG", building_name="Engineering Hall"),
            Building(building_id=2, building_code="LIB", building_name="Library"),
            AppUser(id=1, username="student01"),
            Location(location_id=1, building_id=1, type_id=3, location_code="ENG-201", location_name="Dean's Office"),
            Location(location_id=2, building_id=1, type_id=1, location_code="ENG-202", location_name="Room 202"),
            RouteNode(node_id=1, building_id=1, latitude=1.0, longitude=1.0, node_type="entrance"),
            RouteNode(node_id=2, building_id=2, latitude=2.0, longitude=2.0, node_type="entrance"),
            Pathway(pathway_id=1, source_node_id=1, destination_node_id=2, path_type="Walkway", status="active"),
            Pathway(pathway_id=2, source_node_id=2, destination_node_id=1, path_type="Walkway", status="closed"),
            AuditLog(id=1, created_at=now - timedelta(days=1), category="Admin", actor="admin01", action="create", target="Building", target_id="1"),
            AuditLog(id=2, created_at=now - timedelta(days=40), category="Admin", actor="admin01", action="create", target="Building", target_id="2"),
            AuditLog(id=3, created_at=now - timedelta(hours=1), category="Admin", actor="admin01", action="update", target="Room 202"),
        ])
        db.session.commit()

    response = app.test_client().get("/api/dashboard?range=week")

    assert response.status_code == 200
    data = response.json["data"]
    assert data["buildings"] == 2
    assert data["indoorLocations"] == 2
    assert data["users"] == 1
    assert data["usersByType"] == {"student": 0, "teacher": 0, "visitor": 0}
    assert data["locations"] == 4
    assert data["pathways"] == 1
    assert data["buildingChange"] == 1
    assert data["searches"] == 0
    assert data["topSearched"] == []
    assert [entry["id"] for entry in data["recent"]] == ["3", "1", "2"]


def test_dashboard_ranks_selected_indoor_locations_without_double_counting_their_building(app):
    now = datetime.now(timezone.utc)
    with app.app_context():
        db.session.add_all([
            AppUser(id=1, username="student01"),
            Building(building_id=1, building_code="ENG", building_name="Engineering Hall"),
            Building(building_id=2, building_code="LIB", building_name="Library"),
            Location(location_id=1, building_id=2, type_id=1, location_code="ENG-201", location_name="Room 201"),
            UserHistory(id=1, user_id=1, building_id=1, location_id=1, created_at=now - timedelta(hours=2)),
            UserHistory(id=2, user_id=1, building_id=1, location_id=1, created_at=now - timedelta(hours=1)),
            UserHistory(id=3, user_id=1, building_id=2, created_at=now - timedelta(minutes=30)),
            UserHistory(id=4, user_id=1, building_id=1, created_at=now - timedelta(minutes=15)),
        ])
        db.session.commit()

    response = app.test_client().get("/api/dashboard?range=week")

    assert response.status_code == 200
    assert response.json["data"]["searches"] == 4
    assert response.json["data"]["topSearched"] == [
        {
            "rank": "1",
            "locationId": "Room:1",
            "name": "Room 201",
            "context": "Engineering Hall",
            "searches": 2,
        },
        {
            "rank": "2",
            "locationId": "Building:1",
            "name": "Engineering Hall",
            "context": "Building",
            "searches": 1,
        },
        {
            "rank": "3",
            "locationId": "Building:2",
            "name": "Library",
            "context": "Building",
            "searches": 1,
        },
    ]


def test_dashboard_filters_searches_by_range_and_limits_tied_results_deterministically(app):
    now = datetime.now(timezone.utc)
    names = ["Foxtrot", "Echo", "Delta", "Charlie", "Bravo", "Alpha", "Monthly", "Ancient"]
    with app.app_context():
        for identifier, name in enumerate(names, start=1):
            db.session.add(Building(
                building_id=identifier,
                building_code=f"B{identifier}",
                building_name=name,
            ))
            db.session.add(UserHistory(
                id=identifier,
                building_id=identifier,
                created_at=now - (
                    timedelta(days=40)
                    if name == "Ancient"
                    else timedelta(days=20)
                    if name == "Monthly"
                    else timedelta(hours=identifier)
                ),
            ))
        db.session.commit()

    week = app.test_client().get("/api/dashboard?range=week").json["data"]
    month = app.test_client().get("/api/dashboard?range=month").json["data"]
    all_time = app.test_client().get("/api/dashboard?range=all").json["data"]

    assert week["searches"] == 6
    assert [row["name"] for row in week["topSearched"]] == [
        "Alpha", "Bravo", "Charlie", "Delta", "Echo",
    ]
    assert month["searches"] == 7
    assert all_time["searches"] == 8
    assert [row["name"] for row in all_time["topSearched"]] == [
        "Alpha", "Ancient", "Bravo", "Charlie", "Delta",
    ]


def test_dashboard_folds_the_stored_spellings_into_one_count_per_type(app):
    with app.app_context():
        db.session.add_all([
            # The User App writes its signup picker labels; the backfill and the
            # admin's own vocabulary are lower case.
            UserInfo(id=1, user_type="Student"),
            UserInfo(id=2, user_type="Student"),
            UserInfo(id=3, user_type="Staff"),
            UserInfo(id=4, user_type="teacher"),
            UserInfo(id=5, user_type="faculty"),
            UserInfo(id=6, user_type=None),
            AppUser(id=1, username="student01", info_id=1),
            AppUser(id=2, username="student02", info_id=2),
            AppUser(id=3, username="staff01", info_id=3),
            AppUser(id=4, username="teacher01", info_id=4),
            AppUser(id=5, username="unrecognized", info_id=5),
            AppUser(id=6, username="typeless", info_id=6),
            AppUser(id=7, username="without-info"),
        ])
        db.session.commit()

    response = app.test_client().get("/api/dashboard?range=week")

    assert response.status_code == 200
    data = response.json["data"]
    assert data["users"] == 7
    # "Staff" and "teacher" are one category, so they share a bucket. No
    # visitors registered yet, and the three accounts with no recognizable type
    # are left out of the split rather than folded into one of the three - so it
    # adds up to less than the users total.
    assert data["usersByType"] == {"student": 2, "teacher": 2, "visitor": 0}


def test_dashboard_counts_account_types_independently_of_the_selected_range(app):
    with app.app_context():
        db.session.add_all([
            UserInfo(id=1, created_at=datetime.now(timezone.utc) - timedelta(days=400), user_type="Visitor"),
            AppUser(id=1, username="long-standing-visitor", info_id=1),
        ])
        db.session.commit()

    client = app.test_client()
    split = {"student": 0, "teacher": 0, "visitor": 1}

    assert client.get("/api/dashboard?range=week").json["data"]["usersByType"] == split
    assert client.get("/api/dashboard?range=month").json["data"]["usersByType"] == split
    assert client.get("/api/dashboard?range=all").json["data"]["usersByType"] == split


def test_dashboard_all_time_omits_building_change(app):
    response = app.test_client().get("/api/dashboard?range=all")

    assert response.status_code == 200
    assert response.json["data"]["buildingChange"] is None


def test_dashboard_rejects_invalid_range(app):
    response = app.test_client().get("/api/dashboard?range=year")

    assert response.status_code == 400
    assert response.json["success"] is False


def test_dashboard_requires_authentication(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(dashboard_bp)
    monkeypatch.setattr(
        dashboard_module,
        "admin_required",
        lambda: (None, ({"error": "Authentication required"}, 401)),
    )

    response = app.test_client().get("/api/dashboard")

    assert response.status_code == 401
