import logging

from flask import Blueprint, Response, jsonify, request

from auth import admin_required
from extensions import db
from model.building import Building
from model.building_history import BuildingHistory
from model.floor import Floor
from model.location import LOCATION_TYPE_IDS, LOCATION_TYPE_NAMES, Location
from services.audit import log_audit
from services.floor_lookup import floor_label as _floor_label
from services.floor_lookup import floor_number_from_label as _floor_number_from_label
from services.floor_lookup import resolve_floor as _resolve_floor
from services.location_listing import list_location_page

actions_bp = Blueprint(
    "actions",
    __name__,
    url_prefix="/api/actions"
)

TYPE_IDS = LOCATION_TYPE_IDS
INDOOR_TYPES = {"Room", "Office", "Laboratory", "Restroom"}
CREATABLE_TYPES = set(TYPE_IDS) | {"Building", "Facility"}
PHOTO_MAX_BYTES = 5 * 1024 * 1024
PHOTO_MIME_TYPES = {"image/png", "image/jpeg", "image/webp"}
logger = logging.getLogger(__name__)


def _all_locations():
    try:
        return Location.query.order_by(Location.location_id.asc()).all()
    except Exception:
        logger.exception("Failed to load locations")
        raise


def _all_buildings():
    try:
        return Building.query.order_by(Building.building_id.asc()).all()
    except Exception:
        logger.exception("Failed to load buildings")
        raise


def _all_floors():
    try:
        return Floor.query.order_by(Floor.floor_id.asc()).all()
    except Exception:
        logger.exception("Failed to load floors")
        raise


def _location_floor(record, floors):
    if record.floor_id is None:
        return None
    floor = next((item for item in floors if item.floor_id == record.floor_id), None)
    if floor is None or floor.building_id != record.building_id:
        raise ValueError(f"Location {record.location_id} references an invalid Floor relationship.")
    return floor


def _location_dto(record, buildings, floors):
    if record.type_id not in LOCATION_TYPE_NAMES:
        raise ValueError(
            f"Location {record.location_id} references an unknown location type."
        )
    by_id = {item.building_id: item for item in buildings}
    building = by_id.get(record.building_id)
    floor = _location_floor(record, floors)
    return record.to_location_dto(building=building.building_name if building else None, floor=_floor_label(floor) if floor else None)


def _request_payload():
    return (request.get_json(silent=True) or {}) if request.is_json else request.form.to_dict()


def _photo_upload():
    """Read and validate an optional multipart photo before touching a row."""
    upload = request.files.get("photo")
    if upload is None or not upload.filename:
        return None, None, None
    if upload.mimetype not in PHOTO_MIME_TYPES:
        return None, None, _validation_error({"photo": "Choose a PNG, JPEG, or WebP image."})
    content = upload.read(PHOTO_MAX_BYTES + 1)
    if len(content) > PHOTO_MAX_BYTES:
        return None, None, _validation_error({"photo": "Photo must be 5 MB or smaller."})
    return content, upload.mimetype, None


# Magic numbers for the three formats the uploader accepts.
PHOTO_MAGIC_NUMBERS = (
    (bytes.fromhex("89504e470d0a1a0a"), "image/png"),
    (bytes.fromhex("ffd8ff"), "image/jpeg"),
)


def _sniff_photo_mime_type(content):
    """Recover a Content-Type for rows written before photo_mime_type existed.

    Only the formats the uploader accepts are probed; anything else falls back
    to a generic binary type rather than guessing wrongly.
    """
    for signature, mime_type in PHOTO_MAGIC_NUMBERS:
        if content.startswith(signature):
            return mime_type
    if content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    return "application/octet-stream"


def _photo_response(content, mime_type):
    resolved = mime_type if mime_type in PHOTO_MIME_TYPES else _sniff_photo_mime_type(content)
    response = Response(content, mimetype=resolved)
    response.headers["Content-Length"] = str(len(content))
    # Photos are replaced in place on the same id, so revalidate every time
    # rather than letting a stale image stick in the browser cache.
    response.headers["Cache-Control"] = "no-cache, private"
    return response


def _validation_error(fields=None, relationships=None):
    return jsonify({"success": False, "message": "Location validation failed.", "fields": fields or {}, "relationships": relationships or {}}), 400


