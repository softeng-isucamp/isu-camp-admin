from flask import Flask
import pytest

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
        self.flushes = 0
        self.rollbacks = 0
        self.deleted = []
        self.fail_commit = False

    def add(self, record):
        self.added.append(record)

    def commit(self):
        self.commits += 1
        if self.fail_commit:
            raise RuntimeError("database write failed")

    def rollback(self):
        self.rollbacks += 1

    def delete(self, record):
        self.deleted.append(record)

    def flush(self):
        self.flushes += 1
        return None


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


@pytest.fixture(autouse=True)
def authenticated_admin(monkeypatch):
    """Keep unit tests focused on route behavior; auth has explicit coverage below."""
    monkeypatch.setattr(route_node_module, "admin_required", lambda: (object(), None), raising=False)


def test_walking_network_mutations_require_an_administrator(monkeypatch):
    monkeypatch.setattr(
        route_node_module,
        "admin_required",
        lambda: (None, ({"success": False, "message": "Authentication required"}, 401)),
        raising=False,
    )

    response = app_with_route_node_blueprint().test_client().post(
        "/api/route-nodes", json={"latitude": 16.72, "longitude": 121.69}
    )

    assert response.status_code == 401
    assert response.json["message"] == "Authentication required"


@pytest.mark.parametrize(
    "payload, message",
    [
        ({"latitude": "north", "longitude": 121.69}, "latitude must be a finite number"),
        ({"latitude": 91, "longitude": 121.69}, "latitude must be between -90 and 90"),
        ({"latitude": 16.72, "longitude": 181}, "longitude must be between -180 and 180"),
        ({"latitude": 16.72, "longitude": 121.69, "node_type": "teleporter"}, "node_type must be one of"),
    ],
)
def test_create_route_node_rejects_invalid_values(payload, message):
    response = app_with_route_node_blueprint().test_client().post("/api/route-nodes", json=payload)

    assert response.status_code == 400
    assert message in response.json["message"]


def test_create_pathway_with_points_is_atomic_and_returns_geometry(monkeypatch):
    session = FakeSession()

    class FakeRouteNode:
        query = type("Query", (), {"get": staticmethod(lambda _identifier: object())})()

    class FakePathPoint:
        next_id = 1

        def __init__(self, **values):
            self.point_id = FakePathPoint.next_id
            FakePathPoint.next_id += 1
            self.__dict__.update(values)

        def to_dict(self):
            return {"point_id": self.point_id, "pathway_id": self.pathway_id, "sequence_no": self.sequence_no,
                    "latitude": self.latitude, "longitude": self.longitude}

    class FakePathway:
        def __init__(self, **values):
            self.pathway_id = 9
            self.__dict__.update(values)
            self.allowed_modes = []
            self.path_points = []

        def to_dict(self):
            return {"pathway_id": self.pathway_id, "name": self.name,
                    "path_points": [point.to_dict() for point in self.path_points]}

    monkeypatch.setattr(route_node_module, "RouteNode", FakeRouteNode)
    monkeypatch.setattr(route_node_module, "Pathway", FakePathway)
    monkeypatch.setattr(route_node_module, "PathPoint", FakePathPoint)
    monkeypatch.setattr(route_node_module, "PathwayAllowedMode", FakeAllowedMode)
    monkeypatch.setattr(route_node_module, "db", type("DB", (), {"session": session}))

    response = app_with_route_node_blueprint().test_client().post("/api/pathways", json={
        "source_node_id": 3, "destination_node_id": 4, "path_type": "Walkway",
        "distance_m": 12, "estimated_minutes": 1,
        "path_points": [{"latitude": 16.72, "longitude": 121.69}, {"latitude": 16.721, "longitude": 121.691}],
    })

    assert response.status_code == 201
    assert [point["sequence_no"] for point in response.json["pathway"]["path_points"]] == [1, 2]
    assert session.commits == 1


