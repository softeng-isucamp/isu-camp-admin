import json
import subprocess
import time

import pytest
from flask import Flask

import backups as backups_route
from auth import Admin
from extensions import db
from backups import backups_bp
from services import backup_jobs
from services.security import hash_password

PASSWORD = "Str0ngCurrent1"


@pytest.fixture
def app(monkeypatch, tmp_path):
    app = Flask(__name__)
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite://",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        TESTING=True,
        SECRET_KEY="test-secret",
    )
    db.init_app(app)
    app.register_blueprint(backups_bp)
    monkeypatch.setattr(backups_route, "rate_limited", lambda *args, **kwargs: None)
    monkeypatch.setattr(backups_route, "log_audit", lambda *args, **kwargs: None)
    # Archives go to a temp directory, never the real backups/ folder.
    monkeypatch.setenv("BACKUP_DIR", str(tmp_path))
    monkeypatch.setenv("SUPABASE_DATABASE_URL",
                       "postgresql+psycopg2://u:p@db.example.com:5432/postgres")
    # Jobs live in a module-level registry; a test must not see another's.
    backup_jobs._jobs.clear()

    with app.app_context():
        db.session.execute(db.text("ATTACH DATABASE ':memory:' AS public"))
        db.metadata.create_all(db.engine)
        yield app
        db.session.remove()
        db.drop_all()
    backup_jobs._jobs.clear()


def sign_in(monkeypatch, role="superadmin", identifier=1):
    record = Admin(
        id=identifier, username="admin01", gmail="a@isu.edu.ph",
        password=hash_password(PASSWORD), status="active", role=role,
    )
    db.session.add(record)
    db.session.commit()
    monkeypatch.setattr(
        backups_route, "admin_required",
        lambda: (db.session.get(Admin, identifier), None),
    )
    return record


def wait_for_terminal(job_id, timeout=5):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = backup_jobs.get_job(job_id)
        if job and job["status"] in backup_jobs.TERMINAL_STATUSES:
            return job
        time.sleep(0.05)
    return backup_jobs.get_job(job_id)


class FakeCompleted:
    def __init__(self, returncode=0, stderr=""):
        self.returncode = returncode
        self.stderr = stderr
        self.stdout = ""


# ==========================================
# AUTHORIZATION
# ==========================================

@pytest.mark.parametrize("method, path", (
    ("get", "/api/backups"),
    ("post", "/api/backups"),
    ("post", "/api/backups/x/restore"),
    ("get", "/api/jobs/x"),
))
def test_every_route_refuses_a_plain_administrator(app, monkeypatch, method, path):
    """The panel is hidden from non-superadmins, but the gate lives here."""

    with app.app_context():
        sign_in(monkeypatch, role="admin")
        response = getattr(app.test_client(), method)(path, json={})

    assert response.status_code == 403
    assert "superadministrator" in response.get_json()["message"]


@pytest.mark.parametrize("method, path", (
    ("get", "/api/backups"),
    ("post", "/api/backups"),
    ("get", "/api/jobs/x"),
))
def test_every_route_requires_a_session(app, monkeypatch, method, path):
    from flask import jsonify

    monkeypatch.setattr(
        backups_route, "admin_required",
        lambda: (None, (jsonify({"success": False, "message": "Authentication required"}), 401)),
    )

    with app.app_context():
        assert getattr(app.test_client(), method)(path, json={}).status_code == 401


# ==========================================
# LISTING
# ==========================================

def test_history_is_empty_before_any_backup(app, monkeypatch):
    with app.app_context():
        sign_in(monkeypatch)
        response = app.test_client().get("/api/backups")

    assert response.status_code == 200
    assert response.get_json() == {"items": [], "activeJob": None}


