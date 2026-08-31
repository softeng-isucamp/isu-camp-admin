from flask import Blueprint, request, jsonify

from extensions import db
from model.location import Location


# ==========================================
# Location Blueprint
# ==========================================

location_bp = Blueprint(
    "location",
    __name__,
    url_prefix="/api/locations"
)


# ==========================================
# CREATE LOCATION
# ==========================================

@location_bp.route("", methods=["POST"])
def create_location():

    try:

        # ==========================================
        # Get form data
        # ==========================================

        building_id = request.form.get("building_id")
        floor_id = request.form.get("floor_id")
        type_id = request.form.get("type_id")
        location_code = request.form.get("location_code")
        location_name = request.form.get("location_name")
        description = request.form.get("description")
        status = request.form.get("status")
        keywords = request.form.get("keywords")

        # ==========================================
        # Required fields
        # ==========================================

        if (
            type_id is None
            or not location_code
            or not location_name
        ):
            return jsonify({
                "success": False,
                "message": (
                    "type_id, location_code, "
                    "and location_name are required"
                )
            }), 400

        # ==========================================
        # Convert IDs
        # ==========================================

        building_id = (
            int(building_id)
            if building_id
            else None
        )

        floor_id = (
            int(floor_id)
            if floor_id
            else None
        )

        type_id = int(type_id)

        # ==========================================
        # Get uploaded photo
        # ==========================================

        photo = request.files.get("photo")

        photo_data = None

        if photo:
            photo_data = photo.read()

        # ==========================================
        # Create Location
        # ==========================================

        location = Location(
            building_id=building_id,
            floor_id=floor_id,
            type_id=type_id,
            location_code=location_code,
            location_name=location_name,
            description=description,
            status=status or "Active",
            keywords=keywords,
            photo=photo_data
        )

        # ==========================================
        # Save to database
        # ==========================================
    
        db.session.add(location)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Location created successfully",
            "location": location.to_dict()
        }), 201

    except Exception as e:

        db.session.rollback()

        print("CREATE LOCATION ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Failed to create location",
            "error": str(e)
        }), 500