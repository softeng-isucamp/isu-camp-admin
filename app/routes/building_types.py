"""The Building type vocabulary, for the form that assigns one.

Its own blueprint at ``/api`` rather than a route on the Locations ones,
because it belongs to neither: ``/api/locations`` is the directory of records
and ``/api/actions`` is what is done to them, while this is the fixed list a
Building is classified against - the counterpart of public.location_type.

Read-only. Types are seeded by migration, not created through the portal, so
there is no write route to guard.
"""

import logging

from flask import Blueprint, jsonify

from auth import admin_required
from model.building_type import all_types

building_types_bp = Blueprint("building_types", __name__, url_prefix="/api")
logger = logging.getLogger(__name__)


@building_types_bp.get("/building-types")
def list_building_types():
    """Every Building type, in directory order."""

    _, error = admin_required()
    if error:
        return error

    try:
        return jsonify({"items": [record.to_dict() for record in all_types()]}), 200
    except Exception:
        logger.exception("Failed to list building types")
        return jsonify({
            "success": False,
            "message": "The building types could not be read.",
        }), 500
