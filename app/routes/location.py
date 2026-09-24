import logging

from flask import Blueprint, jsonify, request

from auth import admin_required
from extensions import db
from model.audit_log import AuditLog
from model.building import Building
from model.floor import Floor
from model.location import LOCATION_TYPE_IDS, LOCATION_TYPE_NAMES, Location
from services.audit import log_audit
from services.floor_lookup import floor_label as _floor_label
from services.floor_lookup import floor_number_from_label as _floor_number_from_label
from services.floor_lookup import resolve_floor as _resolve_floor
from services.geometry import polygon_feature_anchor as _polygon_feature_anchor
from services.geometry import polygon_error as _polygon_error
from services.location_listing import list_location_page
from services.location_photos import apply_gallery, read_gallery_change

location_bp = Blueprint("location", __name__, url_prefix="/api/locations")

TYPE_IDS = LOCATION_TYPE_IDS
INDOOR_TYPES = {"Room", "Office", "Laboratory", "Restroom"}
# Facility is a Building classification, never a public.location type.  It
# remains accepted here so the API can create a classified Building record.
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

    floor = next(
        (item for item in floors if item.floor_id == record.floor_id),
        None
    )

    if floor is None or floor.building_id != record.building_id:
        raise ValueError(
            f"Location {record.location_id} references an invalid Floor relationship."
        )

    return floor


def _location_dto(record, buildings, floors):
    if record.type_id not in LOCATION_TYPE_NAMES:
        raise ValueError(
            f"Location {record.location_id} references an unknown location type."
        )

    by_id = {
        item.building_id: item
        for item in buildings
    }

    building = by_id.get(record.building_id)

    floor = _location_floor(record, floors)

    return record.to_location_dto(
        building=building.building_name if building else None,
        floor=_floor_label(floor) if floor else None
    )


def _request_payload():
    return (
        request.get_json(silent=True) or {}
        if request.is_json
        else request.form.to_dict()
    )


def _photo_upload():
    """Read and validate an optional multipart photo before touching a row."""

    upload = request.files.get("photo")

    if upload is None or not upload.filename:
        return None, None, None

    if upload.mimetype not in PHOTO_MIME_TYPES:
        return (
            None,
            None,
            _validation_error(
                {
                    "photo": "Choose a PNG, JPEG, or WebP image."
                }
            )
        )

    content = upload.read(PHOTO_MAX_BYTES + 1)

    if len(content) > PHOTO_MAX_BYTES:
        return (
            None,
            None,
            _validation_error(
                {
                    "photo": "Photo must be 5 MB or smaller."
                }
            )
        )

    return content, upload.mimetype, None


def _validation_error(fields=None, relationships=None):
    return (
        jsonify(
            {
                "success": False,
                "message": "Location validation failed.",
                "fields": fields or {},
                "relationships": relationships or {},
            }
        ),
        400,
    )


def _validate(data, records, buildings):
    fields, relationships = {}, {}

    name = str(data.get("name", "")).strip()
    code = str(data.get("code", "")).strip()

    location_type = data.get("type")
    parent_id = data.get("parentId")

    floor_level = str(
        data.get("floor", "") or ""
    ).strip()

    floor_number = _floor_number_from_label(floor_level)

    # Basic validation
    if not name:
        fields["name"] = "Location name is required."

    if not code:
        fields["code"] = "Location code is required."

    if location_type not in CREATABLE_TYPES:
        fields["type"] = "Select a supported Location type."

    building = None

    # Building
    if location_type == "Building":
        building = None

    # Indoor Location
    elif location_type in INDOOR_TYPES:

        if parent_id in (None, ""):
            fields["parentId"] = (
                "A Building is required for an Indoor Location."
            )

        else:
            try:
                building = next(
                    (
                        item
                        for item in buildings
                        if item.building_id == int(parent_id)
                    ),
                    None,
                )

            except (TypeError, ValueError):
                building = None

            if building is None:
                relationships["parentId"] = (
                    "The selected Building does not exist."
                )

        if not floor_level or floor_level == "Unspecified Floor":
            fields["floor"] = (
                "A specific Floor Level is required for a new Indoor Location."
            )
        elif floor_number is None:
            fields["floor"] = "Select a valid Floor Level."

    elif parent_id not in (None, ""):
        fields["parentId"] = (
            "Only Indoor Locations can belong to a Building."
        )

    if location_type in {"Building", "Facility"} and floor_level:
        fields["floor"] = (
            "Building classifications cannot have a Floor Level."
        )

    # Duplicate code validation
    duplicate = next(
        (
            item
            for item in records
            if item.location_code.lower() == code.lower()
        ),
        None,
    )

    if duplicate is None:
        duplicate = next(
            (
                item
                for item in buildings
                if item.building_code.lower() == code.lower()
            ),
            None,
        )

    if duplicate:
        return (
            None,
            (
                jsonify(
                    {
                        "success": False,
                        "message": "Location code already exists.",
                        "fields": {
                            "code": "Location code must be unique."
                        },
                    }
                ),
                409,
            ),
        )

    polygon_coordinates = data.get("polygonCoordinates")
    if polygon_coordinates is not None:
        polygon_error = _polygon_error(polygon_coordinates)
        if polygon_error:
            fields["polygonCoordinates"] = polygon_error

    if fields or relationships:
        return None, _validation_error(
            fields,
            relationships
        )

    return {
        "name": name,
        "code": code,
        "type": location_type,
        "type_id": TYPE_IDS.get(location_type),
        "building_id": (
            building.building_id
            if building
            else None
        ),
        "floor_number": floor_number,
        "description": data.get(
            "function",
            data.get("description")
        ),
        "keywords": data.get("keywords"),

        # NEW:
        "polygon_coordinates": polygon_coordinates,
    }, None


