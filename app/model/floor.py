from extensions import db


class Floor(db.Model):
    __tablename__ = "floor"

    __table_args__ = {
        "schema": "public"
    }

    floor_id = db.Column(db.BigInteger, primary_key=True)
    building_id = db.Column(db.BigInteger, nullable=False)
    floor_number = db.Column(db.Integer, nullable=False)
