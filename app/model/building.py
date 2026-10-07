from extensions import db
from model.building_photo import BuildingPhoto
from model.record_status import status_label


class Building(db.Model):
    __tablename__ = "building"

    __table_args__ = {"schema": "public"}

    building_id = db.Column(db.BigInteger, primary_key=True)
    building_code = db.Column(db.String, nullable=False)
    building_name = db.Column(db.String, nullable=False)
    classification = db.Column(db.String, nullable=False, default="Building")
    description = db.Column(db.Text, nullable=True)

    # Free-text search keywords for the building, mirroring
    # public.location.keywords. Rows written before the column existed read
    # back as None.
    keywords = db.Column(db.Text, nullable=True)

    # Lifecycle status, lowercase per model.record_status. The column arrived
    # after the directory contract did, so rows written before it carry the
    # database default, 'active' - which is what the DTO used to claim about
    # every row anyway.
    status = db.Column(db.String(20), nullable=False, default="active")
    latitude = db.Column(db.Numeric, nullable=True)
    longitude = db.Column(db.Numeric, nullable=True)

    # Stores the building polygon coordinates as JSON.
    polygon_coordinates = db.Column(db.JSON, nullable=True)

    def has_photo(self):
        """Whether this Building has a cover photo, without reading the image.

        Answered by the ``photo_present`` subquery below, so a list can report
        it for every row without any image crossing the wire.
        """
        return bool(self.photo_present)

    def to_location_dto(self):
        lat = float(self.latitude) if self.latitude is not None else None
        lng = float(self.longitude) if self.longitude is not None else None

        return {
            "id": str(self.building_id),
            "name": self.building_name,
            "code": self.building_code,
            "type": self.classification or "Building",
            "parentId": None,
            "building": None,
            "floor": None,
            "function": self.description,
            "keywords": self.keywords,
            "status": status_label(self.status),
            "lat": lat,
            "lng": lng,

            # Send polygon coordinates back to frontend
            "polygonCoordinates": self.polygon_coordinates,

            "positioned": lat is not None and lng is not None,
            "hasPhoto": self.has_photo(),
        }


# Declared out here because the expression needs the mapped table, which does
# not exist until the class body has run. Selected with every Building as a
# correlated EXISTS, so a list learns which rows have a cover without any
# image being read: the planner stops at the first matching index entry.
Building.photo_present = db.column_property(
    db.exists()
    .where(
        db.and_(
            BuildingPhoto.building_id == Building.building_id,
            BuildingPhoto.is_cover,
        )
    )
    .correlate_except(BuildingPhoto),
    # The flag only changes when the gallery does, and
    # services.location_photos.apply_gallery expires it itself in that
    # case. Without this, every metadata-only write would be followed by
    # a query to re-derive a boolean that cannot have moved.
    expire_on_flush=False,
)
