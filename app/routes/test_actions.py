import sys
from pathlib import Path

from flask import Flask

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services"))

import actions as actions_module
from actions import actions_bp
import location as location_module
from location import location_bp


class ListRecord:
    def __init__(self, identifier, name, code, building_id=None):
        self.location_id = identifier
        self.location_name = name
        self.location_code = code
        self.type_id = 1
        self.building_id = building_id
        self.floor_id = None
        self.floor_level = "Ground Floor"
        self.description = name
        self.keywords = "keyword"
        self.lat = self.lng = None
        self.photo = None

    def to_location_dto(self, building=None, floor=None):
        return {
            "id": str(self.location_id), "name": self.location_name,
            "code": self.location_code, "type": "Room",
            "parentId": str(self.building_id) if self.building_id else None,
            "building": building, "floor": self.floor_level or floor,
            "function": self.description, "keywords": self.keywords,
            "status": "Active", "lat": None, "lng": None,
            "positioned": False, "hasPhoto": False,
        }


class ListBuilding:
    def __init__(self, identifier, name):
        self.building_id = identifier
        self.building_name = name
        self.building_code = f"B-{identifier}"

    def to_location_dto(self):
        return {
            "id": str(self.building_id), "name": self.building_name,
            "code": self.building_code, "type": "Building", "parentId": None,
            "building": None, "floor": None, "function": None,
            "keywords": None, "status": "Active", "lat": None, "lng": None,
            "positioned": False, "hasPhoto": False,
        }


class ListQuery:
    def __init__(self, values):
        self.values = values

    def order_by(self, *_columns):
        return self

    def all(self):
        return self.values