def test_history_describes_stored_archives_newest_first(app, monkeypatch, tmp_path):
    with app.app_context():
        sign_in(monkeypatch)
        for name, when in (("20261001-000000Z", "2026-10-01T00:00:00Z"),
                           ("20261009-000000Z", "2026-10-09T00:00:00Z")):
            (tmp_path / f"{name}.dump").write_bytes(b"PGDMP" + b"x" * 100)
            (tmp_path / f"{name}.json").write_text(json.dumps({
                "createdAt": when, "createdBy": "admin01",
                "scope": "public schema", "status": "ready",
            }), encoding="utf-8")

        items = app.test_client().get("/api/backups").get_json()["items"]

    assert [item["id"] for item in items] == ["20261009-000000Z", "20261001-000000Z"]
    assert items[0]["createdBy"] == "admin01"
    assert items[0]["sizeBytes"] == 105
    assert items[0]["status"] == "ready"


def test_an_archive_without_metadata_is_still_listed(app, monkeypatch, tmp_path):
    """A dump on disk is real even if its sidecar was lost."""

    with app.app_context():
        sign_in(monkeypatch)
        (tmp_path / "orphan.dump").write_bytes(b"PGDMP")

        items = app.test_client().get("/api/backups").get_json()["items"]

    assert len(items) == 1
    assert items[0]["id"] == "orphan"
    assert items[0]["createdBy"] == "unknown"


def test_created_at_is_z_suffixed_not_an_offset(app, monkeypatch, tmp_path):
    """services/profile.ts parses createdAt with Zod's z.string().datetime().

    That rejects a "+00:00" offset unless told to allow one, and Python's
    isoformat() writes exactly that - which failed every row in the panel with
    "Invalid datetime" while the timestamps were perfectly correct.
    """

    with app.app_context():
        sign_in(monkeypatch)
        (tmp_path / "a.dump").write_bytes(b"PGDMP")
        (tmp_path / "a.json").write_text(json.dumps({
            # The form the old code wrote.
            "createdAt": "2026-10-10T11:18:10.116684+00:00",
            "createdBy": "user", "scope": "public schema", "status": "ready",
        }), encoding="utf-8")

        items = app.test_client().get("/api/backups").get_json()["items"]

    assert items[0]["createdAt"] == "2026-10-10T11:18:10.116684Z"
    assert "+00:00" not in items[0]["createdAt"]


def test_a_naive_stored_timestamp_is_read_as_utc(app, monkeypatch, tmp_path):
    with app.app_context():
        sign_in(monkeypatch)
        (tmp_path / "a.dump").write_bytes(b"PGDMP")
        (tmp_path / "a.json").write_text(json.dumps({
            "createdAt": "2026-10-10T11:18:10", "createdBy": "user",
            "scope": "public schema", "status": "ready",
        }), encoding="utf-8")

        items = app.test_client().get("/api/backups").get_json()["items"]

    assert items[0]["createdAt"] == "2026-10-10T11:18:10Z"


def test_an_unreadable_timestamp_falls_back_to_the_file_time(app, monkeypatch, tmp_path):
    """A row must still parse, so a broken value cannot reach the frontend."""

    with app.app_context():
        sign_in(monkeypatch)
        (tmp_path / "a.dump").write_bytes(b"PGDMP")
        (tmp_path / "a.json").write_text(json.dumps({
            "createdAt": "not a timestamp", "createdBy": "user",
        }), encoding="utf-8")

        items = app.test_client().get("/api/backups").get_json()["items"]

    assert items[0]["createdAt"].endswith("Z")


# ==========================================
# CREATING A BACKUP
# ==========================================

