from datetime import datetime

from extensions import db


class BuildingHistory(db.Model):
    """An immutable audit record for a Building.

    The history table is owned by the locations persistence schema.  Keeping
    this mapping separate from ``Building`` means the current row remains the
    source of identity while this endpoint can expose historical changes.
    """

    __tablename__ = "building_history"

    __table_args__ = {"schema": "public"}

    history_id = db.Column(db.BigInteger, primary_key=True)
    building_id = db.Column(db.BigInteger, nullable=False)
    action = db.Column(db.String, nullable=False)
    field = db.Column(db.String, nullable=True)
    old_value = db.Column(db.Text, nullable=True)
    new_value = db.Column(db.Text, nullable=True)
    changed_by = db.Column(db.String, nullable=True)
    created_at = db.Column(
        db.DateTime(timezone=True),
        default=datetime.utcnow,
        nullable=False,
    )
