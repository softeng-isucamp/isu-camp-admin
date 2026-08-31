from extensions import db
from datetime import datetime

LOCATION_TYPE_NAMES = {
    1: "Building",
    2: "Floor",
    3: "Room",
    4: "Office",
    5: "Laboratory",
    6: "Restroom",
    7: "Facility",
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

    floor_level = db.Column(db.Text, nullable=True)

    # Coordinates are owned by Locations only for standalone Outdoor Point
    # Locations. Indoor records intentionally remain unpositioned.
    lat = db.Column(db.Float, nullable=True)

    lng = db.Column(db.Float, nullable=True)

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

    photo = db.Column(
        db.LargeBinary,
        nullable=True
    )

    photo_mime_type = db.Column(
        db.String(64),
        nullable=True
    )

    def to_dict(self):

        return {
            "location_id": self.location_id,
            "building_id": self.building_id,
            "floor_id": self.floor_id,
            "floor_level": self.floor_level,
            "lat": self.lat,
            "lng": self.lng,
            "positioned": self.lat is not None and self.lng is not None,
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
            "has_photo": self.photo is not None,
            "photo_mime_type": self.photo_mime_type,
        }

    def to_location_dto(self, building=None, floor=None):
        """Project the legacy row into the stable Locations API contract.

        The persisted table predates the directory contract: it has no status
        or coordinate columns and stores type/building/floor as IDs. Those
        compatibility values are intentionally made explicit here instead of
        leaking ORM names into the frontend.
        """
        try:
            location_type = LOCATION_TYPE_NAMES[self.type_id]
        except KeyError as error:
            raise ValueError(
                f"Location {self.location_id} references an unknown location type."
            ) from error
        is_building = location_type == "Building"
        positioned = self.lat is not None and self.lng is not None
        return {
            "id": str(self.location_id),
            "name": self.location_name,
            "code": self.location_code,
            "type": location_type,
            "parentId": None if is_building else (str(self.building_id) if self.building_id is not None else None),
            "building": building,
            "floor": self.floor_level or floor,
            "function": self.description,
            "keywords": self.keywords,
            "status": "Active",
            "lat": self.lat if not is_building and location_type == "Facility" else None,
            "lng": self.lng if not is_building and location_type == "Facility" else None,
            "positioned": positioned if not is_building and location_type == "Facility" else False,
            "hasPhoto": self.photo is not None,
        }
