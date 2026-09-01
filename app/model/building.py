from extensions import db


class Building(db.Model):
    __tablename__ = "building"

    __table_args__ = {"schema": "public"}

    building_id = db.Column(db.BigInteger, primary_key=True)
    building_code = db.Column(db.String, nullable=False)
    building_name = db.Column(db.String, nullable=False)
    description = db.Column(db.Text, nullable=True)
    latitude = db.Column(db.Numeric, nullable=True)
    longitude = db.Column(db.Numeric, nullable=True)

    def to_location_dto(self):
        lat = float(self.latitude) if self.latitude is not None else None
        lng = float(self.longitude) if self.longitude is not None else None
        return {
            "id": str(self.building_id),
            "name": self.building_name,
            "code": self.building_code,
            "type": "Building",
            "parentId": None,
            "building": None,
            "floor": None,
            "function": self.description,
            "keywords": None,
            "status": "Active",
            "lat": lat,
            "lng": lng,
            "positioned": lat is not None and lng is not None,
            "hasPhoto": False,
        }
