"""Aggregates for ``GET /api/dashboard/decision-analytics``.

Serves the Analytics page. The response shape is the frontend's
``DecisionAnalytics`` (``frontend/admin/src/types.ts``), validated there by a
Zod schema, and every number is read from tables that already exist:

- **readiness** - active Places, their cover photos, text fields, pins,
  entrance nodes and indoor Locations. A snapshot, not range-dependent.
- **reach** and **closures** - the route graph (``route_node``, ``pathway``,
  ``pathway_allowed_mode``, ``path_point``), read with the User App router's
  rules (``isu-camp-app/server/app/utils/routing.py``) so the admin reports the
  routes users actually get: active records only, one-way pathways stay
  one-way, a pathway only carries the modes it allows ("Vehicle" covers every
  wheeled mode), a Place is reached at one of its entrance nodes, and the
  origin is the one node named like the main gate. Not range-dependent.
- **searches** - ``UserHistory`` rows in the range, split by account type and
  destination type with the same rules as ``services.dashboard_analytics``.

Place references carry the Place's id as the directory's DTO spells it
(``str(building_id)``) so a chart mark can open exactly those records. No app
user is identified: account type is aggregated only.
"""

import heapq
import math
import re
from datetime import datetime, timezone

from extensions import db
from model.app_user import USER_TYPES, AppUser, UserInfo, normalize_user_type
from model.building import Building
from model.location import LOCATION_TYPE_IDS, Location
from model.path_point import PathPoint
from model.pathway import Pathway
from model.pathway_allowed_mode import PathwayAllowedMode
from model.route_node import RouteNode
from services.dashboard_analytics import (
    DESTINATION_TYPES,
    MINIMUM_POLYGON_POINTS,
    _destination_names,
    _destination_of,
    _has_text,
    _history_rows,
    _period,
    manila_day,
)

READINESS_CHECKS = (
    ("photo", "Photo"),
    ("description", "Description"),
    ("keywords", "Search keywords"),
    ("pin", "Map pin"),
    ("entrance", "Entrance linked"),
    ("rooms", "Indoor rooms"),
)

# The User App's modes, in the order the chart lists them, with its labels.
TRAVEL_MODES = (
    ("walking", "Walking"),
    ("bicycle", "Bicycle"),
    ("motorcycle", "Motorcycle"),
    ("car", "Car"),
)

# Mirrors routing.MODE_ALIASES: what a stored allowed-mode string means.
MODE_ALIASES = {
    "walking": "walking", "walk": "walking", "pedestrian": "walking",
    "car": "car", "motorcycle": "motorcycle", "motorbike": "motorcycle",
    "motor": "motorcycle", "bicycle": "bicycle", "bike": "bicycle",
    "cycling": "bicycle", "vehicle": "vehicle",
}

# The node names the User App accepts as its "Main gate" origin.
MAIN_GATE_NAMES = ("gate", "main gate", "isu main gate")

# Closure impact is measured on foot: it is the mode every Place should be
# reachable in, and the one a closed walkway actually strands people in.
CLOSURE_MODE = "walking"

# A detour shorter than this is rounding, not a longer trip.
LONGER_TRIP_METERS = 10

CLOSURE_LIMIT = 5


def _allows(stored, mode):
    label = MODE_ALIASES.get(str(stored or "").strip().lower())
    return label == mode or (label == "vehicle" and mode in ("car", "motorcycle", "bicycle"))


def _meters(a, b):
    lat1, lat2 = math.radians(a[0]), math.radians(b[0])
    dlat, dlng = lat2 - lat1, math.radians(b[1] - a[1])
    h = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlng / 2) ** 2
    return 6371000 * 2 * math.asin(min(1, math.sqrt(h)))


def _position(latitude, longitude):
    try:
        lat, lng = float(latitude), float(longitude)
    except (TypeError, ValueError):
        return None
    if not (math.isfinite(lat) and math.isfinite(lng)):
        return None
    return lat, lng


def _is_active(status):
    return str(status or "").strip().lower() == "active"


