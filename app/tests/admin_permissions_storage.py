"""public.admin.permissions: SQL NULL is not the JSON scalar null.

A JSON column has two different nothings, and the one the schema means by "no
permissions recorded" is SQL NULL. Assigning Python ``None`` stored the JSON
scalar ``null`` instead - a value - which the migration's shape constraint
rejects, because ``jsonb_typeof('null')`` is ``'null'`` and not ``'object'``.
Creating a superadmin and promoting an administrator both assign ``None``
deliberately, so both failed with a check violation on PostgreSQL while every
SQLite and fake-store test passed. Neither carried the constraint (issue #145).

These tests carry it. They run against PostgreSQL when ``ISU_TEST_DATABASE_URL``
names a disposable one, applying the real migration file - which is where the
bug was found and the only place the genuine constraint can be used - and
otherwise against SQLite with the same rule written in SQLite's own JSON
functions, so an ordinary test run catches the regression too.

The assertions are made in SQL rather than through the ORM on purpose. Both
nothings deserialize to Python ``None``, so ``row.permissions is None`` passes
either way and is exactly the blind spot that let this ship.
"""

import os
import time
from pathlib import Path

import pytest
from flask import Flask
from sqlalchemy import Integer, SmallInteger
from sqlalchemy.ext.compiler import compiles

import admins as admins_module
import auth as auth_module
from admins import admins_bp
from auth import Admin
from extensions import db

MIGRATION = Path(__file__).resolve().parents[2] / "migrations" / "20261024_add_admin_permissions.sql"

# A disposable PostgreSQL, as the issue used. Absent, the suite still checks
# the rule - see the module docstring - so this is a sharpening, not a gate.
POSTGRES_URL = os.getenv("ISU_TEST_DATABASE_URL")


# public.admin.id is an identity column in PostgreSQL. SQLite only fills a key
# in by itself when the column is declared INTEGER, and SmallInteger renders as
# SMALLINT, so a route that lets the database assign the id cannot insert at
# all. This changes only what SQLite is handed at CREATE TABLE.
@compiles(SmallInteger, "sqlite")
def _smallint_is_integer_on_sqlite(type_, compiler, **kw):
    return "INTEGER"


# The migration's constraint, in SQLite's JSON functions. A trigger because
# SQLite cannot add a constraint to a table that already exists, and the model
# does not carry one - the constraint is the migration's, which is the whole
# reason a test has to put it back.
SQLITE_CONSTRAINT = """
create trigger public.admin_permissions_shape_on_{event}
before {event} on admin
for each row
when new.permissions is not null and not (
    json_valid(new.permissions)
    and json_type(new.permissions) = 'object'
    and json_type(new.permissions, '$.add') in ('true', 'false')
    and json_type(new.permissions, '$.edit') in ('true', 'false')
    and json_type(new.permissions, '$.delete') in ('true', 'false')
    and json_type(new.permissions, '$.changeUserStatus') in ('true', 'false')
)
begin
    select raise(ABORT, 'admin_permissions_shape');
end;
"""


@pytest.fixture(params=["sqlite", "postgresql"])
def app(request, monkeypatch, tmp_path):
    """One app per backend, with the permission-shape constraint in place."""

    backend = request.param
    if backend == "postgresql" and not POSTGRES_URL:
        pytest.skip("set ISU_TEST_DATABASE_URL to a disposable PostgreSQL to run this")

    app = Flask(__name__)
    app.config.update(
        SQLALCHEMY_DATABASE_URI=POSTGRES_URL if backend == "postgresql" else "sqlite://",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        TESTING=True,
        SECRET_KEY="test-secret",
    )
    db.init_app(app)
    app.register_blueprint(admins_bp)
    # The audit table's id is not autoincrement outside PostgreSQL, and what is
    # being tested is the column the administrator row stores.
    monkeypatch.setattr(admins_module, "log_audit", lambda *args, **kwargs: None)

    with app.app_context():
        if backend == "sqlite":
            # The models name their tables "public.x"; SQLite has no schemas.
            db.session.execute(db.text("ATTACH DATABASE ':memory:' AS public"))
        db.metadata.create_all(db.engine)

        if backend == "postgresql":
            # The genuine article, run exactly as a deployment would run it.
            db.session.execute(db.text(MIGRATION.read_text(encoding="utf-8")))
        else:
            for event in ("insert", "update"):
                db.session.execute(db.text(SQLITE_CONSTRAINT.format(event=event)))
        db.session.commit()

        app.backend = backend
        yield app

        db.session.rollback()
        db.session.remove()
        db.drop_all()