def test_backup_starts_a_job_and_writes_an_archive(app, monkeypatch, tmp_path):
    captured = {}

    def fake_run(command, env=None, **kwargs):
        captured["command"] = command
        captured["env"] = env
        # pg_dump writes the file; stand in for it so the sidecar has a target.
        target = command[command.index("--file") + 1]
        with open(target, "wb") as handle:
            handle.write(b"PGDMP-fake")
        return FakeCompleted()

    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr(backup_jobs, "require_tool", lambda name: f"/usr/bin/{name}")

    with app.app_context():
        sign_in(monkeypatch)
        response = app.test_client().post("/api/backups")
        body = response.get_json()

        assert response.status_code == 202
        assert body["kind"] == "backup"
        assert body["status"] in ("queued", "running")

        job = wait_for_terminal(body["id"])
        assert job["status"] == "succeeded", job

        items = app.test_client().get("/api/backups").get_json()["items"]

    assert len(items) == 1
    assert items[0]["createdBy"] == "admin01"
    assert items[0]["scope"] == "public schema"
    # The archive is restorable by standard tooling, which is the point of
    # pg_dump's custom format over an application-level export.
    assert "--format=custom" in captured["command"]
    assert "--schema=public" in captured["command"]
    assert "--no-owner" in captured["command"]


def test_the_password_is_passed_by_environment_not_argument(app, monkeypatch):
    """Anything on the command line is readable by other processes on the host."""

    captured = {}

    def fake_run(command, env=None, **kwargs):
        captured["command"] = command
        captured["env"] = env
        target = command[command.index("--file") + 1]
        with open(target, "wb") as handle:
            handle.write(b"PGDMP")
        return FakeCompleted()

    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr(backup_jobs, "require_tool", lambda name: f"/usr/bin/{name}")

    with app.app_context():
        sign_in(monkeypatch)
        body = app.test_client().post("/api/backups").get_json()
        wait_for_terminal(body["id"])

    assert captured["env"]["PGPASSWORD"] == "p"
    assert captured["env"]["PGSSLMODE"] == "require"
    assert not any("p" == part for part in captured["command"])
    assert not any("PGPASSWORD" in str(part) for part in captured["command"])


def test_a_failing_dump_reports_the_tool_s_own_reason(app, monkeypatch):
    """A version mismatch is the likeliest real failure, so it must surface."""

    mismatch = ("pg_dump: error: server version: 17.6; pg_dump version: 15.3\n"
                "pg_dump: error: aborting because of server version mismatch")
    monkeypatch.setattr(subprocess, "run",
                        lambda *a, **k: FakeCompleted(returncode=1, stderr=mismatch))
    monkeypatch.setattr(backup_jobs, "require_tool", lambda name: f"/usr/bin/{name}")

    with app.app_context():
        sign_in(monkeypatch)
        body = app.test_client().post("/api/backups").get_json()
        job = wait_for_terminal(body["id"])

    assert job["status"] == "failed"
    assert "version mismatch" in job["message"]


def test_a_missing_pg_dump_is_reported_as_unavailable(app, monkeypatch):
    monkeypatch.setattr(backup_jobs, "find_tool", lambda name: None)

    with app.app_context():
        sign_in(monkeypatch)
        response = app.test_client().post("/api/backups")

    assert response.status_code == 503
    assert "pg_dump is not installed" in response.get_json()["message"]


def test_only_one_job_runs_at_a_time(app, monkeypatch):
    def slow_run(command, env=None, **kwargs):
        time.sleep(0.6)
        target = command[command.index("--file") + 1]
        with open(target, "wb") as handle:
            handle.write(b"PGDMP")
        return FakeCompleted()

    monkeypatch.setattr(subprocess, "run", slow_run)
    monkeypatch.setattr(backup_jobs, "require_tool", lambda name: f"/usr/bin/{name}")

    with app.app_context():
        sign_in(monkeypatch)
        client = app.test_client()
        first = client.post("/api/backups")
        second = client.post("/api/backups")

        assert first.status_code == 202
        assert second.status_code == 409
        assert "already running" in second.get_json()["message"]
        # The running job is reported so the UI can resume polling it.
        assert client.get("/api/backups").get_json()["activeJob"]["id"] == first.get_json()["id"]
        wait_for_terminal(first.get_json()["id"])


# ==========================================
# JOBS
# ==========================================

def test_an_unknown_job_explains_that_jobs_do_not_survive_a_restart(app, monkeypatch):
    with app.app_context():
        sign_in(monkeypatch)
        response = app.test_client().get("/api/jobs/does-not-exist")

    assert response.status_code == 404
    assert "restarted" in response.get_json()["message"]


