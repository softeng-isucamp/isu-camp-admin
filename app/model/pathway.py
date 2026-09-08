from extensions import db
from sqlalchemy.sql import func


class Pathway(db.Model):
    __tablename__ = "pathway"
    __table_args__ = {"schema": "public"}

    pathway_id = db.Column(
        db.BigInteger,
        primary_key=True,
        autoincrement=True
    )

    source_node_id = db.Column(
        db.BigInteger,
        db.ForeignKey(
            "public.route_node.node_id",
            ondelete="CASCADE"
        ),
        nullable=False
    )

    destination_node_id = db.Column(
        db.BigInteger,
        db.ForeignKey(
            "public.route_node.node_id",
            ondelete="CASCADE"
        ),
        nullable=False
    )

    path_type = db.Column(
        db.String(50),
        nullable=False
    )

    distance_m = db.Column(
        db.Numeric,
        nullable=False
    )

    estimated_minutes = db.Column(
        db.Numeric,
        nullable=False
    )

    name = db.Column(
        db.Text,
        nullable=False,
        default="Unnamed Pathway"
    )

    status = db.Column(
        db.String(20),
        nullable=False,
        default="active"
    )

    shaded = db.Column(
        db.Boolean,
        nullable=False,
        default=False
    )

    direction = db.Column(
        db.Text,
        nullable=False,
        default="Unknown"
    )

    shade = db.Column(
        db.Text,
        nullable=False,
        default="Unknown"
    )

    allowed_modes = db.relationship(
        "PathwayAllowedMode",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    surface_type = db.Column(
        db.String(50),
        nullable=True
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
            "pathway_id": self.pathway_id,
            "source_node_id": self.source_node_id,
            "destination_node_id": self.destination_node_id,
            "path_type": self.path_type,
            "name": self.name,
            "distance_m": (
                float(self.distance_m)
                if self.distance_m is not None
                else None
            ),
            "estimated_minutes": (
                float(self.estimated_minutes)
                if self.estimated_minutes is not None
                else None
            ),
            "status": self.status,
            "shaded": self.shaded,
            "direction": self.direction,
            "shade": self.shade,
            "allowed_modes": [item.mode for item in self.allowed_modes],
            "surface_type": self.surface_type,
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
