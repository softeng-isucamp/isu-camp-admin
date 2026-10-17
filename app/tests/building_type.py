"""Buildings carry a type from public.building_type, beside classification.

classification only ever said "Building" or "Facility", which does not
separate a canteen from a car park from a college. These pin the new
vocabulary, and - just as importantly - that adding it changed nothing about
the field the rest of the portal still reads.
"""

import pytest
from flask import Flask

import building_types as building_types_route
from building_types import building_types_bp
from model.building import Building
from model.building_type import BuildingType, type_id_for


SEEDED = ("College", "Campus Services", "Food", "Parking", "Facility")


class FakeType:
    def __init__(self, type_id, type_name, description=None):
        self.type_id = type_id
        self.type_name = type_name
        self.description = description

    to_dict = BuildingType.to_dict


@pytest.fixture
def app():
    app = Flask(__name__)
    app.config.update(TESTING=True, SECRET_KEY="test-secret")
    app.register_blueprint(building_types_bp)
    return app


# ==========================================
# THE VOCABULARY
# ==========================================

def test_the_route_lists_every_type_for_the_form(app, monkeypatch):
    monkeypatch.setattr(building_types_route, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(
        building_types_route, "all_types",
        lambda: [FakeType(index, name) for index, name in enumerate(SEEDED, start=1)],
    )

    response = app.test_client().get("/api/building-types")

    assert response.status_code == 200
    assert [item["name"] for item in response.get_json()["items"]] == list(SEEDED)


def test_the_vocabulary_is_not_public(app, monkeypatch):
    """It describes the directory, so it is behind the same gate as the rest."""

    monkeypatch.setattr(
        building_types_route, "admin_required",
        lambda: (None, ({"success": False, "message": "Authentication required"}, 401)),
    )

    assert app.test_client().get("/api/building-types").status_code == 401


# ==========================================
# RESOLVING A NAME
# ==========================================

class FakeTypeModel:
    """Stands in for the mapped class.

    Patched into the module's namespace rather than onto BuildingType.query:
    reading that attribute is what needs an application context, so even
    saving it to restore later would fail outside one.
    """

    type_name = "type_name"

    def __init__(self, rows):
        self.rows = rows
        self.looked_up = []

    def filter(self, _criterion):
        return self

    def first(self):
        return self.rows.pop(0) if self.rows else None

    @property
    def query(self):
        return self


@pytest.mark.parametrize("sent", ("Campus Services", "campus services", "  Campus   Services "))
def test_a_type_name_resolves_however_it_is_spaced_or_cased(monkeypatch, sent):
    import model.building_type as module

    model_double = FakeTypeModel([FakeType(2, "Campus Services")])
    monkeypatch.setattr(module, "BuildingType", model_double)

    assert type_id_for(sent) == 2


def test_an_unknown_type_is_no_type_rather_than_an_error(monkeypatch):
    """A name the directory does not hold leaves the Building untyped; the
    save is not failed over it while the form is still being filled in."""

    import model.building_type as module
    monkeypatch.setattr(module, "BuildingType", FakeTypeModel([]))

    assert type_id_for("Gymnasium") is None


@pytest.mark.parametrize("sent", ("", None, "   "))
def test_an_empty_type_never_reaches_the_database(monkeypatch, sent):
    import model.building_type as module

    class Explode:
        type_name = "type_name"

        @property
        def query(self):
            raise AssertionError("an empty name must not be looked up")

    monkeypatch.setattr(module, "BuildingType", Explode())

    assert type_id_for(sent) is None


# ==========================================
# THE DTO
# ==========================================

def test_a_building_without_a_type_reports_none_and_keeps_its_classification():
    """Every row starts untyped: 'Building' carried nothing worth migrating."""

    building = Building(
        building_id=1, building_code="B-1", building_name="Main Library",
        classification="Building", status="active",
    )
    building.building_type = None

    dto = building.to_location_dto()

    assert dto["buildingType"] is None
    assert dto["type"] == "Building", "the field the rest of the portal reads is untouched"


def test_a_typed_building_reports_both():
    building = Building(
        building_id=2, building_code="B-2", building_name="CAS Canteen",
        classification="Building", status="active",
    )
    building.building_type = FakeType(3, "Food")

    dto = building.to_location_dto()

    assert dto["buildingType"] == "Food"
    assert dto["type"] == "Building"
