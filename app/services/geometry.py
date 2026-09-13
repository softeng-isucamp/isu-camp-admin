"""Validation helpers for map geometry."""

import math


def polygon_centroid(points):
    """Return the arithmetic center used for a footprint's map marker."""
    return (
        sum(latitude for latitude, _ in points) / len(points),
        sum(longitude for _, longitude in points) / len(points),
    )


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