def add_admin(app, identifier, username, role="admin", permissions=None):
    with app.app_context():
        db.session.add(Admin(
            id=identifier,
            username=username,
            password="not-verified-here",
            gmail=f"{username}@isu.edu.ph",
            role=role,
            permissions=permissions,
        ))
        db.session.commit()


def signed_in(app, admin_id=1):
    client = app.test_client()
    with client.session_transaction() as flask_session:
        flask_session["admin_id"] = admin_id
        flask_session["admin_username"] = "admin01"
        # Creating and promoting both need a recent password confirmation.
        flask_session["reauth_at"] = time.time()
    return client


def stored_is_sql_null(app, username):
    """Whether the row holds SQL NULL, asked in SQL.

    The ORM cannot answer this: SQL NULL and the JSON scalar null both come
    back as Python None, which is why a passing ``is None`` assertion was no
    evidence at all.
    """

    with app.app_context():
        answered = db.session.execute(
            db.text("select permissions is null from public.admin where username = :username"),
            {"username": username},
        ).scalar()
    # A missing row answers None, which would read as "not null" and quietly
    # pass. SQLite answers 1 or 0 where PostgreSQL answers a boolean.
    assert answered is not None, f"no administrator named {username}"
    return bool(answered)


ALL_ON = {key: True for key in auth_module.PERMISSION_KEYS}


# ==========================================
# The constraint is really there
# ==========================================

def test_the_shape_constraint_is_armed(app):
    """Otherwise everything below would pass by not being checked.

    This is the assertion the original tests were missing: without it, a test
    that creates a superadmin proves only that nothing objected.
    """

    add_admin(app, 1, "admin01", role="superadmin")

    with app.app_context():
        with pytest.raises(Exception) as refused:
            db.session.execute(
                db.text("update public.admin set permissions = :value where username = 'admin01'"),
                {"value": "null"},
            )
            db.session.commit()
        db.session.rollback()

    assert "admin_permissions_shape" in str(refused.value)


def test_sql_null_itself_is_accepted(app):
    """The control the issue reported: assigning SQL NULL directly succeeds."""

    add_admin(app, 1, "admin01", role="superadmin")

    with app.app_context():
        db.session.execute(db.text(
            "update public.admin set permissions = null where username = 'admin01'"
        ))
        db.session.commit()

    assert stored_is_sql_null(app, "admin01") is True


# ==========================================
# Creating a superadmin
# ==========================================

NEW_SUPERADMIN = {
    "username": "admin_new",
    "email": "admin_new@isu.edu.ph",
    "password": "Another-secret1!",
    "role": "superadmin",
}


def test_creating_a_superadmin_succeeds_and_stores_sql_null(app):
    """The merge blocker: this answered 500 with a check violation."""

    add_admin(app, 1, "admin01", role="superadmin")

    response = signed_in(app).post("/api/admins", json=NEW_SUPERADMIN)

    assert response.status_code == 201
    assert response.json["admin"]["role"] == "superadmin"
    assert response.json["admin"]["permissions"] is None
    assert stored_is_sql_null(app, "admin_new") is True


