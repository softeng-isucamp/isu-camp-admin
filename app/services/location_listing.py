"""Shared projection, filtering, ordering, and pagination for Locations lists."""


DEFAULT_PAGE = 1
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 100


def _bounded_int(value, default, minimum, maximum=None):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default

    parsed = max(parsed, minimum)
    return min(parsed, maximum) if maximum is not None else parsed


def _params_value(params, name, default=""):
    value = params.get(name, default)
    return default if value is None else value


def _matches(dto, query, type_filter, status_filter, building_id_filter, floor_filter):
    searchable = " ".join(
        str(dto.get(field) or "")
        for field in (
            "name",
            "code",
            "type",
            "building",
            "floor",
            "function",
            "keywords",
        )
    ).lower()

    if query and query not in searchable:
        return False
    if type_filter and dto["type"] != type_filter:
        return False
    if status_filter and dto["status"] != status_filter:
        return False
    if building_id_filter and building_id_filter not in {
        str(dto.get("parentId") or ""),
        str(dto["id"]) if dto["type"] in {"Building", "Facility"} else "",
    }:
        return False
    if floor_filter and str(dto.get("floor") or "").lower() != floor_filter:
        return False
    return True


def _ordering_key(dto):
    """Keep each building immediately ahead of its direct indoor records."""

    parent_id = dto.get("parentId")
    family_id = int(parent_id) if parent_id is not None else int(dto["id"])
    is_parent = dto["type"] in {"Building", "Facility"} and parent_id is None
    return family_id, 0 if is_parent else 1, int(dto["id"])


def list_location_page(
    records,
    buildings,
    floors,
    params,
    project_location,
    project_building,
):
    """Return the canonical flat Locations page response.

    Filters apply to the full projected set before pagination. ``total`` is
    the number of matching flat records, and ``page``/``pageSize`` describe
    the requested offset window. Ordering is stable across requests: each
    building is followed by its children, with IDs breaking all ties.
    """

    query = str(_params_value(params, "q")).strip().lower()
    type_filter = str(_params_value(params, "type")).strip()
    status_filter = str(_params_value(params, "status")).strip()
    building_id_filter = str(_params_value(params, "buildingId")).strip()
    floor_filter = str(_params_value(params, "floor")).strip().lower()
    page = _bounded_int(_params_value(params, "page", DEFAULT_PAGE), DEFAULT_PAGE, 1)
    page_size = _bounded_int(
        _params_value(params, "pageSize", DEFAULT_PAGE_SIZE),
        DEFAULT_PAGE_SIZE,
        1,
        MAX_PAGE_SIZE,
    )

    projected = [
        project_building(building)
        for building in buildings
    ]
    projected.extend(
        project_location(record, buildings, floors)
        for record in records
    )
    projected = [
        dto
        for dto in projected
        if _matches(
            dto,
            query,
            type_filter,
            status_filter,
            building_id_filter,
            floor_filter,
        )
    ]
    projected.sort(key=_ordering_key)

    start = (page - 1) * page_size
    return {
        "success": True,
        "items": projected[start:start + page_size],
        "total": len(projected),
        "page": page,
        "pageSize": page_size,
    }
