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
        self.lat = None
        self.lng = None

    def to_location_dto(self, building=None, floor=None):
        return {
            "id": str(self.location_id), "name": self.location_name,
            "code": self.location_code, "type": "Room" if self.type_id == 3 else "Building",
            "parentId": str(self.building_id) if self.building_id else None,
            "building": building, "floor": floor, "function": self.description,
            "keywords": self.keywords, "status": "Active",
            "lat": self.lat, "lng": self.lng,
            "positioned": self.lat is not None and self.lng is not None,
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


class MutationQuery:
    def __init__(self, records):
        self.records = records

    def order_by(self, _):
        return self

    def all(self):
        return self.records

    def get(self, identifier):
        return next((record for record in self.records if record.location_id == int(identifier)), None)


class MutationSession:
    def __init__(self, records):
        self.records = records
        self.commits = 0
        self.rollbacks = 0
        self.fail_commit = False
        self.pending = None

    def add(self, record):
        record.location_id = max((item.location_id for item in self.records), default=0) + 1
        self.records.append(record)
        self.pending = record

    def flush(self):
        pass

    def commit(self):
        if self.fail_commit:
            raise RuntimeError("database unavailable")
        self.commits += 1
        self.pending = None

    def rollback(self):
        self.rollbacks += 1
        if self.pending in self.records:
            self.records.remove(self.pending)
        self.pending = None


def make_mutation_client(monkeypatch):
    app = Flask(__name__)
    app.secret_key = "test"
    app.register_blueprint(location_bp)
    monkeypatch.setattr(location_module, "admin_required", lambda: (object(), None))
    records = []
    session = MutationSession(records)

    class MutationRecord(FakeRecord):
        query = MutationQuery(records)
        location_id = FakeColumn()

        def __init__(self, **values):
            super().__init__(0, values["location_name"], values["location_code"], values["type_id"], values.get("building_id"), values.get("floor_id"))
            self.description = values.get("description")
            self.keywords = values.get("keywords")
            self.floor_level = values.get("floor_level")
            self.photo = None

        def to_location_dto(self, building=None, floor=None):
            dto = super().to_location_dto(building, self.floor_level or floor)
            dto["function"] = self.description
            dto["keywords"] = self.keywords
            return dto

    monkeypatch.setattr(location_module, "Location", MutationRecord)
    monkeypatch.setattr(location_module.db, "session", session)
    return app.test_client(), records, session


def test_create_and_update_round_trip_keeps_description_and_keywords_separate(monkeypatch):
    client, records, _ = make_mutation_client(monkeypatch)
    building = client.post("/api/locations", json={"name": "Engineering Hall", "code": "ENG", "type": "Building", "function": "Building description", "keywords": "engineering"})
    assert building.status_code == 201
    building_id = building.json["id"]
    room = client.post("/api/locations", json={"name": "Room 204", "code": "ENG-204", "type": "Room", "parentId": building_id, "floor": "2nd Floor", "function": "Teaching room", "keywords": "lecture"})
    assert room.status_code == 201
    assert room.json["floor"] == "2nd Floor"

    updated = client.put(f"/api/locations/{room.json['id']}", json={"name": "Room 205", "code": "ENG-205", "type": "Room", "parentId": building_id, "floor": "2nd Floor", "function": "Updated purpose", "keywords": "seminar"})
    assert updated.status_code == 200
    assert updated.json["function"] == "Updated purpose"
    assert updated.json["keywords"] == "seminar"
    assert records[-1].description == "Updated purpose"
    assert records[-1].keywords == "seminar"

    listed = client.get("/api/locations?q=ENG-205")
    assert listed.json["items"][0]["name"] == "Room 205"


def test_mutations_validate_relationship_floor_and_duplicate_without_partial_write(monkeypatch):
    client, records, session = make_mutation_client(monkeypatch)
    building = client.post("/api/locations", json={"name": "Engineering Hall", "code": "ENG", "type": "Building"})
    assert building.status_code == 201
    before = len(records)

    missing_floor = client.post("/api/locations", json={"name": "Room", "code": "ROOM", "type": "Room", "parentId": building.json["id"]})
    assert missing_floor.status_code == 400
    assert missing_floor.json["fields"]["floor"]
    missing_building = client.post("/api/locations", json={"name": "Room", "code": "ROOM", "type": "Room", "parentId": "999", "floor": "Ground Floor"})
    assert missing_building.status_code == 400
    assert missing_building.json["relationships"]["parentId"]
    duplicate = client.post("/api/locations", json={"name": "Other", "code": "eng", "type": "Facility"})
    assert duplicate.status_code == 409
    assert len(records) == before
    assert session.commits == 1


def test_create_rolls_back_when_persistence_fails(monkeypatch):
    client, records, session = make_mutation_client(monkeypatch)
    session.fail_commit = True
    response = client.post("/api/locations", json={"name": "Library", "code": "LIB", "type": "Building"})
    assert response.status_code == 500
    assert records == []
    assert session.rollbacks == 1


def test_position_update_clear_and_reload_persist_for_outdoor_point(monkeypatch):
    client, records, _ = make_mutation_client(monkeypatch)
    facility = client.post("/api/locations", json={"name": "Water Station", "code": "WATER", "type": "Facility"})
    assert facility.status_code == 201
    location_id = facility.json["id"]

    positioned = client.patch(f"/api/locations/{location_id}/position", json={"lat": 16.7215, "lng": 121.6895})
    assert positioned.status_code == 200
    assert positioned.json == {
        **facility.json,
        "lat": 16.7215,
        "lng": 121.6895,
        "positioned": True,
    }

    reloaded = client.get("/api/locations?q=WATER")
    assert reloaded.json["items"][0]["lat"] == 16.7215
    assert reloaded.json["items"][0]["positioned"] is True

    cleared = client.patch(f"/api/locations/{location_id}/position", json={"lat": None, "lng": None})
    assert cleared.status_code == 200
    assert cleared.json["lat"] is None
    assert cleared.json["lng"] is None
    assert cleared.json["positioned"] is False
    assert records[-1].type_id == 7


def test_position_rejects_invalid_coordinates_and_indoor_locations_without_writes(monkeypatch):
    client, records, session = make_mutation_client(monkeypatch)
    building = client.post("/api/locations", json={"name": "Hall", "code": "HALL", "type": "Building"})
    room = client.post("/api/locations", json={"name": "Room", "code": "ROOM", "type": "Room", "parentId": building.json["id"], "floor": "Ground Floor"})
    facility = client.post("/api/locations", json={"name": "Facility", "code": "FACILITY", "type": "Facility"})
    room_record = next(record for record in records if record.location_id == int(room.json["id"]))
    before = (room_record.lat, room_record.lng)

    invalid = client.patch(f"/api/locations/{facility.json['id']}/position", json={"lat": 91, "lng": 121})
    assert invalid.status_code == 400
    assert invalid.json["fields"]["lat"]
    assert (records[-1].lat, records[-1].lng) == (None, None)

    indoor = client.patch(f"/api/locations/{room.json['id']}/position", json={"lat": 16.7, "lng": 121.6})
    assert indoor.status_code == 400
    assert indoor.json["fields"]["position"]
    assert (room_record.lat, room_record.lng) == before
    assert session.commits == 3


def test_position_requires_authentication(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(location_bp)
    monkeypatch.setattr(location_module, "admin_required", lambda: (None, ({"error": "unauthorized"}, 401)))
    response = app.test_client().patch("/api/locations/1/position", json={"lat": 16, "lng": 121})
    assert response.status_code == 401


def test_position_rejects_a_facility_attached_to_a_building_and_type_change_clears_coordinates(monkeypatch):
    client, records, _ = make_mutation_client(monkeypatch)
    building = client.post("/api/locations", json={"name": "Hall", "code": "HALL", "type": "Building"})
    facility = client.post("/api/locations", json={"name": "Kiosk", "code": "KIOSK", "type": "Facility"})
    facility_record = next(record for record in records if record.location_id == int(facility.json["id"]))
    facility_record.building_id = int(building.json["id"])
    rejected = client.patch(f"/api/locations/{facility.json['id']}/position", json={"lat": 16.7, "lng": 121.6})
    assert rejected.status_code == 400

    standalone = client.post("/api/locations", json={"name": "Flag", "code": "FLAG", "type": "Facility"})
    positioned = client.patch(f"/api/locations/{standalone.json['id']}/position", json={"lat": 16.7, "lng": 121.6})
    assert positioned.status_code == 200
    update = client.put(f"/api/locations/{standalone.json['id']}", json={"name": "Flag", "code": "FLAG", "type": "Room", "parentId": building.json["id"], "floor": "Ground Floor"})
    assert update.status_code == 200
    assert update.json["positioned"] is False
    assert next(record for record in records if record.location_id == int(standalone.json["id"])).lat is None
