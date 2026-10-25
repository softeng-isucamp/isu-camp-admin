"""Per-administrator permissions, as the write routes enforce them.

Against the real guards and a real stored row, deliberately. What is being
tested here is what the server does with ``public.admin.permissions``, so a
fake that answered "allowed" would pass whatever the rule happened to be. Each
route is asked twice: once by an administrator who holds the permission it
needs and once by one who holds the other three.

A refusal is checked by its status and code. An allowance is checked by the
absence of a refusal rather than by a 200, because most of these routes go on
to fail on a record the test never created - reaching that failure is the proof
that the guard let the request through.
"""

import time

import pytest
from flask import Flask
from sqlalchemy import BigInteger
from sqlalchemy.ext.compiler import compiles

import actions as actions_module
import auth as auth_module
import location as location_module
import map as map_module
import route_node as route_node_module
import users as users_module
from actions import actions_bp
from auth import Admin, auth_bp
from extensions import db
from location import location_bp
from map import map_bp
from model.app_user import AppUser
from model.building import Building
from model.location import Location
from model.path_point import PathPoint
from model.pathway import Pathway
from model.pathway_allowed_mode import PathwayAllowedMode
from model.route_node import RouteNode
from route_node import route_node_bp
from users import users_bp

# The network's primary keys are BIGINT, and SQLite only fills a key in by
# itself when the column is declared INTEGER. Without this, a route that
# inserts a path point - which is most of what the composite writes below
# do - fails on the key rather than on anything these tests are about. It
# changes only what SQLite is handed at CREATE TABLE; PostgreSQL still gets
# BIGINT.
@compiles(BigInteger, "sqlite")
def _bigint_is_integer_on_sqlite(type_, compiler, **kw):
    return "INTEGER"


ALL_ON = {key: True for key in auth_module.PERMISSION_KEYS}
ALL_OFF = {key: False for key in auth_module.PERMISSION_KEYS}


def only(*granted):
    """The four switches with only the named ones on."""

    return {key: key in granted for key in auth_module.PERMISSION_KEYS}


def without(permission):
    """The four switches with everything but ``permission`` on.

    How a refusal is set up: the account is not short of access generally, it
    is short of exactly the one the route asks for.
    """

    return {key: key != permission for key in auth_module.PERMISSION_KEYS}


@pytest.fixture(autouse=True)
def no_audit(monkeypatch):
    """The audit table's id is not autoincrement outside PostgreSQL.

    Audit writes are covered where they are made; what matters here is which
    requests reach the point of making one at all.
    """

    for module in (actions_module, auth_module, location_module, map_module,
                   route_node_module, users_module):
        monkeypatch.setattr(module, "log_audit", lambda *args, **kwargs: None)


@pytest.fixture
def app():
    app = Flask(__name__)
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite://",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        TESTING=True,
        SECRET_KEY="test-secret",
    )
    db.init_app(app)
    for blueprint in (auth_bp, actions_bp, location_bp, map_bp, route_node_bp, users_bp):
        app.register_blueprint(blueprint)

    with app.app_context():
        # The models name their tables "public.x"; SQLite has no schemas, so one
        # is attached under that name.
        db.session.execute(db.text("ATTACH DATABASE ':memory:' AS public"))
        db.metadata.create_all(db.engine)
        yield app
        db.session.remove()
        db.drop_all()


def add_admin(app, permissions, role="admin", identifier=1, username="admin01"):
    with app.app_context():
        db.session.add(Admin(
            id=identifier,
            username=username,
            password="not-verified-here",
            gmail=f"{username}@isu.edu.ph",
            role=role,
            permissions=permissions,
        ))
        db.session.commit()


def signed_in(app, admin_id=1, confirmed=True):
    """A client holding a session, with a fresh password confirmation.

    Deletes need the confirmation as well as the permission, and the point of
    these tests is the permission, so it is always there unless a test is about
    which of the two is checked first.
    """

    client = app.test_client()
    with client.session_transaction() as flask_session:
        flask_session["admin_id"] = admin_id
        flask_session["admin_username"] = "admin01"
        if confirmed:
            flask_session["reauth_at"] = time.time()
    return client


def stored_permissions(app, admin_id=1):
    with app.app_context():
        return db.session.get(Admin, admin_id).permissions


# ==========================================
# ONE WRITE PER SWITCH
# ==========================================

