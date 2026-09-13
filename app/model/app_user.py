from extensions import db


class UserInfo(db.Model):
    """Registration details for an app user."""

    __tablename__ = "userInfo"
    __table_args__ = {"schema": "public"}

    id = db.Column(db.BigInteger, primary_key=True)
    email = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), nullable=True)


class AppUser(db.Model):
    """A user account exposed by the read-only administrative directory."""

    __tablename__ = "user"
    __table_args__ = {"schema": "public"}

    id = db.Column(db.BigInteger, primary_key=True)
    username = db.Column(db.String, nullable=False)
    info_id = db.Column(db.BigInteger, db.ForeignKey("public.userInfo.id"), nullable=True)

    info = db.relationship("UserInfo", lazy="joined")

    def to_dict(self):
        return {
            "id": str(self.id),
            "username": self.username,
            "createdAt": self.info.created_at.isoformat() if self.info and self.info.created_at else None,
        }
