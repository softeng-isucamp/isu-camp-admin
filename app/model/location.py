from datetime import datetime

from sqlalchemy import inspect

from extensions import db

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

    # Deferred: whether a photo exists is read far more often than the image
    # itself, and an eager LargeBinary made every list and edit query carry
    # every photo. ``photo_present`` below answers that without the bytes.
    photo = db.deferred(
        db.Column(
            db.LargeBinary,
            nullable=True
        )
    )

    # Stored alongside the bytes so a photo can be served back with a correct
    # Content-Type. Rows written before this column exists read back as None.
    photo_mime_type = db.Column(
        db.String,
        nullable=True
    )

    def has_photo(self):
        """Whether a photo exists, without undeferring the bytes.

        Bytes already in the session win over the stored flag, so a photo set
        earlier in the current request is reported before it is written.
        """
        if "photo" in inspect(self).dict:
            return self.photo is not None
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
# not exist until the class body has run. Selected with every Location, and it
# reads the row's null bitmap rather than the TOASTed image.
# expire_on_flush is off because the flag only changes when ``photo`` itself
# does, and has_photo() reads the bytes from the session in that case: without
# it, every write would be followed by a query to re-derive this boolean.
Location.photo_present = db.column_property(
    Location.__table__.c.photo.isnot(None),
    expire_on_flush=False,
)
