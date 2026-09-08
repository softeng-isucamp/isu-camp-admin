from extensions import db


class PathwayAllowedMode(db.Model):
    __tablename__ = "pathway_allowed_mode"
    __table_args__ = {"schema": "public"}

    pathway_id = db.Column(
        db.BigInteger,
        db.ForeignKey("public.pathway.pathway_id", ondelete="CASCADE"),
        primary_key=True,
    )

    mode = db.Column(
        db.Text,
        primary_key=True,
        nullable=False,
    )
