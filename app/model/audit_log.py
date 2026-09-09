from datetime import datetime, timezone

from extensions import db


class AuditLog(db.Model):
    """Immutable audit record. This model intentionally has no mutation API."""

    __tablename__ = "audit_log"
    __table_args__ = {"schema": "public"}

    id = db.Column(db.BigInteger, primary_key=True)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
    category = db.Column(db.String(32), nullable=False)
    actor = db.Column(db.String(255), nullable=False)
    action = db.Column(db.String(255), nullable=False)
    target = db.Column(db.String(255), nullable=False)
    target_id = db.Column(db.String(255), nullable=True)
    detail = db.Column(db.Text, nullable=True)

    def to_dict(self):
        return {
            "id": str(self.id),
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "category": self.category,
            "actor": self.actor,
            "action": self.action,
            "target": self.target,
            "targetId": self.target_id,
            "detail": self.detail,
        }
