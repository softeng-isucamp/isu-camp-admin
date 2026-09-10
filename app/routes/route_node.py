"""Transaction-safe walking-network API."""
import math

from flask import Blueprint, jsonify, request

from auth import admin_required
from extensions import db
from model.building import Building
from model.path_point import PathPoint
from model.pathway import Pathway
from model.pathway_allowed_mode import PathwayAllowedMode
from model.route_node import RouteNode
from services.audit import log_audit

route_node_bp = Blueprint("route_node", __name__, url_prefix="/api")
SHADES = {"Fully Shaded", "Mostly Shaded", "Partial Shade", "Unshaded", "Unknown"}
MODES = {"Walking", "Vehicle"}
DIRECTIONS = {"Two-way", "One-way", "Unknown"}
NODE_TYPES = {"intersection", "entrance", "access_point"}
STATUSES = {"active", "inactive"}


class ValidationError(ValueError): pass


def _error(message, code=400): return jsonify({"success": False, "message": message}), code
def _guard():
    _, error = admin_required()
    return error
def _body():
    value = request.get_json(silent=True)
    if not isinstance(value, dict) or not value: raise ValidationError("Request body is required")
    return value
def _int(value, name, nullable=False):
    if value is None and nullable: return None
    if isinstance(value, bool): raise ValidationError(f"{name} must be an integer")
    try: parsed = int(value)
    except (TypeError, ValueError): raise ValidationError(f"{name} must be an integer") from None
    if isinstance(value, float) and not value.is_integer(): raise ValidationError(f"{name} must be an integer")
    if isinstance(value, str) and value.strip() != str(parsed): raise ValidationError(f"{name} must be an integer")
    if parsed <= 0: raise ValidationError(f"{name} must be a positive integer")
    return parsed
def _number(value, name, lo=None, hi=None, positive=False):
    if isinstance(value, bool): raise ValidationError(f"{name} must be a finite number")
    try: result = float(value)
    except (TypeError, ValueError): raise ValidationError(f"{name} must be a finite number") from None
    if not math.isfinite(result): raise ValidationError(f"{name} must be a finite number")
    if positive and result <= 0: raise ValidationError(f"{name} must be greater than zero")
    if lo is not None and result < lo or hi is not None and result > hi: raise ValidationError(f"{name} must be between {lo} and {hi}")
    return result
def _text(value, name, required=False, maximum=255):
    if value is None and not required: return None
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > maximum: raise ValidationError(f"{name} must be a non-empty string up to {maximum} characters")
    return value.strip()
def _enum(value, name, options):
    if not isinstance(value, str) or value not in options: raise ValidationError(f"{name} must be one of {', '.join(sorted(options))}")
    return value
def _coordinates(data):
    if "latitude" not in data or "longitude" not in data: raise ValidationError("latitude and longitude are required")
    return _number(data["latitude"], "latitude", -90, 90), _number(data["longitude"], "longitude", -180, 180)
def _status(value):
    if not isinstance(value, str): raise ValidationError("status must be active or inactive")
    if value.lower() in {"active", "open"}: return "active"
    if value.lower() in {"inactive", "closed"}: return "inactive"
    raise ValidationError("status must be active or inactive")
def _modes(data, default=("Walking",)):
    result = data.get("allowed_modes", list(default))
    if not isinstance(result, list) or not result or any(mode not in MODES for mode in result): raise ValidationError("allowed_modes must contain at least one of Walking or Vehicle")
    result = list(dict.fromkeys(result))
    if data.get("path_type") == "Walkway" and "Vehicle" in result: raise ValidationError("Walkways cannot allow Vehicle mode")
    return result
def _modes_on(pathway, modes): pathway.allowed_modes = [PathwayAllowedMode(mode=mode) for mode in modes]
def _building(building_id):
    if building_id is not None and not Building.query.get(building_id): return ("Building not found", 404)
def _points(value):
    if not isinstance(value, list): raise ValidationError("path_points must be an array")
    result = []
    for sequence_no, raw in enumerate(value, 1):
        if not isinstance(raw, dict): raise ValidationError("each path point must be an object")
        lat, lng = _coordinates(raw)
        if _int(raw.get("sequence_no", sequence_no), "sequence_no") != sequence_no: raise ValidationError("path_points sequence_no values must be contiguous and start at 1")
        building_id = _int(raw.get("building_id"), "building_id", True)
        if (error := _building(building_id)): return error
        result.append(dict(sequence_no=sequence_no, latitude=lat, longitude=lng, building_id=building_id, node_type=_text(raw.get("node_type", "Waypoint"), "node_type", True, 50), status=_status(raw.get("status", "active"))))
    return result
