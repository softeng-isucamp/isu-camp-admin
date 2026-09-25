from flask import Flask
import pytest

import map as map_module
from map import map_bp


class FakeQuery:
    def __init__(self, records):
        self.records = records

    def order_by(self, *_columns):
        return self

    def all(self):
        return self.records

    def get(self, record_id):
        return next(
            (record for record in self.records if getattr(record, "building_id", None) == record_id
             or getattr(record, "location_id", None) == record_id),
            None,
        )

    def filter_by(self, **criteria):
        return FakeQuery([
            record for record in self.records
            if all(getattr(record, key, None) == value for key, value in criteria.items())
        ])


class FakeColumn:
    def asc(self):
        return self

    def get(self, identifier):
        return next((record for record in self.records if record.building_id == int(identifier)), None)


class FakePhotoColumn:
    """Records the criteria the route builds instead of comparing values."""

    def __init__(self, name):
        self.name = name

    def __eq__(self, value):
        return (self.name, "==", value)

    def in_(self, values):
        return (self.name, "in", list(values))


class FakePhotoDelete:
    def __init__(self, journal, criteria):
        self.journal = journal
        self.criteria = criteria

    def delete(self, synchronize_session=None):
        self.journal.append(self.criteria)


class FakePhotoQuery:
    def __init__(self, journal):
        self.journal = journal

    def filter(self, *criteria):
        return FakePhotoDelete(self.journal, criteria)

    def filter_by(self, **criteria):
        return FakePhotoDelete(self.journal, criteria)


def fake_photo_model(journal):
    return type("LocationPhotoModel", (), {
        "query": FakePhotoQuery(journal),
        "owner_type": FakePhotoColumn("owner_type"),
        "owner_id": FakePhotoColumn("owner_id"),
    })


class FakeSession:
    def __init__(self):
        self.commits = 0
        self.rollbacks = 0
        self.deleted = []
        self.fail_commit = False

    def commit(self):
        if self.fail_commit:
            raise RuntimeError("database unavailable")
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1
        self.deleted = []

    def delete(self, record):
        self.deleted.append(record)


def app_with_map_blueprint():
    app = Flask(__name__)
    app.register_blueprint(map_bp)
    return app


def test_map_buildings_requires_authentication(monkeypatch):
    monkeypatch.setattr(
        map_module,
        "admin_required",
        lambda: (None, ({"error": "Authentication required"}, 401)),
    )

    response = app_with_map_blueprint().test_client().get("/api/map/buildings")

    assert response.status_code == 401


