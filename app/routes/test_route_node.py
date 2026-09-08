import sys
from pathlib import Path

from flask import Flask

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services"))

import route_node as route_node_module
from route_node import route_node_bp


class FakeQuery:
    def __init__(self, records):
        self.records = records

    def order_by(self, *_columns):
        return self

    def all(self):
        return self.records


class FakeSortColumn:
    def asc(self):
        return self

class FakeSession:
    def __init__(self):
        self.added = []
        self.commits = 0
        self.rollbacks = 0

    def add(self, record):
        self.added.append(record)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class FakeAllowedMode:
    def __init__(self, **values):
        self.__dict__.update(values)


class FakeLookupColumn:
    def __init__(self, records, key):
        self.records = records
        self.key = key

    def get(self, identifier):
        identifier = int(identifier)
        return next((record for record in self.records if getattr(record, self.key) == identifier), None)


def app_with_route_node_blueprint():
    app = Flask(__name__)
    app.register_blueprint(route_node_bp)
    return app


def test_route_node_blueprint_exposes_walking_network_routes():
    app = app_with_route_node_blueprint()
    paths = {rule.rule for rule in app.url_map.iter_rules()}

    assert "/api/route-nodes" in paths
    assert "/api/pathways" in paths
    assert "/api/path-points" in paths


def test_list_route_nodes_serializes_database_records(monkeypatch):
    node = type(
        "RouteNodeRecord",
        (),
        {"node_id": 7, "to_dict": lambda self: {"node_id": 7, "node_type": "entrance"}},
    )()
    monkeypatch.setattr(
        route_node_module,
        "RouteNode",
        type("RouteNodeModel", (), {"query": FakeQuery([node]), "node_id": FakeSortColumn()}),
    )

    response = app_with_route_node_blueprint().test_client().get("/api/route-nodes")

    assert response.status_code == 200
    assert response.json == {
        "success": True,
        "count": 1,
        "route_nodes": [{"node_id": 7, "node_type": "entrance"}],
    }


def test_create_route_node_requires_coordinates():
    response = app_with_route_node_blueprint().test_client().post(
        "/api/route-nodes", json={"node_type": "entrance"}
    )

    assert response.status_code == 400
    assert response.json["message"] == "latitude and longitude are required"


def test_create_route_node_persists_and_returns_the_created_record(monkeypatch):
    session = FakeSession()

    class FakeRouteNode:
        def __init__(self, **values):
            self.node_id = 42
            self.__dict__.update(values)

        def to_dict(self):
            return {"node_id": self.node_id, "latitude": self.latitude, "longitude": self.longitude}

    monkeypatch.setattr(route_node_module, "RouteNode", FakeRouteNode)
    monkeypatch.setattr(route_node_module, "db", type("DB", (), {"session": session}))

    response = app_with_route_node_blueprint().test_client().post(
        "/api/route-nodes",
        json={"latitude": 16.72, "longitude": 121.69, "node_type": "entrance"},
    )

    assert response.status_code == 201
    assert response.json["route_node"] == {
        "node_id": 42,
        "latitude": 16.72,
        "longitude": 121.69,
    }
    assert session.commits == 1
    assert len(session.added) == 1


def test_route_node_name_round_trips_through_create_and_update(monkeypatch):
    session = FakeSession()
    records = []

    class FakeRouteNode:
        query = FakeLookupColumn(records, "node_id")

        def __init__(self, **values):
            self.node_id = 42
            self.__dict__.update(values)
            records.append(self)

        def to_dict(self):
            return {"node_id": self.node_id, "name": self.name, "latitude": self.latitude, "longitude": self.longitude}

    monkeypatch.setattr(route_node_module, "RouteNode", FakeRouteNode)
    monkeypatch.setattr(route_node_module, "db", type("DB", (), {"session": session}))
    client = app_with_route_node_blueprint().test_client()

    created = client.post(
        "/api/route-nodes",
        json={"name": "Library Entrance", "latitude": 16.72, "longitude": 121.69},
    )
    updated = client.put("/api/route-nodes/42", json={"name": "North Library Entrance"})

    assert created.status_code == 201
    assert created.json["route_node"]["name"] == "Library Entrance"
    assert updated.status_code == 200
    assert updated.json["route_node"]["name"] == "North Library Entrance"


