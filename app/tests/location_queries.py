"""Query-level guards for the Locations update path.

The rest of this suite drives the handlers with fake sessions, which cannot show
which columns the ORM actually selects. These tests use a real session so that a
regression which reloads photo bytes, or re-reads the row after the commit,
fails here rather than only showing up as a slow request.
"""

import io
import itertools
import re

import pytest
from flask import Flask
from sqlalchemy import event

import actions as actions_module
from actions import actions_bp
from extensions import db
from model.audit_log import AuditLog  # noqa: F401  registered for create_all
from model.building import Building
from model.building_photo import BuildingPhoto
from model.floor import Floor
from model.location import Location
from model.location_photo import LocationPhoto

# Large enough that fetching it would be the dominant cost of a request.
PNG_BYTES = bytes.fromhex("89504e470d0a1a0a") + b"pixels" * 8192

# An image column in a SELECT list. Since the mirrored photo columns were
# dropped, ``content`` on one of the two gallery tables is the only one left.
PHOTO_COLUMN = re.compile(r"\.content(?![_a-zA-Z])")


class QueryLog(list):
    def selects(self, table=None):
        # Matched on a word boundary: ``public.building`` must not count the
        # ``public.building_photo`` subquery that rides along with every row.
        pattern = re.compile(rf"public\.{re.escape(table)}\b") if table else None
        return [
            sql for sql in self
            if sql.startswith("SELECT") and (pattern is None or pattern.search(sql))
        ]

    def selecting_photo_bytes(self):
        return [sql for sql in self.selects() if PHOTO_COLUMN.search(sql)]

    def after(self, prefix):
        """Statements from the first one starting with ``prefix`` onwards."""
        for index, sql in enumerate(self):
            if sql.startswith(prefix):
                return QueryLog(self[index:])
        raise AssertionError(f"no statement started with {prefix!r}: {list(self)}")


@pytest.fixture
def client(monkeypatch):
    """A real SQLite-backed app seeded with photo-carrying rows."""
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite://"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.register_blueprint(actions_bp)
    db.init_app(app)
    monkeypatch.setattr(actions_module, "admin_required", lambda: (object(), None))
    # public.audit_log.id is a Postgres identity column, which SQLite will not
    # fill in. Audit writes are covered elsewhere; these tests are about reads.
    monkeypatch.setattr(actions_module, "log_audit", lambda *args: None)

    counter = itertools.count(1000)

    def _assign_photo_id(mapper, connection, target):
        # photo_id is a Postgres identity column on both gallery tables, which
        # SQLite will not fill in for a BIGINT primary key.
        if target.photo_id is None:
            target.photo_id = next(counter)

    for model in (BuildingPhoto, LocationPhoto):
        event.listen(model, "before_insert", _assign_photo_id)

    log = QueryLog()
    with app.app_context():
        # public.* is a Postgres schema; SQLite reaches it as an attached database.
        db.session.execute(db.text("attach database ':memory:' as public"))
        db.create_all()
        db.session.add_all(
            Building(
                building_id=identifier,
                building_code=f"B-{identifier}",
                building_name=f"Building {identifier}",
                classification="Building",
                description="before",
            )
            for identifier in range(1, 21)
        )
        # Seeded so resolve_floor finds a Ground Floor instead of inserting one:
        # public.floor.floor_id is a Postgres identity column.
        db.session.add(Floor(floor_id=1, building_id=1, floor_number=0))
        db.session.add(
            Location(
                location_id=101,
                building_id=1,
                type_id=1,
                floor_id=1,
                location_code="ENG-101",
                location_name="Room 101",
                description="before",
            )
        )
        db.session.flush()
        # Every seeded owner carries a cover photo, so ``hasPhoto`` is true
        # across the board and a regression that reads images shows up.
        db.session.add_all(
            BuildingPhoto(
                building_id=identifier, position=0, filename="cover.png",
                mime_type="image/png", content=PNG_BYTES, is_cover=True,
            )
            for identifier in range(1, 21)
        )
        db.session.add(
            LocationPhoto(
                location_id=101, position=0, filename="cover.png",
                mime_type="image/png", content=PNG_BYTES, is_cover=True,
            )
        )
        db.session.commit()

        @event.listens_for(db.engine, "after_cursor_execute")
        def _record(conn, cursor, statement, parameters, context, executemany):
            log.append(" ".join(statement.split()))

        yield app.test_client(), log, app

    for model in (BuildingPhoto, LocationPhoto):
        event.remove(model, "before_insert", _assign_photo_id)


def _cover(app, model, column, owner_id):
    """The owner's cover row as ``(photo_id, content)``, or None."""
    with app.app_context():
        photo = (
            model.query
            .options(db.undefer(model.content))
            .filter_by(**{column: owner_id, "is_cover": True})
            .first()
        )
        return None if photo is None else (photo.photo_id, photo.content)


def _gallery_rows(app, owner_id=1):
    with app.app_context():
        return [
            (photo.photo_id, photo.position, photo.is_cover)
            for photo in BuildingPhoto.query.filter_by(building_id=owner_id)
            .order_by(BuildingPhoto.position).all()
        ]