@pytest.mark.parametrize("fail_commit", [False, True])
@pytest.mark.parametrize("reuse_existing_node", [False, True])
def test_convert_saved_point_creates_one_node_and_two_geometry_preserving_pathways_in_one_commit(monkeypatch, fail_commit, reuse_existing_node):
    from types import SimpleNamespace

    session = FakeSession()
    session.fail_commit = fail_commit
    original_points = [
        SimpleNamespace(latitude=16.7207, longitude=121.6897, to_dict=lambda: {"latitude": 16.7207, "longitude": 121.6897, "sequence_no": 1}),
        SimpleNamespace(latitude=16.7208, longitude=121.6898, to_dict=lambda: {"latitude": 16.7208, "longitude": 121.6898, "sequence_no": 2}),
    ]
    original = SimpleNamespace(
        pathway_id=9, name="North Walk", status="active", source_node_id=1, destination_node_id=2,
        path_type="Walkway", direction="Two-way", shade="Mostly Shaded", allowed_modes=[SimpleNamespace(mode="Walking")],
        path_points=original_points,
    )
    session.get = lambda _model, identifier, **_options: original if identifier == 9 else None
    nodes = {
        1: SimpleNamespace(node_id=1, latitude=16.7205, longitude=121.6895, status="active"),
        2: SimpleNamespace(node_id=2, latitude=16.721, longitude=121.69, status="active"),
        4: SimpleNamespace(node_id=4, latitude=16.7207, longitude=121.6897, status="inactive"),
    }

    class FakeNode:
        query = SimpleNamespace(
            get=lambda identifier: nodes.get(identifier),
            filter_by=lambda **values: SimpleNamespace(first=lambda: next(
                (node for node in nodes.values() if all(getattr(node, key, None) == value for key, value in values.items())),
                None,
            )),
        )

        def __init__(self, **values):
            self.node_id = 3
            self.__dict__.update(values)
            nodes[3] = self

        def to_dict(self):
            return {"node_id": self.node_id, "name": self.name, "node_type": self.node_type}

    if reuse_existing_node:
        nodes[3] = FakeNode(name="Library Junction", node_type="intersection", latitude=16.7207, longitude=121.6897, status="active")

    class FakePathway:
        query = SimpleNamespace(get=lambda identifier: original if identifier == 9 else None)
        next_id = 10

        def __init__(self, **values):
            self.pathway_id = FakePathway.next_id
            FakePathway.next_id += 1
            self.__dict__.update(values)
            self.path_points = []
            self.allowed_modes = []

        def to_dict(self):
            return {"pathway_id": self.pathway_id, "source_node_id": self.source_node_id,
                    "destination_node_id": self.destination_node_id, "name": self.name,
                    "distance_m": self.distance_m, "estimated_minutes": self.estimated_minutes,
                    "path_points": self.path_points}

    monkeypatch.setattr(route_node_module, "RouteNode", FakeNode)
    monkeypatch.setattr(route_node_module, "Pathway", FakePathway)
    monkeypatch.setattr(route_node_module, "PathwayAllowedMode", FakeAllowedMode)
    monkeypatch.setattr(route_node_module, "db", SimpleNamespace(session=session))
    monkeypatch.setattr(route_node_module, "log_audit", lambda *_args: None)
    monkeypatch.setattr(route_node_module, "_replace_points", lambda pathway, points: setattr(pathway, "path_points", points))

    response = app_with_route_node_blueprint().test_client().post("/api/pathways/9/convert-point", json={
        "sequence_no": 1,
        "point": {"latitude": 16.7207, "longitude": 121.6897},
        "node": None if reuse_existing_node else {"name": "Library Junction", "node_type": "intersection"},
        "existing_node_id": 3 if reuse_existing_node else None,
        "pathways": [
            {"name": "North Walk A", "path_type": "Walkway", "shade": "Mostly Shaded", "allowed_modes": ["Walking"]},
            {"name": "North Walk B", "path_type": "Road", "shade": "Unshaded", "allowed_modes": ["Walking", "Vehicle"]},
        ],
    })

    if fail_commit:
        assert response.status_code == 500
        assert session.rollbacks == 1
        return
    assert response.status_code == 201, response.json
    assert session.commits == 1
    assert original.status == "inactive"
    assert sum(isinstance(item, FakeNode) for item in session.added) == (0 if reuse_existing_node else 1)
    assert response.json["route_node"]["name"] == "Library Junction"
    first, second = response.json["pathways"]
    assert (first["source_node_id"], first["destination_node_id"]) == (1, 3)
    assert (second["source_node_id"], second["destination_node_id"]) == (3, 2)
    assert first["path_points"] == []
    assert second["path_points"] == [{"sequence_no": 1, "latitude": 16.7208, "longitude": 121.6898,
                                      "building_id": None, "node_type": "Waypoint", "status": "active"}]
    assert first["distance_m"] > 0 and second["distance_m"] > first["distance_m"]


def test_convert_point_rejects_stale_coordinates_without_writing(monkeypatch):
    from types import SimpleNamespace

    session = FakeSession()
    original = SimpleNamespace(status="active", path_points=[SimpleNamespace(latitude=16.72, longitude=121.69)])
    session.get = lambda _model, _identifier, **_options: original
    monkeypatch.setattr(route_node_module, "Pathway", type("Pathway", (), {"query": SimpleNamespace(get=lambda _id: original)}))
    monkeypatch.setattr(route_node_module, "db", SimpleNamespace(session=session))

    response = app_with_route_node_blueprint().test_client().post("/api/pathways/9/convert-point", json={
        "sequence_no": 1, "point": {"latitude": 16.73, "longitude": 121.69},
    })

    assert response.status_code == 400
    assert "changed" in response.json["message"]
    assert session.added == []
    assert session.commits == 0


