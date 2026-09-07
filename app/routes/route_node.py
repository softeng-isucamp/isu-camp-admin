from flask import Blueprint, request, jsonify

from extensions import db
from model.route_node import RouteNode
from model.path_point import PathPoint
from model.pathway import Pathway


# ==========================================
# Routing Blueprint
# ==========================================

route_node_bp = Blueprint(
    "route_node",
    __name__,
    url_prefix="/api"
)


# =========================================================
#                    ROUTE NODE
# =========================================================


# ==========================================
# GET ALL ROUTE NODES
# ==========================================

@route_node_bp.route("/route-nodes", methods=["GET"])
def get_route_nodes():

    try:

        nodes = (
            RouteNode.query
            .order_by(RouteNode.node_id.asc())
            .all()
        )

        return jsonify({
            "success": True,
            "count": len(nodes),
            "route_nodes": [
                node.to_dict()
                for node in nodes
            ]
        }), 200

    except Exception as e:

        print("GET ROUTE NODES ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Could not retrieve route nodes",
            "error": str(e)
        }), 500


# ==========================================
# GET SINGLE ROUTE NODE
# ==========================================

@route_node_bp.route("/route-nodes/<int:node_id>", methods=["GET"])
def get_route_node(node_id):

    try:

        node = RouteNode.query.get(node_id)

        if not node:

            return jsonify({
                "success": False,
                "message": "Route node not found"
            }), 404

        return jsonify({
            "success": True,
            "route_node": node.to_dict()
        }), 200

    except Exception as e:

        print("GET ROUTE NODE ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Could not retrieve route node",
            "error": str(e)
        }), 500


# ==========================================
# CREATE ROUTE NODE
# ==========================================

@route_node_bp.route("/route-nodes", methods=["POST"])
def create_route_node():

    try:

        data = request.get_json()

        if not data:

            return jsonify({
                "success": False,
                "message": "Request body is required"
            }), 400

        latitude = data.get("latitude")
        longitude = data.get("longitude")

        if latitude is None or longitude is None:

            return jsonify({
                "success": False,
                "message": "latitude and longitude are required"
            }), 400

        node = RouteNode(
            location_id=data.get("location_id"),
            building_id=data.get("building_id"),
            latitude=latitude,
            longitude=longitude,
            node_type=data.get(
                "node_type",
                "intersection"
            ),
            status=data.get(
                "status",
                "active"
            )
        )

        db.session.add(node)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Route node created successfully",
            "route_node": node.to_dict()
        }), 201

    except Exception as e:

        db.session.rollback()

        print("CREATE ROUTE NODE ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Could not create route node",
            "error": str(e)
        }), 500


# ==========================================
# UPDATE ROUTE NODE
# ==========================================

@route_node_bp.route("/route-nodes/<int:node_id>", methods=["PUT"])
def update_route_node(node_id):

    try:

        node = RouteNode.query.get(node_id)

        if not node:

            return jsonify({
                "success": False,
                "message": "Route node not found"
            }), 404

        data = request.get_json()

        if not data:

            return jsonify({
                "success": False,
                "message": "Request body is required"
            }), 400

        if "location_id" in data:
            node.location_id = data["location_id"]

        if "building_id" in data:
            node.building_id = data["building_id"]

        if "latitude" in data:
            node.latitude = data["latitude"]

        if "longitude" in data:
            node.longitude = data["longitude"]

        if "node_type" in data:
            node.node_type = data["node_type"]

        if "status" in data:
            node.status = data["status"]

        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Route node updated successfully",
            "route_node": node.to_dict()
        }), 200

    except Exception as e:

        db.session.rollback()

        print("UPDATE ROUTE NODE ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Could not update route node",
            "error": str(e)
        }), 500


# ==========================================
# DELETE ROUTE NODE
# ==========================================

@route_node_bp.route("/route-nodes/<int:node_id>", methods=["DELETE"])
def delete_route_node(node_id):

    try:

        node = RouteNode.query.get(node_id)

        if not node:

            return jsonify({
                "success": False,
                "message": "Route node not found"
            }), 404

        db.session.delete(node)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Route node deleted successfully"
        }), 200

    except Exception as e:

        db.session.rollback()

        print("DELETE ROUTE NODE ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Could not delete route node",
            "error": str(e)
        }), 500

# =========================================================
#                    PATHWAY
# =========================================================


# ==========================================
# GET ALL PATHWAYS
# ==========================================

@route_node_bp.route("/pathways", methods=["GET"])
def get_pathways():

    try:

        pathways = (
            Pathway.query
            .order_by(Pathway.pathway_id.asc())
            .all()
        )

        return jsonify({
            "success": True,
            "count": len(pathways),
            "pathways": [
                pathway.to_dict()
                for pathway in pathways
            ]
        }), 200

    except Exception as e:

        print("GET PATHWAYS ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Could not retrieve pathways",
            "error": str(e)
        }), 500


