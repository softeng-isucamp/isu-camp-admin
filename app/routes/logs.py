from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request

from auth import admin_required
from model.app_user import AppUser
from model.audit_log import AuditLog
from model.building import Building
from model.location import Location
from model.user_history import UserHistory

logs_bp = Blueprint("logs", __name__, url_prefix="/api/logs")
RANGES = {"all": None, "today": 0, "7d": 7, "30d": 30, "90d": 90}
CATEGORIES = {"All", "Admin", "User", "System"}


def _error(message):
    return jsonify({"success": False, "message": message}), 400


@logs_bp.get("")
def list_logs():
    _, auth_error = admin_required()
    if auth_error:
        return auth_error
    category = request.args.get("category", "All")
    date_range = request.args.get("date_range", "all")
    target_id = request.args.get("target_id", "").strip()
    if category not in CATEGORIES or date_range not in RANGES:
        return _error("Invalid category or date range.")
    try:
        page, page_size = int(request.args.get("page", "1")), int(request.args.get("pageSize", "20"))
        if page < 1 or not 1 <= page_size <= 100:
            raise ValueError
    except (TypeError, ValueError):
        return _error("page must be at least 1 and pageSize must be between 1 and 100.")

    now = datetime.now(timezone.utc)
    days = RANGES[date_range]
    start_date = now.replace(hour=0, minute=0, second=0, microsecond=0) if days == 0 else (now - timedelta(days=days) if days is not None else None)
    query = request.args.get("q", "").strip().lower()
    actor = request.args.get("actor", "").strip().lower()
    records = AuditLog.query.order_by(AuditLog.created_at.desc()).all()
    audit_records = [record.to_dict() for record in records]
    if category in ("All", "User"):
        user_records = _user_activity_records()
        audit_records = user_records if category == "User" else audit_records + user_records
    records = [record for record in audit_records if (not target_id or record["targetId"] == target_id) and (category == "All" or record["category"] == category) and (not actor or (record["actor"] or "").lower() == actor) and (not query or any(query in (record[key] or "").lower() for key in ("action", "actor", "target", "detail"))) and (start_date is None or _as_utc(datetime.fromisoformat(record["createdAt"])) >= start_date)]
    records.sort(key=lambda record: record["createdAt"], reverse=True)
    start = (page - 1) * page_size
    return jsonify({"items": records[start:start + page_size], "total": len(records), "page": page, "pageSize": page_size}), 200


def _user_activity_records():
    """Project User App destination selections into the audit-log contract."""
    projected = []
    for history in UserHistory.query.all():
        user = AppUser.query.get(history.user_id) if history.user_id is not None else None
        location = Location.query.get(history.location_id) if history.location_id is not None else None
        building = Building.query.get(history.building_id) if history.building_id is not None else None
        target = location.location_name if location is not None else (building.building_name if building is not None else "Unknown destination")
        target_id = history.location_id if history.location_id is not None else history.building_id
        target_type = "Location" if location is not None else "Building"
        projected.append({
            "id": f"user-history-{history.id}",
            "createdAt": history.created_at.isoformat(),
            "category": "User",
            "actor": user.username if user is not None else f"user:{history.user_id}",
            "action": f"Searched {target_type}",
            "target": target,
            "targetId": str(target_id) if target_id is not None else None,
            "detail": "Destination selected in the User App",
        })
    return projected


def _as_utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
