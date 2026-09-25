import logging
import math

from flask import Blueprint, jsonify, request

from auth import admin_required
from extensions import db
from model.building import Building
from model.floor import Floor
from model.location import Location
from model.location import LOCATION_TYPE_NAMES
from model.location_photo import LocationPhoto
from model.route_node import RouteNode
from model.pathway import Pathway
from services.audit import log_audit
from services.floor_lookup import floor_label as _floor_label
from services.geometry import polygon_error as _polygon_error
from services.geometry import polygon_feature_anchor as _polygon_feature_anchor
from services.geometry import point_in_polygon as _point_in_polygon

map_bp = Blueprint("map", __name__, url_prefix="/api/map")

logger = logging.getLogger(__name__)


def _map_validation_error(fields):
    return jsonify({
        "success": False,
        "message": "Map validation failed.",
        "fields": fields,
    }), 400


def _map_payload():
    """Validate the container shape before applying any draft updates."""

    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return None, _map_validation_error({
            "request": "Map updates must be a JSON object.",
        })

    fields = {}
    for name in ("buildings", "nodes", "pathways"):
        if name in data and not isinstance(data[name], list):
            fields[name] = "Map updates must be a list."

    if "movedNode" in data and not isinstance(data["movedNode"], dict):
        fields["movedNode"] = "Moved node updates must be an object."

    for name, label in (
        ("buildings", "Building"),
        ("nodes", "Route node"),
        ("pathways", "Pathway"),
    ):
        records = data.get(name, [])
        if isinstance(records, list):
            for index, record in enumerate(records):
                if not isinstance(record, dict):
                    fields[f"{name}[{index}]"] = f"{label} updates must be objects."

    if fields:
        return None, _map_validation_error(fields)

    return data, None


def _building_dto(building):
    return {
        "id": str(building.building_id),
        "name": building.building_name,
        "code": building.building_code,
        "points": building.polygon_coordinates or [],
        "status": "Active",
        "type": getattr(building, "classification", None) or "Building",
    }


def _delete_building_photos(building_id):
    """Purge gallery photos owned by a Building and its Indoor Locations.

    ``location_photo.owner_id`` is polymorphic, so the column carries no
    foreign key and the database performs no cascade.  The rows are removed
    before their owners are staged so the blobs cannot outlive the records
    they belong to (see the same purge in ``routes.actions.delete_location``).
    """
    location_ids = [row.location_id for row in Location.query.filter_by(building_id=building_id).all()]
    if location_ids:
        LocationPhoto.query.filter(
            LocationPhoto.owner_type == "location",
            LocationPhoto.owner_id.in_(location_ids),
        ).delete(synchronize_session=False)
    LocationPhoto.query.filter_by(owner_type="building", owner_id=building_id).delete(synchronize_session=False)


def _delete_building_locations(building_id):
    """Stage every Indoor Location owned by a Building in this transaction.

    The legacy ``location.building_id`` column is not declared as a database
    foreign key, so relying on a database cascade would leave orphaned
    directory records.  Staging these deletes explicitly keeps the hard-delete
    contract true while the Building and audit row still share one commit.
    """
    locations = Location.query.filter_by(building_id=building_id).all()
    for location in locations:
        db.session.delete(location)
    return locations


def _delete_building_floors(building_id):
    """Stage every Floor owned by a Building in this transaction.

    Locations referencing these floors must already be staged for deletion
    (see ``_delete_building_locations``) before this runs, since
    ``location.floor_id`` is a foreign key into ``public.floor``.
    """
    floors = Floor.query.filter_by(building_id=building_id).all()
    for floor in floors:
        db.session.delete(floor)
    return floors


# ==========================================
# GET MAP BUILDINGS
# ==========================================

@map_bp.route("/buildings", methods=["GET"])
def get_map_buildings():
    _, error = admin_required()
    if error:
        return error

    try:
        records = Building.query.order_by(Building.building_id.asc()).all()
        return jsonify([_building_dto(b) for b in records]), 200
    except Exception:
        logger.exception("Failed to list map buildings")
        return jsonify({"success": False, "message": "Failed to load buildings."}), 500


# ==========================================
# DELETE MAP BUILDING
# ==========================================

@map_bp.route("/buildings/<int:building_id>", methods=["DELETE"])
def delete_map_building(building_id):
    _, error = admin_required()
    if error:
        return error

    try:
        building = Building.query.get(building_id)
        if not building:
            return jsonify({"success": False, "message": "Building not found."}), 404

        _delete_building_photos(building_id)
        _delete_building_locations(building_id)
        _delete_building_floors(building_id)
        db.session.delete(building)
        log_audit("Admin", None, "delete", "Building", building_id, building.building_name)
        db.session.commit()
        return jsonify({
            "success": True,
            "message": "Building and associated Indoor Locations permanently deleted.",
        }), 200
    except Exception:
        db.session.rollback()
        logger.exception("Failed to delete building")
        return jsonify({"success": False, "message": "Failed to delete building."}), 500


