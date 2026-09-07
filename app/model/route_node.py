from extensions import db
from sqlalchemy.sql import func


class RouteNode(db.Model):
    __tablename__ = "route_node"
    __table_args__ = {"schema": "public"}

    node_id = db.Column(
        db.BigInteger,
        primary_key=True,
        autoincrement=True
    )

    location_id = db.Column(
        db.BigInteger,
        db.ForeignKey(
            "public.location.location_id",
            ondelete="SET NULL"
        ),
        nullable=True
    )

    building_id = db.Column(
        db.BigInteger,
        db.ForeignKey(
            "public.building.building_id",
            ondelete="SET NULL"
        ),
        nullable=True
    )

    latitude = db.Column(
        db.Float,
        nullable=False
    )

    longitude = db.Column(
        db.Float,
        nullable=False
    )

    node_type = db.Column(
        db.String(50),
        nullable=False,
        default="intersection"
    )

    status = db.Column(
        db.String(20),
        nullable=False,
        default="active"
    )

    created_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        server_default=func.now()
    )

    updated_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
        onupdate=func.now()
    )
    

    def to_dict(self):
        return {
            "node_id": self.node_id,
            "location_id": self.location_id,
            "building_id": self.building_id,
            "latitude": self.latitude,
            "longitude": self.longitude,
            "node_type": self.node_type,
            "status": self.status,
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
        }