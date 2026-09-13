from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request

from auth import admin_required
from model.app_user import AppUser, UserInfo

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
    if created_range not in RANGES:
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
    created_start = _range_start(created_range)
    escaped_query = query.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")

    records_query = AppUser.query.outerjoin(
        UserInfo,
        AppUser.info_id == UserInfo.id,
    )
    if query:
        records_query = records_query.filter(
            AppUser.username.ilike(f"%{escaped_query}%", escape="\\")
        )
    if created_start is not None:
        records_query = records_query.filter(UserInfo.created_at >= created_start)

    total = records_query.count()
    start = (page - 1) * page_size
    records = (
        records_query
        .order_by(UserInfo.created_at.desc().nullslast(), AppUser.id.asc())
        .offset(start)
        .limit(page_size)
        .all()
    )

    return jsonify({"items": [record.to_dict() for record in records], "total": total, "page": page, "pageSize": page_size}), 200
