from extensions import db
from datetime import datetime


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
        nullable=False
    )

    floor_id = db.Column(
        db.BigInteger,
        nullable=False
    )

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
            "has_photo": self.photo is not None   
        }

    def to_location_dto(self, building=None, floor=None):
        """Project the legacy row into the stable Locations API contract.

        The persisted table predates the directory contract: it has no status
        or coordinate columns and stores type/building/floor as IDs. Those
        compatibility values are intentionally made explicit here instead of
        leaking ORM names into the frontend.
        """
        type_names = {
            1: "Building", 2: "Floor", 3: "Room", 4: "Office",
            5: "Laboratory", 6: "Restroom", 7: "Facility",
        }
        location_type = type_names.get(self.type_id, "Facility")
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
            "lat": None,
            "lng": None,
            "positioned": False,
        }
