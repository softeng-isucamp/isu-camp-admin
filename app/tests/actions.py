from flask import Flask
import pytest

import actions as actions_module
from actions import actions_bp
from services.location_photos import GalleryChange
import location as location_module
from location import location_bp


@pytest.fixture(autouse=True)
def confirmed_password(monkeypatch):
    """Deletes require a confirmed password; that guard has its own coverage below."""
    monkeypatch.setattr(actions_module, "reauth_required", lambda: (object(), None), raising=False)


class ListRecord:
    def __init__(self, identifier, name, code, building_id=None):
        self.location_id = identifier
        self.location_name = name
        self.location_code = code
        self.type_id = 1
        self.building_id = building_id
        self.floor_id = None
        self.floor_level = "Ground Floor"
        self.description = name
        self.keywords = "keyword"
        self.lat = self.lng = None

    def to_location_dto(self, building=None, floor=None):
        return {
            "id": str(self.location_id), "name": self.location_name,
            "code": self.location_code, "type": "Room",
            "parentId": str(self.building_id) if self.building_id else None,
            "building": building, "floor": self.floor_level or floor,
            "function": self.description, "keywords": self.keywords,
            "status": "Active", "lat": None, "lng": None,
            "positioned": False, "hasPhoto": False,
        }


class ListBuilding:
    def __init__(self, identifier, name):
        self.building_id = identifier
        self.building_name = name
        self.building_code = f"B-{identifier}"

    def to_location_dto(self):
        return {
            "id": str(self.building_id), "name": self.building_name,
            "code": self.building_code, "type": "Building", "parentId": None,
            "building": None, "floor": None, "function": None,
            "keywords": None, "status": "Active", "lat": None, "lng": None,
            "positioned": False, "hasPhoto": False,
        }


class ListQuery:
    def __init__(self, values):
        self.values = values

    def order_by(self, *_columns):
        return self

    def all(self):
        return self.values