def test_pathway_metadata_and_allowed_modes_round_trip_through_create(monkeypatch):
    session = FakeSession()

    class FakeRouteNode:
        query = type("Query", (), {"get": staticmethod(lambda identifier: object())})()

    class FakePathway:
        def __init__(self, **values):
            self.pathway_id = 9
            self.__dict__.update(values)
            self.allowed_modes = []

        def to_dict(self):
            return {
                "pathway_id": self.pathway_id,
                "name": self.name,
                "direction": self.direction,
                "shade": self.shade,
                "allowed_modes": [item.mode for item in self.allowed_modes],
            }

    monkeypatch.setattr(route_node_module, "RouteNode", FakeRouteNode)
    monkeypatch.setattr(route_node_module, "Pathway", FakePathway)
    monkeypatch.setattr(route_node_module, "PathwayAllowedMode", FakeAllowedMode, raising=False)
    monkeypatch.setattr(route_node_module, "db", type("DB", (), {"session": session}))

    response = app_with_route_node_blueprint().test_client().post(
        "/api/pathways",
        json={
            "name": "Covered Road Connector",
            "source_node_id": 3,
            "destination_node_id": 4,
            "path_type": "Road",
            "distance_m": 120,
            "estimated_minutes": 2,
            "direction": "One-way",
            "shade": "Mostly Shaded",
            "allowed_modes": ["Walking", "Vehicle"],
        },
    )

    assert response.status_code == 201
    assert response.json["pathway"] == {
        "pathway_id": 9,
        "name": "Covered Road Connector",
        "direction": "One-way",
        "shade": "Mostly Shaded",
        "allowed_modes": ["Walking", "Vehicle"],
    }


def test_pathway_update_replaces_allowed_modes_and_preserves_metadata(monkeypatch):
    session = FakeSession()
    pathway = type(
        "PathwayRecord",
        (),
        {
            "pathway_id": 9,
            "source_node_id": 3,
            "destination_node_id": 4,
            "name": "Old Connector",
            "direction": "Two-way",
            "shade": "Unshaded",
            "allowed_modes": [],
            "to_dict": lambda self: {
                "pathway_id": self.pathway_id,
                "name": self.name,
                "direction": self.direction,
                "shade": self.shade,
                "allowed_modes": [item.mode for item in self.allowed_modes],
            },
        },
    )()

    class FakePathway:
        query = type("Query", (), {"get": staticmethod(lambda identifier: pathway)})()

    monkeypatch.setattr(route_node_module, "Pathway", FakePathway)
    monkeypatch.setattr(route_node_module, "PathwayAllowedMode", FakeAllowedMode, raising=False)
    monkeypatch.setattr(route_node_module, "RouteNode", type("RouteNode", (), {"query": type("Query", (), {"get": staticmethod(lambda identifier: object())})()}))
    monkeypatch.setattr(route_node_module, "db", type("DB", (), {"session": session}))

    response = app_with_route_node_blueprint().test_client().put(
        "/api/pathways/9",
        json={"name": "Updated Connector", "direction": "Two-way", "shade": "Partial Shade", "allowed_modes": ["Walking"]},
    )

    assert response.status_code == 200
    assert response.json["pathway"] == {
        "pathway_id": 9,
        "name": "Updated Connector",
        "direction": "Two-way",
        "shade": "Partial Shade",
        "allowed_modes": ["Walking"],
    }


def test_create_pathway_rejects_a_self_connection(monkeypatch):
    response = app_with_route_node_blueprint().test_client().post(
        "/api/pathways",
        json={
            "source_node_id": 3,
            "destination_node_id": 3,
            "path_type": "walkway",
            "distance_m": 10,
            "estimated_minutes": 1,
        },
    )

    assert response.status_code == 400
    assert "cannot be the same" in response.json["message"]


def test_create_path_point_persists_the_ordered_coordinate(monkeypatch):
    session = FakeSession()

    class FakePathPoint:
        def __init__(self, **values):
            self.point_id = 5
            self.__dict__.update(values)

        def to_dict(self):
            return {
                "point_id": self.point_id,
                "pathway_id": self.pathway_id,
                "sequence_no": self.sequence_no,
                "latitude": self.latitude,
                "longitude": self.longitude,
            }

    monkeypatch.setattr(route_node_module, "PathPoint", FakePathPoint)
    monkeypatch.setattr(route_node_module, "db", type("DB", (), {"session": session}))

    response = app_with_route_node_blueprint().test_client().post(
        "/api/path-points",
        json={
            "pathway_id": 9,
            "sequence_no": 2,
            "latitude": 16.721,
            "longitude": 121.691,
            "node_type": "Waypoint",
        },
    )

    assert response.status_code == 201
    assert response.json["path_point"] == {
        "point_id": 5,
        "pathway_id": 9,
        "sequence_no": 2,
        "latitude": 16.721,
        "longitude": 121.691,
    }
    assert session.commits == 1
