from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request

from auth import admin_required
from model.audit_log import AuditLog

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
    records = [record for record in records if (category == "All" or record.category == category) and (not actor or (record.actor or "").lower() == actor) and (not query or any(query in (value or "").lower() for value in (record.action, record.actor, record.target, record.detail))) and (start_date is None or _as_utc(record.created_at) >= start_date)]
    start = (page - 1) * page_size
    return jsonify({"items": [record.to_dict() for record in records[start:start + page_size]], "total": len(records), "page": page, "pageSize": page_size}), 200


def _as_utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
