from datetime import timezone

from extensions import db
from model.record_status import status_label

# The account type an app user picks at signup, in the admin's spelling.
USER_TYPES = ("student", "teacher", "visitor")

# The User App stores the label its signup picker shows - "Student", "Staff",
# "Visitor" - and nothing in the database pins that spelling, so the admin
# normalizes on read instead of trusting the stored text. Keyed by the
# lower-cased stored value; "staff" and "teacher" are one category under two
# names. Add a row here, not a branch at the call site, when a spelling appears.
USER_TYPE_ALIASES = {
    "student": "student",
    "teacher": "teacher",
    "staff": "teacher",
    "visitor": "visitor",
}


def normalize_user_type(stored):
    """The admin's name for a stored user_type, or None if absent or unknown."""
    if stored is None:
        return None
    return USER_TYPE_ALIASES.get(stored.strip().lower())


def stored_user_type_aliases(user_type):
    """Every lower-cased stored spelling that reads back as this account type."""
    return [
        stored
        for stored, canonical in USER_TYPE_ALIASES.items()
        if canonical == user_type
    ]


class UserInfo(db.Model):
    """Registration details for an app user."""

    __tablename__ = "userInfo"
    __table_args__ = {"schema": "public"}

    id = db.Column(db.BigInteger, primary_key=True)
    email = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=True)
    user_type = db.Column(db.String, nullable=True)


class AppUser(db.Model):
    """A user account listed by the administrative directory.

    The profile — username, email, account type — belongs to the User App and
    is read-only here. Whether the account may sign in at all is the portal's
    to set, which is the one field this app writes.
    """

    __tablename__ = "user"
    __table_args__ = {"schema": "public"}

    id = db.Column(db.BigInteger, primary_key=True)
    username = db.Column(db.String, nullable=False)
    info_id = db.Column(db.BigInteger, db.ForeignKey("public.userInfo.id"), nullable=True)

    # Lowercase per model.record_status. Written by the portal's User Management
    # and enforced by the User App, which owns sign-in for these accounts.
    status = db.Column(db.String(20), nullable=False, default="active")

    info = db.relationship("UserInfo", lazy="joined")

    @property
    def registered_at(self):
        return self.info.created_at if self.info else None

    @property
    def user_type(self):
        return normalize_user_type(self.info.user_type) if self.info else None

    def to_dict(self):
        created_at = self.registered_at
        if created_at is not None:
            if created_at.tzinfo is None:
                created_at = created_at.replace(tzinfo=timezone.utc)
            else:
                created_at = created_at.astimezone(timezone.utc)

        return {
            "id": str(self.id),
            "username": self.username,
            "createdAt": created_at.isoformat() if created_at else None,
            "userType": self.user_type,
            "status": status_label(self.status),
        }