# ==========================================
# GET SINGLE PATHWAY
# ==========================================

@route_node_bp.route("/pathways/<int:pathway_id>", methods=["GET"])
def get_pathway(pathway_id):

    try:

        pathway = Pathway.query.get(pathway_id)

        if not pathway:

            return jsonify({
                "success": False,
                "message": "Pathway not found"
            }), 404

        return jsonify({
            "success": True,
            "pathway": pathway.to_dict()
        }), 200

    except Exception as e:

        print("GET PATHWAY ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Could not retrieve pathway",
            "error": str(e)
        }), 500


# ==========================================
# CREATE PATHWAY
# ==========================================

@route_node_bp.route("/pathways", methods=["POST"])
def create_pathway():

    try:

        data = request.get_json()

        if not data:

            return jsonify({
                "success": False,
                "message": "Request body is required"
            }), 400

        source_node_id = data.get("source_node_id")
        destination_node_id = data.get("destination_node_id")
        path_type = data.get("path_type")
        distance_m = data.get("distance_m")
        estimated_minutes = data.get("estimated_minutes")

        if source_node_id is None:

            return jsonify({
                "success": False,
                "message": "source_node_id is required"
            }), 400

        if destination_node_id is None:

            return jsonify({
                "success": False,
                "message": "destination_node_id is required"
            }), 400

        if path_type is None:

            return jsonify({
                "success": False,
                "message": "path_type is required"
            }), 400

        if distance_m is None:

            return jsonify({
                "success": False,
                "message": "distance_m is required"
            }), 400

        if estimated_minutes is None:

            return jsonify({
                "success": False,
                "message": "estimated_minutes is required"
            }), 400

        # Make sure source and destination are not the same node
        if source_node_id == destination_node_id:

            return jsonify({
                "success": False,
                "message": "source_node_id and destination_node_id cannot be the same"
            }), 400

        # Verify source node exists
        source_node = RouteNode.query.get(source_node_id)

        if not source_node:

            return jsonify({
                "success": False,
                "message": "Source route node not found"
            }), 404

        # Verify destination node exists
        destination_node = RouteNode.query.get(destination_node_id)

        if not destination_node:

            return jsonify({
                "success": False,
                "message": "Destination route node not found"
            }), 404

        pathway = Pathway(
            source_node_id=source_node_id,
            destination_node_id=destination_node_id,
            path_type=path_type,
            distance_m=distance_m,
            estimated_minutes=estimated_minutes,
            status=data.get(
                "status",
                "active"
            ),
            shaded=data.get(
                "shaded",
                False
            ),
            surface_type=data.get(
                "surface_type"
            )
        )

        db.session.add(pathway)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Pathway created successfully",
            "pathway": pathway.to_dict()
        }), 201

    except Exception as e:

        db.session.rollback()

        print("CREATE PATHWAY ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Could not create pathway",
            "error": str(e)
        }), 500


# ==========================================
# UPDATE PATHWAY
# ==========================================

@route_node_bp.route("/pathways/<int:pathway_id>", methods=["PUT"])
def update_pathway(pathway_id):

    try:

        pathway = Pathway.query.get(pathway_id)

        if not pathway:

            return jsonify({
                "success": False,
                "message": "Pathway not found"
            }), 404

        data = request.get_json()

        if not data:

            return jsonify({
                "success": False,
                "message": "Request body is required"
            }), 400

        if "source_node_id" in data:

            source_node_id = data["source_node_id"]

            source_node = RouteNode.query.get(source_node_id)

            if not source_node:

                return jsonify({
                    "success": False,
                    "message": "Source route node not found"
                }), 404

            pathway.source_node_id = source_node_id

        if "destination_node_id" in data:

            destination_node_id = data["destination_node_id"]

            destination_node = RouteNode.query.get(destination_node_id)

            if not destination_node:

                return jsonify({
                    "success": False,
                    "message": "Destination route node not found"
                }), 404

            pathway.destination_node_id = destination_node_id

        if pathway.source_node_id == pathway.destination_node_id:

            return jsonify({
                "success": False,
                "message": "source_node_id and destination_node_id cannot be the same"
            }), 400

        if "path_type" in data:
            pathway.path_type = data["path_type"]

        if "distance_m" in data:
            pathway.distance_m = data["distance_m"]

        if "estimated_minutes" in data:
            pathway.estimated_minutes = data["estimated_minutes"]

        if "status" in data:
            pathway.status = data["status"]

        if "shaded" in data:
            pathway.shaded = data["shaded"]

        if "surface_type" in data:
            pathway.surface_type = data["surface_type"]

        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Pathway updated successfully",
            "pathway": pathway.to_dict()
        }), 200

    except Exception as e:

        db.session.rollback()

        print("UPDATE PATHWAY ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Could not update pathway",
            "error": str(e)
        }), 500


# ==========================================
# DELETE PATHWAY
# ==========================================