def _list_app(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(actions_bp)
    buildings = [ListBuilding(2, "Building B"), ListBuilding(1, "Building A")]
    records = [ListRecord(12, "Room B", "B-ROOM", 2), ListRecord(11, "Room A", "A-ROOM", 1)]
    monkeypatch.setattr(actions_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(location_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(actions_module, "Location", type("LocationModel", (), {
        "query": ListQuery(records), "location_id": FakeColumn(),
    }))
    monkeypatch.setattr(actions_module, "Building", type("BuildingModel", (), {
        "query": ListQuery(buildings), "building_id": FakeColumn(),
    }))
    monkeypatch.setattr(actions_module, "Floor", type("FloorModel", (), {
        "query": ListQuery([]), "floor_id": FakeColumn(),
    }))
    monkeypatch.setattr(location_module, "Location", actions_module.Location)
    monkeypatch.setattr(location_module, "Building", actions_module.Building)
    monkeypatch.setattr(location_module, "Floor", actions_module.Floor)
    return app
from model.location import LOCATION_TYPE_IDS, LOCATION_TYPE_NAMES


class FakeQuery:
    def __init__(self, record):
        self.record = record

    def filter_by(self, **kwargs):
        return self

    def first(self):
        return self.record

    def order_by(self, *_columns):
        return self

    def all(self):
        return self.record


class FakeColumn:
    def asc(self):
        return self

    def desc(self):
        return self


class FakeSession:
    def __init__(self):
        self.deleted = None
        self.commits = 0
        self.rollbacks = 0

    def delete(self, record):
        self.deleted = record

    def flush(self):
        pass

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def test_actions_blueprint_exposes_registered_action_routes(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(actions_bp)
    monkeypatch.setattr(actions_module, "admin_required", lambda: (object(), None))

    paths = {rule.rule for rule in app.url_map.iter_rules()}

    assert "/api/actions/locations" in paths
    assert "/api/actions/locations/<int:location_id>" in paths
    assert "/api/actions/buildings/<int:building_id>/rooms" in paths
    assert "/api/actions/buildings/<int:building_id>/history" in paths


def test_actions_blueprint_requires_authentication(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(actions_bp)
    monkeypatch.setattr(
        actions_module,
        "admin_required",
        lambda: (None, ({"error": "Authentication required"}, 401)),
    )

    response = app.test_client().get("/api/actions/locations")

    assert response.status_code == 401


def test_actions_locations_share_deterministic_family_pagination_contract(monkeypatch):
    client = _list_app(monkeypatch).test_client()

    first = client.get("/api/actions/locations?page=1&pageSize=2")
    second = client.get("/api/actions/locations?page=2&pageSize=2")
    filtered = client.get("/api/actions/locations?type=Room&buildingId=1&pageSize=1")

    assert first.json["success"] is True
    assert first.json["total"] == 4
    assert first.json["page"] == 1
    assert first.json["pageSize"] == 2
    assert [item["id"] for item in first.json["items"]] == ["1", "11"]
    assert [item["id"] for item in second.json["items"]] == ["2", "12"]
    assert filtered.json["total"] == 1
    assert [item["id"] for item in filtered.json["items"]] == ["11"]


def test_locations_endpoints_have_identical_list_results(monkeypatch):
    app = _list_app(monkeypatch)
    app.register_blueprint(location_bp)
    params = "?q=room&buildingId=1&page=1&pageSize=1"

    actions_response = app.test_client().get("/api/actions/locations" + params)
    locations_response = app.test_client().get("/api/locations" + params)

    assert actions_response.status_code == locations_response.status_code == 200
    assert actions_response.json == locations_response.json


def test_actions_location_contract_accepts_restroom_with_canonical_type_id():
    assert actions_module.CREATABLE_TYPES == {
        "Room", "Laboratory", "Office", "Restroom", "Building"
    }
    assert actions_module.TYPE_IDS == LOCATION_TYPE_IDS
    assert LOCATION_TYPE_NAMES[LOCATION_TYPE_IDS["Restroom"]] == "Restroom"


def test_actions_can_delete_a_building(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(actions_bp)
    session = FakeSession()
    building = type("Building", (), {"building_id": 42})()
    monkeypatch.setattr(actions_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(actions_module, "Location", type("Location", (), {"query": FakeQuery(None)}))
    monkeypatch.setattr(actions_module, "Building", type("BuildingModel", (), {"query": FakeQuery(building)}))
    monkeypatch.setattr(actions_module, "db", type("DB", (), {"session": session}))

    response = app.test_client().delete("/api/actions/locations/42")

    assert response.status_code == 200
    assert session.deleted is building


def test_actions_can_edit_a_building(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(actions_bp)
    building = type("Building", (), {
        "building_id": 42,
        "building_code": "OLD",
        "building_name": "Old Hall",
        "description": "Old description",
        "to_location_dto": lambda self: {"id": "42", "name": self.building_name, "code": self.building_code, "type": "Building"},
    })()
    monkeypatch.setattr(actions_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(actions_module, "_all_locations", lambda: [])
    monkeypatch.setattr(actions_module, "_all_buildings", lambda: [building])
    monkeypatch.setattr(actions_module, "_photo_upload", lambda: (None, None, None))
    monkeypatch.setattr(actions_module, "db", type("DB", (), {"session": FakeSession()}))

    response = app.test_client().put("/api/actions/locations/42", json={"name": "New Hall", "code": "NEW", "type": "Building"})

    assert response.status_code == 200
    assert building.building_name == "New Hall"
    assert building.building_code == "NEW"


def _history_app(monkeypatch, building, history):
    app = Flask(__name__)
    app.register_blueprint(actions_bp)
    monkeypatch.setattr(actions_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(
        actions_module,
        "Building",
        type("BuildingModel", (), {"query": FakeQuery(building)}),
    )
    monkeypatch.setattr(
        actions_module,
        "BuildingHistory",
        type(
            "BuildingHistoryModel",
            (),
            {"query": FakeQuery(history), "created_at": FakeColumn()},
        ),
    )
    return app


def test_building_history_returns_a_documented_empty_result(monkeypatch):
    app = _history_app(monkeypatch, type("Building", (), {})(), [])

    response = app.test_client().get("/api/actions/buildings/42/history")

    assert response.status_code == 200
    assert response.json == {"success": True, "data": []}


def test_building_history_serializes_records_and_timestamps(monkeypatch):
    from datetime import datetime, timezone

    timestamp = datetime(2026, 9, 2, 8, 30, tzinfo=timezone.utc)
    record = type(
        "HistoryRecord",
        (),
        {
            "history_id": 7,
            "building_id": 42,
            "action": "Updated Building",
            "field": "building_name",
            "old_value": "Old Hall",
            "new_value": "New Hall",
            "changed_by": "admin01",
            "created_at": timestamp,
        },
    )()
    app = _history_app(monkeypatch, type("Building", (), {})(), [record])

    response = app.test_client().get("/api/actions/buildings/42/history")

    assert response.status_code == 200
    assert response.json["data"] == [{
        "history_id": 7,
        "building_id": 42,
        "action": "Updated Building",
        "field": "building_name",
        "old_value": "Old Hall",
        "new_value": "New Hall",
        "changed_by": "admin01",
        "created_at": "2026-09-02T08:30:00+00:00",
    }]


def test_building_history_returns_404_for_a_missing_building(monkeypatch):
    app = _history_app(monkeypatch, None, [])

    response = app.test_client().get("/api/actions/buildings/42/history")

    assert response.status_code == 404
    assert response.json == {"success": False, "message": "Building not found."}


def test_building_history_rolls_back_and_returns_500_on_query_failure(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(actions_bp)
    session = FakeSession()

    class FailingQuery(FakeQuery):
        def all(self):
            raise RuntimeError("database unavailable")

    monkeypatch.setattr(actions_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(actions_module, "Building", type("BuildingModel", (), {"query": FakeQuery(type("Building", (), {})())}))
    monkeypatch.setattr(actions_module, "BuildingHistory", type("BuildingHistoryModel", (), {"query": FailingQuery([]), "created_at": FakeColumn()}))
    monkeypatch.setattr(actions_module, "db", type("DB", (), {"session": session}))

    response = app.test_client().get("/api/actions/buildings/42/history")

    assert response.status_code == 500
    assert response.json == {"success": False, "message": "Failed to get building history."}
    assert session.rollbacks == 1
