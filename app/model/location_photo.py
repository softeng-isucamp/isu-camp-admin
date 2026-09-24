from extensions import db


class LocationPhoto(db.Model):
    __tablename__ = "location_photo"
    __table_args__ = {"schema": "public"}

    photo_id = db.Column(db.BigInteger, primary_key=True)
    owner_type = db.Column(db.String(8), nullable=False)
    owner_id = db.Column(db.BigInteger, nullable=False)
    position = db.Column(db.Integer, nullable=False)
    filename = db.Column(db.String(255), nullable=False)
    mime_type = db.Column(db.String(32), nullable=False)
    content = db.Column(db.LargeBinary, nullable=False)
    is_cover = db.Column(db.Boolean, nullable=False, default=False)

    def to_metadata(self):
        return {
            "id": str(self.photo_id),
            "name": self.filename,
            "type": self.mime_type,
            "isCover": self.is_cover,
        }
