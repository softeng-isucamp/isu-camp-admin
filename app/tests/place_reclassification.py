"""Reclassifying a Place through the real update route, on a real ORM session.

The fake-session tests in actions.py cannot see ORM state: Building.building_type
is a joined-loaded relationship, and a flush after changing type_id does not
refresh it. Only a real session notices the response describing the old type.
"""
from flask import Flask
import pytest

import actions as actions_module
from actions import actions_bp
from extensions import db
from model.building import Building
from model.building_photo import BuildingPhoto
from model.building_type import BuildingType
from model.floor import Floor
from model.location import Location

COLLEGE_ID = 1
FACILITY_ID = 2


@pytest.fixture
def app(monkeypatch):
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite://"
    # The models live in the "public" schema; SQLite has none.
    app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {
        "execution_options": {"schema_translate_map": {"public": None}}
    }
    db.init_app(app)
    app.register_blueprint(actions_bp)
    monkeypatch.setattr(actions_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(actions_module, "log_audit", lambda *args: None)
    monkeypatch.setattr(actions_module, "_photo_change", lambda: (None, False, None))
    monkeypatch.setattr(actions_module, "apply_gallery", lambda *args: None)

    with app.app_context():
        db.metadata.create_all(
            db.engine,
            tables=[
                BuildingType.__table__, Building.__table__, BuildingPhoto.__table__,
                Floor.__table__, Location.__table__,
            ],
        )
        db.session.add(BuildingType(
            type_id=COLLEGE_ID, type_name="College", can_contain_locations=True,
        ))
        db.session.add(BuildingType(
            type_id=FACILITY_ID, type_name="Facility", can_contain_locations=False,
        ))
        db.session.add(Building(
            building_id=7, building_code="OLD", building_name="Old Hall",
            type_id=FACILITY_ID, status=1,
        ))
        db.session.commit()
        # The route loads the row fresh, with its old building_type joined in.
        db.session.expunge_all()
        yield app
        db.session.remove()


def test_reclassifying_a_place_reports_the_new_classification(app):
    response = app.test_client().put("/api/actions/locations/7", json={
        "name": "Old Hall", "code": "OLD", "type": "College",
    })

    assert response.status_code == 200
    assert response.json["type"] == "College"
    with app.app_context():
        db.session.expire_all()
        assert db.session.get(Building, 7).type_id == COLLEGE_ID
