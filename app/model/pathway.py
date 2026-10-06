from extensions import db
from sqlalchemy.sql import func

PATHWAY_TYPES = frozenset({"Walkway", "Road"})
# A Pathway may be both at once (a road with a sidewalk), so path_type stores the
# selected Way types in this fixed order joined by PATHWAY_TYPE_SEPARATOR.
PATHWAY_TYPE_ORDER = ("Walkway", "Road")
PATHWAY_TYPE_SEPARATOR = ", "


def split_path_types(value):
    """Return the Way types carried by a stored or submitted path_type value."""
    parts = (
        value
        if isinstance(value, (list, tuple, set, frozenset))
        else str(value or "").split(",")
    )
    selected = {str(part).strip() for part in parts}
    unknown = sorted(selected - set(PATHWAY_TYPE_ORDER) - {""})
    return [item for item in PATHWAY_TYPE_ORDER if item in selected] + unknown


def join_path_types(types):
    """Canonicalize chosen Way types into the single stored path_type value."""
    return PATHWAY_TYPE_SEPARATOR.join(split_path_types(types))


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
        back_populates="pathway",
    )

    path_points = db.relationship(
        "PathPoint",
        cascade="all, delete-orphan",
        passive_deletes=True,
        lazy="selectin",
        order_by="PathPoint.sequence_no",
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
            "path_types": split_path_types(self.path_type),
            "name": self.name,
            "status": self.status,
            "shaded": self.shaded,
            "direction": self.direction,
            "shade": self.shade,
            "allowed_modes": [item.mode for item in self.allowed_modes],
            "path_points": [point.to_dict() for point in self.path_points],
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
