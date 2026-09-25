from database import app


def test_indoor_marker_patch_preflight_is_allowed_for_map_editor():
    response = app.test_client().options(
        "/api/map/buildings/1/indoor-locations/6",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "PATCH",
            "Access-Control-Request-Headers": "content-type",
        },
    )

    assert response.status_code == 200
    assert response.headers["Access-Control-Allow-Origin"] == "http://localhost:5173"
    assert "PATCH" in response.headers["Access-Control-Allow-Methods"]