def _validate(data, records, buildings):
    fields, relationships = {}, {}
    name, code = str(data.get("name", "")).strip(), str(data.get("code", "")).strip()
    location_type, parent_id = data.get("type"), data.get("parentId")
    floor_level = str(data.get("floor", "") or "").strip()
    floor_number = _floor_number_from_label(floor_level)
    if not name: fields["name"] = "Location name is required."
    if not code: fields["code"] = "Location code is required."
    if location_type not in CREATABLE_TYPES: fields["type"] = "Select a supported Location type."
    building = None
    if location_type == "Building":
        building = None
    elif location_type in INDOOR_TYPES:
        if parent_id in (None, ""):
            fields["parentId"] = "A Building is required for an Indoor Location."
        else:
            try: building = next((item for item in buildings if item.building_id == int(parent_id)), None)
            except (TypeError, ValueError): building = None
            if building is None:
                relationships["parentId"] = "The selected Building does not exist."
        if not floor_level or floor_level == "Unspecified Floor":
            fields["floor"] = "A specific Floor Level is required for a new Indoor Location."
        elif floor_number is None:
            fields["floor"] = "Select a valid Floor Level."
    elif parent_id not in (None, ""):
        fields["parentId"] = "Only Indoor Locations can belong to a Building."
    duplicate = next((item for item in records if item.location_code.lower() == code.lower()), None)
    if duplicate is None:
        duplicate = next((item for item in buildings if item.building_code.lower() == code.lower()), None)
    if duplicate:
        return None, (jsonify({"success": False, "message": "Location code already exists.", "fields": {"code": "Location code must be unique."}}), 409)
    if fields or relationships: return None, _validation_error(fields, relationships)
    return {"name": name, "code": code, "type": location_type, "type_id": TYPE_IDS.get(location_type), "building_id": building.building_id if building else None, "floor_number": floor_number, "description": data.get("function", data.get("description")), "keywords": data.get("keywords")}, None


@actions_bp.route("/locations", methods=["GET"])
def list_locations():
    _, error = admin_required()
    if error: return error
    try:
        records, buildings, floors = _all_locations(), _all_buildings(), _all_floors()
        return jsonify(
            list_location_page(
                records,
                buildings,
                floors,
                request.args,
                _location_dto,
                lambda building: building.to_location_dto(),
            )
        ), 200
    except ValueError as error:
        logger.warning("Invalid persisted location data: %s", error)
        return jsonify({"success": False, "message": str(error)}), 500
    except Exception:
        logger.exception("Failed to list locations")
        return jsonify({"success": False, "message": "Failed to list locations."}), 500

@actions_bp.route("/buildings/<int:building_id>/rooms", methods=["POST"])
def add_room_to_building(building_id):

    _, error = admin_required()
    if error: return error

    try:
        records, buildings = _all_locations(), _all_buildings()
    except Exception:
        return jsonify({"success": False, "message": "Failed to add room."}), 500

    building = next(
        (item for item in buildings if item.building_id == building_id),
        None
    )

    if building is None:
        return jsonify({
            "success": False,
            "message": "Building not found."
        }), 404

    data = _request_payload()

    data["type"] = "Room"
    data["parentId"] = building_id

    values, error = _validate(data, records, buildings)
    if error: return error

    photo, photo_mime_type, error = _photo_upload()
    if error: return error

    try:
        floor_id = (
            _resolve_floor(Floor, db.session, building_id, values["floor_number"]).floor_id
            if values["floor_number"] is not None
            else None
        )

        location = Location(
            building_id=building_id,
            floor_id=floor_id,
            type_id=values["type_id"],
            location_code=values["code"],
            location_name=values["name"],
            description=values["description"],
            keywords=values["keywords"]
        )

        if photo is not None:
            location.photo = photo
            location.photo_mime_type = photo_mime_type

        db.session.add(location)
        db.session.flush()
        log_audit("Admin", None, "create", "Location", location.location_id, location.location_name)
        db.session.commit()

        return jsonify(
            _location_dto(location, buildings, _all_floors())
        ), 201

    except Exception:
        logger.exception("Failed to add room")
        db.session.rollback()

        return jsonify({
            "success": False,
            "message": "Failed to add room."
        }), 500

@actions_bp.route("/locations/<int:location_id>", methods=["PUT"])
def edit_location(location_id):

    _, error = admin_required()
    if error: return error

    try:
        records, buildings = _all_locations(), _all_buildings()
    except Exception:
        return jsonify({"success": False, "message": "Failed to update location."}), 500

    data = _request_payload()
    requested_type = data.get("type")

    location = next(
        (item for item in records if item.location_id == location_id),
        None
    )

    building = next(
        (item for item in buildings if item.building_id == location_id),
        None
    )

    if requested_type in INDOOR_TYPES:
        building = None
    elif requested_type in {"Building", "Facility"}:
        location = None

    if location is None and building is None:
        return jsonify({
            "success": False,
            "message": "Location not found."
        }), 404

    validation_buildings = [item for item in buildings if item.building_id != location_id]
    if building is not None:
        data["parentId"] = None
    values, error = _validate(data, [item for item in records if item.location_id != location_id], validation_buildings)
    if error: return error

    photo, photo_mime_type, error = _photo_upload()
    if error: return error

    try:
        if building is not None:
            building.building_code = values["code"]
            building.building_name = values["name"]
            building.classification = values["type"]
            building.description = values["description"]

            if photo is not None:
                building.photo = photo
                building.photo_mime_type = photo_mime_type

            db.session.flush()
            log_audit("Admin", None, "update", "Building", building.building_id, building.building_name)
            db.session.commit()
            return jsonify(building.to_location_dto()), 200

        location.building_id = values["building_id"]
        location.floor_id = (
            _resolve_floor(Floor, db.session, values["building_id"], values["floor_number"]).floor_id
            if values["floor_number"] is not None
            else None
        )
        location.type_id = values["type_id"]
        location.location_code = values["code"]
        location.location_name = values["name"]
        location.description = values["description"]
        location.keywords = values["keywords"]

        if photo is not None:
            location.photo = photo
            location.photo_mime_type = photo_mime_type

        db.session.flush()
        log_audit("Admin", None, "update", "Location", location.location_id, location.location_name)
        db.session.commit()

        return jsonify(
            _location_dto(location, buildings, _all_floors())
        ), 200

    except Exception:
        logger.exception("Failed to update location")
        db.session.rollback()

        return jsonify({
            "success": False,
            "message": "Failed to update location."
        }), 500

