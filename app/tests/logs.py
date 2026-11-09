from datetime import datetime, timezone, timedelta

import pytest
from flask import Flask
from sqlalchemy import event

import logs as logs_module
from extensions import db
from logs import logs_bp
from model.app_user import AppUser
from model.building import Building
from model.location import Location
from model.user_history import UserHistory


class Query:
    def __init__(self, records): self.records = records
    def order_by(self, _): return self
    def all(self): return self.records


class Column:
    def desc(self): return self


def entry(identifier, created, category, actor, action, target, detail=None, target_id=None):
    return type("Log", (), {"id": identifier, "created_at": created, "category": category, "actor": actor, "action": action, "target": target, "target_id": target_id, "detail": detail, "to_dict": lambda self: {"id": str(self.id), "createdAt": self.created_at.isoformat(), "category": self.category, "actor": self.actor, "action": self.action, "target": self.target, "targetId": self.target_id, "detail": self.detail}})()


def client(monkeypatch, records, include_user_history=False):
    app = Flask(__name__)
    app.register_blueprint(logs_bp)
    monkeypatch.setattr(logs_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(logs_module, "AuditLog", type("AuditLogModel", (), {"query": Query(records), "created_at": Column()}))
    if not include_user_history:
        monkeypatch.setattr(logs_module, "UserHistory", type("UserHistoryModel", (), {"query": Query([])}))
    return app.test_client()


def test_logs_filters_and_paginates(monkeypatch):
    now = datetime.now(timezone.utc)
    records = [entry(1, now - timedelta(days=1), "Admin", "admin01", "Updated Location", "Library", "coordinates"), entry(2, now - timedelta(days=10), "User", "student", "Searched", "Library")]
    response = client(monkeypatch, records).get("/api/logs?category=Admin&q=COORD&date_range=7d&pageSize=1")
    assert response.status_code == 200
    assert response.json == {"items": [records[0].to_dict()], "total": 1, "page": 1, "pageSize": 1}


def test_logs_reject_invalid_filter(monkeypatch):
    assert client(monkeypatch, []).get("/api/logs?date_range=tomorrow").status_code == 400


def test_logs_filters_by_target_id(monkeypatch):
    now = datetime.now(timezone.utc)
    records = [
        entry(1, now, "Admin", "admin01", "update", "Engineering Hall", target_id="4"),
        entry(2, now, "Admin", "admin01", "update", "Other Building", target_id="5"),
    ]

    response = client(monkeypatch, records).get("/api/logs?target_id=4")

    assert response.status_code == 200
    assert response.json["items"] == [records[0].to_dict()]
    assert response.json["total"] == 1


def test_logs_requires_authentication(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(logs_bp)
    monkeypatch.setattr(logs_module, "admin_required", lambda: (None, ({"error": "Authentication required"}, 401)))
    assert app.test_client().get("/api/logs").status_code == 401


# ==========================================
# User App history, against a real database
# ==========================================


@pytest.fixture
def history_db(monkeypatch):
    """A SQLite database with the real models, and a count of its statements.

    The audit log is stood in for as above, so the statements counted are the
    user-history projection's own.
    """
    app = Flask(__name__)
    app.config.update(SQLALCHEMY_DATABASE_URI="sqlite://", SQLALCHEMY_TRACK_MODIFICATIONS=False, TESTING=True)
    db.init_app(app)
    app.register_blueprint(logs_bp)
    monkeypatch.setattr(logs_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(logs_module, "AuditLog", type("AuditLogModel", (), {"query": Query([]), "created_at": Column()}))

    with app.app_context():
        db.session.execute(db.text("ATTACH DATABASE ':memory:' AS public"))
        db.metadata.create_all(db.engine)
        statements = []

        def count(_conn, _cursor, statement, *_args):
            statements.append(statement)

        event.listen(db.engine, "before_cursor_execute", count)
        yield app.test_client(), statements
        event.remove(db.engine, "before_cursor_execute", count)
        db.session.remove()
        db.drop_all()


def seed_history(rows):
    """``rows`` history entries over distinct users, buildings and locations.

    Every row names its own user and either a building or a location, the
    shape that used to cost three lookups per row.
    """
    now = datetime.now(timezone.utc)
    for n in range(1, rows + 1):
        db.session.add(AppUser(id=n, username=f"student{n:02d}", status="active"))
        db.session.add(Building(building_id=n, building_code=f"B{n}", building_name=f"Hall {n}", classification="Building", status="active"))
        if n % 2:
            db.session.add(Location(location_id=n, building_id=n, type_id=1, location_code=f"L{n}", location_name=f"Room {n}"))
        db.session.add(UserHistory(
            id=n, user_id=n,
            building_id=None if n % 2 else n,
            location_id=n if n % 2 else None,
            created_at=now - timedelta(minutes=n),
        ))
    db.session.commit()


def test_user_activity_includes_destination_selections(history_db):
    client, _ = history_db
    now = datetime.now(timezone.utc)
    db.session.add(AppUser(id=9, username="student01", status="active"))
    db.session.add(Building(building_id=4, building_code="LIB", building_name="Library", classification="Building", status="active"))
    db.session.add(UserHistory(id=17, user_id=9, building_id=4, location_id=None, created_at=now))
    db.session.commit()

    response = client.get("/api/logs?category=User")

    assert response.status_code == 200
    assert response.json["total"] == 1
    item = response.json["items"][0]
    assert datetime.fromisoformat(item.pop("createdAt")).replace(tzinfo=timezone.utc) == now.replace(tzinfo=timezone.utc)
    assert item == {
        "id": "user-history-17",
        "category": "User",
        "actor": "student01",
        "action": "Searched Building",
        "target": "Library",
        "targetId": "4",
        "detail": "Destination selected in the User App",
    }


def test_user_activity_names_locations_and_falls_back_for_missing_rows(history_db):
    client, _ = history_db
    now = datetime.now(timezone.utc)
    db.session.add(Location(location_id=3, building_id=None, type_id=1, location_code="R3", location_name="Room 3"))
    db.session.add_all([
        UserHistory(id=1, user_id=None, location_id=3, created_at=now),
        # Rows a deletion left behind: the user, building and location are gone.
        UserHistory(id=2, user_id=404, building_id=405, created_at=now - timedelta(minutes=1)),
        UserHistory(id=3, user_id=None, building_id=None, location_id=None, created_at=now - timedelta(minutes=2)),
    ])
    db.session.commit()

    items = client.get("/api/logs?category=User").json["items"]

    assert [(i["actor"], i["action"], i["target"], i["targetId"]) for i in items] == [
        ("user:None", "Searched Location", "Room 3", "3"),
        ("user:404", "Searched Building", "Unknown destination", "405"),
        ("user:None", "Searched Building", "Unknown destination", None),
    ]


@pytest.mark.parametrize("rows", (1, 6, 40))
def test_user_activity_uses_the_same_statements_however_long_the_history(history_db, rows):
    """One query for the history and one each for its users, locations and
    buildings - not three more for every row (#155)."""

    client, statements = history_db
    seed_history(rows)
    statements.clear()

    response = client.get("/api/logs?category=User&pageSize=100")

    assert response.status_code == 200
    assert response.json["total"] == rows
    selects = [s for s in statements if s.lstrip().upper().startswith("SELECT")]
    # A one-row history names a location and no building, so it skips that lookup.
    assert len(selects) == (3 if rows == 1 else 4)
