"""Turning a Place's classification name into a ``building.type_id``.

The API exchanges names - "College", "Campus Services" - and never ids, so
every write has to resolve one against ``public.building_type``. Both route
modules do it, and they have to agree on three rules, which is why they are
here rather than in either of them:

* an unknown name is a refusal, not a silently untyped Place;
* "Building" is legacy and cannot be chosen. It survives only where it
  already is, so an edit that does not reclassify an old Place still saves;
* a Place that holds indoor Locations cannot become one that may not hold
  them, because the Locations would be stranded somewhere the directory
  does not let a user reach.
"""

from model.building import (
    LEGACY_CLASSIFICATION,
    RECLASSIFY_WOULD_STRAND_LOCATIONS,
    UNSUPPORTED_CLASSIFICATION,
)
from model.building_type import find_type


def resolve_place_type(name, current=None):
    """The ``type_id`` a Place should be written with.

    Returns ``(type_id, error)``. ``type_id`` is None for a legacy Place that
    is being edited without being reclassified; ``error`` is the message for
    ``fields["type"]`` when the name cannot be used.

    ``current`` is the Place being edited, or None when one is being created.
    It is what decides whether "Building" is an unchanged legacy value or an
    attempt to create a new one.
    """

    cleaned = " ".join(str(name or "").split())

    if cleaned == LEGACY_CLASSIFICATION:
        # Only where it already is. A new Place, or an old one that has since
        # been given a real type, may not go back to legacy.
        if current is not None and current.type_id is None:
            return None, None
        return None, UNSUPPORTED_CLASSIFICATION

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

    # Legacy stays able to hold Locations until Phase 3, so a Place that is
    # not being reclassified is never refused here.
    if record is None:
        return None

    if record.can_contain_locations:
        return None

    return RECLASSIFY_WOULD_STRAND_LOCATIONS


def find_type_by_id(type_id):
    """The type row with this id, or None for legacy."""

    if type_id is None:
        return None

    from model.building_type import BuildingType

    return BuildingType.query.filter_by(type_id=type_id).first()
