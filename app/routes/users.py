from datetime import datetime, timedelta, timezone

from flask import Blueprint, jsonify, request

from auth import admin_required
from extensions import db
from model.app_user import (
    USER_TYPES,
    AppUser,
    UserInfo,
    stored_user_type_aliases,
)

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

    # Absent means "every account type", so only a supplied value is checked.
    user_type = request.args.get("user_type")
    if user_type is not None and user_type not in USER_TYPES:
        return _error("Invalid account type.")

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
    if user_type is not None:
        # Match on the normalized value, so a "teacher" filter also finds the
        # accounts the User App stored as "Staff".
        records_query = records_query.filter(
            db.func.lower(db.func.trim(UserInfo.user_type)).in_(
                stored_user_type_aliases(user_type)
            )
        )

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