def test_invalid_atomic_pathway_geometry_does_not_create_any_records(monkeypatch):
    session = FakeSession()
    monkeypatch.setattr(route_node_module, "RouteNode", type("RouteNode", (), {"query": type("Query", (), {"get": staticmethod(lambda _id: object())})()}))
    monkeypatch.setattr(route_node_module, "db", type("DB", (), {"session": session}))

    response = app_with_route_node_blueprint().test_client().post("/api/pathways", json={
        "source_node_id": 3, "destination_node_id": 4, "path_type": "Walkway",
        "distance_m": 12, "estimated_minutes": 1,
        "path_points": [{"latitude": 16.72, "longitude": 121.69}, {"latitude": "bad", "longitude": 121.691}],
    })

    assert response.status_code == 400
    assert session.added == []
    assert session.commits == 0


def test_path_point_requires_an_existing_pathway_and_positive_unique_order(monkeypatch):
    session = FakeSession()
    monkeypatch.setattr(route_node_module, "db", type("DB", (), {"session": session}))
    monkeypatch.setattr(route_node_module, "Pathway", type("Pathway", (), {"query": type("Query", (), {"get": staticmethod(lambda _id: None)})()}))

    response = app_with_route_node_blueprint().test_client().post("/api/path-points", json={
        "pathway_id": 9, "sequence_no": 0, "latitude": 16.72, "longitude": 121.69, "node_type": "Waypoint",
    })

    assert response.status_code == 400
    assert "sequence_no must be a positive integer" == response.json["message"]
    assert session.added == []


def test_path_point_rejects_duplicate_order_within_its_pathway(monkeypatch):
    session = FakeSession()
    existing = object()
    point_query = type(
        "Query",
        (),
        {"filter_by": staticmethod(lambda **_values: type("Result", (), {"first": staticmethod(lambda: existing)})())},
    )()
    monkeypatch.setattr(route_node_module, "PathPoint", type("PathPoint", (), {"query": point_query}))
    monkeypatch.setattr(route_node_module, "Pathway", type("Pathway", (), {"query": type("Query", (), {"get": staticmethod(lambda _id: object())})()}))
    monkeypatch.setattr(route_node_module, "db", type("DB", (), {"session": session}))

    response = app_with_route_node_blueprint().test_client().post("/api/path-points", json={
        "pathway_id": 9, "sequence_no": 1, "latitude": 16.72, "longitude": 121.69, "node_type": "Waypoint",
    })

    assert response.status_code == 400
    assert "already used" in response.json["message"]


def test_pathway_delete_and_failed_update_roll_back_with_an_audit(monkeypatch):
    session = FakeSession()
    pathway = type("PathwayRecord", (), {"pathway_id": 9, "name": "Connector", "path_points": [], "allowed_modes": []})()
    monkeypatch.setattr(route_node_module, "Pathway", type("Pathway", (), {"query": type("Query", (), {"get": staticmethod(lambda _id: pathway)})()}))
    monkeypatch.setattr(route_node_module, "db", type("DB", (), {"session": session}))
    audits = []
    monkeypatch.setattr(route_node_module, "log_audit", lambda *args: audits.append(args))

    response = app_with_route_node_blueprint().test_client().delete("/api/pathways/9")

    assert response.status_code == 200
    assert session.deleted == [pathway]
    assert audits[-1][2:4] == ("delete", "Pathway")


def test_route_node_delete_is_audited_as_a_cascade(monkeypatch):
    session = FakeSession()
    node = type("RouteNodeRecord", (), {"node_id": 4, "name": "North Gate"})()
    monkeypatch.setattr(route_node_module, "RouteNode", type("RouteNode", (), {"query": type("Query", (), {"get": staticmethod(lambda _id: node)})()}))
    monkeypatch.setattr(route_node_module, "db", type("DB", (), {"session": session}))
    audits = []
    monkeypatch.setattr(route_node_module, "log_audit", lambda *args: audits.append(args))

    response = app_with_route_node_blueprint().test_client().delete("/api/route-nodes/4")

    assert response.status_code == 200
    assert session.deleted == [node]
    assert "connected pathways" in audits[-1][-1]


