import logging
from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request

from auth import admin_required
from model.audit_log import AuditLog
from model.building import Building
from model.location import LOCATION_TYPE_IDS, Location
from model.pathway import Pathway
from services.search_analytics import summarize_user_searches

dashboard_bp = Blueprint("dashboard", __name__, url_prefix="/api/dashboard")
logger = logging.getLogger(__name__)

# "all" has no comparison baseline, so buildingChange is omitted for it.
RANGES = {"week": 7, "month": 30, "all": None}


def _as_utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _building_change(days):
    if days is None:
        return None
    start = datetime.now(timezone.utc) - timedelta(days=days)
    records = AuditLog.query.filter(
        AuditLog.target == "Building",
        AuditLog.action.in_(("create", "delete")),
    ).all()
    return sum(
        (1 if record.action == "create" else -1)
        for record in records
        if _as_utc(record.created_at) >= start
    )


@dashboard_bp.get("")
def dashboard_summary():
    _, error = admin_required()
    if error:
        return error

    range_key = request.args.get("range", "week")
    if range_key not in RANGES:
        return jsonify({"success": False, "message": "Invalid range."}), 400

    try:
        buildings = Building.query.count()
        offices = Location.query.filter_by(type_id=LOCATION_TYPE_IDS["Office"]).count()
        pathways = Pathway.query.filter_by(status="active").count()
        recent = AuditLog.query.order_by(AuditLog.created_at.desc()).limit(3).all()
        search_analytics = summarize_user_searches(RANGES[range_key])

        return jsonify({
            "success": True,
            "data": {
                "buildings": buildings,
                "buildingChange": _building_change(RANGES[range_key]),
                "offices": offices,
                "locations": buildings + Location.query.count(),
                "pathways": pathways,
                **search_analytics,
                "recent": [record.to_dict() for record in recent],
            },
        }), 200
    except Exception:
        logger.exception("Failed to load dashboard summary")
        return jsonify({"success": False, "message": "Failed to load dashboard summary."}), 500
