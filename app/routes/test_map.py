import sys
from pathlib import Path

from flask import Flask

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services"))

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
            (record for record in self.records if record.building_id == record_id),
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


def test_map_save_persists_complete_valid_building_polygon(monkeypatch):
    session = FakeSession()
    building = type("BuildingRecord", (), {
        "building_id": 4,
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
    monkeypatch.setattr(map_module, "log_audit", lambda *_args: None)

    points = [[16.72, 121.69], [16.721, 121.69], [16.721, 121.691], [16.72, 121.691]]
    response = app_with_map_blueprint().test_client().post(
        "/api/map/save", json={"buildings": [{"id": "4", "points": points}]}
    )

    assert response.status_code == 200
    assert building.polygon_coordinates == points
    assert session.commits == 1


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
    audits = []
    monkeypatch.setattr(map_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(map_module, "Building", type("BuildingModel", (), {"query": FakeQuery([building])}))
    monkeypatch.setattr(map_module, "Location", type("LocationModel", (), {"query": FakeQuery([indoor_location])}))
    monkeypatch.setattr(map_module, "db", type("DB", (), {"session": session}))
    monkeypatch.setattr(map_module, "log_audit", lambda *args: audits.append(args))

    response = app_with_map_blueprint().test_client().delete("/api/map/buildings/4")

    assert response.status_code == 200
    assert response.json["message"] == "Building and associated Indoor Locations permanently deleted."
    assert session.deleted == [indoor_location, building]
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
    monkeypatch.setattr(map_module, "db", type("DB", (), {"session": session}))
    monkeypatch.setattr(map_module, "log_audit", lambda *args: audits.append(args))

    response = app_with_map_blueprint().test_client().delete("/api/map/buildings/4")

    assert response.status_code == 500
    assert session.rollbacks == 1
    assert session.deleted == []
    assert audits == [("Admin", None, "delete", "Building", 4, "Engineering Hall")]
