from extensions import db
from model.building_photo import BuildingPhoto
from model.record_status import status_label

# Everything outdoors on the campus map is a Place - a row in this table -
# and its classification says what it is. Defined once here because these
# sets decide whether an id names a Place or an indoor Location: a site that
# still carries its own ``{"Building", "Facility"}`` sends a College or a
# Parking Place looking in the wrong table.
#
# The strings are exact and case-sensitive, including the space in
# "Campus Services". They travel in the API's existing ``type`` field, never
# as a type_id, because the admin portal and the User App both filter on
# names.
#
# "Building" was the legacy value - a Place that predated the vocabulary,
# stored as ``type_id IS NULL``. Phase 3 retired it: every Place now has a
# type, and "Building" names only the table. One set, because every
# classification a Place can be read as is now one it can be given.
PLACE_CLASSIFICATIONS = {
    "College",
    "Campus Services",
    "Food",
    "Parking",
    "Facility",
}

# Which classifications may hold indoor Locations. The authority is
# ``building_type.can_contain_locations``; this is the same answer without a
# query, for the paths that only have a DTO's type string to go on.
CAN_CONTAIN_LOCATIONS = {"College", "Campus Services"}

# Worded once and shared, because the two route modules validate the same
# rules and a caller should not get two spellings of one refusal.
PARENT_MUST_HOLD_LOCATIONS = (
    "Indoor Locations can only belong to a College or Campus Services Place."
)

RECLASSIFY_WOULD_STRAND_LOCATIONS = (
    "Move or remove this Place's indoor Locations before classifying it as "
    "Food, Parking, or Facility."
)

UNSUPPORTED_CLASSIFICATION = "Select a supported Location type."


class Building(db.Model):
    __tablename__ = "building"

    __table_args__ = {"schema": "public"}

    building_id = db.Column(db.BigInteger, primary_key=True)
    building_code = db.Column(db.String, nullable=False)
    building_name = db.Column(db.String, nullable=False)

    # What this Place is, and the only thing that says so: the deprecated
    # ``classification`` column was dropped in Phase 3.
    type_id = db.Column(
        db.BigInteger,
        db.ForeignKey("public.building_type.type_id"),
        nullable=False,
    )

    # Loaded with the Place rather than per row, because every DTO a listing
    # returns names its classification.
    building_type = db.relationship("BuildingType", lazy="joined")

    @property
    def place_classification(self):
        """This Place's classification name.

        Named once here rather than read off ``building_type`` at each call
        site, so there is a single answer to what a Place is.
        """

        return self.building_type.type_name

    @property
    def can_contain_locations(self):
        """Whether indoor Locations may sit under this Place.

        Read from the type row, so the rule lives in data.
        """

        return bool(self.building_type.can_contain_locations)

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
            # The classification name, which is what every client filters on.
            # Never a type_id: exposing one would force each of them to keep
            # an id-to-name map, and location_type's deleted id 4 already left
            # a stale one in the frontend.
            "type": self.place_classification,
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
