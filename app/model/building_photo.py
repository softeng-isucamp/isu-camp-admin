from extensions import db
from model.photo_columns import PhotoColumns


class BuildingPhoto(PhotoColumns, db.Model):
    """A Building's gallery photos, newest schema: one row per image.

    The owner is a real foreign key, so deleting a Building takes its photos
    with it. The target is named as a string so this module does not have to
    import ``model.building`` -- that model reads back from here to derive
    ``photo_present``, and the import would be circular.
    """

    __tablename__ = "building_photo"
    __table_args__ = (
        # Matches services.location_photos.list_photos: filter by owner,
        # order by position.
        db.Index("building_photo_owner_idx", "building_id", "position"),
        # At most one cover per owner, enforced by the database rather
        # than only by services.location_photos.apply_gallery.
        db.Index(
            "building_photo_one_cover_idx", "building_id", unique=True,
            postgresql_where=db.text("is_cover"),
            sqlite_where=db.text("is_cover"),
        ),
        {"schema": "public"},
    )

    building_id = db.Column(
        db.BigInteger,
        db.ForeignKey("public.building.building_id", ondelete="CASCADE"),
        nullable=False,
    )