def _replace_points(pathway, points): pathway.path_points = [PathPoint(pathway_id=pathway.pathway_id, **point) for point in points]
def _sequence_conflict(pathway_id, sequence_no, current=None):
    """Keep standalone path-point edits from duplicating a pathway position."""
    query = getattr(PathPoint, "query", None)
    if query is None or not hasattr(query, "filter_by"):
        return False
    match = query.filter_by(pathway_id=pathway_id, sequence_no=sequence_no).first()
    return bool(match and match is not current)


@route_node_bp.route("/route-nodes", methods=["GET"])
def get_route_nodes():
    try:
        records = RouteNode.query.order_by(RouteNode.node_id.asc()).all()
        return jsonify(success=True, count=len(records), route_nodes=[record.to_dict() for record in records])
    except Exception as error: return jsonify(success=False, message="Could not retrieve route nodes", error=str(error)), 500
@route_node_bp.route("/route-nodes/<int:node_id>", methods=["GET"])
def get_route_node(node_id):
    try:
        record = RouteNode.query.get(node_id)
        return _error("Route node not found", 404) if not record else (jsonify(success=True, route_node=record.to_dict()), 200)
    except Exception as error: return jsonify(success=False, message="Could not retrieve route node", error=str(error)), 500
def _node_values(data, current=None):
    node_type = _enum(data.get("node_type", getattr(current, "node_type", "intersection")), "node_type", NODE_TYPES)
    values = {"node_type": node_type}
    for key, lo, hi in (("latitude", -90, 90), ("longitude", -180, 180)):
        if current is None and key not in data: raise ValidationError("latitude and longitude are required")
        if key in data: values[key] = _number(data[key], key, lo, hi)
    for key in ("location_id", "building_id"):
        values[key] = _int(data[key], key, True) if key in data else getattr(current, key, None)
    if values["building_id"] is not None and node_type != "entrance": raise ValidationError("building_id may only be associated with an entrance route node")
    if (error := _building(values["building_id"])): return error
    values["name"] = _text(data["name"], "name", True) if "name" in data else getattr(current, "name", "Route Node")
    values["status"] = _enum(data["status"], "status", STATUSES) if "status" in data else getattr(current, "status", "active")
    return values
@route_node_bp.route("/route-nodes", methods=["POST"])
def create_route_node():
    if (error := _guard()): return error
    try:
        values = _node_values(_body())
        if isinstance(values, tuple): return _error(*values)
        record = RouteNode(**values); db.session.add(record); db.session.flush()
        log_audit("Admin", None, "create", "Route Node", record.node_id, record.name); db.session.commit()
        return jsonify(success=True, message="Route node created successfully", route_node=record.to_dict()), 201
    except ValidationError as error: return _error(str(error))
    except Exception as error: db.session.rollback(); return jsonify(success=False, message="Could not create route node", error=str(error)), 500
@route_node_bp.route("/route-nodes/<int:node_id>", methods=["PUT"])
def update_route_node(node_id):
    if (error := _guard()): return error
    try:
        record = RouteNode.query.get(node_id)
        if not record: return _error("Route node not found", 404)
        data = _body(); values = _node_values(data, record)
        if isinstance(values, tuple): return _error(*values)
        for key, value in values.items(): setattr(record, key, value)
        action = "associate entrance" if "building_id" in data and record.node_type == "entrance" and record.building_id else "clear entrance association" if "building_id" in data and record.node_type == "entrance" else "update"
        log_audit("Admin", None, action, "Route Node", node_id, record.name); db.session.commit()
        return jsonify(success=True, message="Route node updated successfully", route_node=record.to_dict())
    except ValidationError as error: return _error(str(error))
    except Exception as error: db.session.rollback(); return jsonify(success=False, message="Could not update route node", error=str(error)), 500
@route_node_bp.route("/route-nodes/<int:node_id>", methods=["DELETE"])
def delete_route_node(node_id):
    if (error := _guard()): return error
    try:
        record = RouteNode.query.get(node_id)
        if not record: return _error("Route node not found", 404)
        db.session.delete(record); log_audit("Admin", None, "delete", "Route Node", node_id, f"{record.name}; connected pathways and path points cascade deleted"); db.session.commit()
        return jsonify(success=True, message="Route node deleted successfully")
    except Exception as error: db.session.rollback(); return jsonify(success=False, message="Could not delete route node", error=str(error)), 500