@actions_bp.route("/locations/<int:location_id>/photo", methods=["GET"])
def view_location_photo(location_id):
    """Serve the stored image bytes for a Location, Building, or Facility.

    Buildings and Locations are separate tables with independent id sequences,
    so an explicit ``?type=`` disambiguates which one the id belongs to. With
    no hint the Location table is searched first, matching how the rest of the
    directory resolves an ambiguous id.
    """

    _, error = admin_required()
    if error: return error

    requested_type = request.args.get("type")

    try:
        record = None

        if requested_type in {"Building", "Facility"}:
            record = Building.query.filter_by(building_id=location_id).first()
        elif requested_type in INDOOR_TYPES:
            record = Location.query.filter_by(location_id=location_id).first()
        else:
            record = (
                Location.query.filter_by(location_id=location_id).first()
                or Building.query.filter_by(building_id=location_id).first()
            )

        if record is None:
            return jsonify({
                "success": False,
                "message": "Location not found."
            }), 404

        if record.photo is None:
            return jsonify({
                "success": False,
                "message": "Location has no photo."
            }), 404

        return _photo_response(record.photo, record.photo_mime_type)

    except Exception:
        logger.exception("Failed to load location photo")

        return jsonify({
            "success": False,
            "message": "Failed to load location photo."
        }), 500


@actions_bp.route("/buildings/<int:building_id>/history", methods=["GET"])
def view_building_history(building_id):
    """Return a building's audit records, newest first.

    A building with no recorded changes is a valid response and returns
    ``{"success": true, "data": []}``.  Timestamps are serialized as ISO 8601
    strings so the response is safe for JSON clients and stable across ORM
    implementations.
    """

    _, error = admin_required()
    if error: return error

    try:
        building = Building.query.filter_by(
            building_id=building_id
        ).first()

        if building is None:
            return jsonify({
                "success": False,
                "message": "Building not found."
            }), 404

        history = BuildingHistory.query.filter_by(
            building_id=building_id
        ).order_by(
            BuildingHistory.created_at.desc()
        ).all()

        return jsonify({
            "success": True,
            "data": [
                {
                    "history_id": item.history_id,
                    "building_id": item.building_id,
                    "action": item.action,
                    "field": item.field,
                    "old_value": item.old_value,
                    "new_value": item.new_value,
                    "changed_by": item.changed_by,
                    "created_at": item.created_at.isoformat()
                    if item.created_at is not None else None
                }
                for item in history
            ]
        }), 200

    except Exception:
        logger.exception("Failed to get building history")
        db.session.rollback()
        return jsonify({
            "success": False,
            "message": "Failed to get building history."
        }), 500

@actions_bp.route("/locations/<int:location_id>", methods=["DELETE"])
def delete_location(location_id):

    _, error = admin_required()
    if error: return error

    try:
        location = Location.query.filter_by(location_id=location_id).first()
        building = Building.query.filter_by(building_id=location_id).first()

        requested_type = request.args.get("type")
        if requested_type in INDOOR_TYPES:
            building = None
        elif requested_type in {"Building", "Facility"}:
            location = None
        elif location is not None and building is not None:
            return jsonify({
                "success": False,
                "message": "Location type is required when record IDs overlap."
            }), 409

        if location is None and building is None:
            return jsonify({
                "success": False,
                "message": "Location not found."
            }), 404

        db.session.delete(building or location)
        log_audit("Admin", None, "delete", "Building" if building else "Location", location_id)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Location deleted successfully."
        }), 200

    except Exception:
        logger.exception("Failed to delete location")
        db.session.rollback()

        return jsonify({
            "success": False,
            "message": "Failed to delete location."
        }), 500