def _metadata_put(client, log, payload):
    log.clear()
    response = client.put("/api/actions/locations/1", json=payload)
    assert response.status_code == 200, response.get_json()
    return response


def test_metadata_only_building_update_never_fetches_photo_bytes(client):
    http, log, app = client

    response = _metadata_put(http, log, {
        "name": "Building 1", "code": "B-1", "type": "Building", "function": "after",
    })

    assert log.selecting_photo_bytes() == []
    assert response.get_json()["function"] == "after"
    with app.app_context():
        assert db.session.get(Building, 1).description == "after"
    assert _cover(app, BuildingPhoto, "building_id", 1)[1] == PNG_BYTES


def test_metadata_only_building_update_does_not_reread_the_row_after_writing(client):
    http, log, _ = client

    response = _metadata_put(http, log, {
        "name": "Building 1", "code": "B-1", "type": "Building", "function": "after",
    })

    assert log.after("UPDATE public.building").selects("building") == []
    # The response still reports the untouched photo without reading it back.
    assert response.get_json()["hasPhoto"] is True


def test_building_update_reads_one_building_row_not_the_whole_table(client):
    http, log, _ = client

    _metadata_put(http, log, {
        "name": "Building 1", "code": "B-1", "type": "Building", "function": "after",
    })

    # One lean index over the table for the duplicate-code check, and one row
    # for the record being edited. Neither carries an image.
    assert len(log.selects("building")) == 2
    assert log.selecting_photo_bytes() == []


def test_indoor_metadata_update_also_leaves_photos_on_the_server(client):
    http, log, app = client

    log.clear()
    response = http.put("/api/actions/locations/101", json={
        "name": "Room 101", "code": "ENG-101", "type": "Room",
        "parentId": "1", "floor": "Ground Floor", "function": "after",
    })

    assert response.status_code == 200, response.get_json()
    assert log.selecting_photo_bytes() == []
    assert log.after("UPDATE public.location").selects("location") == []
    with app.app_context():
        assert db.session.get(Location, 101).description == "after"
    assert _cover(app, LocationPhoto, "location_id", 101)[1] == PNG_BYTES


def test_the_single_photo_field_becomes_the_cover_without_being_read_back(client):
    http, log, app = client
    replacement = bytes.fromhex("ffd8ff") + b"jpeg" * 512
    log.clear()

    response = http.put(
        "/api/actions/locations/1",
        data={
            "name": "Building 1", "code": "B-1", "type": "Building",
            "photo": (io.BytesIO(replacement), "cover.jpg", "image/jpeg"),
        },
        content_type="multipart/form-data",
    )

    assert response.status_code == 200, response.get_json()
    assert response.get_json()["hasPhoto"] is True
    assert log.selecting_photo_bytes() == []
    # The upload landed in the gallery and took the cover from the seeded row.
    assert _cover(app, BuildingPhoto, "building_id", 1)[1] == replacement
    assert len(_gallery_rows(app)) == 2


def test_locations_list_reports_photos_without_selecting_them(client):
    http, log, _ = client
    log.clear()

    response = http.get("/api/actions/locations?pageSize=100")

    assert response.status_code == 200, response.get_json()
    items = response.get_json()["items"]
    assert items and all(item["hasPhoto"] for item in items)
    assert log.selecting_photo_bytes() == []


def test_the_cover_is_still_served_on_demand(client):
    http, log, _ = client
    log.clear()

    response = http.get("/api/actions/locations/1/photo?type=Building")

    assert response.status_code == 200
    assert response.data == PNG_BYTES
    # Fetched here, and only here: one statement, for one row.
    assert len(log.selecting_photo_bytes()) == 1


def test_a_gallery_save_picks_a_cover_without_moving_any_image(client):
    http, log, app = client
    first = bytes.fromhex("89504e470d0a1a0a") + b"a" * 4096
    second = bytes.fromhex("ffd8ff") + b"b" * 4096
    with app.app_context():
        # Start from an empty gallery so coverIndex addresses the uploads.
        BuildingPhoto.query.filter_by(building_id=1).delete()
        db.session.commit()
    log.clear()

    response = http.put(
        "/api/actions/locations/1",
        data={
            "name": "Building 1", "code": "B-1", "type": "Building",
            "photos": [
                (io.BytesIO(first), "front.png", "image/png"),
                (io.BytesIO(second), "side.jpg", "image/jpeg"),
            ],
            "coverIndex": "1",
        },
        content_type="multipart/form-data",
    )
    # Snapshot before the assertions below read images themselves.
    during_request = QueryLog(log)

    assert response.status_code == 200, response.get_json()
    assert [(position, is_cover) for _, position, is_cover in _gallery_rows(app)] == [
        (0, False), (1, True),
    ]
    # is_cover is the only record of the choice now, and it is the second
    # upload, byte for byte.
    assert _cover(app, BuildingPhoto, "building_id", 1)[1] == second
    # Nothing was read back to get it there.
    assert during_request.selecting_photo_bytes() == []


