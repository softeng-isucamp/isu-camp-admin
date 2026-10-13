"""Hard-delete a Building or an indoor Location along with its dependents.

Every delete here runs as an explicit bulk statement in a fixed order inside
the caller's transaction.  Two properties of the live schema make that
ordering the whole point of this module:

* ``public.floor.building_id`` and ``public.path_point.building_id`` are
  ``NO ACTION`` keys, and ``public."UserHistory"`` holds ``NO ACTION`` keys to
  both ``building`` and ``location``.  Nothing clears those rows on our behalf,
  so a plain ``session.delete(building)`` raises ``ForeignKeyViolation``.
* Staging the dependents with ``session.delete`` instead would not help:
  ``model.floor.Floor`` and ``model.location.Location`` declare no
  ``ForeignKey`` on ``building_id``, so the ORM has no dependency to sort on
  and is free to emit the owner's ``DELETE`` first.

``public.route_node`` is left alone on purpose: both of its keys are declared
``ON DELETE SET NULL`` in the database, so the graph keeps its geometry while
losing the reference.
"""

from model.building import Building
from model.building_photo import BuildingPhoto
from model.floor import Floor
from model.location import Location
from model.location_photo import LocationPhoto
from model.path_point import PathPoint
from model.user_history import UserHistory


def _purge_location_rows(location_ids):
    """Clear the rows that point at the given Locations."""

    if not location_ids:
        return

    LocationPhoto.query.filter(
        LocationPhoto.location_id.in_(location_ids),
    ).delete(synchronize_session=False)
    UserHistory.query.filter(
        UserHistory.location_id.in_(location_ids),
    ).delete(synchronize_session=False)


def purge_building(building_id):
    """Stage a Building and everything it owns for deletion.

    Returns the ids of the indoor Locations that went with it so callers can
    audit or report them.  The caller owns the commit.
    """

    location_ids = [
        row.location_id
        for row in Location.query.filter_by(building_id=building_id).all()
    ]

    _purge_location_rows(location_ids)
    BuildingPhoto.query.filter_by(
        building_id=building_id,
    ).delete(synchronize_session=False)
    UserHistory.query.filter_by(
        building_id=building_id,
    ).delete(synchronize_session=False)

    # A waypoint outlives the Building it was placed against; only the
    # reference goes, matching the ``SET NULL`` the model asks for.
    PathPoint.query.filter_by(building_id=building_id).update(
        {"building_id": None}, synchronize_session=False,
    )

    # Locations before Floors: ``location.floor_id`` is a NO ACTION key into
    # ``public.floor``.
    Location.query.filter_by(building_id=building_id).delete(synchronize_session=False)
    Floor.query.filter_by(building_id=building_id).delete(synchronize_session=False)
    Building.query.filter_by(building_id=building_id).delete(synchronize_session=False)

    return location_ids


def purge_location(location_id):
    """Stage a single indoor Location and its dependents for deletion.

    The caller owns the commit.
    """

    _purge_location_rows([location_id])
    Location.query.filter_by(location_id=location_id).delete(synchronize_session=False)
