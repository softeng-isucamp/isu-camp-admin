from sqlalchemy.orm import declared_attr

from extensions import db


class PhotoColumns:
    """The columns every gallery photo carries, whatever it belongs to.

    ``public.building_photo`` and ``public.location_photo`` are the same shape
    apart from their owner foreign key, so the shared half lives here and the
    two models only declare what differs. Keeping it in one place is what stops
    the two tables drifting the way the old polymorphic table invited.
    """

    photo_id = db.Column(db.BigInteger, primary_key=True)
    position = db.Column(db.Integer, nullable=False)
    filename = db.Column(db.String(255), nullable=False)
    mime_type = db.Column(db.String(32), nullable=False)

    # The cover is the one photo the owner shows outside its gallery: it backs
    # ``hasPhoto`` and the single-image /photo endpoint. The database allows at
    # most one per owner (see the partial unique indexes in
    # migrations/20261002_split_building_and_location_photos.sql).
    is_cover = db.Column(db.Boolean, nullable=False, default=False)

    @declared_attr
    def content(cls):
        # Deferred: a gallery is listed, reordered and re-covered far more often
        # than an image is served, and an eager LargeBinary made every one of
        # those operations download each photo the owner has.
        return db.deferred(db.Column(db.LargeBinary, nullable=False))

    def to_metadata(self):
        return {
            "id": str(self.photo_id),
            "name": self.filename,
            "type": self.mime_type,
            "isCover": self.is_cover,
        }
