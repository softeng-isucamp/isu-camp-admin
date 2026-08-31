import sys
from pathlib import Path

from flask import Flask

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services"))

import location as location_module
from location import location_bp


class FakeRecord:
    def __init__(self, identifier, name, code, type_id, building_id=None, floor_id=None):
        self.location_id = identifier
        self.location_name = name
        self.location_code = code
        self.type_id = type_id
        self.building_id = building_id
        self.floor_id = floor_id
        self.description = "A searchable description"
        self.keywords = "directory keyword"

    def to_location_dto(self, building=None, floor=None):
        return {
            "id": str(self.location_id), "name": self.location_name,
            "code": self.location_code, "type": "Room" if self.type_id == 3 else "Building",
            "parentId": str(self.building_id) if self.building_id else None,
            "building": building, "floor": floor, "function": self.description,
            "keywords": self.keywords, "status": "Active", "lat": None,
            "lng": None, "positioned": False,
        }


class FakeQuery:
    def __init__(self, records):
        self.records = records

    def order_by(self, _):
        return self

    def all(self):
        return self.records


class FakeColumn:
    def asc(self):
        return self


def make_client(monkeypatch):
    app = Flask(__name__)
    app.secret_key = "test"
    app.register_blueprint(location_bp)
    monkeypatch.setattr(location_module, "admin_required", lambda: (object(), None))
    building = FakeRecord(1, "Engineering Hall", "ENG", 1)
    room = FakeRecord(2, "Room 204", "ENG-204", 3, building_id=1)
    monkeypatch.setattr(location_module, "Location", type("FakeLocation", (), {
        "query": FakeQuery([building, room]), "location_id": FakeColumn(),
    }))
    return app.test_client()


def test_list_locations_returns_authenticated_searchable_page(monkeypatch):
    client = make_client(monkeypatch)
    response = client.get("/api/locations?q=ROOM&page=1&pageSize=1")
    assert response.status_code == 200
    assert response.json["total"] == 1
    assert response.json["items"][0]["id"] == "2"
    assert response.json["items"][0]["status"] == "Active"
    assert response.json["items"][0]["positioned"] is False


def test_list_locations_requires_authentication(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(location_bp)
    monkeypatch.setattr(location_module, "admin_required", lambda: (None, ({"error": "unused"}, 401)))
    response = app.test_client().get("/api/locations")
    assert response.status_code == 401