@route_node_bp.route("/pathways/<int:pathway_id>", methods=["DELETE"])
def delete_pathway(pathway_id):

    try:

        pathway = Pathway.query.get(pathway_id)

        if not pathway:

            return jsonify({
                "success": False,
                "message": "Pathway not found"
            }), 404

        db.session.delete(pathway)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Pathway deleted successfully"
        }), 200

    except Exception as e:

        db.session.rollback()

        print("DELETE PATHWAY ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Could not delete pathway",
            "error": str(e)
        }), 500

# =========================================================
#                    PATH POINT
# =========================================================


# ==========================================
# GET ALL PATH POINTS
# ==========================================

@route_node_bp.route("/path-points", methods=["GET"])
def get_path_points():

    try:

        points = (
            PathPoint.query
            .order_by(
                PathPoint.pathway_id.asc(),
                PathPoint.sequence_no.asc()
            )
            .all()
        )

        return jsonify({
            "success": True,
            "count": len(points),
            "path_points": [
                point.to_dict()
                for point in points
            ]
        }), 200

    except Exception as e:

        print("GET PATH POINTS ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Could not retrieve path points",
            "error": str(e)
        }), 500


# ==========================================
# GET SINGLE PATH POINT
# ==========================================

@route_node_bp.route("/path-points/<int:point_id>", methods=["GET"])
def get_path_point(point_id):

    try:

        point = PathPoint.query.get(point_id)

        if not point:

            return jsonify({
                "success": False,
                "message": "Path point not found"
            }), 404

        return jsonify({
            "success": True,
            "path_point": point.to_dict()
        }), 200

    except Exception as e:

        print("GET PATH POINT ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Could not retrieve path point",
            "error": str(e)
        }), 500


# ==========================================
# CREATE PATH POINT
# ==========================================

@route_node_bp.route("/path-points", methods=["POST"])
def create_path_point():

    try:

        data = request.get_json()

        if not data:

            return jsonify({
                "success": False,
                "message": "Request body is required"
            }), 400

        pathway_id = data.get("pathway_id")
        sequence_no = data.get("sequence_no")
        latitude = data.get("latitude")
        longitude = data.get("longitude")
        node_type = data.get("node_type")

        if pathway_id is None:
            return jsonify({
                "success": False,
                "message": "pathway_id is required"
            }), 400

        if sequence_no is None:
            return jsonify({
                "success": False,
                "message": "sequence_no is required"
            }), 400

        if latitude is None or longitude is None:
            return jsonify({
                "success": False,
                "message": "latitude and longitude are required"
            }), 400

        if node_type is None:
            return jsonify({
                "success": False,
                "message": "node_type is required"
            }), 400

        point = PathPoint(
            pathway_id=pathway_id,
            sequence_no=sequence_no,
            latitude=latitude,
            longitude=longitude,
            building_id=data.get("building_id"),
            node_type=node_type,
            status=data.get(
                "status",
                "active"
            )
        )

        db.session.add(point)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Path point created successfully",
            "path_point": point.to_dict()
        }), 201

    except Exception as e:

        db.session.rollback()

        print("CREATE PATH POINT ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Could not create path point",
            "error": str(e)
        }), 500


# ==========================================
# UPDATE PATH POINT
# ==========================================

@route_node_bp.route("/path-points/<int:point_id>", methods=["PUT"])
def update_path_point(point_id):

    try:

        point = PathPoint.query.get(point_id)

        if not point:

            return jsonify({
                "success": False,
                "message": "Path point not found"
            }), 404

        data = request.get_json()

        if not data:

            return jsonify({
                "success": False,
                "message": "Request body is required"
            }), 400

        if "pathway_id" in data:
            point.pathway_id = data["pathway_id"]

        if "sequence_no" in data:
            point.sequence_no = data["sequence_no"]

        if "latitude" in data:
            point.latitude = data["latitude"]

        if "longitude" in data:
            point.longitude = data["longitude"]

        if "building_id" in data:
            point.building_id = data["building_id"]

        if "node_type" in data:
            point.node_type = data["node_type"]

        if "status" in data:
            point.status = data["status"]

        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Path point updated successfully",
            "path_point": point.to_dict()
        }), 200

    except Exception as e:

        db.session.rollback()

        print("UPDATE PATH POINT ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Could not update path point",
            "error": str(e)
        }), 500


# ==========================================
# DELETE PATH POINT
# ==========================================

@route_node_bp.route("/path-points/<int:point_id>", methods=["DELETE"])
def delete_path_point(point_id):

    try:

        point = PathPoint.query.get(point_id)

        if not point:

            return jsonify({
                "success": False,
                "message": "Path point not found"
            }), 404

        db.session.delete(point)
        db.session.commit()

        return jsonify({
            "success": True,
            "message": "Path point deleted successfully"
        }), 200

    except Exception as e:

        db.session.rollback()

        print("DELETE PATH POINT ERROR:")
        print(e)

        return jsonify({
            "success": False,
            "message": "Could not delete path point",
            "error": str(e)
        }), 500