from extensions import db
from model.photo_columns import PhotoColumns


class LocationPhoto(PhotoColumns, db.Model):
    """An indoor Location's gallery photos, one row per image.

    This table used to hold Building photos too, addressed by
    ``(owner_type, owner_id)``. That pair could not carry a foreign key, so
    every delete path purged its rows by hand. Buildings now have their own
    ``model.building_photo.BuildingPhoto`` and this column is a real key.
    """

    __tablename__ = "location_photo"
    __table_args__ = (
        # Matches services.location_photos.list_photos: filter by owner,
        # order by position.
        db.Index("location_photo_owner_idx", "location_id", "position"),
        # At most one cover per owner, enforced by the database rather
        # than only by services.location_photos.apply_gallery.
        db.Index(
            "location_photo_one_cover_idx", "location_id", unique=True,
            postgresql_where=db.text("is_cover"),
            sqlite_where=db.text("is_cover"),
        ),
        {"schema": "public"},
    )

    location_id = db.Column(
        db.BigInteger,
        db.ForeignKey("public.location.location_id", ondelete="CASCADE"),
        nullable=False,
    )
