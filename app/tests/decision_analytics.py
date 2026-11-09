"""``GET /api/dashboard/decision-analytics`` and the rules behind it.

One small campus serves every test. Distances are real metres (the router
measures with Haversine), laid out so the shortest walk to the College runs
through the junction and a longer detour exists around the west side:

    detour --------------.
      |                  |
     gate --- junction --+-- college entrance
                 |
                 +---- cafe entrance        (walk + vehicle)

    annex entrance -> junction              (one-way, pointing away from it)
    library                                 (no entrance at all)
    gate --- cafe                           (inactive shortcut, ignored)
"""

from datetime import datetime, timezone

import pytest
from flask import Flask

import dashboard as dashboard_route
from dashboard import dashboard_bp
from extensions import db
from model.app_user import AppUser, UserInfo
from model.building import Building
from model.building_type import BuildingType
from model.location import Location
from model.pathway import Pathway
from model.pathway_allowed_mode import PathwayAllowedMode
from model.route_node import RouteNode
from model.user_history import UserHistory
from services.decision_analytics import summarize_decision_analytics

NOW = datetime(2026, 10, 9, 4, 0, tzinfo=timezone.utc)

GATE, JUNCTION, COLLEGE_DOOR, CAFE_DOOR, ANNEX_DOOR, DETOUR = 1, 2, 3, 4, 5, 6
COLLEGE, CAFE, ANNEX, LIBRARY, CLOSED = 10, 20, 30, 40, 50


@pytest.fixture
def app(monkeypatch):
    app = Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI="sqlite://", SQLALCHEMY_TRACK_MODIFICATIONS=False, TESTING=True)
    db.init_app(app)
    app.register_blueprint(dashboard_bp)
    monkeypatch.setattr(dashboard_route, "admin_required", lambda: (object(), None))

    with app.app_context():
        db.session.execute(db.text("ATTACH DATABASE ':memory:' AS public"))
        db.metadata.create_all(db.engine)
        db.session.add_all([
            BuildingType(type_id=index, type_name=name, can_contain_locations=name in ("College", "Campus Services"))
            for index, name in enumerate(("College", "Campus Services", "Food", "Parking", "Facility"), start=1)
        ])
        seed_campus()
        db.session.commit()
        yield app
        db.session.remove()
        db.drop_all()


def place(identifier, name, classification, **columns):
    type_row = BuildingType.query.filter_by(type_name=classification).first()
    db.session.add(Building(
        building_id=identifier, building_code=f"B{identifier}", building_name=name,
        classification=classification, type_id=type_row.type_id, status=columns.pop("status", "active"),
        **columns,
    ))


def node(identifier, lat, lng, name="Route Node", node_type="intersection", building_id=None, status="active"):
    db.session.add(RouteNode(
        node_id=identifier, latitude=lat, longitude=lng, name=name,
        node_type=node_type, building_id=building_id, status=status,
    ))


def pathway(identifier, source, target, modes, direction="Two Way", status="active", name=None):
    db.session.add(Pathway(
        pathway_id=identifier, source_node_id=source, destination_node_id=target, path_type="Walkway",
        name=name or f"Path {identifier}", status=status, direction=direction,
    ))
    db.session.add_all(PathwayAllowedMode(pathway_id=identifier, mode=mode) for mode in modes)


def seed_campus():
    place(COLLEGE, "College of Engineering", "College", description="Labs", keywords="coe", latitude=16.722, longitude=121.69)
    place(CAFE, "Cafe", "Food", description="Coffee", keywords="food", latitude=16.721, longitude=121.691)
    place(ANNEX, "Annex", "Campus Services", latitude=16.72, longitude=121.691)
    place(LIBRARY, "Library", "College")
    place(CLOSED, "Closed Hall", "College", status="inactive")
    db.session.add(Location(
        location_id=1, location_code="R1", location_name="Room 101", type_id=1,
        building_id=COLLEGE, status="active", created_at=NOW, updated_at=NOW,
    ))

    node(GATE, 16.720, 121.690, name="Main Gate")
    node(JUNCTION, 16.721, 121.690)
    node(COLLEGE_DOOR, 16.722, 121.690, node_type="Entrance", building_id=COLLEGE)
    node(CAFE_DOOR, 16.721, 121.691, node_type="Entrance", building_id=CAFE)
    node(ANNEX_DOOR, 16.720, 121.691, node_type="Entrance", building_id=ANNEX)
    node(DETOUR, 16.721, 121.688)

    pathway(100, GATE, JUNCTION, ("Walking", "Vehicle"), name="Gate road")
    pathway(101, JUNCTION, COLLEGE_DOOR, ("Walking",), name="College walk")
    pathway(102, JUNCTION, CAFE_DOOR, ("Walking", "Vehicle"), name="Cafe lane")
    pathway(103, ANNEX_DOOR, JUNCTION, ("Walking",), direction="One Way", name="Annex exit")
    pathway(104, GATE, CAFE_DOOR, ("Walking",), status="inactive", name="Old shortcut")
    pathway(105, GATE, DETOUR, ("Walking",), name="West path")
    pathway(106, DETOUR, COLLEGE_DOOR, ("Walking",), name="West path")


def summary(range_key="week"):
    return summarize_decision_analytics(range_key, now=NOW)


def check(result, key):
    return next(row for row in result["readiness"]["checks"] if row["key"] == key)


def ids(refs):
    return sorted(ref["id"] for ref in refs)