class RouteGraph:
    """The campus route graph as the User App sees it.

    ``edges`` holds every routable pathway once; ``adjacency(mode)`` turns them
    into directed edges for one travel mode.
    """

    def __init__(self):
        self.nodes = {}
        for node in RouteNode.query.all():
            if not _is_active(node.status):
                continue
            position = _position(node.latitude, node.longitude)
            if position is not None:
                self.nodes[node.node_id] = node

        modes = {}
        for row in PathwayAllowedMode.query.all():
            modes.setdefault(row.pathway_id, set()).add(row.mode)

        shapes = {}
        for point in PathPoint.query.all():
            if not _is_active(point.status):
                continue
            position = _position(point.latitude, point.longitude)
            if position is not None:
                shapes.setdefault(point.pathway_id, []).append((point.sequence_no, position))

        self.edges = []
        for pathway in Pathway.query.all():
            direction = re.sub(r"[\s_-]+", "", str(pathway.direction or "").strip().lower())
            source, target = pathway.source_node_id, pathway.destination_node_id
            if (not _is_active(pathway.status) or direction not in ("oneway", "twoway")
                    or source not in self.nodes or target not in self.nodes):
                continue
            length = self._length(source, target, shapes.get(pathway.pathway_id, []))
            if length <= 0:
                continue
            self.edges.append({
                "id": pathway.pathway_id,
                "name": (pathway.name or "").strip() or "Unnamed pathway",
                "source": source,
                "target": target,
                "twoWay": direction == "twoway",
                "length": length,
                "modes": modes.get(pathway.pathway_id, set()),
            })

        # A Place's entrances: active entrance nodes that some routable
        # pathway touches. One left floating is not a way in.
        touched = {edge["source"] for edge in self.edges} | {edge["target"] for edge in self.edges}
        self.entrances = {}
        for node_id, node in self.nodes.items():
            if (node.building_id is not None and node_id in touched
                    and str(node.node_type or "").strip().lower() == "entrance"):
                self.entrances.setdefault(node.building_id, set()).add(node_id)

        gates = [
            node_id for node_id, node in self.nodes.items()
            if str(node.name or "").strip().lower() in MAIN_GATE_NAMES
        ]
        # The User App refuses to route from an ambiguous gate, so this does too.
        self.gate = self.nodes[gates[0]] if len(gates) == 1 else None

    def _length(self, source, target, shape):
        start = _position(self.nodes[source].latitude, self.nodes[source].longitude)
        end = _position(self.nodes[target].latitude, self.nodes[target].longitude)
        points = [position for _, position in sorted(shape, key=lambda item: item[0])]
        if points and _meters(start, points[-1]) + _meters(end, points[0]) < _meters(start, points[0]) + _meters(end, points[-1]):
            points.reverse()
        geometry = []
        for position in (start, *points, end):
            if not geometry or position != geometry[-1]:
                geometry.append(position)
        return sum(_meters(a, b) for a, b in zip(geometry, geometry[1:]))

    def adjacency(self, mode):
        graph = {}
        for edge in self.edges:
            if not any(_allows(stored, mode) for stored in edge["modes"]):
                continue
            graph.setdefault(edge["source"], []).append((edge["target"], edge["length"], edge["id"]))
            if edge["twoWay"]:
                graph.setdefault(edge["target"], []).append((edge["source"], edge["length"], edge["id"]))
        return graph


def _shortest(graph, start, closed=None):
    """Dijkstra from ``start``: ``(distance, via)`` per reached node.

    ``via`` is the pathway each node was last reached along, which is what
    makes a pathway part of someone's shortest route. ``closed`` skips one
    pathway in both directions.
    """

    distance = {start: 0.0}
    via = {}
    queue = [(0.0, start)]
    while queue:
        cost, node = heapq.heappop(queue)
        if cost != distance[node]:
            continue
        for target, length, pathway_id in graph.get(node, ()):
            if pathway_id == closed:
                continue
            updated = cost + length
            if updated < distance.get(target, math.inf):
                distance[target] = updated
                via[target] = pathway_id
                heapq.heappush(queue, (updated, target))
    return distance, via


def _place_distances(distance, entrances):
    """The shortest distance to each Place, measured to its nearest entrance."""

    result = {}
    for place_id, nodes in entrances.items():
        reached = [distance[node] for node in nodes if node in distance]
        if reached:
            result[place_id] = min(reached)
    return result


def _ref(place):
    return {"id": str(place.building_id), "name": place.building_name}


def _active_places():
    return Building.query.filter(Building.status == "active").order_by(Building.building_name).all()


def _readiness(places, graph):
    with_rooms = {
        building_id
        for (building_id,) in db.session.query(Location.building_id)
        .filter(
            Location.status == "active",
            Location.type_id.in_(LOCATION_TYPE_IDS.values()),
            Location.building_id.isnot(None),
        )
        .distinct()
        .all()
    }

    missing = {key: [] for key, _ in READINESS_CHECKS}
    applies = {key: 0 for key, _ in READINESS_CHECKS}
    fully_ready = 0

    for place in places:
        footprint = place.polygon_coordinates
        enclosed = isinstance(footprint, list) and len(footprint) >= MINIMUM_POLYGON_POINTS
        pinned = place.latitude is not None and place.longitude is not None
        holds_rooms = place.can_contain_locations
        passed = {
            "photo": place.has_photo(),
            "description": _has_text(place.description),
            "keywords": _has_text(place.keywords),
            "pin": pinned or enclosed,
            "entrance": place.building_id in graph.entrances,
            # Only Places that may hold indoor Locations are asked to have one.
            "rooms": place.building_id in with_rooms if holds_rooms else None,
        }
        ready = True
        for key, ok in passed.items():
            if ok is None:
                continue
            applies[key] += 1
            if not ok:
                missing[key].append(_ref(place))
                ready = False
        if ready:
            fully_ready += 1

    return {
        "total": len(places),
        "fullyReady": fully_ready,
        "checks": [
            {
                "key": key,
                "label": label,
                "complete": applies[key] - len(missing[key]),
                "total": applies[key],
                "missing": missing[key],
            }
            for key, label in READINESS_CHECKS
        ],
    }


