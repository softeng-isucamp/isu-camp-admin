"""Place classifications: the vocabulary, and resolving a name to a type.

Everything outdoors on the campus map is a Place, and its classification is
what the User App filters on. ``classification`` used to say only "Building"
or "Facility", which separates nothing; ``building.type_id`` is the source of
truth, and NOT NULL since Phase 3 retired the legacy "Building" value.

The route and model rules live here; the two route modules' own behaviour is
covered in tests/location.py and tests/actions.py.
"""

import pytest
from flask import Flask

import building_types as building_types_route
from building_types import building_types_bp
from model.building import (
    CAN_CONTAIN_LOCATIONS,
    PLACE_CLASSIFICATIONS,
    UNSUPPORTED_CLASSIFICATION,
    Building,
)
from model.building_type import BuildingType
from services import place_classification


ASSIGNABLE = ("College", "Campus Services", "Food", "Parking", "Facility")
HOLDS_LOCATIONS = {"College", "Campus Services"}


class FakeType:
    def __init__(self, type_id, type_name, can_contain_locations=False, description=None):
        self.type_id = type_id
        self.type_name = type_name
        self.can_contain_locations = can_contain_locations
        self.description = description

    to_dict = BuildingType.to_dict


VOCABULARY = {
    name: FakeType(index, name, name in HOLDS_LOCATIONS, f"{name} description")
    for index, name in enumerate(ASSIGNABLE, start=1)
}


@pytest.fixture
def app():
    app = Flask(__name__)
    app.config.update(TESTING=True, SECRET_KEY="test-secret")
    app.register_blueprint(building_types_bp)
    return app


@pytest.fixture
def vocabulary(monkeypatch):
    """The seeded types, without a database."""

    monkeypatch.setattr(place_classification, "find_type", VOCABULARY.get)
    monkeypatch.setattr(
        place_classification, "find_type_by_id",
        lambda type_id: next(
            (row for row in VOCABULARY.values() if row.type_id == type_id), None
        ),
    )
    return VOCABULARY


# ==========================================
# THE CONSTANTS
# ==========================================

def test_every_classification_is_named_once_and_legacy_is_gone():
    assert PLACE_CLASSIFICATIONS == set(ASSIGNABLE)
    assert "Building" not in PLACE_CLASSIFICATIONS


def test_only_colleges_and_campus_services_hold_indoor_locations():
    assert CAN_CONTAIN_LOCATIONS == {"College", "Campus Services"}
    for standalone in ("Food", "Parking", "Facility"):
        assert standalone not in CAN_CONTAIN_LOCATIONS


def test_campus_services_keeps_its_space():
    """The User App filters on the exact string."""

    assert "Campus Services" in PLACE_CLASSIFICATIONS
    assert "CampusServices" not in PLACE_CLASSIFICATIONS


# ==========================================
# THE ROUTE
# ==========================================

def test_the_vocabulary_is_served_with_what_each_type_may_hold(app, monkeypatch):
    monkeypatch.setattr(building_types_route, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(building_types_route, "all_types", lambda: list(VOCABULARY.values()))

    body = app.test_client().get("/api/building-types").get_json()

    assert [item["name"] for item in body["items"]] == list(ASSIGNABLE)
    held = {item["name"]: item["canContainLocations"] for item in body["items"]}
    assert held == {"College": True, "Campus Services": True,
                    "Food": False, "Parking": False, "Facility": False}


def test_the_vocabulary_never_exposes_a_type_id(app, monkeypatch):
    """Clients filter on names; an id would force each to keep a map of them."""

    monkeypatch.setattr(building_types_route, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(building_types_route, "all_types", lambda: list(VOCABULARY.values()))

    body = app.test_client().get("/api/building-types").get_json()

    for item in body["items"]:
        assert "id" not in item and "type_id" not in item


def test_the_vocabulary_is_not_public(app, monkeypatch):
    monkeypatch.setattr(
        building_types_route, "admin_required",
        lambda: (None, ({"success": False, "message": "Authentication required"}, 401)),
    )

    assert app.test_client().get("/api/building-types").status_code == 401


# ==========================================
# RESOLVING A NAME TO A TYPE
# ==========================================

@pytest.mark.parametrize("name", ASSIGNABLE)
def test_every_assignable_classification_resolves(vocabulary, name):
    type_id, error = place_classification.resolve_place_type(name)

    assert error is None
    assert type_id == vocabulary[name].type_id


def test_surrounding_space_is_tolerated(vocabulary):
    assert place_classification.resolve_place_type("  College  ")[0] == vocabulary["College"].type_id


def test_the_wrong_case_is_refused_rather_than_guessed(vocabulary):
    """Two spellings of one classification must not both reach the directory."""

    _, error = place_classification.resolve_place_type("campus services")

    assert error == UNSUPPORTED_CLASSIFICATION


def test_an_unknown_classification_is_refused(vocabulary):
    _, error = place_classification.resolve_place_type("Gymnasium")

    assert error == UNSUPPORTED_CLASSIFICATION


# ==========================================
# THE RETIRED LEGACY VALUE
# ==========================================

class FakePlace:
    def __init__(self, type_id=1, building_id=1):
        self.type_id = type_id
        self.building_id = building_id


def test_building_is_refused_like_any_other_unknown_name(vocabulary):
    """Phase 3 left no row that may carry it, new or existing."""

    type_id, error = place_classification.resolve_place_type("Building")

    assert type_id is None
    assert error == UNSUPPORTED_CLASSIFICATION


# ==========================================
# RECLASSIFICATION GUARD
# ==========================================

def test_a_place_holding_locations_cannot_become_one_that_may_not(vocabulary):
    error = place_classification.reclassification_error(
        FakePlace(type_id=1), vocabulary["Parking"].type_id, has_indoor_locations=True
    )

    assert error is not None
    assert "Move or remove" in error


def test_the_same_place_may_become_a_college(vocabulary):
    assert place_classification.reclassification_error(
        FakePlace(type_id=3), vocabulary["College"].type_id, has_indoor_locations=True
    ) is None


def test_an_empty_place_may_become_anything(vocabulary):
    assert place_classification.reclassification_error(
        FakePlace(type_id=1), vocabulary["Parking"].type_id, has_indoor_locations=False
    ) is None


# ==========================================
# THE DTO
# ==========================================

def _place(type_row):
    building = Building(
        building_id=1, building_code="B-1", building_name="CAS Canteen",
        type_id=type_row.type_id, status="active",
    )
    building.building_type = type_row
    return building


def test_a_classified_place_reports_its_classification_name():
    assert _place(VOCABULARY["Food"]).to_location_dto()["type"] == "Food"


def test_the_model_no_longer_maps_the_dropped_classification_column():
    """20261022_drop_place_classification.sql removed it from the table."""

    assert "classification" not in Building.__table__.c
    assert Building.__table__.c.type_id.nullable is False


def test_the_dto_never_carries_a_type_id():
    dto = _place(VOCABULARY["College"]).to_location_dto()

    assert "type_id" not in dto and "buildingType" not in dto


@pytest.mark.parametrize("name, expected", (
    ("College", True), ("Campus Services", True),
    ("Food", False), ("Parking", False), ("Facility", False),
))
def test_whether_a_place_may_hold_locations_comes_from_its_type(name, expected):
    assert _place(VOCABULARY[name]).can_contain_locations is expected
