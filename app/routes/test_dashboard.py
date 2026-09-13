import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from flask import Flask

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services"))

import dashboard as dashboard_module
from dashboard import dashboard_bp
from extensions import db
from model.audit_log import AuditLog
from model.building import Building
from model.location import Location
from model.path_point import PathPoint  # noqa: F401 - registers Pathway.path_points relationship
from model.pathway import Pathway
from model.pathway_allowed_mode import PathwayAllowedMode  # noqa: F401 - registers Pathway.allowed_modes relationship
from model.route_node import RouteNode


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
            Location(location_id=1, building_id=1, type_id=3, location_code="ENG-201", location_name="Dean's Office"),
            Location(location_id=2, building_id=1, type_id=1, location_code="ENG-202", location_name="Room 202"),
            RouteNode(node_id=1, building_id=1, latitude=1.0, longitude=1.0, node_type="entrance"),
            RouteNode(node_id=2, building_id=2, latitude=2.0, longitude=2.0, node_type="entrance"),
            Pathway(pathway_id=1, source_node_id=1, destination_node_id=2, path_type="Walkway", distance_m=10, estimated_minutes=1, status="active"),
            Pathway(pathway_id=2, source_node_id=2, destination_node_id=1, path_type="Walkway", distance_m=10, estimated_minutes=1, status="closed"),
            AuditLog(id=1, created_at=now - timedelta(days=1), category="Admin", actor="admin01", action="create", target="Building", target_id="1"),
            AuditLog(id=2, created_at=now - timedelta(days=40), category="Admin", actor="admin01", action="create", target="Building", target_id="2"),
            AuditLog(id=3, created_at=now - timedelta(hours=1), category="Admin", actor="admin01", action="update", target="Room 202"),
        ])
        db.session.commit()

    response = app.test_client().get("/api/dashboard?range=week")

    assert response.status_code == 200
    data = response.json["data"]
    assert data["buildings"] == 2
    assert data["offices"] == 1
    assert data["locations"] == 4
    assert data["pathways"] == 1
    assert data["buildingChange"] == 1
    assert data["searches"] == 0
    assert data["topSearched"] == []
    assert [entry["id"] for entry in data["recent"]] == ["3", "1", "2"]


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
