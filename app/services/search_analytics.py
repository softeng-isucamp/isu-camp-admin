from datetime import datetime, timedelta, timezone

from sqlalchemy import func

from extensions import db
from model.building import Building
from model.location import LOCATION_TYPE_NAMES, Location
from model.user_history import UserHistory


def summarize_user_searches(days, limit=5):
    """Return ranked User App destination selections for a rolling window."""

    cutoff = (
        datetime.now(timezone.utc) - timedelta(days=days)
        if days is not None
        else None
    )

    location_query = (
        db.session.query(
            UserHistory.location_id.label("target_id"),
            Location.location_name.label("name"),
            Location.type_id.label("location_type_id"),
            Building.building_name.label("context"),
            func.count(UserHistory.id).label("search_count"),
        )
        .join(Location, Location.location_id == UserHistory.location_id)
        .outerjoin(Building, Building.building_id == UserHistory.building_id)
        .filter(UserHistory.location_id.isnot(None))
    )
    building_query = (
        db.session.query(
            UserHistory.building_id.label("target_id"),
            Building.building_name.label("name"),
            Building.classification.label("context"),
            func.count(UserHistory.id).label("search_count"),
        )
        .join(Building, Building.building_id == UserHistory.building_id)
        .filter(
            UserHistory.location_id.is_(None),
            UserHistory.building_id.isnot(None),
        )
    )

    if cutoff is not None:
        location_query = location_query.filter(UserHistory.created_at >= cutoff)
        building_query = building_query.filter(UserHistory.created_at >= cutoff)

    location_rows = location_query.group_by(
        UserHistory.location_id,
        Location.location_name,
        Location.type_id,
        Building.building_name,
    ).all()
    building_rows = building_query.group_by(
        UserHistory.building_id,
        Building.building_name,
        Building.classification,
    ).all()

    ranked = [
        {
            "locationId": f"{LOCATION_TYPE_NAMES.get(row.location_type_id, 'Location')}:{row.target_id}",
            "name": row.name,
            "context": row.context or "Indoor Location",
            "searches": int(row.search_count),
        }
        for row in location_rows
    ]
    ranked.extend(
        {
            "locationId": f"{row.context or 'Building'}:{row.target_id}",
            "name": row.name,
            "context": row.context or "Building",
            "searches": int(row.search_count),
        }
        for row in building_rows
    )
    ranked.sort(
        key=lambda row: (
            -row["searches"],
            row["name"].casefold(),
            row["locationId"],
        )
    )

    return {
        "searches": sum(row["searches"] for row in ranked),
        "topSearched": [
            {"rank": str(index), **row}
            for index, row in enumerate(ranked[:limit], start=1)
        ],
    }