def _list_app(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(actions_bp)
    buildings = [ListBuilding(2, "Building B"), ListBuilding(1, "Building A")]
    records = [ListRecord(12, "Room B", "B-ROOM", 2), ListRecord(11, "Room A", "A-ROOM", 1)]
    monkeypatch.setattr(actions_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(location_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(actions_module, "Location", type("LocationModel", (), {
        "query": ListQuery(records), "location_id": FakeColumn(),
    }))
    monkeypatch.setattr(actions_module, "Building", type("BuildingModel", (), {
        "query": ListQuery(buildings), "building_id": FakeColumn(),
    }))
    monkeypatch.setattr(actions_module, "Floor", type("FloorModel", (), {
        "query": ListQuery([]), "floor_id": FakeColumn(),
    }))
    monkeypatch.setattr(location_module, "Location", actions_module.Location)
    monkeypatch.setattr(location_module, "Building", actions_module.Building)
    monkeypatch.setattr(location_module, "Floor", actions_module.Floor)
    return app
from model.location import LOCATION_TYPE_IDS, LOCATION_TYPE_NAMES


class FakeQuery:
    def __init__(self, record):
        self.record = record

    def filter_by(self, **kwargs):
        return self

    def first(self):
        return self.record

    def order_by(self, *_columns):
        return self

    def all(self):
        return self.record

    def delete(self):
        return 0


class FakeColumn:
    def asc(self):
        return self

    def desc(self):
        return self


class FakeSession:
    def __init__(self):
        self.deleted = None
        self.commits = 0
        self.rollbacks = 0

    def delete(self, record):
        self.deleted = record

    def flush(self):
        pass

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def test_actions_blueprint_exposes_registered_action_routes(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(actions_bp)
    monkeypatch.setattr(actions_module, "admin_required", lambda: (object(), None))

    paths = {rule.rule for rule in app.url_map.iter_rules()}

    assert "/api/actions/locations" in paths
    assert "/api/actions/locations/<int:location_id>" in paths
    assert "/api/actions/buildings/<int:building_id>/rooms" in paths
    # Building history comes from public.audit_log via
    # GET /api/locations/<id>/history. The route that read the dropped
    # public.building_history is gone and should not come back.
    assert "/api/actions/buildings/<int:building_id>/history" not in paths


def test_actions_blueprint_requires_authentication(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(actions_bp)
    monkeypatch.setattr(
        actions_module,
        "admin_required",
        lambda: (None, ({"error": "Authentication required"}, 401)),
    )

    response = app.test_client().get("/api/actions/locations")

    assert response.status_code == 401


def test_actions_locations_share_deterministic_family_pagination_contract(monkeypatch):
    client = _list_app(monkeypatch).test_client()

    first = client.get("/api/actions/locations?page=1&pageSize=2")
    second = client.get("/api/actions/locations?page=2&pageSize=2")
    filtered = client.get("/api/actions/locations?type=Room&buildingId=1&pageSize=1")

    assert first.json["success"] is True
    assert first.json["total"] == 4
    assert first.json["page"] == 1
    assert first.json["pageSize"] == 2
    assert [item["id"] for item in first.json["items"]] == ["1", "11"]
    assert [item["id"] for item in second.json["items"]] == ["2", "12"]
    assert filtered.json["total"] == 1
    assert [item["id"] for item in filtered.json["items"]] == ["11"]


def test_locations_endpoints_have_identical_list_results(monkeypatch):
    app = _list_app(monkeypatch)
    app.register_blueprint(location_bp)
    params = "?q=room&buildingId=1&page=1&pageSize=1"

    actions_response = app.test_client().get("/api/actions/locations" + params)
    locations_response = app.test_client().get("/api/locations" + params)

    assert actions_response.status_code == locations_response.status_code == 200
    assert actions_response.json == locations_response.json


def test_actions_location_contract_accepts_restroom_with_canonical_type_id():
    assert actions_module.CREATABLE_TYPES == {
        "Room", "Laboratory", "Office", "Restroom", "Building", "Facility"
    }
    assert actions_module.TYPE_IDS == LOCATION_TYPE_IDS
    assert LOCATION_TYPE_NAMES[LOCATION_TYPE_IDS["Restroom"]] == "Restroom"


def test_actions_delete_requires_a_confirmed_password(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(actions_bp)
    monkeypatch.setattr(actions_module, "reauth_required", lambda: (None, (
        {"success": False, "code": "password_confirmation_required", "message": "Confirm your password to delete this record."},
        403,
    )))

    response = app.test_client().delete("/api/actions/locations/42")

    assert response.status_code == 403
    assert response.json["code"] == "password_confirmation_required"


def test_actions_can_delete_a_building(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(actions_bp)
    session = FakeSession()
    building = type("Building", (), {"building_id": 42})()
    monkeypatch.setattr(actions_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(actions_module, "Location", type("Location", (), {"query": FakeQuery(None)}))
    monkeypatch.setattr(actions_module, "Building", type("BuildingModel", (), {"query": FakeQuery(building)}))
    monkeypatch.setattr(actions_module, "LocationPhoto", type("LocationPhotoModel", (), {"query": FakeQuery(None)}))
    monkeypatch.setattr(actions_module, "BuildingPhoto", type("BuildingPhotoModel", (), {"query": FakeQuery(None)}))
    # The audit helper uses the same db singleton as the route.
    monkeypatch.setattr(actions_module.db, "session", session)

    response = app.test_client().delete("/api/actions/locations/42")

    assert response.status_code == 200
    assert session.deleted is building


def test_actions_delete_uses_type_when_location_and_building_ids_overlap(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(actions_bp)
    session = FakeSession()
    location = type("Location", (), {"location_id": 42})()
    building = type("Building", (), {"building_id": 42})()
    monkeypatch.setattr(actions_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(actions_module, "Location", type("LocationModel", (), {"query": FakeQuery(location)}))
    monkeypatch.setattr(actions_module, "Building", type("BuildingModel", (), {"query": FakeQuery(building)}))
    monkeypatch.setattr(actions_module, "LocationPhoto", type("LocationPhotoModel", (), {"query": FakeQuery(None)}))
    monkeypatch.setattr(actions_module, "BuildingPhoto", type("BuildingPhotoModel", (), {"query": FakeQuery(None)}))
    # The audit helper uses the same db singleton as the route.
    monkeypatch.setattr(actions_module.db, "session", session)

    response = app.test_client().delete("/api/actions/locations/42?type=Room")

    assert response.status_code == 200
    assert session.deleted is location


def test_actions_can_edit_a_building(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(actions_bp)
    building = type("Building", (), {
        "building_id": 42,
        "building_code": "OLD",
        "building_name": "Old Hall",
        "classification": "Building",
        "description": "Old description",
        "to_location_dto": lambda self: {"id": "42", "name": self.building_name, "code": self.building_code, "type": self.classification},
    })()
    monkeypatch.setattr(actions_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(actions_module, "_edit_target", lambda location_id, requested_type: (None, building))
    monkeypatch.setattr(actions_module, "_validation_index", lambda: ([], [building]))
    monkeypatch.setattr(actions_module, "_photo_change", lambda: (None, False, None))
    monkeypatch.setattr(actions_module, "log_audit", lambda *args: None)
    monkeypatch.setattr(actions_module.db, "session", FakeSession())

    response = app.test_client().put("/api/actions/locations/42", json={"name": "New Hall", "code": "NEW", "type": "Facility"})

    assert response.status_code == 200
    assert building.building_name == "New Hall"
    assert building.building_code == "NEW"
    assert building.classification == "Facility"
    assert response.json["type"] == "Facility"


def test_actions_edit_updates_building_search_keywords(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(actions_bp)
    building = type("Building", (), {
        "building_id": 42,
        "building_code": "ENG",
        "building_name": "Engineering Hall",
        "classification": "Building",
        "description": "Old description",
        "keywords": "old, tags",
        "to_location_dto": lambda self: {"id": "42", "name": self.building_name, "keywords": self.keywords},
    })()
    monkeypatch.setattr(actions_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(actions_module, "_edit_target", lambda location_id, requested_type: (None, building))
    monkeypatch.setattr(actions_module, "_validation_index", lambda: ([], [building]))
    monkeypatch.setattr(actions_module, "_photo_change", lambda: (None, False, None))
    monkeypatch.setattr(actions_module, "log_audit", lambda *args: None)
    monkeypatch.setattr(actions_module.db, "session", FakeSession())

    response = app.test_client().put(
        "/api/actions/locations/42",
        json={"name": "Engineering Hall", "code": "ENG", "type": "Building", "keywords": "engineering, labs"},
    )

    assert response.status_code == 200
    assert building.keywords == "engineering, labs"
    assert response.json["keywords"] == "engineering, labs"


def test_actions_edit_updates_building_lifecycle_status(monkeypatch):
    """The STATUS choice now reaches public.building.status on an edit.

    An edit that leaves the field out keeps whatever the row already had,
    rather than reviving a building the admin has retired.
    """

    app = Flask(__name__)
    app.register_blueprint(actions_bp)
    building = type("Building", (), {
        "building_id": 42,
        "building_code": "OLD",
        "building_name": "Old Hall",
        "classification": "Building",
        "description": "Old description",
        "keywords": None,
        "status": "active",
        "to_location_dto": lambda self: {"id": "42", "name": self.building_name, "status": "Inactive" if self.status == "inactive" else "Active"},
    })()
    monkeypatch.setattr(actions_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(actions_module, "_edit_target", lambda location_id, requested_type: (None, building))
    monkeypatch.setattr(actions_module, "_validation_index", lambda: ([], [building]))
    monkeypatch.setattr(actions_module, "_photo_change", lambda: (None, False, None))
    monkeypatch.setattr(actions_module, "log_audit", lambda *args: None)
    monkeypatch.setattr(actions_module.db, "session", FakeSession())
    client = app.test_client()

    retired = client.put(
        "/api/actions/locations/42",
        json={"name": "Old Hall", "code": "OLD", "type": "Building", "status": "Inactive"},
    )

    assert retired.status_code == 200
    assert building.status == "inactive"
    assert retired.json["status"] == "Inactive"

    untouched = client.put(
        "/api/actions/locations/42",
        json={"name": "Old Hall", "code": "OLD", "type": "Building"},
    )

    assert untouched.status_code == 200
    assert building.status == "inactive"


# ==================================================
# PHOTO UPLOAD AND RETRIEVAL
# ==================================================

PNG_BYTES = bytes.fromhex("89504e470d0a1a0a") + b"body"
JPEG_BYTES = bytes.fromhex("ffd8ff") + b"body"


def _photo_app(monkeypatch, location=None, building=None, covers=None):
    """A client whose owners resolve to the covers given in ``covers``."""
    app = Flask(__name__)
    app.register_blueprint(actions_bp)
    monkeypatch.setattr(actions_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(actions_module, "Location", type("LocationModel", (), {"query": FakeQuery(location)}))
    monkeypatch.setattr(actions_module, "Building", type("BuildingModel", (), {"query": FakeQuery(building)}))
    lookup = {id(record): cover for record, cover in (covers or {}).items()}
    monkeypatch.setattr(actions_module, "find_cover", lambda record: lookup.get(id(record)))
    return app.test_client()


def _owner():
    """An owner record: the image lives in its gallery, not on the row."""
    return type("Record", (), {})()


def _cover(content, mime_type):
    return type("Cover", (), {"content": content, "mime_type": mime_type})()


def _edit_building_app(monkeypatch, has_photo, photo_change, applied):
    app = Flask(__name__)
    app.register_blueprint(actions_bp)
    building = type("Building", (), {
        "building_id": 42,
        "building_code": "ENG",
        "building_name": "Engineering Hall",
        "classification": "Building",
        "description": "A building",
        "to_location_dto": lambda self: {"id": "42", "hasPhoto": has_photo},
    })()
    monkeypatch.setattr(actions_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(actions_module, "_edit_target", lambda location_id, requested_type: (None, building))
    monkeypatch.setattr(actions_module, "_validation_index", lambda: ([], [building]))
    monkeypatch.setattr(actions_module, "_photo_change", lambda: photo_change)
    monkeypatch.setattr(
        actions_module,
        "apply_gallery",
        lambda record, change, cover_last_upload=False: applied.append((record, change, cover_last_upload)),
    )
    monkeypatch.setattr(actions_module, "log_audit", lambda *args: None)
    monkeypatch.setattr(actions_module.db, "session", FakeSession())
    return app.test_client(), building


def test_actions_can_attach_a_photo_when_editing_a_building(monkeypatch):
    """The single ``photo`` field lands in the gallery as a cover upload."""
    change = GalleryChange([("cover.png", "image/png", PNG_BYTES)], [], None)
    applied = []
    client, building = _edit_building_app(monkeypatch, True, (change, True, None), applied)

    response = client.put("/api/actions/locations/42", json={"name": "Engineering Hall", "code": "ENG", "type": "Building"})

    assert response.status_code == 200
    assert applied == [(building, change, True)]
    assert response.json["hasPhoto"] is True


def test_editing_a_building_without_an_upload_leaves_the_gallery_alone(monkeypatch):
    applied = []
    client, building = _edit_building_app(monkeypatch, True, (None, False, None), applied)

    response = client.put("/api/actions/locations/42", json={"name": "Renamed Hall", "code": "ENG", "type": "Building"})

    assert response.status_code == 200
    assert building.building_name == "Renamed Hall"
    # Nothing to apply, so the existing cover is left where it is.
    assert applied == [(building, None, False)]
    assert response.json["hasPhoto"] is True


def test_location_photo_is_served_with_its_stored_content_type(monkeypatch):
    record = _owner()
    client = _photo_app(monkeypatch, location=record, covers={record: _cover(PNG_BYTES, "image/png")})

    response = client.get("/api/actions/locations/42/photo")

    assert response.status_code == 200
    assert response.mimetype == "image/png"
    assert response.data == PNG_BYTES


def test_building_photo_is_served_when_the_type_hint_names_a_footprint(monkeypatch):
    indoor, footprint = _owner(), _owner()
    client = _photo_app(
        monkeypatch,
        location=indoor,
        building=footprint,
        covers={indoor: _cover(JPEG_BYTES, "image/jpeg"), footprint: _cover(PNG_BYTES, "image/png")},
    )

    response = client.get("/api/actions/locations/42/photo?type=Building")

    assert response.status_code == 200
    assert response.data == PNG_BYTES


def test_photo_content_type_is_sniffed_when_the_stored_type_is_missing(monkeypatch):
    record = _owner()
    client = _photo_app(monkeypatch, location=record, covers={record: _cover(JPEG_BYTES, None)})

    response = client.get("/api/actions/locations/42/photo")

    assert response.status_code == 200
    assert response.mimetype == "image/jpeg"


def test_photo_request_for_a_row_without_an_image_is_not_found(monkeypatch):
    """An owner whose gallery is empty has no cover to serve."""
    client = _photo_app(monkeypatch, location=_owner(), covers={})

    response = client.get("/api/actions/locations/42/photo")

    assert response.status_code == 404
    assert response.json["success"] is False


def test_photo_request_for_an_unknown_id_is_not_found(monkeypatch):
    client = _photo_app(monkeypatch)

    response = client.get("/api/actions/locations/42/photo")

    assert response.status_code == 404
