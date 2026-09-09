from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request

from auth import admin_required
from model.app_user import AppUser

users_bp = Blueprint("users", __name__, url_prefix="/api/users")
RANGES = {"all": None, "7d": 7, "30d": 30, "90d": 90}


def _range_start(value):
    days = RANGES.get(value)
    return None if days is None else datetime.now(timezone.utc) - timedelta(days=days)


def _error(message):
    return jsonify({"success": False, "message": message}), 400


@users_bp.get("")
def list_users():
    _, auth_error = admin_required()
    if auth_error:
        return auth_error

    created_range = request.args.get("created_range", "all")
    sign_in_range = request.args.get("sign_in_range", "all")
    if created_range not in RANGES or sign_in_range not in RANGES:
        return _error("Invalid date range.")

    try:
        page = request.args.get("page", "1")
        page_size = request.args.get("pageSize", "20")
        page, page_size = int(page), int(page_size)
        if page < 1 or not 1 <= page_size <= 100:
            raise ValueError
    except (TypeError, ValueError):
        return _error("page must be at least 1 and pageSize must be between 1 and 100.")

    query = request.args.get("q", "").strip().lower()
    created_start, sign_in_start = _range_start(created_range), _range_start(sign_in_range)
    records = AppUser.query.order_by(AppUser.id.asc()).all()
    records = [record for record in records if (
        not query or query in (record.username or "").lower()
    ) and (created_start is None or _as_utc(record.created_at) >= created_start) and (
        sign_in_start is None or (record.last_sign_in_at is not None and _as_utc(record.last_sign_in_at) >= sign_in_start)
    )]
    start = (page - 1) * page_size
    return jsonify({"items": [record.to_dict() for record in records[start:start + page_size]], "total": len(records), "page": page, "pageSize": page_size}), 200


def _as_utc(value):
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
