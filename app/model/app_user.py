from datetime import datetime, timezone

from extensions import db


class AppUser(db.Model):
    """A user account exposed by the read-only administrative directory."""

    __tablename__ = "app_user"
    __table_args__ = {"schema": "public"}

    id = db.Column(db.String(128), primary_key=True)
    username = db.Column(db.String(255), unique=True, nullable=False)
    email = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    last_sign_in_at = db.Column(db.DateTime(timezone=True), nullable=True)
    is_active = db.Column(db.Boolean, default=True, nullable=False)

    def to_dict(self):
        return {
            "id": str(self.id),
            "username": self.username,
            "email": self.email,
            "createdAt": self.created_at.isoformat() if self.created_at else None,
            "lastSignIn": self.last_sign_in_at.isoformat() if self.last_sign_in_at else None,
            "isActive": self.is_active,
        }
