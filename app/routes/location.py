import math

from flask import Blueprint, Response, jsonify, request

from auth import admin_required
from extensions import db
from model.location import LOCATION_TYPE_IDS, LOCATION_TYPE_NAMES, Location

location_bp = Blueprint("location", __name__, url_prefix="/api/locations")

TYPE_IDS = LOCATION_TYPE_IDS
INDOOR_TYPES = {"Room", "Office", "Laboratory", "Restroom"}
CREATABLE_TYPES = set(TYPE_IDS) - {"Floor"}
PHOTO_MAX_BYTES = 5 * 1024 * 1024
PHOTO_MIME_TYPES = {"image/png", "image/jpeg", "image/webp"}


def _records():
    return Location.query.order_by(Location.location_id.asc()).all()


def _dto(record, records):
    if record.type_id not in LOCATION_TYPE_NAMES:
        raise ValueError(
            f"Location {record.location_id} references an unknown location type."
        )
    by_id = {item.location_id: item for item in records}
    building = by_id.get(record.building_id)
    legacy_floor = by_id.get(record.floor_id)
    floor = getattr(record, "floor_level", None)
    return record.to_location_dto(building=building.location_name if building else None, floor=floor or (legacy_floor.location_name if legacy_floor else None))


def _payload():
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


def _position_error(fields):
    return jsonify({"success": False, "message": "Location position validation failed.", "fields": fields}), 400


def _position_values(data):
    """Validate a complete coordinate pair before changing the ORM row."""
    if "lat" not in data or "lng" not in data:
        return None, _position_error({"position": "Latitude and longitude are required together."})
    lat, lng = data.get("lat"), data.get("lng")
    if lat is None and lng is None:
        return (None, None), None
    if isinstance(lat, bool) or not isinstance(lat, (int, float)) or not math.isfinite(lat) or lat < -90 or lat > 90:
        return None, _position_error({"lat": "Latitude must be between -90 and 90."})
    if isinstance(lng, bool) or not isinstance(lng, (int, float)) or not math.isfinite(lng) or lng < -180 or lng > 180:
        return None, _position_error({"lng": "Longitude must be between -180 and 180."})
    return (float(lat), float(lng)), None


def _validate(data, records, current=None):
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
        existing_floor = getattr(current, "floor_level", None) if current else None
        if (not floor_level or floor_level == "Unspecified Floor") and (current is None or existing_floor):
            fields["floor"] = "A specific Floor Level is required for a new Indoor Location."
    elif parent_id not in (None, ""):
        fields["parentId"] = "Only Indoor Locations can belong to a Building."
    duplicate = next((item for item in records if item is not current and item.location_code.lower() == code.lower()), None)
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
        records, projected = _records(), []
        for record in records:
            dto = _dto(record, records)
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
        return jsonify({"success": False, "message": str(error)}), 500
    except Exception:
        return jsonify({"success": False, "message": "Failed to list locations."}), 500


@location_bp.route("", methods=["POST"])
def create_location():
    _, error = admin_required()
    if error: return error
    records = _records()
    values, error = _validate(_payload(), records)
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
        return jsonify(_dto(location, records + [location])), 201
    except Exception:
        db.session.rollback()
        return jsonify({"success": False, "message": "Failed to create location."}), 500


@location_bp.route("/<int:location_id>", methods=["PUT"])
def update_location(location_id):
    _, error = admin_required()
    if error: return error
    records = _records()
    location = next((item for item in records if item.location_id == location_id), None)
    if location is None: return jsonify({"success": False, "message": "Location not found."}), 404
    values, error = _validate(_payload(), records, location)
    if error: return error
    photo, photo_mime_type, error = _photo_upload()
    if error: return error
    try:
        legacy_floor = next(
            (item for item in records if item.location_id == location.floor_id),
            None,
        )
        preserve_legacy_floor = (
            legacy_floor is not None
            and values["type_id"] in {TYPE_IDS[name] for name in INDOOR_TYPES}
            and values["building_id"] == location.building_id
            and values["floor_level"] == legacy_floor.location_name
        )
        location.location_name, location.location_code, location.type_id = values["name"], values["code"], values["type_id"]
        location.building_id = values["building_id"]
        location.floor_id = location.floor_id if preserve_legacy_floor else None
        location.floor_level = None if preserve_legacy_floor else values["floor_level"]
        if values["type_id"] != TYPE_IDS["Facility"]:
            location.lat, location.lng = None, None
        location.description, location.keywords = values["description"], values["keywords"]
        if photo is not None:
            location.photo, location.photo_mime_type = photo, photo_mime_type
        if request.form.get("removePhoto", "").lower() == "true":
            location.photo, location.photo_mime_type = None, None
        db.session.commit()
        return jsonify(_dto(location, records)), 200
    except Exception:
        db.session.rollback()
        return jsonify({"success": False, "message": "Failed to update location."}), 500


@location_bp.route("/<int:location_id>", methods=["DELETE"])
def delete_location(location_id):
    _, error = admin_required()
    if error:
        return error

    records = _records()
    location = next((item for item in records if item.location_id == location_id), None)
    if location is None:
        return jsonify({"success": False, "message": "Location not found."}), 404

    affected = [location]
    if location.type_id == TYPE_IDS["Building"]:
        affected.extend(
            item for item in records
            if item.building_id == location_id and item.type_id in {TYPE_IDS[name] for name in INDOOR_TYPES}
        )

    try:
        for record in affected:
            db.session.delete(record)
        db.session.commit()
        return jsonify({
            "success": True,
            "deleted": {
                "id": str(location_id),
                "count": len(affected),
                "ids": [str(record.location_id) for record in affected],
            },
        }), 200
    except Exception:
        db.session.rollback()
        return jsonify({"success": False, "message": "Failed to delete location."}), 500


@location_bp.route("/<int:location_id>/position", methods=["PATCH"])
def save_location_position(location_id):
    _, error = admin_required()
    if error:
        return error
    records = _records()
    location = next((item for item in records if item.location_id == location_id), None)
    if location is None:
        return jsonify({"success": False, "message": "Location not found."}), 404
    if location.type_id != TYPE_IDS["Facility"] or location.building_id is not None:
        return _position_error({"position": "Only standalone Outdoor Point Locations can own an outdoor position."})
    values, error = _position_values(_payload())
    if error:
        return error
    try:
        location.lat, location.lng = values
        db.session.commit()
        return jsonify(_dto(location, records)), 200
    except Exception:
        db.session.rollback()
        return jsonify({"success": False, "message": "Failed to save location position."}), 500


@location_bp.route("/<int:location_id>/photo", methods=["GET"])
def get_location_photo(location_id):
    _, error = admin_required()
    if error:
        return error
    location = Location.query.get(location_id)
    if location is None or getattr(location, "photo", None) is None:
        return jsonify({"success": False, "message": "Location photo not found."}), 404
    mime_type = getattr(location, "photo_mime_type", None)
    if not mime_type:
        return jsonify({"success": False, "message": "Location photo metadata is unavailable."}), 404
    return Response(location.photo, mimetype=mime_type, headers={"Content-Disposition": "inline"})