def test_atomic_pathway_write_rolls_back_everything_when_commit_fails(monkeypatch):
    session = FakeSession()
    session.fail_commit = True

    class FakeRouteNode:
        query = type("Query", (), {"get": staticmethod(lambda _id: object())})()

    class FakePathway:
        def __init__(self, **values):
            self.pathway_id = 9
            self.__dict__.update(values)
            self.allowed_modes = []
            self.path_points = []

        def to_dict(self):
            return {"pathway_id": self.pathway_id}

    monkeypatch.setattr(route_node_module, "RouteNode", FakeRouteNode)
    monkeypatch.setattr(route_node_module, "Pathway", FakePathway)
    monkeypatch.setattr(route_node_module, "PathPoint", lambda **values: type("Point", (), values)())
    monkeypatch.setattr(route_node_module, "PathwayAllowedMode", FakeAllowedMode)
    monkeypatch.setattr(route_node_module, "db", type("DB", (), {"session": session}))

    response = app_with_route_node_blueprint().test_client().post("/api/pathways", json={
        "source_node_id": 3, "destination_node_id": 4, "path_type": "Walkway",
        "distance_m": 12, "estimated_minutes": 1,
        "path_points": [{"latitude": 16.72, "longitude": 121.69}],
    })

    assert response.status_code == 500
    assert session.commits == 1
    assert session.rollbacks == 1


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
                "path_type": "Walkway",
                "distance_m": 20,
                "estimated_minutes": 1,
                "status": "active",
                "surface_type": None,
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


def test_pathway_update_removes_old_points_before_reusing_sequence_numbers(monkeypatch):
    session = FakeSession()
    old_point = type("PathPointRecord", (), {"point_id": 4, "sequence_no": 1})()
    pathway = type(
        "PathwayRecord",
        (),
        {
            "pathway_id": 9,
            "source_node_id": 3,
            "destination_node_id": 4,
            "path_type": "Walkway",
            "distance_m": 20,
            "estimated_minutes": 1,
            "name": "Connector",
            "status": "active",
            "direction": "Unknown",
            "shade": "Unshaded",
            "surface_type": None,
            "allowed_modes": [],
            "path_points": [old_point],
            "to_dict": lambda self: {
                "pathway_id": self.pathway_id,
                "path_points": [
                    {"sequence_no": point.sequence_no, "latitude": point.latitude}
                    for point in self.path_points
                ],
            },
        },
    )()

    class FakePathPoint:
        def __init__(self, **values):
            self.__dict__.update(values)

    monkeypatch.setattr(
        route_node_module,
        "Pathway",
        type("Pathway", (), {"query": type("Query", (), {"get": staticmethod(lambda _id: pathway)})()}),
    )
    monkeypatch.setattr(route_node_module, "PathPoint", FakePathPoint)
    monkeypatch.setattr(route_node_module, "PathwayAllowedMode", FakeAllowedMode)
    monkeypatch.setattr(
        route_node_module,
        "RouteNode",
        type("RouteNode", (), {"query": type("Query", (), {"get": staticmethod(lambda _id: object())})()}),
    )
    monkeypatch.setattr(route_node_module, "db", type("DB", (), {"session": session}))

    response = app_with_route_node_blueprint().test_client().put(
        "/api/pathways/9",
        json={"path_points": [{"sequence_no": 1, "latitude": 16.721, "longitude": 121.691}]},
    )

    assert response.status_code == 200
    assert session.deleted == [old_point]
    assert session.flushes == 1
    assert response.json["pathway"]["path_points"] == [{"sequence_no": 1, "latitude": 16.721}]


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


def test_pathway_and_path_point_reject_unsupported_editor_enums(monkeypatch):
    session = FakeSession()
    monkeypatch.setattr(
        route_node_module,
        "RouteNode",
        type("RouteNode", (), {"query": type("Query", (), {"get": staticmethod(lambda _id: object())})()}),
    )
    monkeypatch.setattr(
        route_node_module,
        "Pathway",
        type("Pathway", (), {"query": type("Query", (), {"get": staticmethod(lambda _id: object())})()}),
    )
    monkeypatch.setattr(route_node_module, "PathPoint", type("PathPoint", (), {}))
    monkeypatch.setattr(route_node_module, "db", type("DB", (), {"session": session}))
    client = app_with_route_node_blueprint().test_client()

    pathway = client.post(
        "/api/pathways",
        json={
            "source_node_id": 3,
            "destination_node_id": 4,
            "path_type": "Trail",
            "distance_m": 10,
            "estimated_minutes": 1,
        },
    )
    path_point = client.post(
        "/api/path-points",
        json={
            "pathway_id": 9,
            "sequence_no": 1,
            "latitude": 16.72,
            "longitude": 121.69,
            "node_type": "Marker",
        },
    )

    assert pathway.status_code == 400
    assert pathway.json["message"] == "path_type must be one of Road, Walkway"
    assert path_point.status_code == 400
    assert path_point.json["message"] == "node_type must be one of Waypoint"


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
    monkeypatch.setattr(route_node_module, "Pathway", type("Pathway", (), {"query": type("Query", (), {"get": staticmethod(lambda _id: object())})()}))
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
