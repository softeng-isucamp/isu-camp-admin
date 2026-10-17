"""Place classifications: the vocabulary, and resolving a name to a type.

Everything outdoors on the campus map is a Place, and its classification is
what the User App filters on. ``classification`` used to say only "Building"
or "Facility", which separates nothing; ``building.type_id`` is now the
source of truth and NULL means legacy.

The route and model rules live here; the two route modules' own behaviour is
covered in tests/location.py and tests/actions.py.
"""

import pytest
from flask import Flask

import building_types as building_types_route
from building_types import building_types_bp
from model.building import (
    CAN_CONTAIN_LOCATIONS,
    LEGACY_CLASSIFICATION,
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

def test_every_classification_is_named_once_and_includes_legacy():
    assert PLACE_CLASSIFICATIONS == set(ASSIGNABLE) | {"Building"}


def test_only_colleges_campus_services_and_legacy_hold_indoor_locations():
    assert CAN_CONTAIN_LOCATIONS == {"College", "Campus Services", "Building"}
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
# LEGACY
# ==========================================

class FakePlace:
    def __init__(self, type_id=None, building_id=1):
        self.type_id = type_id
        self.building_id = building_id


def test_a_new_place_may_not_be_created_as_legacy(vocabulary):
    """type_id IS NULL is what Phase 2 exists to clear; no new ones."""

    type_id, error = place_classification.resolve_place_type(LEGACY_CLASSIFICATION)

    assert type_id is None
    assert error == UNSUPPORTED_CLASSIFICATION


def test_editing_a_legacy_place_without_reclassifying_it_still_saves(vocabulary):
    """Otherwise none of the 53 legacy rows could be edited at all."""

    type_id, error = place_classification.resolve_place_type(
        LEGACY_CLASSIFICATION, current=FakePlace(type_id=None)
    )

    assert error is None
    assert type_id is None


def test_a_classified_place_cannot_be_sent_back_to_legacy(vocabulary):
    _, error = place_classification.resolve_place_type(
        LEGACY_CLASSIFICATION, current=FakePlace(type_id=1)
    )

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


def test_a_legacy_place_that_is_not_reclassified_is_not_refused(vocabulary):
    assert place_classification.reclassification_error(
        FakePlace(type_id=None), None, has_indoor_locations=True
    ) is None


# ==========================================
# THE DTO
# ==========================================

def _place(type_row):
    building = Building(
        building_id=1, building_code="B-1", building_name="CAS Canteen",
        classification="Food", status="active",
    )
    building.building_type = type_row
    return building


def test_a_classified_place_reports_its_classification_name():
    assert _place(VOCABULARY["Food"]).to_location_dto()["type"] == "Food"


def test_a_legacy_place_reports_building():
    """type_id IS NULL is the only legitimate source of "Building"."""

    assert _place(None).to_location_dto()["type"] == LEGACY_CLASSIFICATION


def test_the_dto_never_carries_a_type_id():
    dto = _place(VOCABULARY["College"]).to_location_dto()

    assert "type_id" not in dto and "buildingType" not in dto


@pytest.mark.parametrize("name, expected", (
    ("College", True), ("Campus Services", True),
    ("Food", False), ("Parking", False), ("Facility", False),
))
def test_whether_a_place_may_hold_locations_comes_from_its_type(name, expected):
    assert _place(VOCABULARY[name]).can_contain_locations is expected


def test_a_legacy_place_may_still_hold_locations_until_phase_three():
    assert _place(None).can_contain_locations is True