# Every route the four permissions gate, except the two that cannot be reached
# without stored records to act on - the indoor marker and the map draft, which
# have their own tests below.
#
# The bodies are as thin as each route's validation allows: a refusal happens
# before the body is read, and an allowance only has to get past the guard.
WRITES = {
    "add": {
        "create a location":
            lambda client: client.post("/api/locations", json={}),
        "add a room to a building":
            lambda client: client.post("/api/actions/buildings/1/rooms", json={}),
        "create a route node":
            lambda client: client.post("/api/route-nodes", json={"latitude": 16.72, "longitude": 121.69}),
        "create a pathway":
            lambda client: client.post("/api/pathways", json={"source_node_id": 1, "destination_node_id": 2, "path_type": "Walkway"}),
        "create a path point":
            lambda client: client.post("/api/path-points", json={"pathway_id": 1, "sequence_no": 1, "latitude": 16.72, "longitude": 121.69, "node_type": "Waypoint"}),
        "convert a path point to a route node":
            lambda client: client.post("/api/pathways/1/convert-point", json={"sequence_no": 1}),
    },
    "edit": {
        "edit a location":
            lambda client: client.put("/api/actions/locations/1", json={}),
        "edit a route node":
            lambda client: client.put("/api/route-nodes/1", json={"name": "North Gate"}),
        "edit a pathway":
            lambda client: client.put("/api/pathways/1", json={"name": "Main Walk"}),
        "edit a path point":
            lambda client: client.put("/api/path-points/1", json={"latitude": 16.72, "longitude": 121.69}),
        "reshape a pathway":
            lambda client: client.put("/api/pathways/1/points", json={"path_points": []}),
    },
    "delete": {
        "delete a location":
            lambda client: client.delete("/api/actions/locations/1"),
        "delete a building":
            lambda client: client.delete("/api/map/buildings/1"),
        "delete a route node":
            lambda client: client.delete("/api/route-nodes/1"),
        "delete a pathway":
            lambda client: client.delete("/api/pathways/1"),
        "delete a path point":
            lambda client: client.delete("/api/path-points/1"),
    },
    "changeUserStatus": {
        "deactivate an app user":
            lambda client: client.put("/api/users/1/status", json={"status": "Inactive"}),
    },
}

EVERY_WRITE = [
    pytest.param(permission, send, id=f"{permission}: {label}")
    for permission, routes in WRITES.items()
    for label, send in routes.items()
]


@pytest.mark.parametrize("permission,send", EVERY_WRITE)
def test_a_write_is_refused_without_its_permission(app, permission, send):
    add_admin(app, without(permission))

    response = send(signed_in(app))

    assert response.status_code == 403
    assert response.json["code"] == "PERMISSION_DENIED"
    assert response.json["message"] == "You don't have permission to do that. Ask a superadmin."
    assert response.json["success"] is False


@pytest.mark.parametrize("permission,send", EVERY_WRITE)
def test_a_write_is_allowed_with_its_permission(app, permission, send):
    add_admin(app, only(permission))

    response = send(signed_in(app))

    # Whatever it answers, it is not a refusal about permissions.
    assert response.status_code != 403
    assert (response.json or {}).get("code") != "PERMISSION_DENIED"


@pytest.mark.parametrize("permission,send", EVERY_WRITE)
def test_a_superadmin_is_never_refused(app, permission, send):
    """Their switches are not configurable, and the role carries everything."""

    add_admin(app, None, role="superadmin")

    response = send(signed_in(app))

    assert response.status_code != 403


@pytest.mark.parametrize("permission,send", EVERY_WRITE)
def test_a_superadmin_is_not_judged_by_a_stored_set(app, permission, send):
    """Four stored "off" switches on a superadmin's row still mean nothing."""

    add_admin(app, dict(ALL_OFF), role="superadmin")

    response = send(signed_in(app))

    assert response.status_code != 403


@pytest.mark.parametrize("permission,send", EVERY_WRITE)
def test_no_stored_permissions_is_full_access(app, permission, send):
    """What every row holds before the migration backfills it, and what any
    row a deployment never configured holds: no restriction recorded."""

    add_admin(app, None)

    response = send(signed_in(app))

    assert response.status_code != 403


