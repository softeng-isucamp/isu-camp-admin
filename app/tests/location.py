import io

import pytest
from flask import Flask

import location as location_module
from location import location_bp
from model.location import LOCATION_TYPE_IDS, LOCATION_TYPE_NAMES, Location


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
        self.photo = None

    def to_location_dto(self, building=None, floor=None):
        return {
            "id": str(self.location_id), "name": self.location_name,
            "code": self.location_code, "type": LOCATION_TYPE_NAMES[self.type_id],
            "parentId": str(self.building_id) if self.building_id else None,
            "building": building, "floor": floor, "function": self.description,
            "keywords": self.keywords, "status": "Active",
            "lat": None, "lng": None,
            "positioned": False,
            "hasPhoto": self.photo is not None,
        }


class FakeQuery:
    def __init__(self, records):
        self.records = records

    def order_by(self, _):
        return self

    def all(self):
        return self.records

    def filter_by(self, **criteria):
        return FakeQuery([
            record for record in self.records
            if all(getattr(record, key, None) == value for key, value in criteria.items())
        ])

    def first(self):
        return self.records[0] if self.records else None


class FakeColumn:
    def asc(self):
        return self

    def desc(self):
        return self


class FakeFloor:
    def __init__(self, identifier, building_id, number):
        self.floor_id = identifier
        self.building_id = building_id
        self.floor_number = number


class FakeBuilding:
    def __init__(self, identifier, name="Engineering Hall", code="ENG", description="A building", classification="Building", polygon_coordinates=None):
        self.building_id = identifier
        self.building_name = name
        self.building_code = code
        self.description = description
        self.latitude = None
        self.longitude = None
        self.classification = classification
        self.polygon_coordinates = polygon_coordinates

    def to_location_dto(self):
        lat = float(self.latitude) if self.latitude is not None else None
        lng = float(self.longitude) if self.longitude is not None else None
        dto = {
            "id": str(self.building_id), "name": self.building_name,
            "code": self.building_code, "type": self.classification, "parentId": None,
            "building": None, "floor": None, "function": self.description,
            "keywords": None, "status": "Active", "lat": lat, "lng": lng,
            "positioned": lat is not None and lng is not None, "hasPhoto": False,
        }
        if self.polygon_coordinates is not None:
            dto["polygonCoordinates"] = self.polygon_coordinates
        return dto


def make_client(monkeypatch):
    app = Flask(__name__)
    app.secret_key = "test"
    app.register_blueprint(location_bp)
    monkeypatch.setattr(location_module, "admin_required", lambda: (object(), None))
    building = FakeBuilding(1)
    room = FakeRecord(2, "Room 204", "ENG-204", 1, building_id=1)
    room.floor_id = 2
    monkeypatch.setattr(location_module, "Location", type("FakeLocation", (), {
        "query": FakeQuery([room]), "location_id": FakeColumn(),
    }))
    monkeypatch.setattr(location_module, "Building", type("FakeBuildingModel", (), {
        "query": FakeQuery([building]), "building_id": FakeColumn(),
    }))
    monkeypatch.setattr(location_module, "Floor", type("FakeFloorModel", (), {
        "query": FakeQuery([FakeFloor(2, 1, 2)]), "floor_id": FakeColumn(),
    }))
    return app.test_client()


def test_location_history_is_scoped_to_the_selected_location(monkeypatch):
    client = make_client(monkeypatch)

    class Audit:
        def __init__(self, identifier, target_id, target="Location"):
            self.id = identifier
            self.target_id = target_id
            self.target = target

        def to_dict(self):
            return {"id": str(self.id), "targetId": self.target_id}

    monkeypatch.setattr(location_module, "AuditLog", type("AuditLogModel", (), {
        "query": FakeQuery([Audit(1, "1"), Audit(2, "2"), Audit(3, "1", "Building")]),
        "created_at": FakeColumn(),
    }))

    response = client.get("/api/locations/1/history")

    assert response.status_code == 200
    assert response.json["items"] == [{"id": "3", "targetId": "1"}]
    assert response.json["total"] == 1


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


