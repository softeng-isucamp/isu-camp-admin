"""Turning a Place's classification name into a ``building.type_id``.

The API exchanges names - "College", "Campus Services" - and never ids, so
every write has to resolve one against ``public.building_type``. Both route
modules do it, and they have to agree on two rules, which is why they are
here rather than in either of them:

* an unknown name is a refusal, not a silently untyped Place. "Building" is
  one such name: it was the legacy value, it is not in the vocabulary, and
  Phase 3 left no row that may carry it;
* a Place that holds indoor Locations cannot become one that may not hold
  them, because the Locations would be stranded somewhere the directory
  does not let a user reach.
"""

from model.building import (
    RECLASSIFY_WOULD_STRAND_LOCATIONS,
    UNSUPPORTED_CLASSIFICATION,
)
from model.building_type import find_type


def resolve_place_type(name):
    """The ``type_id`` a Place should be written with.

    Returns ``(type_id, error)``. ``error`` is the message for
    ``fields["type"]`` when the name is not one the vocabulary knows, and
    ``type_id`` is None in that case; otherwise ``type_id`` is a real id,
    because every Place has a type.
    """

    cleaned = " ".join(str(name or "").split())

    record = find_type(cleaned)
    if record is None:
        return None, UNSUPPORTED_CLASSIFICATION

    return record.type_id, None


def reclassification_error(current, type_id, has_indoor_locations):
    """Why this Place may not become ``type_id``, or None.

    ``has_indoor_locations`` is passed in rather than counted here so the
    caller can use the rows it has already loaded.
    """

    if current is None or not has_indoor_locations:
        return None

    record = find_type_by_id(type_id)

    # ``type_id`` came from resolve_place_type, so a missing row means the
    # vocabulary changed under us rather than a Place without a type.
    if record is None or record.can_contain_locations:
        return None

    return RECLASSIFY_WOULD_STRAND_LOCATIONS


def find_type_by_id(type_id):
    """The type row with this id, or None when there is no such type."""

    if type_id is None:
        return None

    from model.building_type import BuildingType

    return BuildingType.query.filter_by(type_id=type_id).first()