# ==========================================
# RESTORE
# ==========================================

def test_restore_is_disabled_unless_switched_on(app, monkeypatch, tmp_path):
    monkeypatch.delenv("BACKUP_RESTORE_ENABLED", raising=False)
    (tmp_path / "20261009-000000Z.dump").write_bytes(b"PGDMP")

    with app.app_context():
        sign_in(monkeypatch)
        response = app.test_client().post(
            "/api/backups/20261009-000000Z/restore",
            json={"currentPassword": PASSWORD},
        )

    assert response.status_code == 403
    assert "BACKUP_RESTORE_ENABLED" in response.get_json()["message"]


def test_restore_requires_the_current_password(app, monkeypatch, tmp_path):
    monkeypatch.setenv("BACKUP_RESTORE_ENABLED", "true")
    (tmp_path / "20261009-000000Z.dump").write_bytes(b"PGDMP")

    with app.app_context():
        sign_in(monkeypatch)
        client = app.test_client()

        missing = client.post("/api/backups/20261009-000000Z/restore", json={})
        wrong = client.post("/api/backups/20261009-000000Z/restore",
                            json={"currentPassword": "not-it"})

    assert missing.status_code == 400
    assert wrong.status_code == 401


def test_the_password_is_checked_before_the_feature_flag(app, monkeypatch, tmp_path):
    """So a stranger cannot learn whether restoring is available here."""

    monkeypatch.delenv("BACKUP_RESTORE_ENABLED", raising=False)
    (tmp_path / "20261009-000000Z.dump").write_bytes(b"PGDMP")

    with app.app_context():
        sign_in(monkeypatch)
        response = app.test_client().post(
            "/api/backups/20261009-000000Z/restore",
            json={"currentPassword": "not-it"},
        )

    # 401 for the password, not 403 for the flag.
    assert response.status_code == 401


def test_restore_runs_pg_restore_over_the_schema(app, monkeypatch, tmp_path):
    monkeypatch.setenv("BACKUP_RESTORE_ENABLED", "yes")
    (tmp_path / "20261009-000000Z.dump").write_bytes(b"PGDMP")
    captured = {}

    def fake_run(command, env=None, **kwargs):
        captured["command"] = command
        return FakeCompleted()

    monkeypatch.setattr(subprocess, "run", fake_run)
    monkeypatch.setattr(backup_jobs, "require_tool", lambda name: f"/usr/bin/{name}")

    with app.app_context():
        sign_in(monkeypatch)
        response = app.test_client().post(
            "/api/backups/20261009-000000Z/restore",
            json={"currentPassword": PASSWORD},
        )
        body = response.get_json()
        assert response.status_code == 202
        assert body["kind"] == "restore"
        assert wait_for_terminal(body["id"])["status"] == "succeeded"

    # --single-transaction so a failure part-way does not leave the schema
    # half-replaced.
    assert "--single-transaction" in captured["command"]
    assert "--clean" in captured["command"]
    assert "--if-exists" in captured["command"]
    assert "--schema=public" in captured["command"]


def test_restoring_a_missing_archive_is_not_found(app, monkeypatch):
    monkeypatch.setenv("BACKUP_RESTORE_ENABLED", "true")

    with app.app_context():
        sign_in(monkeypatch)
        response = app.test_client().post(
            "/api/backups/no-such-backup/restore",
            json={"currentPassword": PASSWORD},
        )

    assert response.status_code == 404


@pytest.mark.parametrize("hostile", (
    "../../etc/passwd",
    "..\\..\\windows\\system32\\config\\sam",
    "nested/path",
))
def test_a_backup_id_cannot_escape_the_backup_directory(app, monkeypatch, hostile):
    """The id arrives from the URL, so it must never be joined onto a path."""

    with app.app_context():
        sign_in(monkeypatch)
        assert backup_jobs.find_archive(hostile) is None
