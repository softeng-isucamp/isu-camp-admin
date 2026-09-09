import logging

from flask import Blueprint, jsonify, request

from auth import admin_required
from extensions import db
from model.building import Building
from model.route_node import RouteNode
from model.pathway import Pathway
from services.audit import log_audit

map_bp = Blueprint("map", __name__, url_prefix="/api/map")

logger = logging.getLogger(__name__)


def _building_dto(building):
    return {
        "id": str(building.building_id),
        "name": building.building_name,
        "code": building.building_code,
        "points": building.polygon_coordinates or [],
        "status": "Active",
        "type": "Building",
    }


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

        db.session.delete(building)
        log_audit("Admin", None, "delete", "Building", building_id, building.building_name)
        db.session.commit()
        return jsonify({"success": True, "message": "Building deleted."}), 200
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
        data = request.get_json(silent=True) or {}

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

        for building in data.get("buildings", []) or []:
            try:
                record = Building.query.get(int(building.get("id")))
            except (TypeError, ValueError):
                continue
            if not record:
                continue
            if building.get("lat") is not None:
                record.latitude = building["lat"]
            if building.get("lng") is not None:
                record.longitude = building["lng"]
            if "points" in building:
                record.polygon_coordinates = building["points"]

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
