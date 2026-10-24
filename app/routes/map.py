import logging
import math

from flask import Blueprint, jsonify, request

from auth import admin_required, permission_error, reauth_required
from extensions import db
from model.building import Building
from model.floor import Floor
from model.location import Location
from model.location import LOCATION_TYPE_NAMES
from model.record_status import status_label as _status_label
from model.route_node import RouteNode
from model.pathway import Pathway
from services.audit import log_audit
from services.floor_lookup import floor_label as _floor_label
from services.geometry import polygon_error as _polygon_error
from services.geometry import polygon_feature_anchor as _polygon_feature_anchor
from services.geometry import point_in_polygon as _point_in_polygon
from services.record_deletion import purge_building

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
        "status": _status_label(building.status),
        "type": building.place_classification,
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
    # The permission before the password, so an administrator who may not
    # delete is refused outright rather than prompted first.
    admin, error = admin_required()
    if error:
        return error

    if denied := permission_error(admin, "delete"):
        return denied

    _, error = reauth_required()
    if error:
        return error

    try:
        building = Building.query.get(building_id)
        if not building:
            return jsonify({"success": False, "message": "Building not found."}), 404

        building_name = building.building_name
        purge_building(building_id)
        log_audit("Admin", None, "delete", "Building", building_id, building_name)
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
    """Set or clear an existing indoor location's map marker.

    One route, two operations. Giving an indoor location its first marker puts
    something on the map that was not on it before, which is an "add"; moving
    or clearing a marker it already has is an "edit". Which of the two this is
    cannot be read off the request - the body looks the same either way - so it
    is decided from the marker's stored coordinates below.
    """
    admin, error = admin_required()
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

        # Read from the row, never from the request: a client that claimed to
        # be placing a marker would otherwise choose which permission it was
        # judged against.
        unpositioned = location.latitude is None and location.longitude is None
        placing = unpositioned and latitude is not None
        if denied := permission_error(admin, "add" if placing else "edit"):
            return denied

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

# How a refusal names what it refused, per permission.
_PERMISSION_VERBS = {"add": "add", "edit": "change", "delete": "remove"}


def _change(permission, what, apply):
    """One write a save payload asks for.

    ``permission`` is which of the four it needs, ``what`` names it in a
    refusal, and ``apply`` performs it once the whole payload is allowed.
    """

    return {"permission": permission, "what": what, "apply": apply}


def _refusal(change):
    verb = _PERMISSION_VERBS.get(change["permission"], "change")
    return (
        f"You don't have permission to {verb} {change['what']}. "
        "Ask a superadmin."
    )


def _footprint_change(record, building):
    """The write one building entry asks for: its footprint, and its anchor."""

    def apply():
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

    name = getattr(record, "building_name", None) or f"Building {record.building_id}"
    return _change("edit", f"the {name} footprint", apply)


def _fields_change(record, fields, permission, what):
    def apply():
        for key, value in fields.items():
            setattr(record, key, value)

    return _change(permission, what, apply)


def _map_changes(data):
    """Every write the payload asks for, in the order they are applied.

    Collected before the first one lands, because a save is one operation: a
    change the caller may not make has to refuse the whole payload, and a
    sequence of guarded writes would instead store the allowed half of it.

    Everything this route can apply is a change to a record that already
    exists - it looks each one up by id and skips the ones it cannot find - so
    every change here is an edit. Nothing in this payload creates or removes a
    feature; those go through the routes that do (POST /api/route-nodes, DELETE
    /api/map/buildings/:id and the rest), each authorized as itself.

    Returns ``(changes, error_response)``.
    """

    changes = []

    # Footprints are validated before any other entry is even read, as they
    # were before: an invalid polygon is a 400 about the payload, not a
    # half-applied save. They are appended last because the anchor is
    # recomputed from the polygon this applies.
    footprints = []
    for index, building in enumerate(data.get("buildings", [])):
        if "points" not in building:
            continue
        polygon_error = _polygon_error(building["points"])
        if polygon_error:
            return None, _map_validation_error({
                f"buildings[{index}].points": polygon_error,
            })
        try:
            record = Building.query.get(int(building.get("id")))
        except (TypeError, ValueError):
            continue
        if record:
            footprints.append(_footprint_change(record, building))

    for node in data.get("nodes", []) or []:
        try:
            record = RouteNode.query.get(int(node.get("id")))
        except (TypeError, ValueError):
            continue
        if not record:
            continue
        fields = {}
        if node.get("lat") is not None:
            fields["latitude"] = node["lat"]
        if node.get("lng") is not None:
            fields["longitude"] = node["lng"]
        if node.get("status"):
            fields["status"] = "inactive" if str(node["status"]).lower() == "inactive" else "active"
        if fields:
            name = getattr(record, "name", None) or f"Route Node {record.node_id}"
            changes.append(_fields_change(record, fields, "edit", f"Route Node {name}"))

    moved_node = data.get("movedNode")
    if moved_node and moved_node.get("id") is not None:
        try:
            record = RouteNode.query.get(int(moved_node["id"]))
        except (TypeError, ValueError):
            record = None
        if record:
            fields = {}
            if moved_node.get("lat") is not None:
                fields["latitude"] = moved_node["lat"]
            if moved_node.get("lng") is not None:
                fields["longitude"] = moved_node["lng"]
            if fields:
                name = getattr(record, "name", None) or f"Route Node {record.node_id}"
                changes.append(_fields_change(record, fields, "edit", f"the position of Route Node {name}"))

    for pathway in data.get("pathways", []) or []:
        try:
            record = Pathway.query.get(int(pathway.get("id")))
        except (TypeError, ValueError):
            continue
        if record and pathway.get("status"):
            status = "closed" if str(pathway["status"]).lower() == "closed" else "active"
            name = getattr(record, "name", None) or f"Pathway {record.pathway_id}"
            changes.append(_fields_change(record, {"status": status}, "edit", f"Pathway {name}"))

    return changes + footprints, None


@map_bp.route("/save", methods=["POST"])
def save_map_draft():
    admin, error = admin_required()
    if error:
        return error

    try:
        data, error = _map_payload()
        if error:
            return error

        changes, error = _map_changes(data)
        if error:
            return error

        # Every change is checked before the first one is applied, and the
        # first one that is refused refuses the save. An empty payload asks for
        # nothing, so it needs nothing.
        for change in changes:
            denied = permission_error(admin, change["permission"], _refusal(change))
            if denied:
                return denied

        for change in changes:
            change["apply"]()

        log_audit("Admin", None, "save draft", "Map", None, "Map draft changes saved")
        db.session.commit()
        return jsonify({"success": True, "message": "Map draft saved."}), 200

    except Exception:
        db.session.rollback()
        logger.exception("Failed to save map draft")
        return jsonify({"success": False, "message": "Failed to save map draft."}), 500


@map_bp.route("/publish", methods=["POST"])
def publish_map_revision():
    """Record publication of the current validated map revision.

    Open to every active administrator, deliberately, and none of the four
    permissions gates it: publishing promotes work that is already saved, and
    the saving is what each of those permissions was checked on. Requiring
    "edit" here would leave an administrator who may add - and has just added
    something through a route they are allowed to use - unable to put it live,
    and would leave the portal showing a Publish button that always refuses.
    """
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