def _reach(places, graph):
    """Routable Places each travel mode reaches from the main gate.

    Null when the main gate is missing or ambiguous, the same case in which
    the User App cannot route from it.
    """

    if graph.gate is None:
        return None
    routable = [place for place in places if place.building_id in graph.entrances]
    modes = []
    for mode, label in TRAVEL_MODES:
        distance, _ = _shortest(graph.adjacency(mode), graph.gate.node_id)
        reached = _place_distances(distance, graph.entrances)
        modes.append({
            "mode": label,
            "reachable": sum(1 for place in routable if place.building_id in reached),
            "unreachable": [_ref(place) for place in routable if place.building_id not in reached],
        })
    return {"origin": (graph.gate.name or "Main gate").strip(), "total": len(routable), "modes": modes}


def _closures(places, graph):
    """What closing each pathway would do to walks from the main gate.

    Only a pathway on some Place's shortest walk can change anything, so only
    those are re-solved: closing any other leaves every distance as it was.
    """

    if graph.gate is None:
        return []
    by_id = {place.building_id: place for place in places}
    walking = graph.adjacency(CLOSURE_MODE)
    distance, via = _shortest(walking, graph.gate.node_id)
    baseline = _place_distances(distance, graph.entrances)
    baseline = {place_id: meters for place_id, meters in baseline.items() if place_id in by_id}

    names = {edge["id"]: edge["name"] for edge in graph.edges}
    impacts = []
    for pathway_id in sorted(set(via.values())):
        closed, _ = _shortest(walking, graph.gate.node_id, closed=pathway_id)
        after = _place_distances(closed, graph.entrances)
        cut_off = [by_id[place_id] for place_id in baseline if place_id not in after]
        longer = sum(
            1 for place_id, meters in baseline.items()
            if place_id in after and after[place_id] - meters > LONGER_TRIP_METERS
        )
        if cut_off or longer:
            impacts.append({
                "id": str(pathway_id),
                "pathway": names[pathway_id],
                "cutOff": [_ref(place) for place in sorted(cut_off, key=lambda p: p.building_name.casefold())],
                "longerTrip": longer,
            })

    impacts.sort(key=lambda row: (-len(row["cutOff"]), -row["longerTrip"], row["pathway"].casefold(), row["id"]))
    top = impacts[:CLOSURE_LIMIT]

    # The chart labels its rows by name, so two "Unnamed pathway"s must differ.
    counts = {}
    for row in top:
        counts[row["pathway"]] = counts.get(row["pathway"], 0) + 1
    for row in top:
        if counts[row["pathway"]] > 1:
            row["pathway"] = f"{row['pathway']} #{row['id']}"
    return top


def _searches(range_key, today):
    days, _ = _period(range_key, today)
    rows = _history_rows(days[0], days[-1]) if days else []

    user_ids = {row[1] for row in rows if row[1] is not None}
    account_type = {}
    if user_ids:
        account_type = {
            user_id: normalize_user_type(stored)
            for user_id, stored in db.session.query(AppUser.id, UserInfo.user_type)
            .join(UserInfo, AppUser.info_id == UserInfo.id)
            .filter(AppUser.id.in_(user_ids))
            .all()
        }

    buildings, locations = _destination_names()
    by_account = {name: 0 for name in USER_TYPES}
    by_destination = {name: 0 for name in DESTINATION_TYPES}
    for row in rows:
        name = account_type.get(row[1])
        if name is not None:
            by_account[name] += 1
        destination = _destination_of(row, buildings, locations)
        if destination is not None and destination[3] in by_destination:
            by_destination[destination[3]] += 1

    # Rows with no recognized account type or destination still count in the
    # total, so the splits can add up to less than it.
    return {"total": len(rows), "byAccountType": by_account, "byDestinationType": by_destination}


def summarize_decision_analytics(range_key, now=None):
    """The whole Analytics page for one range, shaped as ``DecisionAnalytics``."""

    today = manila_day(now or datetime.now(timezone.utc))
    places = _active_places()
    graph = RouteGraph()
    return {
        "range": range_key,
        "readiness": _readiness(places, graph),
        "closures": _closures(places, graph),
        "reach": _reach(places, graph),
        "searches": _searches(range_key, today),
    }