@route_node_bp.route("/pathways", methods=["GET"])
def get_pathways():
    try:
        records = Pathway.query.order_by(Pathway.pathway_id.asc()).all()
        return jsonify(success=True, count=len(records), pathways=[record.to_dict() for record in records])
    except Exception as error: return jsonify(success=False, message="Could not retrieve pathways", error=str(error)), 500
@route_node_bp.route("/pathways/<int:pathway_id>", methods=["GET"])
def get_pathway(pathway_id):
    try:
        record = Pathway.query.get(pathway_id)
        return _error("Pathway not found", 404) if not record else (jsonify(success=True, pathway=record.to_dict()), 200)
    except Exception as error: return jsonify(success=False, message="Could not retrieve pathway", error=str(error)), 500
def _pathway_values(data, current=None):
    required = ("source_node_id", "destination_node_id", "path_type", "distance_m", "estimated_minutes")
    for key in required:
        if current is None and key not in data: raise ValidationError(f"{key} is required")
    values = {}
    for key in ("source_node_id", "destination_node_id"):
        values[key] = _int(data.get(key, getattr(current, key, None)), key)
    if values["source_node_id"] == values["destination_node_id"]: raise ValidationError("source_node_id and destination_node_id cannot be the same")
    for key in ("source_node_id", "destination_node_id"):
        if not RouteNode.query.get(values[key]): return (f"{'Source' if key == 'source_node_id' else 'Destination'} route node not found", 404)
    values["path_type"] = _text(data.get("path_type", getattr(current, "path_type", None)), "path_type", True, 50)
    values["distance_m"] = _number(data.get("distance_m", getattr(current, "distance_m", None)), "distance_m", positive=True)
    values["estimated_minutes"] = _number(data.get("estimated_minutes", getattr(current, "estimated_minutes", None)), "estimated_minutes", positive=True)
    values["name"] = _text(data.get("name", getattr(current, "name", "Unnamed Pathway")), "name", True)
    values["status"] = _status(data.get("status", getattr(current, "status", "active")))
    values["direction"] = _enum(data.get("direction", getattr(current, "direction", "Unknown")), "direction", DIRECTIONS)
    shade = data.get("shade", getattr(current, "shade", "Unshaded"))
    if "shaded" in data and "shade" not in data:
        if not isinstance(data["shaded"], bool): raise ValidationError("shaded must be a boolean")
        shade = "Fully Shaded" if data["shaded"] else "Unshaded"
    values["shade"] = _enum(shade, "shade", SHADES)
    values["surface_type"] = _text(data["surface_type"], "surface_type", False, 50) if "surface_type" in data else getattr(current, "surface_type", None)
    values["allowed_modes"] = _modes({**data, "path_type": values["path_type"]}, tuple(x.mode for x in getattr(current, "allowed_modes", [])) or ("Walking",))
    if "path_points" in data:
        values["path_points"] = _points(data["path_points"])
        if isinstance(values["path_points"], tuple): return values["path_points"]
    return values
def _apply_pathway(record, values):
    points = values.pop("path_points", None); modes = values.pop("allowed_modes")
    for key, value in values.items(): setattr(record, key, value)
    record.shaded = record.shade in {"Fully Shaded", "Mostly Shaded", "Partial Shade"}; _modes_on(record, modes)
    return points
@route_node_bp.route("/pathways", methods=["POST"])
def create_pathway():
    if (error := _guard()): return error
    try:
        values = _pathway_values(_body())
        if isinstance(values, tuple): return _error(*values)
        record = Pathway(source_node_id=values["source_node_id"], destination_node_id=values["destination_node_id"], path_type=values["path_type"], distance_m=values["distance_m"], estimated_minutes=values["estimated_minutes"])
        points = _apply_pathway(record, values); db.session.add(record); db.session.flush()
        if points is not None: _replace_points(record, points)
        log_audit("Admin", None, "create", "Pathway", record.pathway_id, record.name); db.session.commit()
        return jsonify(success=True, message="Pathway created successfully", pathway=record.to_dict()), 201
    except ValidationError as error: return _error(str(error))
    except Exception as error: db.session.rollback(); return jsonify(success=False, message="Could not create pathway", error=str(error)), 500
@route_node_bp.route("/pathways/<int:pathway_id>", methods=["PUT"])
def update_pathway(pathway_id):
    if (error := _guard()): return error
    try:
        record = Pathway.query.get(pathway_id)
        if not record: return _error("Pathway not found", 404)
        values = _pathway_values(_body(), record)
        if isinstance(values, tuple): return _error(*values)
        points = _apply_pathway(record, values)
        if points is not None: _replace_points(record, points)
        log_audit("Admin", None, "update", "Pathway", pathway_id, record.name); db.session.commit()
        return jsonify(success=True, message="Pathway updated successfully", pathway=record.to_dict())
    except ValidationError as error: return _error(str(error))
    except Exception as error: db.session.rollback(); return jsonify(success=False, message="Could not update pathway", error=str(error)), 500
