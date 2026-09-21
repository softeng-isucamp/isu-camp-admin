from extensions import db
from sqlalchemy.sql import func


class UserHistory(db.Model):
    """A destination selection recorded by the companion User App."""

    __tablename__ = "UserHistory"
    __table_args__ = {"schema": "public"}

    id = db.Column(db.BigInteger, primary_key=True)
    user_id = db.Column(
        "User_id",
        db.BigInteger,
        db.ForeignKey("public.user.id"),
        nullable=True,
    )
    building_id = db.Column(
        "Building_id",
        db.BigInteger,
        db.ForeignKey("public.building.building_id"),
        nullable=True,
    )
    location_id = db.Column(
        "Location_id",
        db.BigInteger,
        db.ForeignKey("public.location.location_id"),
        nullable=True,
    )
    created_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
