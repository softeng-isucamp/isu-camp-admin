import logging
from datetime import timezone

from flask import Blueprint, jsonify, request

from auth import admin_required
from extensions import db
from model.audit_log import AuditLog
from model.building import Building
from model.app_user import USER_TYPES, AppUser, UserInfo, normalize_user_type
from model.location import LOCATION_TYPE_IDS, Location
from model.pathway import Pathway
from services.dashboard_analytics import RANGE_DAYS, search_window, summarize_dashboard_analytics
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
    start, _ = search_window(days)
    records = AuditLog.query.filter(
        AuditLog.target == "Building",
        AuditLog.action.in_(("create", "delete")),
    ).all()
    return sum(
        (1 if record.action == "create" else -1)
        for record in records
        if _as_utc(record.created_at) >= start
    )


def _users_by_type():
    """All-time account count per type, keyed by every type the admin reports."""
    counts = {name: 0 for name in USER_TYPES}
    stored_counts = (
        db.session.query(UserInfo.user_type, db.func.count(AppUser.id))
        .select_from(AppUser)
        .outerjoin(UserInfo, AppUser.info_id == UserInfo.id)
        .group_by(UserInfo.user_type)
        .all()
    )
    # The database groups the stored spellings, which the admin then folds into
    # its own names - "Staff" and "teacher" land in the same bucket. An account
    # with no type, or one nothing recognizes, is left out rather than guessed
    # at, so the split can add up to less than the users total.
    for stored, total in stored_counts:
        name = normalize_user_type(stored)
        if name is not None:
            counts[name] += total
    return counts


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
        indoor_locations = Location.query.filter(
            Location.type_id.in_(LOCATION_TYPE_IDS.values())
        ).count()
        users = AppUser.query.count()
        pathways = Pathway.query.filter_by(status="active").count()
        recent = AuditLog.query.order_by(AuditLog.created_at.desc()).limit(3).all()
        search_analytics = summarize_user_searches(RANGES[range_key])

        return jsonify({
            "success": True,
            "data": {
                "buildings": buildings,
                "buildingChange": _building_change(RANGES[range_key]),
                "indoorLocations": indoor_locations,
                "users": users,
                "usersByType": _users_by_type(),
                "locations": buildings + Location.query.count(),
                "pathways": pathways,
                **search_analytics,
                "recent": [record.to_dict() for record in recent],
            },
        }), 200
    except Exception:
        logger.exception("Failed to load dashboard summary")
        return jsonify({"success": False, "message": "Failed to load dashboard summary."}), 500


@dashboard_bp.get("/analytics")
def dashboard_analytics():
    """Serves the Analytics tab: Searches, Visits, registrations, completeness.

    Shares the range vocabulary with the summary above, and reports a Visit
    count of zero everywhere because no arrival event is recorded yet - see
    ``services.dashboard_analytics``.
    """

    _, error = admin_required()
    if error:
        return error

    range_key = request.args.get("range", "week")
    if range_key not in RANGE_DAYS:
        return jsonify({"success": False, "message": "Invalid range."}), 400

    try:
        return jsonify({"success": True, "data": summarize_dashboard_analytics(range_key)}), 200
    except Exception:
        logger.exception("Failed to load dashboard analytics")
        return jsonify({"success": False, "message": "Failed to load dashboard analytics."}), 500
