"""What a Place is, as a controlled vocabulary.

The counterpart to ``public.location_type`` for Places - rows in
``public.building``. ``classification`` held free text that only ever said
"Building" or "Facility", which does not separate a canteen from a car park
from a college, so the User App has nothing real to filter on.

``building.type_id`` is the source of truth, and NOT NULL since Phase 3:
every Place names one of these types, and the legacy "Building" value - a
Place that predated the vocabulary - no longer exists.

The names are read from the table rather than hardcoded here, so a type can
be added by seeding a row. ``model.building`` still names them in
``PLACE_CLASSIFICATIONS`` for the paths that have only a DTO's type string
and no session to query with; the table is what a write is validated against.
"""

from extensions import db


class BuildingType(db.Model):

    __tablename__ = "building_type"

    __table_args__ = {"schema": "public"}

    type_id = db.Column(db.BigInteger, primary_key=True)
    type_name = db.Column(db.String, nullable=False, unique=True)
    description = db.Column(db.Text, nullable=True)

    # Whether Places of this type may hold indoor Locations, so the rule is
    # data rather than a set in the code. False for Food, Parking and
    # Facility; true for College and Campus Services.
    can_contain_locations = db.Column(
        db.Boolean,
        nullable=False,
        default=False,
    )

    def to_dict(self):
        return {
            "name": self.type_name,
            "description": self.description,
            "canContainLocations": bool(self.can_contain_locations),
        }


def all_types():
    """Every Place type, in the order the directory lists them."""

    return BuildingType.query.order_by(BuildingType.type_id).all()


def find_type(name):
    """The type row called ``name``, or None when the vocabulary has no such name.

    Matched exactly apart from surrounding space. The strings are
    case-sensitive on purpose: "Campus Services" is the value the User App
    filters on, and quietly accepting "campus services" would let two
    spellings of one classification into the directory.
    """

    cleaned = " ".join(str(name or "").split())
    if not cleaned:
        return None

    return BuildingType.query.filter_by(type_name=cleaned).first()
