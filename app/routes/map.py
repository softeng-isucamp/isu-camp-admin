import logging

from flask import Blueprint, jsonify, request

from auth import admin_required
from extensions import db
from model.building import Building
from model.floor import Floor
from model.location import Location
from model.route_node import RouteNode
from model.pathway import Pathway
from services.audit import log_audit
from services.geometry import polygon_error as _polygon_error

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