# ==========================================
# READINESS
# ==========================================

def test_readiness_counts_active_places_only(app):
    with app.app_context():
        result = summary()

    assert result["readiness"]["total"] == 4
    assert str(CLOSED) not in {ref["id"] for row in result["readiness"]["checks"] for ref in row["missing"]}


def test_an_entrance_counts_only_when_a_routable_pathway_touches_it(app):
    with app.app_context():
        entrance = check(summary(), "entrance")

    # The Annex door is on a one-way pathway, which still links it; the
    # Library has no entrance node at all.
    assert ids(entrance["missing"]) == [str(LIBRARY)]
    assert entrance["complete"] == 3


def test_indoor_rooms_apply_only_to_places_that_may_hold_them(app):
    with app.app_context():
        rooms = check(summary(), "rooms")

    # The Cafe is Food, so it is not asked to have rooms.
    assert rooms["total"] == 3
    assert ids(rooms["missing"]) == [str(ANNEX), str(LIBRARY)]


def test_fully_ready_needs_every_check_that_applies(app):
    with app.app_context():
        result = summary()

    # Nobody has a cover photo, so nobody is fully ready.
    assert result["readiness"]["fullyReady"] == 0
    assert check(result, "photo")["complete"] == 0
    assert ids(check(result, "pin")["missing"]) == [str(LIBRARY)]


# ==========================================
# REACH
# ==========================================

def test_reach_follows_modes_and_one_way_pathways_from_the_main_gate(app):
    with app.app_context():
        reach = summary()["reach"]

    assert reach["origin"] == "Main Gate"
    # College, Cafe and Annex have linked entrances; the Library does not.
    assert reach["total"] == 3
    modes = {row["mode"]: row for row in reach["modes"]}
    # The Annex's only pathway points away from the junction.
    assert ids(modes["Walking"]["unreachable"]) == [str(ANNEX)]
    assert modes["Walking"]["reachable"] == 2
    # Vehicle covers wheeled modes; the College walk is walking-only.
    for mode in ("Bicycle", "Motorcycle", "Car"):
        assert modes[mode]["reachable"] == 1
        assert ids(modes[mode]["unreachable"]) == sorted([str(ANNEX), str(COLLEGE)])


def test_no_unique_main_gate_means_no_reach_and_no_closures(app):
    with app.app_context():
        node(99, 16.7, 121.7, name="gate")
        db.session.commit()
        result = summary()

    assert result["reach"] is None
    assert result["closures"] == []


# ==========================================
# CLOSURES
# ==========================================

def test_closure_impact_separates_cut_off_places_from_longer_walks(app):
    with app.app_context():
        closures = {row["pathway"]: row for row in summary()["closures"]}

    # The Cafe lane is the only way to the Cafe.
    assert ids(closures["Cafe lane"]["cutOff"]) == [str(CAFE)]
    assert closures["Cafe lane"]["longerTrip"] == 0
    # Without the Gate road both are still reached round the west path,
    # through the College, only further.
    assert closures["Gate road"]["cutOff"] == []
    assert closures["Gate road"]["longerTrip"] == 2
    assert closures["College walk"]["cutOff"] == []
    assert closures["College walk"]["longerTrip"] == 1
    # The inactive shortcut never counted, so it cannot be closed.
    assert "Old shortcut" not in closures
    # Rows that change nothing are left out, and the worst comes first.
    assert list(closures) == ["Cafe lane", "Gate road", "College walk"]


# ==========================================
# SEARCHES
# ==========================================

def test_searches_split_by_account_type_and_destination_type(app):
    with app.app_context():
        db.session.add(UserInfo(id=1, created_at=NOW, user_type="Student"))
        db.session.add(AppUser(id=1, username="s1", info_id=1))
        db.session.add(UserInfo(id=2, created_at=NOW, user_type="Staff"))
        db.session.add(AppUser(id=2, username="t1", info_id=2))
        db.session.add_all([
            UserHistory(id=1, user_id=1, building_id=COLLEGE, created_at=NOW),
            UserHistory(id=2, user_id=1, building_id=COLLEGE, location_id=1, created_at=NOW),
            UserHistory(id=3, user_id=2, building_id=CAFE, created_at=NOW),
            UserHistory(id=4, user_id=None, building_id=CAFE, created_at=NOW),
            UserHistory(id=5, user_id=1, building_id=CAFE, created_at=datetime(2026, 1, 1, tzinfo=timezone.utc)),
        ])
        db.session.commit()
        searches = summary()["searches"]

    assert searches["total"] == 4
    assert searches["byAccountType"] == {"student": 2, "teacher": 1, "visitor": 0}
    assert searches["byDestinationType"] == {"Building": 3, "Room": 1, "Laboratory": 0, "Office": 0, "Restroom": 0}


# ==========================================
# ROUTE
# ==========================================

def test_the_route_rejects_an_unknown_range(app):
    response = app.test_client().get("/api/dashboard/decision-analytics?range=year")

    assert response.status_code == 400
    assert response.get_json()["errors"] == {"range": "Choose week, month or all."}


def test_the_route_returns_the_summary(app):
    response = app.test_client().get("/api/dashboard/decision-analytics?range=month")

    assert response.status_code == 200
    body = response.get_json()
    assert body["success"] is True
    assert body["data"]["range"] == "month"
    assert set(body["data"]) == {"range", "readiness", "closures", "reach", "searches"}