def test_map_buildings_returns_polygon_points(monkeypatch):
    building = type(
        "BuildingRecord",
        (),
        {
            "building_id": 4,
            "building_name": "Engineering Hall",
            "building_code": "ENG-01",
            "polygon_coordinates": [[16.72, 121.69], [16.721, 121.69], [16.721, 121.691]],
        },
    )()
    monkeypatch.setattr(map_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(
        map_module,
        "Building",
        type("BuildingModel", (), {"query": FakeQuery([building]), "building_id": FakeColumn()}),
    )

    response = app_with_map_blueprint().test_client().get("/api/map/buildings")

    assert response.status_code == 200
    assert response.json == [{
        "id": "4",
        "name": "Engineering Hall",
        "code": "ENG-01",
        "points": [[16.72, 121.69], [16.721, 121.69], [16.721, 121.691]],
        "status": "Active",
        "type": "Building",
    }]


def test_indoor_location_position_persists_marker_inside_building(monkeypatch):
    session = FakeSession()
    building = type("BuildingRecord", (), {
        "building_id": 4,
        "building_name": "Engineering Hall",
        "polygon_coordinates": [[16.7, 121.6], [16.7, 121.7], [16.8, 121.7], [16.8, 121.6]],
    })()
    location = type("LocationRecord", (), {
        "location_id": 12,
        "building_id": 4,
        "type_id": 1,
        "latitude": None,
        "longitude": None,
        "floor_id": None,
        "to_location_dto": lambda self, building=None, floor=None: {
            "id": str(self.location_id), "name": "Room 12", "code": "R-12", "type": "Room",
            "parentId": str(self.building_id), "building": building, "floor": floor,
            "function": None, "keywords": None, "status": "Active", "lat": self.latitude,
            "lng": self.longitude, "positioned": self.latitude is not None and self.longitude is not None,
            "hasPhoto": False,
        },
    })()
    monkeypatch.setattr(map_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(map_module, "Building", type("BuildingModel", (), {"query": FakeQuery([building])}))
    monkeypatch.setattr(map_module, "Location", type("LocationModel", (), {"query": FakeQuery([location])}))
    monkeypatch.setattr(map_module, "db", type("DB", (), {"session": session}))

    response = app_with_map_blueprint().test_client().patch(
        "/api/map/buildings/4/indoor-locations/12", json={"lat": 16.75, "lng": 121.65}
    )

    assert response.status_code == 200
    assert response.json["id"] == "12"
    assert response.json["parentId"] == "4"
    assert response.json["building"] == "Engineering Hall"
    assert response.json["lat"] == 16.75
    assert response.json["lng"] == 121.65
    assert response.json["positioned"] is True
    assert (location.latitude, location.longitude) == (16.75, 121.65)
    assert session.commits == 1


def test_indoor_location_position_accepts_polygon_boundary(monkeypatch):
    building = type("BuildingRecord", (), {
        "building_id": 4,
        "building_name": "Engineering Hall",
        "polygon_coordinates": [[16.7, 121.6], [16.7, 121.7], [16.8, 121.7], [16.8, 121.6]],
    })()
    location = type("LocationRecord", (), {
        "location_id": 12, "building_id": 4, "type_id": 1, "floor_id": None,
        "to_location_dto": lambda self, building=None, floor=None: {"lat": self.latitude, "lng": self.longitude},
    })()
    monkeypatch.setattr(map_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(map_module, "Building", type("BuildingModel", (), {"query": FakeQuery([building])}))
    monkeypatch.setattr(map_module, "Location", type("LocationModel", (), {"query": FakeQuery([location])}))
    monkeypatch.setattr(map_module, "db", type("DB", (), {"session": FakeSession()}))

    response = app_with_map_blueprint().test_client().patch(
        "/api/map/buildings/4/indoor-locations/12", json={"lat": 16.7, "lng": 121.65}
    )

    assert response.status_code == 200


def test_indoor_location_position_can_be_cleared(monkeypatch):
    session = FakeSession()
    building = type("BuildingRecord", (), {
        "building_id": 4, "building_name": "Engineering Hall",
        "polygon_coordinates": [[16.7, 121.6], [16.7, 121.7], [16.8, 121.7], [16.8, 121.6]],
    })()
    location = type("LocationRecord", (), {
        "location_id": 12, "building_id": 4, "type_id": 1, "floor_id": None,
        "latitude": 16.75, "longitude": 121.65,
        "to_location_dto": lambda self, building=None, floor=None: {
            "id": str(self.location_id), "lat": self.latitude, "lng": self.longitude,
            "positioned": self.latitude is not None and self.longitude is not None,
        },
    })()
    monkeypatch.setattr(map_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(map_module, "Building", type("BuildingModel", (), {"query": FakeQuery([building])}))
    monkeypatch.setattr(map_module, "Location", type("LocationModel", (), {"query": FakeQuery([location])}))
    monkeypatch.setattr(map_module, "db", type("DB", (), {"session": session}))

    response = app_with_map_blueprint().test_client().patch(
        "/api/map/buildings/4/indoor-locations/12", json={"lat": None, "lng": None}
    )

    assert response.status_code == 200
    assert response.json == {"id": "12", "lat": None, "lng": None, "positioned": False}
    assert (location.latitude, location.longitude) == (None, None)
    assert session.commits == 1


@pytest.mark.parametrize(
    "payload, message",
    [
        ({"lat": 16.9, "lng": 121.65}, "must be inside"),
        ({"lat": None, "lng": 121.65}, "both be finite numbers or both null"),
    ],
)
def test_indoor_location_position_rejects_invalid_marker(monkeypatch, payload, message):
    building = type("BuildingRecord", (), {
        "building_id": 4,
        "polygon_coordinates": [[16.7, 121.6], [16.7, 121.7], [16.8, 121.7], [16.8, 121.6]],
    })()
    location = type("LocationRecord", (), {"location_id": 12, "building_id": 4, "type_id": 1, "floor_id": None})()
    monkeypatch.setattr(map_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(map_module, "Building", type("BuildingModel", (), {"query": FakeQuery([building])}))
    monkeypatch.setattr(map_module, "Location", type("LocationModel", (), {"query": FakeQuery([location])}))
    monkeypatch.setattr(map_module, "db", type("DB", (), {"session": FakeSession()}))

    response = app_with_map_blueprint().test_client().patch(
        "/api/map/buildings/4/indoor-locations/12", json=payload
    )

    assert response.status_code == 400
    assert message in response.json["message"]


def test_map_save_persists_complete_valid_building_polygon(monkeypatch):
    session = FakeSession()
    audits = []
    building = type("BuildingRecord", (), {
        "building_id": 4,
        "building_name": "Engineering Hall",
        "latitude": None,
        "longitude": None,
        "polygon_coordinates": None,
    })()
    monkeypatch.setattr(map_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(
        map_module,
        "Building",
        type("BuildingModel", (), {"query": FakeQuery([building])}),
    )
    monkeypatch.setattr(map_module, "db", type("DB", (), {"session": session}))
    monkeypatch.setattr(map_module, "log_audit", lambda *args: audits.append(args))

    points = [[16.72, 121.69], [16.721, 121.69], [16.721, 121.691], [16.72, 121.691]]
    response = app_with_map_blueprint().test_client().post(
        "/api/map/save", json={"buildings": [{"id": "4", "points": points}]}
    )

    assert response.status_code == 200
    assert building.polygon_coordinates == points
    assert session.commits == 1
    assert audits == [
        ("Admin", None, "update geometry", "Building", 4, "Engineering Hall footprint updated"),
        ("Admin", None, "save draft", "Map", None, "Map draft changes saved"),
    ]


def test_map_save_persists_an_internal_anchor_for_a_closed_concave_polygon(monkeypatch):
    session = FakeSession()
    building = type("BuildingRecord", (), {
        "building_id": 4,
        "building_name": "Engineering Hall",
        "latitude": 16.7,
        "longitude": 121.6,
        "polygon_coordinates": [[16.7, 121.6], [16.71, 121.6], [16.71, 121.61]],
    })()
    monkeypatch.setattr(map_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(
        map_module,
        "Building",
        type("BuildingModel", (), {"query": FakeQuery([building])}),
    )
    monkeypatch.setattr(map_module, "db", type("DB", (), {"session": session}))
    monkeypatch.setattr(map_module, "log_audit", lambda *args: None)

    points = [
        [0, 0], [0, 4], [4, 4], [4, 3], [1, 3],
        [1, 1], [4, 1], [4, 0], [0, 0],
    ]
    response = app_with_map_blueprint().test_client().post(
        "/api/map/save", json={"buildings": [{"id": "4", "points": points}]}
    )

    assert response.status_code == 200
    assert building.latitude == 0.625
    assert building.longitude == 0.625


def test_map_save_rejects_invalid_geometry_without_mutating_the_building(monkeypatch):
    session = FakeSession()
    building = type("BuildingRecord", (), {
        "building_id": 4,
        "latitude": None,
        "longitude": None,
        "polygon_coordinates": [[16.7, 121.6], [16.71, 121.6], [16.71, 121.61]],
    })()
    monkeypatch.setattr(map_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(map_module, "Building", type("BuildingModel", (), {"query": FakeQuery([building])}))
    monkeypatch.setattr(map_module, "db", type("DB", (), {"session": session}))

    response = app_with_map_blueprint().test_client().post(
        "/api/map/save",
        json={"buildings": [{"id": "4", "points": [[16.72, 121.69], [16.721, 121.691], [16.72, 121.691], [16.721, 121.69]]}]},
    )

    assert response.status_code == 400
    assert response.json["fields"]["buildings[0].points"]
    assert building.polygon_coordinates == [[16.7, 121.6], [16.71, 121.6], [16.71, 121.61]]
    assert session.commits == 0


def test_map_save_rejects_self_touching_footprint_without_mutating_the_building(monkeypatch):
    session = FakeSession()
    building = type("BuildingRecord", (), {
        "building_id": 4,
        "latitude": None,
        "longitude": None,
        "polygon_coordinates": [[16.7, 121.6], [16.71, 121.6], [16.71, 121.61]],
    })()
    monkeypatch.setattr(map_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(map_module, "Building", type("BuildingModel", (), {"query": FakeQuery([building])}))
    monkeypatch.setattr(map_module, "db", type("DB", (), {"session": session}))

    response = app_with_map_blueprint().test_client().post(
        "/api/map/save",
        json={"buildings": [{"id": "4", "points": [
            [16.720, 121.689], [16.724, 121.689], [16.724, 121.693],
            [16.722, 121.689], [16.720, 121.693],
        ]}]},
    )

    assert response.status_code == 400
    assert response.json["fields"]["buildings[0].points"] == "Footprint edges must not intersect."
    assert building.polygon_coordinates == [[16.7, 121.6], [16.71, 121.6], [16.71, 121.61]]
    assert session.commits == 0


def test_map_save_rejects_malformed_building_payload_before_mutating(monkeypatch):
    session = FakeSession()
    building = type("BuildingRecord", (), {
        "building_id": 4,
        "latitude": None,
        "longitude": None,
        "polygon_coordinates": [[16.7, 121.6], [16.71, 121.6], [16.71, 121.61]],
    })()
    monkeypatch.setattr(map_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(map_module, "Building", type("BuildingModel", (), {"query": FakeQuery([building])}))
    monkeypatch.setattr(map_module, "db", type("DB", (), {"session": session}))

    response = app_with_map_blueprint().test_client().post(
        "/api/map/save", json={"buildings": {"id": "4", "points": []}},
    )

    assert response.status_code == 400
    assert response.json["fields"]["buildings"]
    assert building.polygon_coordinates == [[16.7, 121.6], [16.71, 121.6], [16.71, 121.61]]
    assert session.commits == 0


def test_map_save_rejects_non_object_json_payload(monkeypatch):
    monkeypatch.setattr(map_module, "admin_required", lambda: (object(), None))

    response = app_with_map_blueprint().test_client().post(
        "/api/map/save", json=[{"buildings": []}],
    )

    assert response.status_code == 400
    assert response.json["fields"]["request"]


def test_delete_map_building_requires_administrator(monkeypatch):
    monkeypatch.setattr(map_module, "admin_required", lambda: (None, ({"error": "Authentication required"}, 401)))

    response = app_with_map_blueprint().test_client().delete("/api/map/buildings/4")

    assert response.status_code == 401


def test_delete_map_building_deletes_indoor_locations_and_audits_in_one_transaction(monkeypatch):
    session = FakeSession()
    building = type("BuildingRecord", (), {"building_id": 4, "building_name": "Engineering Hall"})()
    indoor_location = type("LocationRecord", (), {"location_id": 12, "building_id": 4})()
    floor = type("FloorRecord", (), {"floor_id": 9, "building_id": 4})()
    audits = []
    photo_deletes = []
    monkeypatch.setattr(map_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(map_module, "Building", type("BuildingModel", (), {"query": FakeQuery([building])}))
    monkeypatch.setattr(map_module, "Location", type("LocationModel", (), {"query": FakeQuery([indoor_location])}))
    monkeypatch.setattr(map_module, "Floor", type("FloorModel", (), {"query": FakeQuery([floor])}))
    monkeypatch.setattr(map_module, "LocationPhoto", fake_photo_model(photo_deletes))
    monkeypatch.setattr(map_module, "db", type("DB", (), {"session": session}))
    monkeypatch.setattr(map_module, "log_audit", lambda *args: audits.append(args))

    response = app_with_map_blueprint().test_client().delete("/api/map/buildings/4")

    assert response.status_code == 200
    assert response.json["message"] == "Building and associated Indoor Locations permanently deleted."
    assert session.deleted == [indoor_location, floor, building]
    assert session.commits == 1
    assert audits == [("Admin", None, "delete", "Building", 4, "Engineering Hall")]


def test_delete_map_building_rolls_back_delete_and_audit_together(monkeypatch):
    session = FakeSession()
    session.fail_commit = True
    building = type("BuildingRecord", (), {"building_id": 4, "building_name": "Engineering Hall"})()
    audits = []
    monkeypatch.setattr(map_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(map_module, "Building", type("BuildingModel", (), {"query": FakeQuery([building])}))
    monkeypatch.setattr(map_module, "Location", type("LocationModel", (), {"query": FakeQuery([])}))
    monkeypatch.setattr(map_module, "Floor", type("FloorModel", (), {"query": FakeQuery([])}))
    monkeypatch.setattr(map_module, "LocationPhoto", fake_photo_model([]))
    monkeypatch.setattr(map_module, "db", type("DB", (), {"session": session}))
    monkeypatch.setattr(map_module, "log_audit", lambda *args: audits.append(args))

    response = app_with_map_blueprint().test_client().delete("/api/map/buildings/4")

    assert response.status_code == 500
    assert session.rollbacks == 1
    assert session.deleted == []
    assert audits == [("Admin", None, "delete", "Building", 4, "Engineering Hall")]


def test_delete_map_building_purges_gallery_photos_for_the_building_and_its_locations(monkeypatch):
    """location_photo.owner_id is polymorphic, so no database cascade removes
    these rows; the route has to purge both owner kinds itself."""
    session = FakeSession()
    building = type("BuildingRecord", (), {"building_id": 4, "building_name": "Engineering Hall"})()
    rooms = [
        type("LocationRecord", (), {"location_id": 12, "building_id": 4})(),
        type("LocationRecord", (), {"location_id": 13, "building_id": 4})(),
    ]
    photo_deletes = []
    monkeypatch.setattr(map_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(map_module, "Building", type("BuildingModel", (), {"query": FakeQuery([building])}))
    monkeypatch.setattr(map_module, "Location", type("LocationModel", (), {"query": FakeQuery(rooms)}))
    monkeypatch.setattr(map_module, "Floor", type("FloorModel", (), {"query": FakeQuery([])}))
    monkeypatch.setattr(map_module, "LocationPhoto", fake_photo_model(photo_deletes))
    monkeypatch.setattr(map_module, "db", type("DB", (), {"session": session}))
    monkeypatch.setattr(map_module, "log_audit", lambda *args: None)

    response = app_with_map_blueprint().test_client().delete("/api/map/buildings/4")

    assert response.status_code == 200
    assert photo_deletes == [
        (("owner_type", "==", "location"), ("owner_id", "in", [12, 13])),
        {"owner_type": "building", "owner_id": 4},
    ]
    assert session.commits == 1


def test_delete_map_building_without_indoor_locations_only_purges_its_own_photos(monkeypatch):
    session = FakeSession()
    building = type("BuildingRecord", (), {"building_id": 4, "building_name": "Engineering Hall"})()
    photo_deletes = []
    monkeypatch.setattr(map_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(map_module, "Building", type("BuildingModel", (), {"query": FakeQuery([building])}))
    monkeypatch.setattr(map_module, "Location", type("LocationModel", (), {"query": FakeQuery([])}))
    monkeypatch.setattr(map_module, "Floor", type("FloorModel", (), {"query": FakeQuery([])}))
    monkeypatch.setattr(map_module, "LocationPhoto", fake_photo_model(photo_deletes))
    monkeypatch.setattr(map_module, "db", type("DB", (), {"session": session}))
    monkeypatch.setattr(map_module, "log_audit", lambda *args: None)

    response = app_with_map_blueprint().test_client().delete("/api/map/buildings/4")

    assert response.status_code == 200
    assert photo_deletes == [{"owner_type": "building", "owner_id": 4}]
