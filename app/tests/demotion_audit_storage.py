"""A demotion and its reasons, through a real database (issue #166).

The route tests in ``admins.py`` run over a fake store whose ``log_audit`` is a
recorder, so they cannot show that the role and its audit row commit or roll
back together, nor what ``GET /api/logs`` makes of the stored row once the
account it names has been renamed or removed. These do, on SQLite always and
on PostgreSQL when ``ISU_TEST_DATABASE_URL`` names a disposable one. Nothing
here applies a migration to anything but that disposable database: none is
needed, since the reasons live in the existing ``audit_log.detail`` text.
"""

import json
import os
import time

import pytest
from flask import Flask
from sqlalchemy import BigInteger, SmallInteger
from sqlalchemy.ext.compiler import compiles

import admins as admins_module
from admins import admins_bp
from auth import Admin
from extensions import db
from logs import logs_bp
from model.audit_log import AuditLog

POSTGRES_URL = os.getenv("ISU_TEST_DATABASE_URL")


# SQLite only fills a key in by itself when the column is declared INTEGER.
# public.admin.id is a SmallInteger and public.audit_log.id a BigInteger; both
# are identity columns on PostgreSQL. This changes only what SQLite is handed.
@compiles(SmallInteger, "sqlite")
@compiles(BigInteger, "sqlite")
def _integer_on_sqlite(type_, compiler, **kw):
    return "INTEGER"


@pytest.fixture(params=["sqlite", "postgresql"])
def app(request):
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
    app.register_blueprint(logs_bp)

    with app.app_context():
        if backend == "sqlite":
            db.session.execute(db.text("ATTACH DATABASE ':memory:' AS public"))
        db.metadata.create_all(db.engine)
        for identifier, username, role in ((1, "admin01", "superadmin"), (2, "admin02", "superadmin")):
            db.session.add(Admin(
                id=identifier, username=username, password="not-verified-here",
                gmail=f"{username}@isu.edu.ph", role=role, status="active",
            ))
        db.session.commit()

        yield app

        db.session.rollback()
        db.session.remove()
        db.drop_all()


def signed_in(app, admin_id=1):
    client = app.test_client()
    with client.session_transaction() as flask_session:
        flask_session["admin_id"] = admin_id
        flask_session["admin_username"] = "admin01"
        flask_session["reauth_at"] = time.time()
    return client


def stored(app):
    with app.app_context():
        db.session.expire_all()
        role = db.session.get(Admin, 2).role if db.session.get(Admin, 2) else None
        events = [(row.action, row.target_id, row.detail) for row in AuditLog.query.order_by(AuditLog.id).all()]
        return role, events


def demotion_logs(client):
    response = client.get("/api/logs?category=Admin")
    assert response.status_code == 200
    return [item for item in response.json["items"] if item["action"] == "demote"]


EXPLANATION = "<b>Moved</b> to the Registrar & \"won't\" need it"


def test_the_role_and_its_reasons_commit_together(app):
    response = signed_in(app).put("/api/admins/2/role", json={
        "role": "admin", "reasons": ["other", "left_team"], "otherReason": f"  {EXPLANATION}  ",
    })

    assert response.status_code == 200
    role, events = stored(app)
    assert role == "admin"
    assert len(events) == 1
    action, target_id, detail = events[0]
    assert (action, target_id) == ("demote", "2")
    assert json.loads(detail) == {
        "kind": "demotion", "targetName": "admin02",
        "reasons": ["left_team", "other"], "otherReason": EXPLANATION,
    }


def test_an_invalid_demotion_writes_neither(app):
    response = signed_in(app).put("/api/admins/2/role", json={"role": "admin", "reasons": []})

    assert response.status_code == 400
    assert stored(app) == ("superadmin", [])


def test_an_audit_row_that_cannot_be_written_takes_the_role_change_with_it(app, monkeypatch):
    """The audit row is staged in the role change's transaction, so a failure
    writing it - here a NOT NULL violation at COMMIT - leaves the role alone."""

    def broken_audit(category, actor, action, target, target_id=None, detail=None):
        db.session.add(AuditLog(category=None, actor="admin01", action=action, target=target,
                                target_id=str(target_id), detail=detail))

    monkeypatch.setattr(admins_module, "log_audit", broken_audit)

    response = signed_in(app).put("/api/admins/2/role", json={"role": "admin", "reasons": ["role_changed"]})

    assert response.status_code == 500
    assert stored(app) == ("superadmin", [])


def test_system_logs_show_the_reasons_after_a_rename_and_a_removal(app):
    client = signed_in(app)
    client.put("/api/admins/2/role", json={
        "role": "admin", "reasons": ["security_concern", "other"], "otherReason": EXPLANATION,
    })

    with app.app_context():
        db.session.get(Admin, 2).username = "renamed02"
        db.session.commit()
    after_rename = demotion_logs(client)

    with app.app_context():
        db.session.delete(db.session.get(Admin, 2))
        db.session.commit()
    after_removal = demotion_logs(client)

    expected = {
        "targetName": "admin02",
        "reasons": ["security_concern", "other"],
        "otherReason": EXPLANATION,
    }
    for items in (after_rename, after_removal):
        assert len(items) == 1
        item = items[0]
        assert (item["actor"], item["target"], item["targetId"]) == ("admin01", "Administrator", "2")
        assert item["createdAt"]
        assert item["demotion"] == expected
        # Free text comes back as the text it was, for the client to render as text.
        assert item["detail"] == f"admin02. Reasons: Security concern, Other reason. Other reason: {EXPLANATION}"


def test_the_log_search_finds_a_demotion_by_its_explanation(app):
    client = signed_in(app)
    client.put("/api/admins/2/role", json={"role": "admin", "reasons": ["other"], "otherReason": "Registrar transfer"})

    response = client.get("/api/logs?q=registrar%20transfer")

    assert [item["action"] for item in response.json["items"]] == ["demote"]


def test_a_demotion_recorded_before_reasons_reads_as_it_always_did(app):
    with app.app_context():
        db.session.add(AuditLog(category="Admin", actor="admin01", action="demote",
                                target="Administrator", target_id="2", detail="admin02"))
        db.session.commit()

    items = demotion_logs(signed_in(app))

    assert [item["detail"] for item in items] == ["admin02"]
    assert "demotion" not in items[0]