@location_bp.route("", methods=["GET"])
def list_locations():

    _, error = admin_required()

    if error:
        return error

    try:
        records = _all_locations()
        buildings = _all_buildings()
        floors = _all_floors()
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

        logger.warning(
            "Invalid persisted location data: %s",
            error
        )

        return jsonify(
            {
                "success": False,
                "message": str(error)
            }
        ), 500

    except Exception:

        logger.exception(
            "Failed to list locations"
        )

        return jsonify(
            {
                "success": False,
                "message": "Failed to list locations."
            }
        ), 500


@location_bp.route("/<int:location_id>/history", methods=["GET"])
def location_history(location_id):
    """Return only the audit history belonging to one Campus Location."""
    _, error = admin_required()
    if error:
        return error

    try:
        location = Location.query.filter_by(location_id=location_id).first()
        building = Building.query.filter_by(building_id=location_id).first()
        requested_type = request.args.get("type")
        if requested_type in INDOOR_TYPES:
            building = None
        elif requested_type in {"Building", "Facility"}:
            location = None
        elif location is not None:
            building = None
        if location is None and building is None:
            return jsonify({"success": False, "message": "Location not found."}), 404

        target = "Building" if building is not None else "Location"
        records = AuditLog.query.filter_by(target_id=str(location_id), target=target).order_by(
            AuditLog.created_at.desc()
        ).all()
        return jsonify({
            "items": [record.to_dict() for record in records],
            "total": len(records),
            "page": 1,
            "pageSize": max(len(records), 20),
        }), 200
    except Exception:
        logger.exception("Failed to get location history")
        return jsonify({"success": False, "message": "Failed to get location history."}), 500


@location_bp.route("", methods=["POST"])
def create_location():

    _, error = admin_required()

    if error:
        return error

    try:

        records = _all_locations()
        buildings = _all_buildings()

    except Exception:

        return jsonify(
            {
                "success": False,
                "message": "Failed to create location."
            }
        ), 500

    # Get request data
    data = _request_payload()
    if not isinstance(data, dict):
        return _validation_error({
            "request": "Location updates must be an object.",
        })

    values, error = _validate(
        data,
        records,
        buildings
    )

    if error:
        return error

    photo, photo_mime_type, error = _photo_upload()

    if error:
        return error
    gallery_change, gallery_error = read_gallery_change(request)
    if gallery_error:
        return _validation_error({"photo": gallery_error})

    try:

        # ==================================================
        # BUILDING CREATION
        # ==================================================

        if values.get("type") in {"Building", "Facility"}:

            latitude = longitude = None
            if values["polygon_coordinates"] is not None:
                latitude, longitude = _polygon_feature_anchor(
                    values["polygon_coordinates"]
                )

            building = Building(
                building_code=values["code"],
                building_name=values["name"],
                description=values["description"],
                classification=values["type"],
                latitude=latitude,
                longitude=longitude,

                # NEW:
                # Save polygon coordinates
                polygon_coordinates=values[
                    "polygon_coordinates"
                ],
            )

            if photo is not None:
                building.photo = photo
                building.photo_mime_type = photo_mime_type

            db.session.add(building)

            db.session.flush()
            gallery_error = apply_gallery(building, gallery_change)
            if gallery_error:
                db.session.rollback()
                return _validation_error({"photo": gallery_error})
            log_audit("Admin", None, "create", "Building", building.building_id, building.building_name)

            db.session.commit()

            return jsonify(
                building.to_location_dto()
            ), 201

        # ==================================================
        # NORMAL LOCATION CREATION
        # ==================================================

        floor_id = (
            _resolve_floor(Floor, db.session, values["building_id"], values["floor_number"]).floor_id
            if values["floor_number"] is not None
            else None
        )

        location = Location(
            building_id=values["building_id"],
            floor_id=floor_id,
            type_id=values["type_id"],
            location_code=values["code"],
            location_name=values["name"],
            description=values["description"],
            keywords=values["keywords"],
        )

        if photo is not None:
            location.photo = photo
            location.photo_mime_type = photo_mime_type

        db.session.add(location)

        db.session.flush()
        gallery_error = apply_gallery(location, gallery_change)
        if gallery_error:
            db.session.rollback()
            return _validation_error({"photo": gallery_error})
        log_audit("Admin", None, "create", "Location", location.location_id, location.location_name)

        db.session.commit()

        return jsonify(
            _location_dto(
                location,
                buildings,
                _all_floors()
            )
        ), 201

    except Exception:

        logger.exception(
            "Failed to create location"
        )

        db.session.rollback()

        return jsonify(
            {
                "success": False,
                "message": "Failed to create location."
            }
        ), 500
