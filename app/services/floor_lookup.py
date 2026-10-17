"""Translate between the Locations form's Floor Level labels and public.floor rows.

Locations do not store a floor number directly: they hold a ``floor_id``
pointing at a shared ``public.floor`` row (``building_id`` + ``floor_number``).
The Locations form still speaks in labels (e.g. "Ground Floor", "2nd Floor")
from a fixed vocabulary, so this module is the single place that converts
between that label and the underlying Floor row.
"""

import re

_ORDINAL_FLOOR = re.compile(r"^(\d+)(?:st|nd|rd|th) Floor$")


# Ground Floor and 1st Floor name the same storey, and the directory now
# keeps it as 1. Zero is still read as Ground Floor because rows written
# before the merge hold it, and because this module has to give the same
# answer before, during and after the migration that rewrites them - a
# deployment that reads 0 as "0th Floor" for the minutes in between would
# show every indoor location on a floor that does not exist.
GROUND_FLOOR = 1
GROUND_FLOOR_LABEL = "Ground Floor"
_LEGACY_GROUND_FLOOR = 0


def floor_label(floor):
    """Render a Floor row's ``floor_number`` as its display label."""

    number = floor.floor_number

    if number in (GROUND_FLOOR, _LEGACY_GROUND_FLOOR):
        return GROUND_FLOOR_LABEL

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

    if normalized == GROUND_FLOOR_LABEL:
        return GROUND_FLOOR

    if normalized == "Basement":
        return -1

    match = _ORDINAL_FLOOR.match(normalized)

    if match is None:
        return None

    # "1st Floor" is no longer offered, but a client holding an older copy of
    # the vocabulary may still send it. It resolves to 1, which is now the
    # Ground Floor, so the two agree rather than creating a second storey.
    number = int(match.group(1))

    # "0th Floor" has never been an offered label, and is refused rather than
    # taken at face value: writing a 0 back is how the storey this merge just
    # removed would reappear.
    return None if number == _LEGACY_GROUND_FLOOR else number


def resolve_floor(floor_model, session, building_id, floor_number):
    """Get-or-create the shared Floor row for a Building + floor number.

    ``floor_model`` and ``session`` are passed in (rather than imported here)
    so callers' test doubles for ``Floor``/``db.session`` are honored.
    """

    # A building that still holds a pre-merge Ground Floor row is reused
    # rather than given a second one: the unique constraint on
    # (building_id, floor_number) would reject the duplicate anyway, and the
    # locations already standing on it would be stranded on the old row.
    if floor_number == GROUND_FLOOR:
        for candidate in (GROUND_FLOOR, _LEGACY_GROUND_FLOOR):
            existing = floor_model.query.filter_by(
                building_id=building_id,
                floor_number=candidate,
            ).first()
            if existing is not None:
                return existing

    floor = floor_model.query.filter_by(
        building_id=building_id,
        floor_number=floor_number,
    ).first()

    if floor is None:
        floor = floor_model(building_id=building_id, floor_number=floor_number)
        session.add(floor)
        session.flush()

    return floor