@pytest.mark.parametrize("permission,send", EVERY_WRITE)
def test_everything_off_refuses_every_write(app, permission, send):
    add_admin(app, dict(ALL_OFF))

    response = send(signed_in(app))

    assert response.status_code == 403
    assert response.json["code"] == "PERMISSION_DENIED"


@pytest.mark.parametrize("permission,send", EVERY_WRITE)
def test_everything_on_allows_every_write(app, permission, send):
    add_admin(app, dict(ALL_ON))

    response = send(signed_in(app))

    assert response.status_code != 403


def test_a_switch_missing_from_a_stored_set_reads_as_off(app):
    """A configured set is complete by construction, but a hand-edited row is
    not: the set was configured and this switch is not in it."""

    add_admin(app, {"add": True})

    response = signed_in(app).put("/api/route-nodes/1", json={"name": "North Gate"})

    assert response.status_code == 403
    assert response.json["code"] == "PERMISSION_DENIED"


def test_a_mangled_stored_value_fails_open(app):
    """Not a configured set, so it reads like NULL: no restriction recorded.

    Failing closed here would lock a campus out of its own map over a bad
    write, and the database constraint is what stops the value arriving.
    """

    add_admin(app, "everything")

    response = signed_in(app).post("/api/route-nodes", json={"latitude": 16.72, "longitude": 121.69})

    assert response.status_code != 403


# ==========================================
# WITHDRAWING ONE TAKES EFFECT AT ONCE
# ==========================================

def test_a_revoked_permission_is_refused_on_the_next_request(app):
    """No sign-out, no new cookie: the switches are read from the row."""

    add_admin(app, dict(ALL_ON))
    client = signed_in(app)
    node = {"latitude": 16.72, "longitude": 121.69}

    assert client.post("/api/route-nodes", json=node).status_code != 403

    with app.app_context():
        db.session.get(Admin, 1).permissions = without("add")
        db.session.commit()

    # Same session cookie. Only the stored row changed.
    response = client.post("/api/route-nodes", json=node)

    assert response.status_code == 403
    assert response.json["code"] == "PERMISSION_DENIED"


def test_a_granted_permission_is_allowed_on_the_next_request(app):
    add_admin(app, dict(ALL_OFF))
    client = signed_in(app)

    assert client.post("/api/route-nodes", json={"latitude": 16.72, "longitude": 121.69}).status_code == 403

    with app.app_context():
        db.session.get(Admin, 1).permissions = only("add")
        db.session.commit()

    assert client.post("/api/route-nodes", json={"latitude": 16.72, "longitude": 121.69}).status_code != 403


def test_the_signed_in_account_reports_its_permissions_from_the_row(app):
    """GET /api/me is where the portal re-reads them, so it never caches."""

    add_admin(app, only("add", "edit"))
    client = signed_in(app)

    assert client.get("/api/me").json["admin"]["permissions"] == {
        "add": True, "edit": True, "delete": False, "changeUserStatus": False,
    }

    with app.app_context():
        db.session.get(Admin, 1).permissions = only("edit")
        db.session.commit()

    assert client.get("/api/me").json["admin"]["permissions"] == {
        "add": False, "edit": True, "delete": False, "changeUserStatus": False,
    }


def test_a_superadmin_reports_no_permissions_object(app):
    add_admin(app, None, role="superadmin")

    body = signed_in(app).get("/api/me").json["admin"]

    assert body["role"] == "superadmin"
    # Null, which the frontend reads as full access.
    assert body["permissions"] is None


# ==========================================
# THE PERMISSION COMES BEFORE THE PASSWORD
# ==========================================

DELETES = {
    "a location": lambda client: client.delete("/api/actions/locations/1"),
    "a building": lambda client: client.delete("/api/map/buildings/1"),
    "a route node": lambda client: client.delete("/api/route-nodes/1"),
    "a pathway": lambda client: client.delete("/api/pathways/1"),
}


@pytest.mark.parametrize("send", DELETES.values(), ids=list(DELETES))
def test_a_delete_without_the_permission_is_not_asked_for_a_password(app, send):
    """As with superadmin_required: refused outright, not prompted first.

    Being asked to confirm a password for something the answer was always no
    to teaches an administrator that the prompt means nothing.
    """

    add_admin(app, without("delete"))

    response = send(signed_in(app, confirmed=False))

    assert response.status_code == 403
    assert response.json["code"] == "PERMISSION_DENIED"


