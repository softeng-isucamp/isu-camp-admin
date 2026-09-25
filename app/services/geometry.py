"""Validation helpers for map geometry."""

import math


def polygon_centroid(points):
    """Return the arithmetic center used for a footprint's map marker."""
    if len(points) > 1 and points[0] == points[-1]:
        points = points[:-1]
    return (
        sum(latitude for latitude, _ in points) / len(points),
        sum(longitude for _, longitude in points) / len(points),
    )


def polygon_feature_anchor(points):
    """Return a representative point guaranteed to lie on a valid polygon."""
    ring = points[:-1] if len(points) > 1 and points[0] == points[-1] else points
    if len(ring) < 3:
        return polygon_centroid(ring)

    origin = ring[0]
    translated = [
        (point[0] - origin[0], point[1] - origin[1])
        for point in ring
    ]
    twice_area = latitude = longitude = 0.0
    for index, point in enumerate(translated):
        next_point = translated[(index + 1) % len(translated)]
        cross = point[0] * next_point[1] - next_point[0] * point[1]
        twice_area += cross
        latitude += (point[0] + next_point[0]) * cross
        longitude += (point[1] + next_point[1]) * cross

    if abs(twice_area) < 1e-12:
        return polygon_centroid(ring)

    area_point = (
        origin[0] + latitude / (3 * twice_area),
        origin[1] + longitude / (3 * twice_area),
    )
    if _point_in_polygon(area_point, ring):
        return area_point

    south = min(point[0] for point in ring)
    north = max(point[0] for point in ring)
    west = min(point[1] for point in ring)
    east = max(point[1] for point in ring)
    best = None
    best_clearance = -1.0
    for row in range(33):
        for column in range(33):
            candidate = (
                south + (north - south) * row / 32,
                west + (east - west) * column / 32,
            )
            if not _point_in_polygon(candidate, ring):
                continue
            clearance = min(
                _distance_to_segment(candidate, point, ring[(index + 1) % len(ring)])
                for index, point in enumerate(ring)
            )
            if clearance > best_clearance:
                best = candidate
                best_clearance = clearance
    return best or tuple(ring[0])


def _point_in_polygon(point, polygon):
    inside = False
    previous = polygon[-1]
    for vertex in polygon:
        if ((vertex[1] > point[1]) != (previous[1] > point[1])) and point[0] < (
            (previous[0] - vertex[0]) * (point[1] - vertex[1])
            / (previous[1] - vertex[1]) + vertex[0]
        ):
            inside = not inside
        previous = vertex
    return inside


def point_in_polygon(point, polygon):
    """Return whether a latitude/longitude point is inside or on a polygon.

    Polygon vertices and points are represented as ``(latitude, longitude)``.
    Treating the boundary as included makes placing a marker on a footprint
    edge valid while still rejecting points outside it.
    """
    if not polygon:
        return False
    for index, start in enumerate(polygon):
        end = polygon[(index + 1) % len(polygon)]
        if _distance_to_segment(point, start, end) <= 1e-12:
            return True
    return _point_in_polygon(point, polygon)


def _distance_to_segment(point, start, end):
    latitude_delta = end[0] - start[0]
    longitude_delta = end[1] - start[1]
    length_squared = latitude_delta ** 2 + longitude_delta ** 2
    projection = 0.0 if length_squared == 0 else max(0.0, min(
        1.0,
        ((point[0] - start[0]) * latitude_delta
         + (point[1] - start[1]) * longitude_delta) / length_squared,
    ))
    nearest = (
        start[0] + projection * latitude_delta,
        start[1] + projection * longitude_delta,
    )
    return math.hypot(point[0] - nearest[0], point[1] - nearest[1])


def polygon_error(points):
    """Return a validation message for an invalid latitude/longitude polygon."""
    if not isinstance(points, list) or len(points) < 3:
        return "Footprint geometry requires at least three latitude/longitude points."

    vertices = []
    for point in points:
        if (
            not isinstance(point, (list, tuple))
            or len(point) != 2
            or any(
                isinstance(value, bool)
                or not isinstance(value, (int, float))
                or not math.isfinite(value)
                for value in point
            )
        ):
            return "Each footprint point must contain finite latitude and longitude values."
        latitude, longitude = point
        if not -90 <= latitude <= 90 or not -180 <= longitude <= 180:
            return "Footprint coordinates must be valid latitude and longitude values."
        vertices.append((float(latitude), float(longitude)))

    if vertices[0] == vertices[-1]:
        vertices.pop()
    if len(vertices) < 3 or len(set(vertices)) != len(vertices):
        return "Footprint geometry must contain at least three distinct vertices."

    area_twice = sum(
        first[0] * second[1] - second[0] * first[1]
        for first, second in zip(vertices, vertices[1:] + vertices[:1])
    )
    if abs(area_twice) < 1e-12:
        return "Footprint geometry must enclose an area."

    def orientation(first, second, third):
        return (
            (second[1] - first[1]) * (third[0] - first[0])
            - (second[0] - first[0]) * (third[1] - first[1])
        )

    def on_segment(first, second, point):
        return (
            min(first[0], second[0]) <= point[0] <= max(first[0], second[0])
            and min(first[1], second[1]) <= point[1] <= max(first[1], second[1])
        )

    def segments_intersect(first, second, third, fourth):
        orientations = (
            orientation(first, second, third),
            orientation(first, second, fourth),
            orientation(third, fourth, first),
            orientation(third, fourth, second),
        )
        if any(math.isclose(value, 0.0, abs_tol=1e-12) for value in orientations):
            return (
                math.isclose(orientations[0], 0.0, abs_tol=1e-12)
                and on_segment(first, second, third)
            ) or (
                math.isclose(orientations[1], 0.0, abs_tol=1e-12)
                and on_segment(first, second, fourth)
            ) or (
                math.isclose(orientations[2], 0.0, abs_tol=1e-12)
                and on_segment(third, fourth, first)
            ) or (
                math.isclose(orientations[3], 0.0, abs_tol=1e-12)
                and on_segment(third, fourth, second)
            )
        return (
            (orientations[0] > 0) != (orientations[1] > 0)
            and (orientations[2] > 0) != (orientations[3] > 0)
        )

    edges = list(zip(vertices, vertices[1:] + vertices[:1]))
    for index, (first, second) in enumerate(edges):
        for other_index, (third, fourth) in enumerate(edges[index + 1:], index + 1):
            if other_index == index + 1 or (index == 0 and other_index == len(edges) - 1):
                continue
            if segments_intersect(first, second, third, fourth):
                return "Footprint edges must not intersect."

    return None
