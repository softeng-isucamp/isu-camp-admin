"""Query-level guards for the Locations update path.

The rest of this suite drives the handlers with fake sessions, which cannot show
which columns the ORM actually selects. These tests use a real session so that a
regression which reloads photo bytes, or re-reads the row after the commit,
fails here rather than only showing up as a slow request.
"""

import io
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
from model.location_photo import LocationPhoto  # noqa: F401  for create_all

# Large enough that fetching it would be the dominant cost of a request.
PNG_BYTES = bytes.fromhex("89504e470d0a1a0a") + b"pixels" * 8192

# ``.photo`` selected as a column: neither ``.photo_mime_type`` nor the
# ``photo IS NOT NULL`` presence flag, both of which are cheap by design.
PHOTO_COLUMN = re.compile(r"\.photo(?![_a-zA-Z])(?! IS NOT NULL)")


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