@pytest.mark.parametrize("send", DELETES.values(), ids=list(DELETES))
def test_a_delete_with_the_permission_still_needs_a_password(app, send):
    add_admin(app, only("delete"))

    response = send(signed_in(app, confirmed=False))

    assert response.status_code == 403
    assert response.json["code"] == "password_confirmation_required"


# ==========================================
# INDOOR MARKERS: PLACING IS AN ADD, MOVING IS AN EDIT
# ==========================================

def add_building_with_room(app, *, lat=None, lng=None):
    """A building with a footprint and one indoor location inside it."""

    with app.app_context():
        db.session.add(Building(
            building_id=1,
            building_code="ENG-01",
            building_name="Engineering Hall",
            classification="Building",
            polygon_coordinates=[[16.70, 121.60], [16.70, 121.70], [16.80, 121.70], [16.80, 121.60]],
        ))
        db.session.add(Location(
            location_id=2,
            location_code="R-12",
            location_name="Room 12",
            type_id=1,
            building_id=1,
            latitude=lat,
            longitude=lng,
        ))
        db.session.commit()


def marker_of(app, location_id=2):
    """The stored marker as plain floats; the columns are Numeric."""

    with app.app_context():
        record = db.session.get(Location, location_id)
        if record.latitude is None and record.longitude is None:
            return (None, None)
        return (float(record.latitude), float(record.longitude))


INSIDE = {"lat": 16.75, "lng": 121.65}
ELSEWHERE_INSIDE = {"lat": 16.76, "lng": 121.66}
CLEARED = {"lat": None, "lng": None}


def test_placing_an_unpositioned_marker_needs_add(app):
    add_building_with_room(app)
    add_admin(app, only("add"))

    response = signed_in(app).patch("/api/map/buildings/1/indoor-locations/2", json=INSIDE)

    assert response.status_code == 200
    assert marker_of(app) == (16.75, 121.65)


def test_placing_an_unpositioned_marker_is_refused_without_add(app):
    add_building_with_room(app)
    add_admin(app, without("add"))

    response = signed_in(app).patch("/api/map/buildings/1/indoor-locations/2", json=INSIDE)

    assert response.status_code == 403
    assert response.json["code"] == "PERMISSION_DENIED"
    assert marker_of(app) == (None, None)


def test_moving_an_existing_marker_needs_edit(app):
    add_building_with_room(app, lat=16.75, lng=121.65)
    add_admin(app, only("edit"))

    response = signed_in(app).patch(
        "/api/map/buildings/1/indoor-locations/2", json=ELSEWHERE_INSIDE,
    )

    assert response.status_code == 200
    assert marker_of(app) == (16.76, 121.66)


def test_moving_an_existing_marker_is_refused_without_edit(app):
    add_building_with_room(app, lat=16.75, lng=121.65)
    add_admin(app, without("edit"))

    response = signed_in(app).patch(
        "/api/map/buildings/1/indoor-locations/2", json=ELSEWHERE_INSIDE,
    )

    assert response.status_code == 403
    assert marker_of(app) == (16.75, 121.65)


def test_clearing_an_existing_marker_needs_edit_not_delete(app):
    """Clearing a marker removes nothing: the indoor location is still there,
    it just has no position. Deleting it is a different route."""

    add_building_with_room(app, lat=16.75, lng=121.65)
    add_admin(app, only("edit"))

    response = signed_in(app).patch("/api/map/buildings/1/indoor-locations/2", json=CLEARED)

    assert response.status_code == 200
    assert marker_of(app) == (None, None)


def test_add_alone_cannot_move_a_marker_that_is_already_placed(app):
    """The two halves of this route are judged apart: an administrator who may
    place markers but not edit cannot drag one that is already on the map."""

    add_building_with_room(app, lat=16.75, lng=121.65)
    add_admin(app, only("add"))

    response = signed_in(app).patch(
        "/api/map/buildings/1/indoor-locations/2", json=ELSEWHERE_INSIDE,
    )

    assert response.status_code == 403
    assert marker_of(app) == (16.75, 121.65)


def test_edit_alone_cannot_place_a_marker_for_the_first_time(app):
    add_building_with_room(app)
    add_admin(app, only("edit"))

    response = signed_in(app).patch("/api/map/buildings/1/indoor-locations/2", json=INSIDE)

    assert response.status_code == 403
    assert marker_of(app) == (None, None)


