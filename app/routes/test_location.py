import io
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
        self.photo = None
        self.photo_mime_type = None

    def to_location_dto(self, building=None, floor=None):
        return {
            "id": str(self.location_id), "name": self.location_name,
            "code": self.location_code, "type": "Room" if self.type_id == 3 else "Building",
            "parentId": str(self.building_id) if self.building_id else None,
            "building": building, "floor": floor, "function": self.description,
            "keywords": self.keywords, "status": "Active",
            "lat": self.lat, "lng": self.lng,
            "positioned": self.lat is not None and self.lng is not None,
            "hasPhoto": self.photo is not None,
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
    room.floor_level = "2nd Floor"
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


def test_list_locations_applies_relationship_filters_before_pagination(monkeypatch):
    client = make_client(monkeypatch)
    response = client.get(
        "/api/locations?type=Room&buildingId=1&floor=2nd%20Floor&page=1&pageSize=10"
    )

    assert response.status_code == 200
    assert response.json["total"] == 1
    assert [item["id"] for item in response.json["items"]] == ["2"]


def test_list_locations_requires_authentication(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(location_bp)
    monkeypatch.setattr(location_module, "admin_required", lambda: (None, ({"error": "unused"}, 401)))
    response = app.test_client().get("/api/locations")
    assert response.status_code == 401


def test_list_locations_rejects_unknown_persisted_type(monkeypatch):
    client = make_client(monkeypatch)
    unknown = FakeRecord(9, "Unknown", "UNKNOWN", 999)
    monkeypatch.setattr(location_module, "Location", type("FakeLocation", (), {
        "query": FakeQuery([unknown]), "location_id": FakeColumn(),
    }))

    response = client.get("/api/locations")

    assert response.status_code == 500
    assert response.json["message"] == "Location 9 references an unknown location type."


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
        self.deleted = []

    def add(self, record):
        record.location_id = max((item.location_id for item in self.records), default=0) + 1
        self.records.append(record)
        self.pending = record

    def flush(self):
        pass

    def commit(self):
        if self.fail_commit:
            raise RuntimeError("database unavailable")
        for record in self.deleted:
            if record in self.records:
                self.records.remove(record)
        self.deleted = []
        self.commits += 1
        self.pending = None

    def rollback(self):
        self.rollbacks += 1
        if self.pending in self.records:
            self.records.remove(self.pending)
        self.deleted = []
        self.pending = None

    def delete(self, record):
        self.deleted.append(record)


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
            dto["hasPhoto"] = self.photo is not None
            return dto

    monkeypatch.setattr(location_module, "Location", MutationRecord)
    monkeypatch.setattr(location_module.db, "session", session)
    return app.test_client(), records, session


def test_invalid_legacy_floor_relationship_is_reported_instead_of_projected(monkeypatch):
    client, records, _ = make_mutation_client(monkeypatch)
    building = client.post("/api/locations", json={"name": "Engineering Hall", "code": "ENG", "type": "Building"})
    wrong_building = client.post("/api/locations", json={"name": "Other Hall", "code": "OTHER", "type": "Building"})
    floor = type(records[0])(location_name="Second Floor", location_code="OTHER-F2", type_id=2, building_id=int(wrong_building.json["id"]), floor_id=None, floor_level=None)
    floor.location_id = 20
    records.append(floor)
    room = type(records[0])(location_name="Room 204", location_code="ENG-204", type_id=3, building_id=int(building.json["id"]), floor_id=20, floor_level=None)
    room.location_id = 21
    records.append(room)

    response = client.get("/api/locations")

    assert response.status_code == 500
    assert "invalid legacy Floor relationship" in response.json["message"]


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


def test_photo_upload_persists_metadata_without_json_binary(monkeypatch):
    client, records, _ = make_mutation_client(monkeypatch)
    created = client.post(
        "/api/locations",
        data={"name": "Library", "code": "LIB", "type": "Building", "photo": (io.BytesIO(b"png-bytes"), "library.png")},
        content_type="multipart/form-data",
    )
    assert created.status_code == 201
    assert created.json["hasPhoto"] is True
    assert "photo" not in created.json
    record = records[0]
    assert record.photo_mime_type == "image/png"

def test_photo_upload_rejects_invalid_and_oversized_files_without_writes(monkeypatch):
    client, records, session = make_mutation_client(monkeypatch)
    invalid = client.post(
        "/api/locations",
        data={"name": "Library", "code": "LIB", "type": "Building", "photo": (io.BytesIO(b"no"), "library.txt")},
        content_type="multipart/form-data",
    )
    assert invalid.status_code == 400
    assert records == []
    oversized = client.post(
        "/api/locations",
        data={"name": "Library", "code": "LIB", "type": "Building", "photo": (io.BytesIO(b"x" * (5 * 1024 * 1024 + 1)), "library.png")},
        content_type="multipart/form-data",
    )
    assert oversized.status_code == 400
    assert records == []
    assert session.commits == 0