@route_node_bp.route("/pathways/<int:pathway_id>", methods=["DELETE"])
def delete_pathway(pathway_id):
    if (error := _guard()): return error
    try:
        record = Pathway.query.get(pathway_id)
        if not record: return _error("Pathway not found", 404)
        db.session.delete(record); log_audit("Admin", None, "delete", "Pathway", pathway_id, f"{record.name}; path points cascade deleted"); db.session.commit()
        return jsonify(success=True, message="Pathway deleted successfully")
    except Exception as error: db.session.rollback(); return jsonify(success=False, message="Could not delete pathway", error=str(error)), 500


@route_node_bp.route("/path-points", methods=["GET"])
def get_path_points():
    try:
        records = PathPoint.query.order_by(PathPoint.pathway_id.asc(), PathPoint.sequence_no.asc()).all()
        return jsonify(success=True, count=len(records), path_points=[record.to_dict() for record in records])
    except Exception as error: return jsonify(success=False, message="Could not retrieve path points", error=str(error)), 500
@route_node_bp.route("/path-points/<int:point_id>", methods=["GET"])
def get_path_point(point_id):
    try:
        record = PathPoint.query.get(point_id)
        return _error("Path point not found", 404) if not record else (jsonify(success=True, path_point=record.to_dict()), 200)
    except Exception as error: return jsonify(success=False, message="Could not retrieve path point", error=str(error)), 500
def _point_values(data, current=None):
    for key in ("pathway_id", "sequence_no", "latitude", "longitude", "node_type"):
        if current is None and key not in data: raise ValidationError("latitude and longitude are required" if key in {"latitude", "longitude"} else f"{key} is required")
    values = {"pathway_id": _int(data.get("pathway_id", getattr(current, "pathway_id", None)), "pathway_id"), "sequence_no": _int(data.get("sequence_no", getattr(current, "sequence_no", None)), "sequence_no")}
    if not Pathway.query.get(values["pathway_id"]): return ("Pathway not found", 404)
    if _sequence_conflict(values["pathway_id"], values["sequence_no"], current):
        raise ValidationError("sequence_no is already used by another path point in this pathway")
    values.update(latitude=_number(data.get("latitude", getattr(current, "latitude", None)), "latitude", -90, 90), longitude=_number(data.get("longitude", getattr(current, "longitude", None)), "longitude", -180, 180), node_type=_text(data.get("node_type", getattr(current, "node_type", None)), "node_type", True, 50), status=_status(data.get("status", getattr(current, "status", "active"))))
    values["building_id"] = _int(data.get("building_id", getattr(current, "building_id", None)), "building_id", True)
    if (error := _building(values["building_id"])): return error
    return values
def _point_write(point_id=None):
    if (error := _guard()): return error
    try:
        record = PathPoint.query.get(point_id) if point_id is not None else None
        if point_id is not None and not record: return _error("Path point not found", 404)
        values = _point_values(_body(), record)
        if isinstance(values, tuple): return _error(*values)
        if record is None: record = PathPoint(**values); db.session.add(record); db.session.flush(); action, code = "create", 201
        else:
            for key, value in values.items(): setattr(record, key, value)
            action, code = "update", 200
        log_audit("Admin", None, action, "Path Point", record.point_id, record.node_type); db.session.commit()
        return jsonify(success=True, message=f"Path point {action}d successfully", path_point=record.to_dict()), code
    except ValidationError as error: return _error(str(error))
    except Exception as error: db.session.rollback(); return jsonify(success=False, message=f"Could not {'update' if point_id else 'create'} path point", error=str(error)), 500
@route_node_bp.route("/path-points", methods=["POST"])
def create_path_point(): return _point_write()
@route_node_bp.route("/path-points/<int:point_id>", methods=["PUT"])
def update_path_point(point_id): return _point_write(point_id)
@route_node_bp.route("/path-points/<int:point_id>", methods=["DELETE"])
def delete_path_point(point_id):
    if (error := _guard()): return error
    try:
        record = PathPoint.query.get(point_id)
        if not record: return _error("Path point not found", 404)
        db.session.delete(record); log_audit("Admin", None, "delete", "Path Point", point_id, record.node_type); db.session.commit()
        return jsonify(success=True, message="Path point deleted successfully")
    except Exception as error: db.session.rollback(); return jsonify(success=False, message="Could not delete path point", error=str(error)), 500