def test_which_operation_it_is_comes_from_the_row_not_the_request(app):
    """A client cannot choose the permission it is judged against by claiming
    to be placing a marker that is already placed."""

    add_building_with_room(app, lat=16.75, lng=121.65)
    add_admin(app, only("add"))

    response = signed_in(app).patch(
        "/api/map/buildings/1/indoor-locations/2",
        json={**ELSEWHERE_INSIDE, "placing": True, "firstPlacement": True},
    )

    assert response.status_code == 403
    assert marker_of(app) == (16.75, 121.65)


# ==========================================
# THE MAP DRAFT: ONE SAVE, CHECKED PER CHANGE
# ==========================================

FOOTPRINT = [[16.70, 121.60], [16.70, 121.71], [16.81, 121.71], [16.81, 121.60]]


def add_building(app):
    with app.app_context():
        db.session.add(Building(
            building_id=1,
            building_code="ENG-01",
            building_name="Engineering Hall",
            classification="Building",
            polygon_coordinates=[[16.70, 121.60], [16.70, 121.70], [16.80, 121.70], [16.80, 121.60]],
        ))
        db.session.commit()


def footprint_of(app, building_id=1):
    with app.app_context():
        return db.session.get(Building, building_id).polygon_coordinates


def test_saving_a_footprint_needs_edit(app):
    add_building(app)
    add_admin(app, only("edit"))

    response = signed_in(app).post("/api/map/save", json={
        "buildings": [{"id": "1", "points": FOOTPRINT}],
    })

    assert response.status_code == 200
    assert footprint_of(app) == FOOTPRINT


def test_saving_a_footprint_is_refused_without_edit(app):
    add_building(app)
    add_admin(app, without("edit"))
    before = footprint_of(app)

    response = signed_in(app).post("/api/map/save", json={
        "buildings": [{"id": "1", "points": FOOTPRINT}],
    })

    assert response.status_code == 403
    assert response.json["code"] == "PERMISSION_DENIED"
    # The refusal names the change it refused, not just the permission.
    assert response.json["message"] == (
        "You don't have permission to change the Engineering Hall footprint. "
        "Ask a superadmin."
    )
    assert footprint_of(app) == before


def test_one_refused_change_refuses_the_whole_save(app):
    """A save is one operation: the allowed half of a payload must not land."""

    add_building(app)
    with app.app_context():
        db.session.add(RouteNode(node_id=5, latitude=16.72, longitude=121.69, name="North Gate", node_type="intersection", status="active"))
        db.session.commit()
    add_admin(app, without("edit"))

    response = signed_in(app).post("/api/map/save", json={
        "nodes": [{"id": "5", "lat": 16.73, "lng": 121.70}],
        "buildings": [{"id": "1", "points": FOOTPRINT}],
    })

    assert response.status_code == 403
    with app.app_context():
        node = db.session.get(RouteNode, 5)
        assert (node.latitude, node.longitude) == (16.72, 121.69)
    assert footprint_of(app) != FOOTPRINT


def test_a_save_that_asks_for_nothing_needs_nothing(app):
    """An empty draft changes no record, so there is nothing to refuse."""

    add_admin(app, dict(ALL_OFF))

    response = signed_in(app).post("/api/map/save", json={})

    assert response.status_code == 200


def test_a_save_naming_records_that_do_not_exist_asks_for_nothing(app):
    add_admin(app, dict(ALL_OFF))

    response = signed_in(app).post("/api/map/save", json={
        "nodes": [{"id": "404", "lat": 16.73, "lng": 121.70}],
    })

    assert response.status_code == 200


def test_an_invalid_footprint_is_still_a_validation_error(app):
    """Checked before the permissions, because it is about the payload."""

    add_building(app)
    add_admin(app, dict(ALL_OFF))

    response = signed_in(app).post("/api/map/save", json={
        "buildings": [{"id": "1", "points": [[16.7, 121.6]]}],
    })

    assert response.status_code == 400
    assert "buildings[0].points" in response.json["fields"]


def test_publishing_is_open_to_every_active_administrator(app):
    """It promotes work that is already saved, and the saving is what each
    permission was checked on."""

    add_admin(app, dict(ALL_OFF))

    response = signed_in(app).post("/api/map/publish", json={"revisionId": "7"})

    assert response.status_code == 200