def test_removing_the_last_photo_leaves_the_owner_with_no_cover(client):
    http, log, app = client
    photo_id = _cover(app, BuildingPhoto, "building_id", 1)[0]
    log.clear()

    response = http.put(
        "/api/actions/locations/1",
        data={
            "name": "Building 1", "code": "B-1", "type": "Building",
            "removePhotoIds": f"[{photo_id}]",
        },
        content_type="multipart/form-data",
    )

    assert response.status_code == 200, response.get_json()
    assert _gallery_rows(app) == []
    assert _cover(app, BuildingPhoto, "building_id", 1) is None
    assert response.get_json()["hasPhoto"] is False


def test_gallery_metadata_listing_does_not_read_the_images(client):
    http, log, app = client
    with app.app_context():
        BuildingPhoto.query.filter_by(building_id=1).delete()
        db.session.add_all(
            BuildingPhoto(
                photo_id=index, building_id=1, position=index - 1,
                filename=f"photo-{index}.png", mime_type="image/png",
                content=PNG_BYTES, is_cover=index == 1,
            )
            for index in (1, 2, 3)
        )
        db.session.commit()
    log.clear()

    response = http.get("/api/actions/locations/1/photos?type=Building")

    assert response.status_code == 200, response.get_json()
    assert [item["name"] for item in response.get_json()["items"]] == [
        "photo-1.png", "photo-2.png", "photo-3.png",
    ]
    assert log.selecting_photo_bytes() == []


def test_serving_one_gallery_photo_reads_only_that_photo(client):
    http, log, app = client
    wanted = bytes.fromhex("ffd8ff") + b"wanted" * 512
    with app.app_context():
        BuildingPhoto.query.filter_by(building_id=1).delete()
        db.session.add_all([
            BuildingPhoto(photo_id=1, building_id=1, position=0, filename="a.png",
                          mime_type="image/png", content=PNG_BYTES, is_cover=True),
            BuildingPhoto(photo_id=2, building_id=1, position=1, filename="b.jpg",
                          mime_type="image/jpeg", content=wanted, is_cover=False),
        ])
        db.session.commit()
    log.clear()

    response = http.get("/api/actions/locations/1/photos/2?type=Building")

    assert response.status_code == 200
    assert response.data == wanted
    # One statement carries an image, and it is the one row asked for.
    assert len(log.selecting_photo_bytes()) == 1


def test_a_buildings_photos_and_its_locations_are_addressed_separately(client):
    """The two galleries are independent tables keyed by their own owner.

    Building 1 and Location 101 both exist; before the split they shared one
    table and one id space, so the wrong owner_type could serve the wrong image.
    """
    http, _, app = client

    building = http.get("/api/actions/locations/1/photos?type=Building")
    indoor = http.get("/api/actions/locations/101/photos?type=Room")

    assert building.status_code == 200 and indoor.status_code == 200
    assert len(building.get_json()["items"]) == 1
    assert len(indoor.get_json()["items"]) == 1
    with app.app_context():
        assert BuildingPhoto.query.filter_by(building_id=101).count() == 0
        assert LocationPhoto.query.filter_by(location_id=1).count() == 0


def test_retiring_a_building_and_an_indoor_location_round_trips_through_both_tables(client):
    """public.building.status and public.location.status, over a real session.

    The fake-session tests show the handler assigns the column; this shows the
    value survives the commit in each of the two tables and reads back as the
    directory's spelling.
    """
    http, _, app = client

    building = http.put("/api/actions/locations/1", json={
        "name": "Building 1", "code": "B-1", "type": "Building", "status": "Inactive",
    })
    indoor = http.put("/api/actions/locations/101", json={
        "name": "Room 101", "code": "ENG-101", "type": "Room",
        "parentId": "1", "floor": "Ground Floor", "status": "Inactive",
    })

    assert building.status_code == 200, building.get_json()
    assert indoor.status_code == 200, indoor.get_json()
    assert building.get_json()["status"] == "Inactive"
    assert indoor.get_json()["status"] == "Inactive"
    with app.app_context():
        assert db.session.get(Building, 1).status == "inactive"
        assert db.session.get(Location, 101).status == "inactive"
        # The edit is scoped to the row it names.
        assert db.session.get(Building, 2).status == "active"


def test_an_edit_that_omits_the_status_leaves_a_retired_record_retired(client):
    """A form that never touched STATUS cannot revive a retired record."""
    http, _, app = client

    http.put("/api/actions/locations/101", json={
        "name": "Room 101", "code": "ENG-101", "type": "Room",
        "parentId": "1", "floor": "Ground Floor", "status": "Inactive",
    })
    response = http.put("/api/actions/locations/101", json={
        "name": "Room 101", "code": "ENG-101", "type": "Room",
        "parentId": "1", "floor": "Ground Floor", "function": "after",
    })

    assert response.status_code == 200, response.get_json()
    assert response.get_json()["status"] == "Inactive"
    with app.app_context():
        record = db.session.get(Location, 101)
        assert record.status == "inactive"
        assert record.description == "after"
