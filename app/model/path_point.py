from extensions import db


class PathPoint(db.Model):
    __tablename__ = "path_point"
    __table_args__ = {"schema": "public"}

    point_id = db.Column(
        db.BigInteger,
        primary_key=True,
        autoincrement=True
    )

    pathway_id = db.Column(
        db.BigInteger,
        db.ForeignKey(
            "public.pathway.pathway_id",
            ondelete="CASCADE"
        ),
        nullable=False
    )

    sequence_no = db.Column(
        db.Integer,
        nullable=False
    )

    latitude = db.Column(
        db.Numeric,
        nullable=False
    )

    longitude = db.Column(
        db.Numeric,
        nullable=False
    )

    building_id = db.Column(
        db.BigInteger,
        db.ForeignKey(
            "public.building.building_id",
            ondelete="SET NULL"
        ),
        nullable=True
    )

    node_type = db.Column(
        db.String(50),
        nullable=False
    )

    status = db.Column(
        db.String(20),
        nullable=False,
        default="active"
    )

    def to_dict(self):
        return {
            "point_id": self.point_id,
            "pathway_id": self.pathway_id,
            "sequence_no": self.sequence_no,
            "latitude": (
                float(self.latitude)
                if self.latitude is not None
                else None
            ),
            "longitude": (
                float(self.longitude)
                if self.longitude is not None
                else None
            ),
            "building_id": self.building_id,
            "node_type": self.node_type,
            "status": self.status,
        }