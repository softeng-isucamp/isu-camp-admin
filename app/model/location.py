from datetime import datetime

from extensions import db
from model.location_photo import LocationPhoto

# These are the IDs currently persisted by public.location_type. Buildings
# and Floors are separate tables and are therefore not location type IDs.
LOCATION_TYPE_NAMES = {
    1: "Room",
    2: "Laboratory",
    3: "Office",
    5: "Restroom",
}
LOCATION_TYPE_IDS = {name: identifier for identifier, name in LOCATION_TYPE_NAMES.items()}


class Location(db.Model):

    __tablename__ = "location"

    __table_args__ = {
        "schema": "public"
    }

    location_id = db.Column(
        db.BigInteger,
        primary_key=True
    )

    building_id = db.Column(
        db.BigInteger,
        nullable=True
    )

    floor_id = db.Column(
        db.BigInteger,
        nullable=True
    )

    # Optional map position for indoor locations. These coordinates are
    # independent of the containing building's footprint anchor.
    latitude = db.Column(db.Numeric, nullable=True)
    longitude = db.Column(db.Numeric, nullable=True)

    type_id = db.Column(
        db.BigInteger,
        nullable=False
    )

    location_code = db.Column(
        db.String,
        nullable=False
    )

    location_name = db.Column(
        db.String,
        nullable=False
    )

    description = db.Column(
        db.Text,
        nullable=True
    )

    created_at = db.Column(
        db.DateTime(timezone=True),
        default=datetime.utcnow,
        nullable=False
    )

    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
        nullable=False
    )

    keywords = db.Column(
    db.Text,
    nullable=True
    )

    def has_photo(self):
        """Whether this Location has a cover photo, without reading the image.

        Answered by the ``photo_present`` subquery below, so a list can report
        it for every row without any image crossing the wire.
        """
        return bool(self.photo_present)

    def to_dict(self):

        return {
            "location_id": self.location_id,
            "building_id": self.building_id,
            "floor_id": self.floor_id,
            "type_id": self.type_id,
            "location_code": self.location_code,
            "location_name": self.location_name,
            "description": self.description,
            "created_at": (
                self.created_at.isoformat()
                if self.created_at
                else None
            ),
            "updated_at": (
                self.updated_at.isoformat()
                if self.updated_at
                else None
            ),
            "keywords": self.keywords,
            "has_photo": self.has_photo(),
        }

    def to_location_dto(self, building=None, floor=None):
        """Project the persisted row into the stable Locations API contract.

        The persisted table predates the directory contract: it has no status
        or coordinate columns and stores type/building/floor as IDs. Those
        compatibility values are intentionally made explicit here instead of
        leaking ORM names into the frontend. ``floor`` is the caller-resolved
        Floor label (see ``services.floor_lookup``), since floors are owned by
        ``public.floor`` and looked up via ``floor_id``.
        """
        try:
            location_type = LOCATION_TYPE_NAMES[self.type_id]
        except KeyError as error:
            raise ValueError(
                f"Location {self.location_id} references an unknown location type."
            ) from error
        is_building = location_type == "Building"
        return {
            "id": str(self.location_id),
            "name": self.location_name,
            "code": self.location_code,
            "type": location_type,
            "parentId": None if is_building else (str(self.building_id) if self.building_id is not None else None),
            "building": building,
            "floor": floor,
            "function": self.description,
            "keywords": self.keywords,
            "status": "Active",
            "lat": float(self.latitude) if self.latitude is not None else None,
            "lng": float(self.longitude) if self.longitude is not None else None,
            "positioned": self.latitude is not None and self.longitude is not None,
            "hasPhoto": self.has_photo(),
        }


# Declared out here because the expression needs the mapped table, which does
# not exist until the class body has run. Selected with every Location as a
# correlated EXISTS, so a list learns which rows have a cover without any
# image being read: the planner stops at the first matching index entry.
Location.photo_present = db.column_property(
    db.exists()
    .where(
        db.and_(
            LocationPhoto.location_id == Location.location_id,
            LocationPhoto.is_cover,
        )
    )
    .correlate_except(LocationPhoto),
    # The flag only changes when the gallery does, and
    # services.location_photos.apply_gallery expires it itself in that
    # case. Without this, every metadata-only write would be followed by
    # a query to re-derive a boolean that cannot have moved.
    expire_on_flush=False,
)
