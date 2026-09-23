from datetime import datetime, timedelta, timezone

import pytest
from flask import Flask
from sqlalchemy import event

import users as users_module
from extensions import db
from model.app_user import AppUser, UserInfo
from users import users_bp


@pytest.fixture
def app(monkeypatch):
    app = Flask(__name__)
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite://",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        TESTING=True,
    )
    db.init_app(app)
    app.register_blueprint(users_bp)
    monkeypatch.setattr(users_module, "admin_required", lambda: (object(), None))

    with app.app_context():
        db.session.execute(db.text("ATTACH DATABASE ':memory:' AS public"))
        db.metadata.create_all(db.engine)
        yield app
        db.session.remove()
        db.drop_all()


def add_users(app, *records):
    with app.app_context():
        users = []
        for identifier, username, created_at, info_exists in records:
            info_id = identifier * 100
            if info_exists:
                db.session.add(UserInfo(id=info_id, created_at=created_at))
            users.append(
                AppUser(
                    id=identifier,
                    username=username,
                    info_id=info_id if info_exists else None,
                )
            )
        db.session.add_all(users)
        db.session.commit()


def test_users_searches_and_filters_registration_range(app):
    now = datetime.now(timezone.utc)
    add_users(
        app,
        (1, "Admin01", now - timedelta(days=2), True),
        (2, "admin-old", now - timedelta(days=40), True),
        (3, "admin-no-info", None, False),
    )

    statements = []
    with app.app_context():
        @event.listens_for(db.engine, "before_cursor_execute")
        def capture_sql(_connection, _cursor, statement, _parameters, _context, _executemany):
            statements.append(statement.upper())

    try:
        response = app.test_client().get(
            "/api/users?q=ADMIN&created_range=7d&page=1&pageSize=1"
        )
    finally:
        with app.app_context():
            event.remove(db.engine, "before_cursor_execute", capture_sql)

    assert response.status_code == 200
    assert response.json["items"][0]["id"] == "1"
    assert response.json["items"][0]["username"] == "Admin01"
    assert response.json["items"][0]["createdAt"].endswith("+00:00")
    assert response.json["total"] == 1
    assert response.json["page"] == 1
    assert response.json["pageSize"] == 1
    assert any("COUNT(" in statement for statement in statements)
    assert any("LEFT OUTER JOIN" in statement for statement in statements)
    assert any("LIMIT" in statement and "OFFSET" in statement for statement in statements)


def test_users_all_time_keeps_null_registration_details_last_and_breaks_ties_by_id(app):
    created = datetime(2026, 9, 5, 12, 0, tzinfo=timezone.utc)
    add_users(
        app,
        (20, "same-time-high-id", created, True),
        (10, "same-time-low-id", created, True),
        (30, "with-info-null-date", None, True),
        (40, "without-info", None, False),
        (50, "newest", created + timedelta(days=1), True),
    )

    response = app.test_client().get("/api/users?pageSize=10")

    assert response.status_code == 200
    assert [item["username"] for item in response.json["items"]] == [
        "newest",
        "same-time-low-id",
        "same-time-high-id",
        "with-info-null-date",
        "without-info",
    ]
    assert response.json["total"] == 5
    assert response.json["items"][-2]["createdAt"] is None
    assert response.json["items"][-1]["createdAt"] is None


def test_users_paginates_after_database_count_and_ordering(app):
    created = datetime(2026, 9, 5, 12, 0, tzinfo=timezone.utc)
    add_users(
        app,
        (1, "one", created + timedelta(days=3), True),
        (2, "two", created + timedelta(days=2), True),
        (3, "three", created + timedelta(days=1), True),
    )

    response = app.test_client().get("/api/users?page=2&pageSize=1")

    assert response.status_code == 200
    assert response.json["items"][0]["username"] == "two"
    assert response.json["total"] == 3
    assert response.json["page"] == 2
    assert response.json["pageSize"] == 1


def test_users_treats_search_wildcards_as_literal_characters(app):
    created = datetime(2026, 9, 5, 12, 0, tzinfo=timezone.utc)
    add_users(
        app,
        (1, "a_b", created, True),
        (2, "alice", created, True),
    )

    response = app.test_client().get("/api/users?q=_")

    assert response.status_code == 200
    assert [item["username"] for item in response.json["items"]] == ["a_b"]


@pytest.mark.parametrize(
    "query_string",
    [
        {"created_range": "tomorrow"},
        {"page": "0"},
        {"page": "not-a-number"},
        {"pageSize": "0"},
        {"pageSize": "101"},
    ],
)
def test_users_reject_invalid_inputs(app, query_string):
    response = app.test_client().get("/api/users", query_string=query_string)

    assert response.status_code == 400
    assert response.json["success"] is False


def test_users_requires_authentication(monkeypatch):
    app = Flask(__name__)
    app.register_blueprint(users_bp)
    monkeypatch.setattr(
        users_module,
        "admin_required",
        lambda: (None, ({"error": "Authentication required"}, 401)),
    )

    response = app.test_client().get("/api/users")

    assert response.status_code == 401