@map_bp.route("/buildings/<int:building_id>/indoor-locations/<int:location_id>", methods=["PATCH"])
def set_indoor_location_position(building_id, location_id):
    """Set or clear an existing indoor location's map marker."""
    _, error = admin_required()
    if error:
        return error

    data = request.get_json(silent=True)
    if not isinstance(data, dict) or "lat" not in data or "lng" not in data:
        return jsonify({"success": False, "message": "lat and lng are required."}), 400

    lat, lng = data["lat"], data["lng"]
    if lat is None and lng is None:
        latitude = longitude = None
    else:
        if lat is None or lng is None or isinstance(lat, bool) or isinstance(lng, bool):
            return jsonify({"success": False, "message": "lat and lng must both be finite numbers or both null."}), 400
        try:
            latitude, longitude = float(lat), float(lng)
        except (TypeError, ValueError):
            return jsonify({"success": False, "message": "lat and lng must both be finite numbers or both null."}), 400
        if not math.isfinite(latitude) or not math.isfinite(longitude):
            return jsonify({"success": False, "message": "lat and lng must both be finite numbers or both null."}), 400
        if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
            return jsonify({"success": False, "message": "Coordinates must be valid latitude and longitude values."}), 400

    try:
        building = Building.query.get(building_id)
        if building is None:
            return jsonify({"success": False, "message": "Building not found."}), 404
        location = Location.query.get(location_id)
        if location is None or location.building_id != building_id:
            return jsonify({"success": False, "message": "Indoor location not found for this building."}), 404
        if location.type_id not in LOCATION_TYPE_NAMES:
            return jsonify({"success": False, "message": "Location is not an indoor location."}), 400

        if latitude is not None:
            points = building.polygon_coordinates
            if not points:
                return jsonify({"success": False, "message": "Building footprint is required to place an indoor location."}), 400
            if _polygon_error(points):
                return jsonify({"success": False, "message": "Building footprint is invalid."}), 400
            if not _point_in_polygon((latitude, longitude), points):
                return jsonify({"success": False, "message": "Indoor location must be inside the building footprint."}), 400

        location.latitude = latitude
        location.longitude = longitude
        floor = Floor.query.get(location.floor_id) if location.floor_id is not None else None
        location_dto = location.to_location_dto(
            building=building.building_name,
            floor=_floor_label(floor) if floor and floor.building_id == building_id else None,
        )
        db.session.commit()
        return jsonify(location_dto), 200
    except Exception:
        db.session.rollback()
        logger.exception("Failed to update indoor location marker")
        return jsonify({"success": False, "message": "Failed to update indoor location marker."}), 500


# ==========================================
# SAVE MAP DRAFT
# ==========================================

@map_bp.route("/save", methods=["POST"])
def save_map_draft():
    _, error = admin_required()
    if error:
        return error

    try:
        data, error = _map_payload()
        if error:
            return error

        building_updates = []
        for index, building in enumerate(data.get("buildings", [])):
            if "points" not in building:
                continue
            polygon_error = _polygon_error(building["points"])
            if polygon_error:
                return _map_validation_error({
                    f"buildings[{index}].points": polygon_error,
                })
            try:
                record = Building.query.get(int(building.get("id")))
            except (TypeError, ValueError):
                continue
            if record:
                building_updates.append((record, building))

        for node in data.get("nodes", []) or []:
            try:
                record = RouteNode.query.get(int(node.get("id")))
            except (TypeError, ValueError):
                continue
            if not record:
                continue
            if node.get("lat") is not None:
                record.latitude = node["lat"]
            if node.get("lng") is not None:
                record.longitude = node["lng"]
            if node.get("status"):
                record.status = "inactive" if str(node["status"]).lower() == "inactive" else "active"

        moved_node = data.get("movedNode")
        if moved_node and moved_node.get("id") is not None:
            try:
                record = RouteNode.query.get(int(moved_node["id"]))
                if record:
                    if moved_node.get("lat") is not None:
                        record.latitude = moved_node["lat"]
                    if moved_node.get("lng") is not None:
                        record.longitude = moved_node["lng"]
            except (TypeError, ValueError):
                pass

        for pathway in data.get("pathways", []) or []:
            try:
                record = Pathway.query.get(int(pathway.get("id")))
            except (TypeError, ValueError):
                continue
            if record and pathway.get("status"):
                record.status = "closed" if str(pathway["status"]).lower() == "closed" else "active"

        for record, building in building_updates:
            previous_points = record.polygon_coordinates
            if building.get("lat") is not None:
                record.latitude = building["lat"]
            if building.get("lng") is not None:
                record.longitude = building["lng"]
            if "points" in building:
                record.polygon_coordinates = building["points"]
                record.latitude, record.longitude = _polygon_feature_anchor(record.polygon_coordinates)
                if previous_points != record.polygon_coordinates:
                    log_audit(
                        "Admin",
                        None,
                        "update geometry",
                        "Building",
                        record.building_id,
                        f"{getattr(record, 'building_name', record.building_id)} footprint updated",
                    )

        log_audit("Admin", None, "save draft", "Map", None, "Map draft changes saved")
        db.session.commit()
        return jsonify({"success": True, "message": "Map draft saved."}), 200

    except Exception:
        db.session.rollback()
        logger.exception("Failed to save map draft")
        return jsonify({"success": False, "message": "Failed to save map draft."}), 500


@map_bp.route("/publish", methods=["POST"])
def publish_map_revision():
    """Record publication of the current validated map revision."""
    _, error = admin_required()
    if error:
        return error

    try:
        data = request.get_json(silent=True) or {}
        revision_id = data.get("revisionId") or data.get("revision_id")
        log_audit(
            "Admin",
            None,
            "publish revision",
            "Map",
            revision_id,
            "Map revision published",
        )
        db.session.commit()
        return jsonify({"success": True, "message": "Map revision published."}), 200
    except Exception:
        db.session.rollback()
        logger.exception("Failed to publish map revision")
        return jsonify({"success": False, "message": "Failed to publish map revision."}), 500
