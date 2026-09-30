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
from model.floor import Floor
from model.location import Location
from model.location_photo import LocationPhoto

# Large enough that fetching it would be the dominant cost of a request.
PNG_BYTES = bytes.fromhex("89504e470d0a1a0a") + b"pixels" * 8192

# An image column in a SELECT list: ``location_photo.content`` or a ``.photo``
# that is neither ``.photo_mime_type`` nor the cheap ``photo IS NOT NULL`` flag.
PHOTO_COLUMN = re.compile(
    r"\.content(?![_a-zA-Z])|\.photo(?![_a-zA-Z])(?! IS NOT NULL)"
)


class QueryLog(list):
    def selects(self, table=None):
        return [
            sql for sql in self
            if sql.startswith("SELECT") and (table is None or f"public.{table}" in sql)
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

    @event.listens_for(LocationPhoto, "before_insert")
    def _assign_photo_id(mapper, connection, target):
        # public.location_photo.photo_id is a Postgres identity column, which
        # SQLite will not fill in for a BIGINT primary key.
        if target.photo_id is None:
            target.photo_id = next(counter)

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
                photo=PNG_BYTES,
                photo_mime_type="image/png",
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
                photo=PNG_BYTES,
                photo_mime_type="image/png",
            )
        )
        db.session.commit()

        @event.listens_for(db.engine, "after_cursor_execute")
        def _record(conn, cursor, statement, parameters, context, executemany):
            log.append(" ".join(statement.split()))

        yield app.test_client(), log, app

    event.remove(LocationPhoto, "before_insert", _assign_photo_id)


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
        stored = db.session.get(Building, 1)
        assert stored.description == "after"
        assert stored.photo == PNG_BYTES


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
        stored = db.session.get(Location, 101)
        assert stored.description == "after"
        assert stored.photo == PNG_BYTES


def test_an_uploaded_photo_is_reported_without_being_read_back(client):
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
    with app.app_context():
        assert db.session.get(Building, 1).photo == replacement


def test_locations_list_reports_photos_without_selecting_them(client):
    http, log, _ = client
    log.clear()

    response = http.get("/api/actions/locations?pageSize=100")

    assert response.status_code == 200, response.get_json()
    items = response.get_json()["items"]
    assert items and all(item["hasPhoto"] for item in items)
    assert log.selecting_photo_bytes() == []


def test_a_deferred_photo_is_still_served_on_demand(client):
    http, log, _ = client
    log.clear()

    response = http.get("/api/actions/locations/1/photo?type=Building")

    assert response.status_code == 200
    assert response.data == PNG_BYTES
    # Fetched here, and only here: one statement, for one row.
    assert len(log.selecting_photo_bytes()) == 1


def _gallery_rows(app, owner_id=1):
    with app.app_context():
        return [
            (photo.photo_id, photo.position, photo.is_cover, photo.content)
            for photo in LocationPhoto.query.filter_by(
                owner_type="building", owner_id=owner_id
            ).order_by(LocationPhoto.position).all()
        ]


def test_a_gallery_save_mirrors_the_cover_without_moving_any_image(client):
    http, log, app = client
    first = bytes.fromhex("89504e470d0a1a0a") + b"a" * 4096
    second = bytes.fromhex("ffd8ff") + b"b" * 4096
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
    rows = _gallery_rows(app)
    assert [(position, is_cover) for _, position, is_cover, _ in rows] == [(0, False), (1, True)]
    with app.app_context():
        # The owner's own copy is the chosen cover, byte for byte.
        assert db.session.get(Building, 1).photo == second
    # Nothing was read back to get it there.
    assert during_request.selecting_photo_bytes() == []


def test_removing_the_last_photo_clears_the_owners_copy(client):
    http, log, app = client
    with app.app_context():
        db.session.add(LocationPhoto(
            photo_id=1, owner_type="building", owner_id=1, position=0,
            filename="front.png", mime_type="image/png", content=PNG_BYTES, is_cover=True,
        ))
        db.session.commit()
    log.clear()

    response = http.put(
        "/api/actions/locations/1",
        data={
            "name": "Building 1", "code": "B-1", "type": "Building",
            "removePhotoIds": "[1]",
        },
        content_type="multipart/form-data",
    )

    assert response.status_code == 200, response.get_json()
    assert _gallery_rows(app) == []
    with app.app_context():
        assert db.session.get(Building, 1).photo is None
    assert response.get_json()["hasPhoto"] is False


def test_gallery_metadata_listing_does_not_read_the_images(client):
    http, log, app = client
    with app.app_context():
        db.session.add_all(
            LocationPhoto(
                photo_id=index, owner_type="building", owner_id=1, position=index - 1,
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
        db.session.add_all([
            LocationPhoto(photo_id=1, owner_type="building", owner_id=1, position=0,
                          filename="a.png", mime_type="image/png", content=PNG_BYTES, is_cover=True),
            LocationPhoto(photo_id=2, owner_type="building", owner_id=1, position=1,
                          filename="b.jpg", mime_type="image/jpeg", content=wanted, is_cover=False),
        ])
        db.session.commit()
    log.clear()

    response = http.get("/api/actions/locations/1/photos/2?type=Building")

    assert response.status_code == 200
    assert response.data == wanted
    # One statement carries an image, and it is the one row asked for.
    assert len(log.selecting_photo_bytes()) == 1
