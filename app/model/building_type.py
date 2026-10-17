"""What a Building is, as a controlled vocabulary.

The counterpart to ``public.location_type`` for Buildings.
``public.building.classification`` holds free text and only ever says
"Building" or "Facility", which does not distinguish a canteen from a car
park from a college, so the directory gains a real type.

Unlike ``model.location``, the names are not hardcoded here. Location types
are pinned to their ids because ``Location.type_id`` is written from a fixed
set the form offers; building types are read from the table, so a type can be
added by seeding a row rather than by editing and redeploying this module.
``classification`` is untouched and still drives the Building DTO's ``type``.
"""

from extensions import db


class BuildingType(db.Model):

    __tablename__ = "building_type"

    __table_args__ = {"schema": "public"}

    type_id = db.Column(db.BigInteger, primary_key=True)
    type_name = db.Column(db.String, nullable=False, unique=True)
    description = db.Column(db.Text, nullable=True)

    def to_dict(self):
        return {
            "id": str(self.type_id),
            "name": self.type_name,
            "description": self.description,
        }


def all_types():
    """Every building type, in the order the directory lists them."""

    return BuildingType.query.order_by(BuildingType.type_id).all()


def type_id_for(name):
    """The id of the type called ``name``, or None.

    Matched without regard to case or surrounding space, so a client sending
    "campus services" reaches the same row as "Campus Services". An unknown
    name is None rather than an error; the caller decides whether that is a
    rejection or simply no type.
    """

    cleaned = " ".join(str(name or "").split())
    if not cleaned:
        return None

    record = BuildingType.query.filter(
        db.func.lower(BuildingType.type_name) == cleaned.lower()
    ).first()

    return record.type_id if record else None