# ==========================================
# COMPOSITE NETWORK WRITES
# ==========================================

def add_network(app, points=2):
    """Two route nodes and an active pathway carrying ``points`` vertices."""

    with app.app_context():
        for node_id, lat in ((1, 16.70), (2, 16.80)):
            db.session.add(RouteNode(
                node_id=node_id, latitude=lat, longitude=121.60,
                name=f"Node {node_id}", node_type="intersection", status="active",
            ))
        db.session.add(Pathway(
            pathway_id=1, source_node_id=1, destination_node_id=2,
            path_type="Walkway", name="Main Walk", status="active",
            direction="Two-way", shade="Unshaded", shaded=False,
        ))
        db.session.flush()
        # A pathway with no allowed mode is not a pathway any route will
        # accept, and splitting one carries its modes across.
        db.session.add(PathwayAllowedMode(pathway_id=1, mode="Walking"))
        for sequence_no in range(1, points + 1):
            db.session.add(PathPoint(
                pathway_id=1, sequence_no=sequence_no,
                latitude=16.70 + sequence_no / 100, longitude=121.60,
                node_type="Waypoint", status="active",
            ))
        db.session.commit()


def shape_of(app, pathway_id=1):
    with app.app_context():
        points = (
            PathPoint.query
            .filter_by(pathway_id=pathway_id)
            .order_by(PathPoint.sequence_no)
            .all()
        )
        return [(point.sequence_no, round(float(point.latitude), 4)) for point in points]


def vertices(*latitudes):
    return [
        {"latitude": latitude, "longitude": 121.60, "node_type": "Waypoint"}
        for latitude in latitudes
    ]


def test_reshaping_a_pathway_with_more_vertices_needs_only_edit(app):
    """The vertices this stores are new records, and dropping one removes a
    record, but the operation is one Edit Pathway and is authorized as one."""

    add_network(app, points=2)
    add_admin(app, only("edit"))

    response = signed_in(app).put("/api/pathways/1/points", json={
        "path_points": vertices(16.71, 16.72, 16.73, 16.74),
    })

    assert response.status_code == 200
    assert shape_of(app) == [(1, 16.71), (2, 16.72), (3, 16.73), (4, 16.74)]


def test_reshaping_a_pathway_with_fewer_vertices_needs_only_edit(app):
    add_network(app, points=4)
    add_admin(app, only("edit"))

    response = signed_in(app).put("/api/pathways/1/points", json={
        "path_points": vertices(16.71),
    })

    assert response.status_code == 200
    assert shape_of(app) == [(1, 16.71)]


def test_reshaping_a_pathway_to_no_vertices_needs_only_edit(app):
    add_network(app, points=3)
    add_admin(app, only("edit"))

    response = signed_in(app).put("/api/pathways/1/points", json={"path_points": []})

    assert response.status_code == 200
    assert shape_of(app) == []


def test_a_refused_reshape_leaves_the_whole_shape_unchanged(app):
    add_network(app, points=3)
    add_admin(app, without("edit"))
    before = shape_of(app)

    response = signed_in(app).put("/api/pathways/1/points", json={
        "path_points": vertices(16.71, 16.72, 16.73, 16.74, 16.75),
    })

    assert response.status_code == 403
    assert response.json["code"] == "PERMISSION_DENIED"
    assert shape_of(app) == before


def test_add_alone_cannot_reshape_a_pathway(app):
    """Even though reshaping stores new vertex records: the operation is an
    edit, and which records it may touch is decided from the pathway in the URL."""

    add_network(app, points=2)
    add_admin(app, only("add"))
    before = shape_of(app)

    response = signed_in(app).put("/api/pathways/1/points", json={
        "path_points": vertices(16.71, 16.72, 16.73),
    })

    assert response.status_code == 403
    assert shape_of(app) == before


def test_creating_a_pathway_with_its_vertices_needs_only_add(app):
    """Initial creation carries the shape with it, so it is one add."""

    add_network(app, points=0)
    add_admin(app, only("add"))

    response = signed_in(app).post("/api/pathways", json={
        "source_node_id": 1,
        "destination_node_id": 2,
        "path_type": "Walkway",
        "name": "Service Road",
        "path_points": vertices(16.72, 16.74, 16.76),
    })

    assert response.status_code == 201
    assert len(response.json["pathway"]["path_points"]) == 3


