from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request

from auth import admin_required
from extensions import db
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
    """Project User App destination selections into the audit-log contract.

    A fixed number of statements however long the history is: the history,
    then one ``IN (...)`` lookup each for the users, locations and buildings it
    names. Only the names are selected, which also keeps out the per-row
    columns the full models carry, such as a location's cover-photo EXISTS.
    """
    histories = UserHistory.query.all()
    usernames = _names_by_id(AppUser.id, AppUser.username, (h.user_id for h in histories))
    location_names = _names_by_id(Location.location_id, Location.location_name, (h.location_id for h in histories))
    building_names = _names_by_id(Building.building_id, Building.building_name, (h.building_id for h in histories))

    projected = []
    for history in histories:
        location_name = location_names.get(history.location_id)
        building_name = building_names.get(history.building_id)
        target = location_name if location_name is not None else (building_name if building_name is not None else "Unknown destination")
        target_id = history.location_id if history.location_id is not None else history.building_id
        target_type = "Location" if location_name is not None else "Building"
        username = usernames.get(history.user_id)
        projected.append({
            "id": f"user-history-{history.id}",
            "createdAt": history.created_at.isoformat(),
            "category": "User",
            "actor": username if username is not None else f"user:{history.user_id}",
            "action": f"Searched {target_type}",
            "target": target,
            "targetId": str(target_id) if target_id is not None else None,
            "detail": "Destination selected in the User App",
        })
    return projected


def _names_by_id(id_column, name_column, ids):
    """``{id: name}`` for the given ids, from one query, or no query for none."""
    wanted = {identifier for identifier in ids if identifier is not None}
    if not wanted:
        return {}
    rows = db.session.query(id_column, name_column).filter(id_column.in_(wanted)).all()
    return {identifier: name for identifier, name in rows}


def _as_utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