def test_creating_a_superadmin_ignores_any_permissions_it_is_sent(app):
    """Ignored, not stored: a client may hold one form for both roles."""

    add_admin(app, 1, "admin01", role="superadmin")

    response = signed_in(app).post("/api/admins", json={**NEW_SUPERADMIN, "permissions": dict(ALL_ON)})

    assert response.status_code == 201
    assert stored_is_sql_null(app, "admin_new") is True


def test_creating_a_regular_administrator_stores_the_four_switches(app):
    """The other side of the same column: an object, and not NULL."""

    add_admin(app, 1, "admin01", role="superadmin")

    response = signed_in(app).post("/api/admins", json={
        **NEW_SUPERADMIN, "role": "admin", "permissions": dict(ALL_ON),
    })

    assert response.status_code == 201
    assert stored_is_sql_null(app, "admin_new") is False
    with app.app_context():
        record = Admin.query.filter_by(username="admin_new").one()
        assert record.permissions == ALL_ON


def test_a_new_administrator_with_no_permissions_named_stores_four_falses(app):
    """Not NULL: an unconfigured row reads as full access, and a new account
    has been given nothing."""

    add_admin(app, 1, "admin01", role="superadmin")

    response = signed_in(app).post("/api/admins", json={**NEW_SUPERADMIN, "role": "admin"})

    assert response.status_code == 201
    assert stored_is_sql_null(app, "admin_new") is False
    with app.app_context():
        assert Admin.query.filter_by(username="admin_new").one().permissions == {
            "add": False, "edit": False, "delete": False, "changeUserStatus": False,
        }


# ==========================================
# Promoting and demoting
# ==========================================

def test_promoting_an_administrator_succeeds_and_stores_sql_null(app):
    """The second half of the merge blocker, for the same reason."""

    add_admin(app, 1, "admin01", role="superadmin")
    add_admin(app, 2, "admin02", permissions=dict(ALL_ON))

    response = signed_in(app).put("/api/admins/2/role", json={"role": "superadmin"})

    assert response.status_code == 200
    assert response.json["admin"]["permissions"] is None
    assert stored_is_sql_null(app, "admin02") is True


def test_demoting_a_superadmin_stores_an_object_not_null(app):
    add_admin(app, 1, "admin01", role="superadmin")
    add_admin(app, 2, "admin02", role="superadmin")

    response = signed_in(app).put("/api/admins/2/role", json={
        "role": "admin", "permissions": dict(ALL_ON),
    })

    assert response.status_code == 200
    assert stored_is_sql_null(app, "admin02") is False


def test_setting_permissions_on_an_administrator_stores_an_object(app):
    add_admin(app, 1, "admin01", role="superadmin")
    add_admin(app, 2, "admin02")

    response = signed_in(app).put("/api/admins/2/permissions", json={
        "permissions": {"add": True, "edit": False, "delete": False, "changeUserStatus": True},
    })

    assert response.status_code == 200
    assert stored_is_sql_null(app, "admin02") is False
    with app.app_context():
        assert Admin.query.filter_by(username="admin02").one().permissions == {
            "add": True, "edit": False, "delete": False, "changeUserStatus": True,
        }


def test_a_promotion_round_trips_through_a_demotion(app):
    """Both directions in one request sequence, which is how the bug was found:
    the UI promotes and demotes the same row."""

    add_admin(app, 1, "admin01", role="superadmin")
    add_admin(app, 2, "admin02", permissions=dict(ALL_ON))
    client = signed_in(app)

    promoted = client.put("/api/admins/2/role", json={"role": "superadmin"})
    demoted = client.put("/api/admins/2/role", json={"role": "admin"})

    assert (promoted.status_code, demoted.status_code) == (200, 200)
    assert stored_is_sql_null(app, "admin02") is False
    with app.app_context():
        assert Admin.query.filter_by(username="admin02").one().permissions == {
            "add": False, "edit": False, "delete": False, "changeUserStatus": False,
        }