def test_converting_a_path_point_to_a_route_node_needs_only_add(app):
    """Create Junction and Convert to Route Node rewire the pathways they
    split - that rewiring is part of the add, not a separate edit or delete."""

    add_network(app, points=3)
    add_admin(app, only("add"))

    response = signed_in(app).post("/api/pathways/1/convert-point", json={
        "sequence_no": 2,
        "point": {"latitude": 16.72, "longitude": 121.60},
        "node": {"name": "New Junction", "node_type": "intersection"},
        "pathways": [{"name": "Main Walk A"}, {"name": "Main Walk B"}],
    })

    assert response.status_code == 201
    assert response.json["route_node"]["name"] == "New Junction"
    assert len(response.json["pathways"]) == 2
    with app.app_context():
        # The pathway it replaced was retired, not deleted.
        assert db.session.get(Pathway, 1).status == "inactive"


def test_a_refused_conversion_leaves_the_graph_unchanged(app):
    add_network(app, points=3)
    add_admin(app, without("add"))
    before = shape_of(app)

    response = signed_in(app).post("/api/pathways/1/convert-point", json={
        "sequence_no": 2,
        "point": {"latitude": 16.72, "longitude": 121.60},
        "node": {"name": "New Junction", "node_type": "intersection"},
        "pathways": [{"name": "Main Walk A"}, {"name": "Main Walk B"}],
    })

    assert response.status_code == 403
    assert shape_of(app) == before
    with app.app_context():
        assert db.session.get(Pathway, 1).status == "active"
        assert RouteNode.query.count() == 2
        assert Pathway.query.count() == 1


def test_a_standalone_vertex_write_is_still_judged_on_its_own(app):
    """Which is why reshaping has its own route: an Edit Pathway reconciled
    one vertex at a time would need "add" for a pathway that gained one."""

    add_network(app, points=1)
    add_admin(app, only("edit"))

    response = signed_in(app).post("/api/path-points", json={
        "pathway_id": 1, "sequence_no": 2,
        "latitude": 16.73, "longitude": 121.60, "node_type": "Waypoint",
    })

    assert response.status_code == 403
    assert response.json["code"] == "PERMISSION_DENIED"


# ==========================================
# APP USER STATUS
# ==========================================

def test_changing_an_app_users_status_needs_its_own_permission(app):
    with app.app_context():
        db.session.add(AppUser(id=1, username="student01", status="active"))
        db.session.commit()
    add_admin(app, only("changeUserStatus"))

    response = signed_in(app).put("/api/users/1/status", json={"status": "Inactive"})

    assert response.status_code == 200
    with app.app_context():
        assert db.session.get(AppUser, 1).status == "inactive"


def test_the_other_three_permissions_do_not_reach_app_users(app):
    """Locking a student out of the User App is a different kind of decision
    from editing the map, and is given to a different set of people."""

    with app.app_context():
        db.session.add(AppUser(id=1, username="student01", status="active"))
        db.session.commit()
    add_admin(app, only("add", "edit", "delete"))

    response = signed_in(app).put("/api/users/1/status", json={"status": "Inactive"})

    assert response.status_code == 403
    with app.app_context():
        assert db.session.get(AppUser, 1).status == "active"


# ==========================================
# VIEWING IS NOT A SWITCH
# ==========================================

READS = {
    "the locations list": "/api/actions/locations",
    "the map buildings": "/api/map/buildings",
    "the route nodes": "/api/route-nodes",
    "the pathways": "/api/pathways",
    "the path points": "/api/path-points",
    "the app users": "/api/users",
}


@pytest.mark.parametrize("path", READS.values(), ids=list(READS))
def test_an_administrator_with_nothing_switched_on_can_still_read(app, path):
    """Viewing is the least-privilege minimum every active account keeps. An
    administrator who should see nothing is deactivated instead."""

    add_admin(app, dict(ALL_OFF))

    response = signed_in(app).get(path)

    assert response.status_code == 200


@pytest.mark.parametrize("path", READS.values(), ids=list(READS))
def test_a_deactivated_account_reads_nothing(app, path):
    add_admin(app, dict(ALL_ON))
    with app.app_context():
        db.session.get(Admin, 1).status = "inactive"
        db.session.commit()

    response = signed_in(app).get(path)

    assert response.status_code == 401
