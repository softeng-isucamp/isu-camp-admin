"""Translate between the Locations form's Floor Level labels and public.floor rows.

Locations do not store a floor number directly: they hold a ``floor_id``
pointing at a shared ``public.floor`` row (``building_id`` + ``floor_number``).
The Locations form still speaks in labels (e.g. "Ground Floor", "2nd Floor")
from a fixed vocabulary, so this module is the single place that converts
between that label and the underlying Floor row.
"""

import re

_ORDINAL_FLOOR = re.compile(r"^(\d+)(?:st|nd|rd|th) Floor$")


def floor_label(floor):
    """Render a Floor row's ``floor_number`` as its display label."""

    number = floor.floor_number

    if number == 0:
        return "Ground Floor"

    if number == -1:
        return "Basement"

    suffix = (
        "th"
        if 10 < number % 100 < 14
        else {1: "st", 2: "nd", 3: "rd"}.get(number % 10, "th")
    )

    return f"{number}{suffix} Floor"


def floor_number_from_label(label):
    """Reverse of ``floor_label``.

    Returns ``None`` when ``label`` is not one of the controlled Floor Level
    values the Locations form offers.
    """

    normalized = (label or "").strip()

    if normalized == "Ground Floor":
        return 0

    if normalized == "Basement":
        return -1

    match = _ORDINAL_FLOOR.match(normalized)

    return int(match.group(1)) if match else None


def resolve_floor(floor_model, session, building_id, floor_number):
    """Get-or-create the shared Floor row for a Building + floor number.

    ``floor_model`` and ``session`` are passed in (rather than imported here)
    so callers' test doubles for ``Floor``/``db.session`` are honored.
    """

    floor = floor_model.query.filter_by(
        building_id=building_id,
        floor_number=floor_number,
    ).first()

    if floor is None:
        floor = floor_model(building_id=building_id, floor_number=floor_number)
        session.add(floor)
        session.flush()

    return floor
