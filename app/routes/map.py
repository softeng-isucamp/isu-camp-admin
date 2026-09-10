import logging
import math

from flask import Blueprint, jsonify, request

from auth import admin_required
from extensions import db
from model.building import Building
from model.location import Location
from model.route_node import RouteNode
from model.pathway import Pathway
from services.audit import log_audit

map_bp = Blueprint("map", __name__, url_prefix="/api/map")

logger = logging.getLogger(__name__)


def _polygon_error(points):
    if not isinstance(points, list) or len(points) < 3:
        return "Footprint geometry requires at least three latitude/longitude points."

    vertices = []
    for point in points:
        if (
            not isinstance(point, (list, tuple))
            or len(point) != 2
            or any(isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) for value in point)
        ):
            return "Each footprint point must contain finite latitude and longitude values."
        latitude, longitude = point
        if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
            return "Footprint coordinates must be valid latitude and longitude values."
        vertices.append((float(latitude), float(longitude)))

    if vertices[0] == vertices[-1]:
        vertices.pop()
    if len(vertices) < 3 or len(set(vertices)) != len(vertices):
        return "Footprint geometry must contain at least three distinct vertices."

    area_twice = sum(
        first[0] * second[1] - second[0] * first[1]
        for first, second in zip(vertices, vertices[1:] + vertices[:1])
    )
    if abs(area_twice) < 1e-12:
        return "Footprint geometry must enclose an area."

    def orientation(first, second, third):
        return (
            (second[1] - first[1]) * (third[0] - first[0])
            - (second[0] - first[0]) * (third[1] - first[1])
        )

    def on_segment(first, second, point):
        return (
            min(first[0], second[0]) <= point[0] <= max(first[0], second[0])
            and min(first[1], second[1]) <= point[1] <= max(first[1], second[1])
        )

    def segments_intersect(first, second, third, fourth):
        orientations = (
            orientation(first, second, third),
            orientation(first, second, fourth),
            orientation(third, fourth, first),
            orientation(third, fourth, second),
        )
        if any(math.isclose(value, 0.0, abs_tol=1e-12) for value in orientations):
            return (
                math.isclose(orientations[0], 0.0, abs_tol=1e-12)
                and on_segment(first, second, third)
            ) or (
                math.isclose(orientations[1], 0.0, abs_tol=1e-12)
                and on_segment(first, second, fourth)
            ) or (
                math.isclose(orientations[2], 0.0, abs_tol=1e-12)
                and on_segment(third, fourth, first)
            ) or (
                math.isclose(orientations[3], 0.0, abs_tol=1e-12)
                and on_segment(third, fourth, second)
            )
        return (orientations[0] > 0) != (orientations[1] > 0) and (orientations[2] > 0) != (orientations[3] > 0)

    edges = list(zip(vertices, vertices[1:] + vertices[:1]))
    for index, (first, second) in enumerate(edges):
        for other_index, (third, fourth) in enumerate(edges[index + 1:], index + 1):
            if other_index == index + 1 or (index == 0 and other_index == len(edges) - 1):
                continue
            if segments_intersect(first, second, third, fourth):
                return "Footprint edges must not intersect."

    return None


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