def test_list_locations_composes_buildings_and_uses_database_location_types(monkeypatch):
    client = make_client(monkeypatch)

    response = client.get("/api/locations?page=1&pageSize=10")

    assert response.status_code == 200
    assert response.json["total"] == 2
    assert [(item["name"], item["type"]) for item in response.json["items"]] == [
        ("Engineering Hall", "Building"),
        ("Room 204", "Room"),
    ]


def test_list_locations_requires_authentication(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(location_bp)
    monkeypatch.setattr(location_module, "admin_required", lambda: (None, ({"error": "unused"}, 401)))
    response = app.test_client().get("/api/locations")
    assert response.status_code == 401


def test_create_location_requires_administrator(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(location_bp)
    monkeypatch.setattr(location_module, "admin_required", lambda: (None, ({"error": "unused"}, 401)))

    response = app.test_client().post(
        "/api/locations",
        json={"name": "Library", "code": "LIB", "type": "Building"},
    )

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


def test_list_locations_paginates_deterministic_building_families(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(location_bp)
    monkeypatch.setattr(location_module, "admin_required", lambda: (object(), None))
    buildings = [FakeBuilding(2, name="Building B"), FakeBuilding(1, name="Building A")]
    records = [
        FakeRecord(12, "Room B", "B-ROOM", 1, building_id=2),
        FakeRecord(11, "Room A", "A-ROOM", 1, building_id=1),
    ]
    monkeypatch.setattr(location_module, "Location", type("LocationModel", (), {
        "query": FakeQuery(records), "location_id": FakeColumn(),
    }))
    monkeypatch.setattr(location_module, "Building", type("BuildingModel", (), {
        "query": FakeQuery(buildings), "building_id": FakeColumn(),
    }))
    monkeypatch.setattr(location_module, "Floor", type("FloorModel", (), {
        "query": FakeQuery([]), "floor_id": FakeColumn(),
    }))

    first = app.test_client().get("/api/locations?page=1&pageSize=2")
    second = app.test_client().get("/api/locations?page=2&pageSize=2")

    assert first.json["total"] == 4
    assert first.json["page"] == 1
    assert first.json["pageSize"] == 2
    assert [item["id"] for item in first.json["items"]] == ["1", "11"]
    assert [item["id"] for item in second.json["items"]] == ["2", "12"]


def test_list_locations_filters_before_pagination_and_clamps_page_size(monkeypatch):
    client = make_client(monkeypatch)

    response = client.get(
        "/api/locations?type=Room&buildingId=1&page=2&pageSize=0"
    )

    assert response.status_code == 200
    assert response.json["total"] == 1
    assert response.json["page"] == 2
    assert response.json["pageSize"] == 1
    assert response.json["items"] == []


def test_location_type_ids_preserve_existing_records_and_add_restroom():
    assert LOCATION_TYPE_IDS == {
        "Room": 1,
        "Laboratory": 2,
        "Office": 3,
        "Restroom": 5,
    }


def test_facility_without_polygon_is_still_created_as_a_building(monkeypatch):
    client, records, session = make_mutation_client(monkeypatch)

    response = client.post(
        "/api/locations",
        json={"name": "Covered Court", "code": "COURT", "type": "Facility"},
    )

    assert response.status_code == 201
    assert response.json["type"] == "Facility"
    assert records == []
    assert len(session.buildings) == 1
    assert session.buildings[0].classification == "Facility"


def test_facility_cannot_use_normal_location_parent_fields(monkeypatch):
    client, records, session = make_mutation_client(monkeypatch)

    response = client.post(
        "/api/locations",
        json={
            "name": "Legacy Facility Row",
            "code": "LEGACY-FACILITY",
            "type": "Facility",
            "parentId": "1",
            "floor": "Ground Floor",
        },
    )

    assert response.status_code == 400
    assert response.json["fields"]["parentId"]
    assert records == []
    assert session.commits == 0

    floor_only = client.post(
        "/api/locations",
        json={
            "name": "Standalone Facility",
            "code": "STANDALONE-FACILITY",
            "type": "Facility",
            "floor": "Ground Floor",
        },
    )

    assert floor_only.status_code == 400
    assert floor_only.json["fields"]["floor"]
    assert records == []
    assert session.commits == 0


def test_restroom_dto_uses_canonical_type_and_indoor_parent():
    restroom = Location(
        location_id=8,
        building_id=42,
        type_id=LOCATION_TYPE_IDS["Restroom"],
        location_code="REST-01",
        location_name="Main Restroom",
        description="Accessible restroom",
        keywords="accessible",
    )

    assert restroom.to_location_dto(building="Engineering Hall", floor="Ground Floor") == {
        "id": "8",
        "name": "Main Restroom",
        "code": "REST-01",
        "type": "Restroom",
        "parentId": "42",
        "building": "Engineering Hall",
        "floor": "Ground Floor",
        "function": "Accessible restroom",
        "keywords": "accessible",
        "status": "Active",
        "lat": None,
        "lng": None,
        "positioned": False,
        "hasPhoto": False,
    }


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
    def __init__(self, records, buildings, floors=None):
        self.records = records
        self.buildings = buildings
        self.floors = floors if floors is not None else []
        self.commits = 0
        self.rollbacks = 0
        self.fail_commit = False
        self.pending = None
        self.deleted = []

    def add(self, record):
        if record.__class__.__name__ == "MutationBuilding":
            record.building_id = max((item.building_id for item in self.buildings), default=0) + 1
            self.buildings.append(record)
        elif record.__class__.__name__ == "MutationFloor":
            record.floor_id = max((item.floor_id for item in self.floors), default=0) + 1
            self.floors.append(record)
        else:
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
        if self.pending in self.buildings:
            self.buildings.remove(self.pending)
        if self.pending in self.floors:
            self.floors.remove(self.pending)
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
    buildings = []
    floors = []
    session = MutationSession(records, buildings, floors)

    class MutationRecord(FakeRecord):
        query = MutationQuery(records)
        location_id = FakeColumn()

        def __init__(self, **values):
            super().__init__(0, values["location_name"], values["location_code"], values["type_id"], values.get("building_id"), values.get("floor_id"))
            self.description = values.get("description")
            self.keywords = values.get("keywords")
            self.photo = None

        def to_location_dto(self, building=None, floor=None):
            dto = super().to_location_dto(building, floor)
            dto["function"] = self.description
            dto["keywords"] = self.keywords
            dto["hasPhoto"] = self.photo is not None
            return dto

    monkeypatch.setattr(location_module, "Location", MutationRecord)
    class MutationBuilding(FakeBuilding):
        query = FakeQuery(buildings)
        building_id = FakeColumn()

        def __init__(self, **values):
            super().__init__(
                0,
                values["building_name"],
                values["building_code"],
                values.get("description"),
                values.get("classification", "Building"),
                values.get("polygon_coordinates"),
            )
            self.latitude = values.get("latitude")
            self.longitude = values.get("longitude")

    monkeypatch.setattr(location_module, "Building", MutationBuilding)

    class MutationFloor:
        query = FakeQuery(floors)
        floor_id = FakeColumn()

        def __init__(self, building_id=None, floor_number=None):
            self.floor_id = None
            self.building_id = building_id
            self.floor_number = floor_number

    monkeypatch.setattr(location_module, "Floor", MutationFloor)
    monkeypatch.setattr(location_module.db, "session", session)
    return app.test_client(), records, session


def test_invalid_floor_relationship_is_reported_instead_of_projected(monkeypatch):
    client, records, _ = make_mutation_client(monkeypatch)
    building = client.post("/api/locations", json={"name": "Engineering Hall", "code": "ENG", "type": "Building"})
    wrong_building = client.post("/api/locations", json={"name": "Other Hall", "code": "OTHER", "type": "Building"})
    floor = FakeFloor(20, int(wrong_building.json["id"]), 2)
    monkeypatch.setattr(location_module, "Floor", type("FakeFloorModel", (), {
        "query": FakeQuery([floor]), "floor_id": FakeColumn(),
    }))
    room = FakeRecord(21, "Room 204", "ENG-204", 1, building_id=int(building.json["id"]), floor_id=20)
    room.location_id = 21
    records.append(room)

    response = client.get("/api/locations")

    assert response.status_code == 500
    assert "invalid Floor relationship" in response.json["message"]


def test_mutations_validate_relationship_floor_and_duplicate_without_partial_write(monkeypatch):
    client, records, session = make_mutation_client(monkeypatch)
    building = client.post("/api/locations", json={"name": "Engineering Hall", "code": "ENG", "type": "Building"})
    assert building.status_code == 201
    listed = client.get("/api/locations")
    assert listed.status_code == 200
    assert next(item for item in listed.json["items"] if item["id"] == building.json["id"]) == {
        "id": building.json["id"],
        "name": "Engineering Hall",
        "code": "ENG",
        "type": "Building",
        "parentId": None,
        "building": None,
        "floor": None,
        "function": None,
        "keywords": None,
        "status": "Active",
        "lat": None,
        "lng": None,
        "positioned": False,
        "hasPhoto": False,
    }
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


def test_create_restroom_persists_canonical_type_and_projects_dto(monkeypatch):
    client, records, session = make_mutation_client(monkeypatch)
    building = client.post(
        "/api/locations",
        json={"name": "Engineering Hall", "code": "ENG", "type": "Building"},
    )

    response = client.post(
        "/api/locations",
        json={
            "name": "Main Restroom",
            "code": "REST-01",
            "type": "Restroom",
            "parentId": building.json["id"],
            "floor": "Ground Floor",
            "function": "Accessible restroom",
            "keywords": "accessible",
        },
    )

    assert response.status_code == 201
    assert response.json["type"] == "Restroom"
    assert response.json["parentId"] == building.json["id"]
    assert response.json["floor"] == "Ground Floor"
    assert records[-1].type_id == LOCATION_TYPE_IDS["Restroom"]
    assert session.commits == 2


def test_create_rolls_back_when_persistence_fails(monkeypatch):
    client, records, session = make_mutation_client(monkeypatch)
    session.fail_commit = True
    response = client.post("/api/locations", json={"name": "Library", "code": "LIB", "type": "Building"})
    assert response.status_code == 500
    assert records == []
    assert session.rollbacks == 1


def test_create_facility_footprint_round_trips_its_classification_and_geometry(monkeypatch):
    client, _records, session = make_mutation_client(monkeypatch)
    polygon = [[16.72, 121.69], [16.721, 121.69], [16.721, 121.691], [16.72, 121.691]]

    response = client.post(
        "/api/locations",
        json={"name": "Health Center", "code": "HC", "type": "Facility", "polygonCoordinates": polygon},
    )

    assert response.status_code == 201
    assert response.json["type"] == "Facility"
    assert response.json["polygonCoordinates"] == polygon
    assert response.json["positioned"] is True
    assert response.json["lat"] == pytest.approx(16.7205)
    assert response.json["lng"] == pytest.approx(121.6905)
    assert session.commits == 1

    reloaded = client.get("/api/locations")
    assert reloaded.status_code == 200
    assert reloaded.json["items"] == [response.json]


def test_create_rejects_invalid_footprint_before_writing(monkeypatch):
    client, records, session = make_mutation_client(monkeypatch)

    response = client.post(
        "/api/locations",
        json={"name": "Bad Footprint", "code": "BAD", "type": "Building", "polygonCoordinates": [[16.72, 121.69], [16.72, 121.69], [16.721, 121.691]]},
    )

    assert response.status_code == 400
    assert response.json["fields"]["polygonCoordinates"]
    assert records == []
    assert session.commits == 0


def test_footprint_rejects_non_adjacent_edge_touch(monkeypatch):
    points = [
        [0, 0],
        [4, 0],
        [4, 4],
        [0, 4],
        [0, 2],
        [2, 2],
        [2, 0],
    ]

    assert location_module._polygon_error(points) == "Footprint edges must not intersect."


def test_building_and_facility_photo_uploads_are_rejected_without_photo_schema(monkeypatch):
    client, records, _ = make_mutation_client(monkeypatch)
    building = client.post(
        "/api/locations",
        data={"name": "Library", "code": "LIB", "type": "Building", "photo": (io.BytesIO(b"png-bytes"), "library.png")},
        content_type="multipart/form-data",
    )
    facility = client.post(
        "/api/locations",
        data={"name": "Health Center", "code": "HC", "type": "Facility", "photo": (io.BytesIO(b"png-bytes"), "health-center.png")},
        content_type="multipart/form-data",
    )

    assert building.status_code == facility.status_code == 400
    assert building.json["fields"]["photo"] == facility.json["fields"]["photo"]
    assert records == []

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
