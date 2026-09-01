import logging

from flask import Blueprint, jsonify, request

from auth import admin_required
from extensions import db
from model.floor import Floor
from model.location import LOCATION_TYPE_IDS, LOCATION_TYPE_NAMES, Location

location_bp = Blueprint("location", __name__, url_prefix="/api/locations")

TYPE_IDS = LOCATION_TYPE_IDS
INDOOR_TYPES = {"Room", "Office", "Laboratory", "Restroom"}
CREATABLE_TYPES = set(TYPE_IDS) - {"Floor"}
PHOTO_MAX_BYTES = 5 * 1024 * 1024
PHOTO_MIME_TYPES = {"image/png", "image/jpeg", "image/webp"}
logger = logging.getLogger(__name__)


def _all_locations():
    try:
        return Location.query.order_by(Location.location_id.asc()).all()
    except Exception:
        logger.exception("Failed to load locations")
        raise


def _all_floors():
    try:
        return Floor.query.order_by(Floor.floor_id.asc()).all()
    except Exception:
        logger.exception("Failed to load floors")
        raise


def _floor_label(floor):
    number = floor.floor_number
    if number == 0:
        return "Ground Floor"
    suffix = "th" if 10 < number % 100 < 14 else {1: "st", 2: "nd", 3: "rd"}.get(number % 10, "th")
    return f"{number}{suffix} Floor"


def _legacy_floor(record, floors):
    if record.floor_id is None:
        return None
    floor = next((item for item in floors if item.floor_id == record.floor_id), None)
    if floor is None or floor.building_id != record.building_id:
        raise ValueError(f"Location {record.location_id} references an invalid legacy Floor relationship.")
    return floor


def _location_dto(record, records, floors):
    if record.type_id not in LOCATION_TYPE_NAMES:
        raise ValueError(
            f"Location {record.location_id} references an unknown location type."
        )
    by_id = {item.location_id: item for item in records}
    building = by_id.get(record.building_id)
    legacy_floor = _legacy_floor(record, floors)
    floor = getattr(record, "floor_level", None)
    return record.to_location_dto(building=building.location_name if building else None, floor=floor or (_floor_label(legacy_floor) if legacy_floor else None))


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


def _validation_error(fields=None, relationships=None):
    return jsonify({"success": False, "message": "Location validation failed.", "fields": fields or {}, "relationships": relationships or {}}), 400


def _validate(data, records):
    fields, relationships = {}, {}
    name, code = str(data.get("name", "")).strip(), str(data.get("code", "")).strip()
    location_type, parent_id = data.get("type"), data.get("parentId")
    floor_level = str(data.get("floor", "") or "").strip()
    if not name: fields["name"] = "Location name is required."
    if not code: fields["code"] = "Location code is required."
    if location_type not in CREATABLE_TYPES: fields["type"] = "Select a supported Location type."
    building = None
    if location_type in INDOOR_TYPES:
        if parent_id in (None, ""):
            fields["parentId"] = "A Building is required for an Indoor Location."
        else:
            try: building = next((item for item in records if item.location_id == int(parent_id)), None)
            except (TypeError, ValueError): building = None
            if building is None or building.type_id != TYPE_IDS["Building"]:
                relationships["parentId"] = "The selected Building does not exist."
        if not floor_level or floor_level == "Unspecified Floor":
            fields["floor"] = "A specific Floor Level is required for a new Indoor Location."
    elif parent_id not in (None, ""):
        fields["parentId"] = "Only Indoor Locations can belong to a Building."
    duplicate = next((item for item in records if item.location_code.lower() == code.lower()), None)
    if duplicate:
        return None, (jsonify({"success": False, "message": "Location code already exists.", "fields": {"code": "Location code must be unique."}}), 409)
    if fields or relationships: return None, _validation_error(fields, relationships)
    return {"name": name, "code": code, "type_id": TYPE_IDS[location_type], "building_id": building.location_id if building else None, "floor_level": floor_level or None, "description": data.get("function", data.get("description")), "keywords": data.get("keywords")}, None


@location_bp.route("", methods=["GET"])
def list_locations():
    _, error = admin_required()
    if error: return error
    try:
        query = request.args.get("q", "").strip().lower()
        type_filter = request.args.get("type", "").strip()
        status_filter = request.args.get("status", "").strip()
        building_id_filter = request.args.get("buildingId", "").strip()
        floor_filter = request.args.get("floor", "").strip().lower()
        page = max(request.args.get("page", 1, type=int) or 1, 1)
        page_size = min(max(request.args.get("pageSize", 20, type=int) or 20, 1), 100)
        records, floors, projected = _all_locations(), _all_floors(), []
        for record in records:
            dto = _location_dto(record, records, floors)
            searchable = " ".join(str(dto.get(field) or "") for field in ("name", "code", "type", "building", "floor", "function", "keywords")).lower()
            if query and query not in searchable:
                continue
            if type_filter and dto["type"] != type_filter:
                continue
            if status_filter and dto["status"] != status_filter:
                continue
            if building_id_filter and building_id_filter not in {
                str(record.building_id or ""),
                str(record.location_id) if dto["type"] == "Building" else "",
            }:
                continue
            if floor_filter and str(dto.get("floor") or "").lower() != floor_filter:
                continue
            projected.append(dto)
        start = (page - 1) * page_size
        return jsonify({"success": True, "items": projected[start:start + page_size], "total": len(projected), "page": page, "pageSize": page_size}), 200
    except ValueError as error:
        logger.warning("Invalid persisted location data: %s", error)
        return jsonify({"success": False, "message": str(error)}), 500
    except Exception:
        logger.exception("Failed to list locations")
        return jsonify({"success": False, "message": "Failed to list locations."}), 500


@location_bp.route("", methods=["POST"])
def create_location():
    _, error = admin_required()
    if error: return error
    try:
        records = _all_locations()
    except Exception:
        return jsonify({"success": False, "message": "Failed to create location."}), 500
    values, error = _validate(_request_payload(), records)
    if error: return error
    photo, photo_mime_type, error = _photo_upload()
    if error: return error
    try:
        location = Location(building_id=values["building_id"], floor_id=None, floor_level=values["floor_level"], type_id=values["type_id"], location_code=values["code"], location_name=values["name"], description=values["description"], keywords=values["keywords"])
        if photo is not None:
            location.photo, location.photo_mime_type = photo, photo_mime_type
        db.session.add(location)
        db.session.flush()
        db.session.commit()
        return jsonify(_location_dto(location, records + [location], _all_floors())), 201
    except Exception:
        logger.exception("Failed to create location")
        db.session.rollback()
        return jsonify({"success": False, "message": "Failed to create location."}), 500
