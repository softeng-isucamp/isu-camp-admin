"""The Backup & Recovery routes: history, jobs, download, delete and schedule."""

import json
import subprocess
import threading
import time

import pytest
from flask import Flask, jsonify

import backups as backups_route
from auth import Admin
from extensions import db
from backups import backups_bp
from model.backup_schedule import BackupSchedule
from services import backup_jobs
from services.security import hash_password

PASSWORD = "Str0ngCurrent1"

# What a client tool's exit looks like after a terminate. The value does not
# matter to the code - anything non-zero is "did not finish" - but a real
# SIGTERM is reported this way, so the fake reports it the same.
TERMINATED = -15


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
    # The schedule is seeded from these on first read, so a test that does not
    # set one must not inherit the developer's.
    for name in ("BACKUP_SCHEDULE_ENABLED", "BACKUP_SCHEDULE_AT", "BACKUP_KEEP"):
        monkeypatch.delenv(name, raising=False)
    # Jobs and download links live in module-level registries; a test must not
    # see another's.
    backup_jobs._jobs.clear()
    backup_jobs._downloads.clear()

    with app.app_context():
        db.session.execute(db.text("ATTACH DATABASE ':memory:' AS public"))
        db.metadata.create_all(db.engine)
        yield app
        db.session.remove()
        db.drop_all()
    backup_jobs._jobs.clear()
    backup_jobs._downloads.clear()


def sign_in(monkeypatch, role="superadmin", identifier=1, confirmed=True):
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
    # Delete uses the portal's re-authentication convention, which reads a
    # confirmation off the session rather than a password in the body. The
    # refusal is spelled out here rather than reached through the real guard,
    # so these tests exercise the route's response to it either way.
    def confirmation(message=None):
        if confirmed:
            return db.session.get(Admin, identifier), None
        return None, (jsonify({
            "success": False,
            "code": "password_confirmation_required",
            "message": message,
        }), 403)

    monkeypatch.setattr(backups_route, "reauth_required", confirmation)
    return record


def wait_for_terminal(job_id, timeout=5):
    deadline = time.time() + timeout
    while time.time() < deadline:
        job = backup_jobs.get_job(job_id)
        if job and job["status"] in backup_jobs.TERMINAL_STATUSES:
            return job
        time.sleep(0.01)
    return backup_jobs.get_job(job_id)


class FakeProcess:
    """One pg_dump or pg_restore, as Popen hands it back.

    ``runtime`` is how long the tool works for. A terminate cuts that short and
    the exit is reported as a real one would be, which is what lets the cancel
    paths be exercised without a PostgreSQL client anywhere near the test.
    """

    def __init__(self, returncode=0, stderr="", runtime=0.0):
        self.returncode = None
        self.terminated = False
        self._code = returncode
        self._stderr = stderr
        self._runtime = runtime
        self._stop = threading.Event()
        self._started = threading.Event()

    def communicate(self, timeout=None):
        self._started.set()
        if self._stop.wait(self._runtime):
            self.returncode = TERMINATED
            return "", "pg_dump: error: query was cancelled"
        self.returncode = self._code
        return "", self._stderr

    def terminate(self):
        self.terminated = True
        self._stop.set()

    def kill(self):
        self.terminate()

    def wait_until_running(self, timeout=2):
        assert self._started.wait(timeout), "the tool was never started"


def fake_tool(monkeypatch, returncode=0, stderr="", runtime=0.0, writes=b"PGDMP-fake"):
    """Stands in for the client tools. Returns what the code asked them to do.

    ``writes`` is what the tool puts in its ``--file`` target: pg_dump creates
    that file at once and fills it as it reads, and the publishing rename
    depends on it being there.
    """

    captured = {"processes": []}

    def popen(command, env=None, **keywords):
        captured["command"] = command
        captured["env"] = env
        if writes is not None and "--file" in command:
            with open(command[command.index("--file") + 1], "wb") as handle:
                handle.write(writes)
        process = FakeProcess(returncode=returncode, stderr=stderr, runtime=runtime)
        captured["processes"].append(process)
        return process

    monkeypatch.setattr(subprocess, "Popen", popen)
    monkeypatch.setattr(backup_jobs, "require_tool", lambda name: f"/usr/bin/{name}")
    return captured


def running_tool(captured, index=0, timeout=2):
    """The nth tool the code started, once it is actually working.

    The worker is a thread, so a test that reads ``captured["processes"]`` the
    moment the route answers is racing it: the job is queued and Popen has not
    been reached yet.
    """

    deadline = time.time() + timeout
    while time.time() < deadline and len(captured["processes"]) <= index:
        time.sleep(0.01)
    assert len(captured["processes"]) > index, "the tool was never started"
    process = captured["processes"][index]
    process.wait_until_running(timeout)
    return process


def store_archive(tmp_path, name="20261009-000000Z", status="ready",
                  created="2026-10-09T00:00:00Z", body=b"PGDMP" + b"x" * 100):
    (tmp_path / f"{name}.dump").write_bytes(body)
    (tmp_path / f"{name}.json").write_text(json.dumps({
        "createdAt": created, "createdBy": "admin01",
        "scope": "public schema", "status": status,
    }), encoding="utf-8")
    return name


# ==========================================
# AUTHORIZATION
# ==========================================

@pytest.mark.parametrize("method, path", (
    ("get", "/api/backups"),
    ("post", "/api/backups"),
    ("post", "/api/backups/x/restore"),
    ("post", "/api/backups/x/download"),
    ("delete", "/api/backups/x"),
    ("put", "/api/backups/schedule"),
    ("get", "/api/jobs/x"),
    ("post", "/api/jobs/x/cancel"),
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
    ("post", "/api/backups/x/download"),
    ("delete", "/api/backups/x"),
    ("put", "/api/backups/schedule"),
    ("get", "/api/jobs/x"),
    ("post", "/api/jobs/x/cancel"),
))
def test_every_route_requires_a_session(app, monkeypatch, method, path):
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
    body = response.get_json()
    assert body["items"] == []
    assert body["activeJob"] is None


def test_history_advertises_the_controls_this_server_can_serve(app, monkeypatch):
    """A missing key hides its control, so the present ones must be present."""

    with app.app_context():
        sign_in(monkeypatch)
        body = app.test_client().get("/api/backups").get_json()

    assert body["canDownload"] is True
    assert body["canDelete"] is True
    assert body["schedule"]["timeZone"] == "Asia/Manila"
    assert body["schedule"]["enabled"] is False
    assert body["schedule"]["keep"] == 14


def test_an_unreadable_schedule_is_left_out_rather_than_guessed(app, monkeypatch):
    """A deployment that has not applied the migration hides the control."""

    monkeypatch.setattr(backups_route, "read_schedule", lambda: None)

    with app.app_context():
        sign_in(monkeypatch)
        body = app.test_client().get("/api/backups").get_json()

    assert "schedule" not in body
    # The other two controls are unaffected: they are separate routes.
    assert body["canDownload"] is True


def test_history_describes_stored_archives_newest_first(app, monkeypatch, tmp_path):
    with app.app_context():
        sign_in(monkeypatch)
        store_archive(tmp_path, "20261001-000000Z", created="2026-10-01T00:00:00Z")
        store_archive(tmp_path, "20261009-000000Z", created="2026-10-09T00:00:00Z")

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
        # The form the old code wrote.
        store_archive(tmp_path, "a", created="2026-10-10T11:18:10.116684+00:00")

        items = app.test_client().get("/api/backups").get_json()["items"]

    assert items[0]["createdAt"] == "2026-10-10T11:18:10.116684Z"
    assert "+00:00" not in items[0]["createdAt"]


def test_a_naive_stored_timestamp_is_read_as_utc(app, monkeypatch, tmp_path):
    with app.app_context():
        sign_in(monkeypatch)
        store_archive(tmp_path, "a", created="2026-10-10T11:18:10")

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
    captured = fake_tool(monkeypatch)

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

    captured = fake_tool(monkeypatch)

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
    fake_tool(monkeypatch, returncode=1, stderr=mismatch, writes=None)

    with app.app_context():
        sign_in(monkeypatch)
        body = app.test_client().post("/api/backups").get_json()
        job = wait_for_terminal(body["id"])

    assert job["status"] == "failed"
    assert "version mismatch" in job["message"]


def test_a_failed_dump_is_not_left_where_a_restore_could_find_it(app, monkeypatch, tmp_path):
    """pg_dump fills its file as it reads, so a dump that died has written one."""

    fake_tool(monkeypatch, returncode=1, stderr="pg_dump: error: connection lost",
              writes=b"PGDMP-half")

    with app.app_context():
        sign_in(monkeypatch)
        body = app.test_client().post("/api/backups").get_json()
        job = wait_for_terminal(body["id"])
        items = app.test_client().get("/api/backups").get_json()["items"]

    assert job["status"] == "failed"
    assert items == []
    assert list(tmp_path.glob("*.dump*")) == []


def test_a_dump_that_cannot_be_published_leaves_no_partial_behind(app, monkeypatch, tmp_path):
    """The tool succeeded but the rename did not, so there is still a truncated
    file in the directory and nothing has cleaned it up."""

    fake_tool(monkeypatch, writes=b"PGDMP-whole")

    def refuse(self, target):
        raise OSError("the directory went away")

    monkeypatch.setattr("pathlib.Path.replace", refuse)

    with app.app_context():
        sign_in(monkeypatch)
        body = app.test_client().post("/api/backups").get_json()
        job = wait_for_terminal(body["id"])

        assert job["status"] == "failed"
        assert "could not be recorded" in job["message"]
        assert app.test_client().get("/api/backups").get_json()["items"] == []

    assert list(tmp_path.glob("*.dump*")) == []


def test_a_missing_pg_dump_is_reported_as_unavailable(app, monkeypatch):
    monkeypatch.setattr(backup_jobs, "find_tool", lambda name: None)

    with app.app_context():
        sign_in(monkeypatch)
        response = app.test_client().post("/api/backups")

    assert response.status_code == 503
    assert "pg_dump is not installed" in response.get_json()["message"]


def test_only_one_job_runs_at_a_time(app, monkeypatch):
    captured = fake_tool(monkeypatch, runtime=5)

    with app.app_context():
        sign_in(monkeypatch)
        client = app.test_client()
        first = client.post("/api/backups")
        process = running_tool(captured)
        second = client.post("/api/backups")

        assert first.status_code == 202
        assert second.status_code == 409
        assert "already running" in second.get_json()["message"]
        # The running job is reported so the UI can resume polling it.
        assert client.get("/api/backups").get_json()["activeJob"]["id"] == first.get_json()["id"]
        process.terminate()
        wait_for_terminal(first.get_json()["id"])


def test_a_manual_backup_applies_the_saved_retention(app, monkeypatch, tmp_path):
    """Retention is about disk, so it does not care who pressed the button."""

    fake_tool(monkeypatch)

    with app.app_context():
        sign_in(monkeypatch)
        for name in ("20260101-000000Z", "20260102-000000Z"):
            store_archive(tmp_path, name, created=f"2026-01-0{name[7]}T00:00:00Z")
        db.session.add(BackupSchedule(id=1, enabled=False, frequency="daily",
                                      at_time="02:30", keep=1))
        db.session.commit()

        body = app.test_client().post("/api/backups").get_json()
        assert wait_for_terminal(body["id"])["status"] == "succeeded"

        items = app.test_client().get("/api/backups").get_json()["items"]

    # Only the newest survives, and the sidecars went with the archives.
    assert len(items) == 1
    assert sorted(path.suffix for path in tmp_path.iterdir()) == [".dump", ".json"]


def test_retention_is_left_alone_when_there_is_no_saved_schedule(app, monkeypatch, tmp_path):
    """Guessing a limit here would delete somebody's archive on a deployment
    that has not applied the migration yet."""

    fake_tool(monkeypatch)
    monkeypatch.setattr(backups_route, "read_schedule", lambda: None)

    with app.app_context():
        sign_in(monkeypatch)
        for name in ("20260101-000000Z", "20260102-000000Z"):
            store_archive(tmp_path, name, created=f"2026-01-0{name[7]}T00:00:00Z")

        body = app.test_client().post("/api/backups").get_json()
        assert wait_for_terminal(body["id"])["status"] == "succeeded"

        items = app.test_client().get("/api/backups").get_json()["items"]

    assert len(items) == 3


# ==========================================
# JOBS
# ==========================================

def test_an_unknown_job_explains_that_jobs_do_not_survive_a_restart(app, monkeypatch):
    with app.app_context():
        sign_in(monkeypatch)
        response = app.test_client().get("/api/jobs/does-not-exist")

    assert response.status_code == 404
    assert "restarted" in response.get_json()["message"]


def test_a_running_job_says_it_can_be_cancelled(app, monkeypatch):
    """Without the key the panel hides Cancel, so a server that can must say so."""

    captured = fake_tool(monkeypatch, runtime=5)

    with app.app_context():
        sign_in(monkeypatch)
        client = app.test_client()
        body = client.post("/api/backups").get_json()
        process = running_tool(captured)

        polled = client.get(f"/api/jobs/{body['id']}").get_json()
        assert polled["cancellable"] is True
        assert client.get("/api/backups").get_json()["activeJob"]["cancellable"] is True

        process.terminate()
        wait_for_terminal(body["id"])


def test_a_finished_job_no_longer_says_it_can_be_cancelled(app, monkeypatch):
    fake_tool(monkeypatch)

    with app.app_context():
        sign_in(monkeypatch)
        body = app.test_client().post("/api/backups").get_json()
        job = wait_for_terminal(body["id"])

    assert job["status"] == "succeeded"
    assert "cancellable" not in job


# ==========================================
# CANCELLING
# ==========================================

def test_cancelling_a_running_backup_leaves_no_archive(app, monkeypatch, tmp_path):
    captured = fake_tool(monkeypatch, runtime=5)

    with app.app_context():
        sign_in(monkeypatch)
        client = app.test_client()
        body = client.post("/api/backups").get_json()
        process = running_tool(captured)

        response = client.post(f"/api/jobs/{body['id']}/cancel", json={})

        # Accepted, not finished: the panel shows "Cancelling..." and polls on.
        assert response.status_code == 202
        assert response.get_json()["id"] == body["id"]
        assert process.terminated is True

        job = wait_for_terminal(body["id"])
        assert job["status"] == "cancelled"
        assert "cancellable" not in job
        # No archive, no history row, and the partial file is gone.
        assert client.get("/api/backups").get_json()["items"] == []

    assert list(tmp_path.glob("*.dump*")) == []


def test_cancelling_a_queued_job_never_starts_the_tool(app, monkeypatch):
    """A cancel that beats the worker is honoured without running a dump."""

    captured = fake_tool(monkeypatch, runtime=5)

    with app.app_context():
        sign_in(monkeypatch)
        # Hold the worker at the gate so the job is still queued.
        released = threading.Event()
        original = backup_jobs._run
        monkeypatch.setattr(
            backup_jobs, "_run",
            lambda *args, **kwargs: (released.wait(2), original(*args, **kwargs)),
        )

        client = app.test_client()
        body = client.post("/api/backups").get_json()
        assert client.post(f"/api/jobs/{body['id']}/cancel", json={}).status_code == 202
        released.set()

        job = wait_for_terminal(body["id"])

    assert job["status"] == "cancelled"
    assert captured["processes"] == []


def test_a_lost_race_reports_the_real_outcome(app, monkeypatch):
    """A dump that had already written its last byte did succeed, and saying
    "cancelled" would be a lie about an archive that now exists."""

    with app.app_context():
        sign_in(monkeypatch)
        fake_tool(monkeypatch)
        client = app.test_client()
        body = client.post("/api/backups").get_json()
        job = wait_for_terminal(body["id"])
        assert job["status"] == "succeeded"

        response = client.post(f"/api/jobs/{body['id']}/cancel", json={})

        # Nothing was cancelled, so 200 with the job exactly as it stands.
        assert response.status_code == 200
        assert response.get_json()["status"] == "succeeded"
        assert "cancellable" not in response.get_json()
        assert client.get("/api/backups").get_json()["items"] != []


def test_cancelling_a_restore_leaves_the_database_as_it_was(app, monkeypatch, tmp_path):
    """pg_restore runs in a single transaction, so a terminate abandons it."""

    monkeypatch.setenv("BACKUP_RESTORE_ENABLED", "true")
    store_archive(tmp_path)
    captured = fake_tool(monkeypatch, runtime=5)

    with app.app_context():
        sign_in(monkeypatch)
        client = app.test_client()
        body = client.post("/api/backups/20261009-000000Z/restore",
                           json={"currentPassword": PASSWORD}).get_json()
        process = running_tool(captured)

        assert client.post(f"/api/jobs/{body['id']}/cancel", json={}).status_code == 202

        job = wait_for_terminal(body["id"])

    assert job["kind"] == "restore"
    assert job["status"] == "cancelled"
    assert "--single-transaction" in captured["command"]


def test_cancelling_an_unknown_job_is_not_found(app, monkeypatch):
    with app.app_context():
        sign_in(monkeypatch)
        response = app.test_client().post("/api/jobs/does-not-exist/cancel", json={})

    assert response.status_code == 404


def test_any_superadmin_can_cancel_a_scheduled_run(app, monkeypatch):
    """An unattended dump competing for the database has nobody else to ask."""

    captured = fake_tool(monkeypatch, runtime=5)

    with app.app_context():
        sign_in(monkeypatch, identifier=1)
        # Started by the scheduler, not by this administrator.
        job = backup_jobs.start_backup(actor="scheduled")
        process = running_tool(captured)

        response = app.test_client().post(f"/api/jobs/{job['id']}/cancel", json={})

        assert response.status_code == 202
        assert wait_for_terminal(job["id"])["status"] == "cancelled"


# ==========================================
# DOWNLOADING
# ==========================================

def test_download_returns_a_link_and_when_it_expires(app, monkeypatch, tmp_path):
    with app.app_context():
        sign_in(monkeypatch)
        store_archive(tmp_path)

        response = app.test_client().post(
            "/api/backups/20261009-000000Z/download",
            json={"currentPassword": PASSWORD},
        )

    assert response.status_code == 200
    body = response.get_json()
    # Root-relative, so it resolves against the API base rather than the page
    # origin - in development those are different hosts.
    assert body["url"].startswith("/api/backup-downloads/")
    assert body["expiresAt"].endswith("Z")
    # The link is the authority to fetch a file of password hashes, so it must
    # not be guessable.
    assert len(body["url"].rsplit("/", 1)[1]) >= 32


def test_the_link_streams_the_archive_as_an_attachment(app, monkeypatch, tmp_path):
    with app.app_context():
        sign_in(monkeypatch)
        store_archive(tmp_path, body=b"PGDMP-the-real-bytes")
        client = app.test_client()
        url = client.post("/api/backups/20261009-000000Z/download",
                          json={"currentPassword": PASSWORD}).get_json()["url"]

        response = client.get(url)

    assert response.status_code == 200
    assert response.data == b"PGDMP-the-real-bytes"
    assert "attachment" in response.headers["Content-Disposition"]
    assert "20261009-000000Z.dump" in response.headers["Content-Disposition"]


def test_a_link_works_once(app, monkeypatch, tmp_path):
    with app.app_context():
        sign_in(monkeypatch)
        store_archive(tmp_path)
        client = app.test_client()
        url = client.post("/api/backups/20261009-000000Z/download",
                          json={"currentPassword": PASSWORD}).get_json()["url"]

        first = client.get(url)
        second = client.get(url)

    assert first.status_code == 200
    assert second.status_code == 404
    assert "already been used" in second.get_json()["message"]


def test_an_expired_link_no_longer_works(app, monkeypatch, tmp_path):
    with app.app_context():
        sign_in(monkeypatch)
        store_archive(tmp_path)
        monkeypatch.setattr(backup_jobs, "DOWNLOAD_LIFETIME_SECONDS", -1)
        client = app.test_client()
        url = client.post("/api/backups/20261009-000000Z/download",
                          json={"currentPassword": PASSWORD}).get_json()["url"]

        response = client.get(url)

    assert response.status_code == 404
    assert "expired" in response.get_json()["message"]


def test_an_invented_token_is_not_found(app, monkeypatch):
    with app.app_context():
        sign_in(monkeypatch)
        response = app.test_client().get("/api/backup-downloads/not-a-real-token")

    assert response.status_code == 404


def test_the_link_does_not_rely_on_the_session(app, monkeypatch, tmp_path):
    """The browser's own downloader fetches it, so a URL that worked only
    because a cookie was attached would be fetchable by any page that could
    persuade the browser to follow it."""

    with app.app_context():
        sign_in(monkeypatch)
        store_archive(tmp_path)
        client = app.test_client()
        url = client.post("/api/backups/20261009-000000Z/download",
                          json={"currentPassword": PASSWORD}).get_json()["url"]

        # Signed out between asking for the link and following it.
        monkeypatch.setattr(
            backups_route, "admin_required",
            lambda: (None, (jsonify({"success": False, "message": "Authentication required"}), 401)),
        )
        response = client.get(url)

    assert response.status_code == 200


@pytest.mark.parametrize("body, expected", (
    ({}, 400),
    ({"currentPassword": "not-it"}, 401),
))
def test_download_rechecks_the_password(app, monkeypatch, tmp_path, body, expected):
    with app.app_context():
        sign_in(monkeypatch)
        store_archive(tmp_path)

        response = app.test_client().post(
            "/api/backups/20261009-000000Z/download", json=body)

    assert response.status_code == expected
    assert backup_jobs._downloads == {}


def test_the_password_is_checked_before_the_archive_is_looked_up(app, monkeypatch):
    """So a session left open cannot be used to ask which archives exist."""

    with app.app_context():
        sign_in(monkeypatch)
        response = app.test_client().post(
            "/api/backups/no-such-backup/download",
            json={"currentPassword": "not-it"},
        )

    assert response.status_code == 401


@pytest.mark.parametrize("status", ("failed", "running"))
def test_only_a_ready_archive_can_be_downloaded(app, monkeypatch, tmp_path, status):
    """The other statuses describe a file nobody could restore from."""

    with app.app_context():
        sign_in(monkeypatch)
        store_archive(tmp_path, status=status)

        response = app.test_client().post(
            "/api/backups/20261009-000000Z/download",
            json={"currentPassword": PASSWORD},
        )

    assert response.status_code == 404


def test_downloading_a_missing_archive_is_not_found(app, monkeypatch):
    with app.app_context():
        sign_in(monkeypatch)
        response = app.test_client().post(
            "/api/backups/no-such-backup/download",
            json={"currentPassword": PASSWORD},
        )

    assert response.status_code == 404


def test_the_download_is_audited_without_the_token(app, monkeypatch, tmp_path):
    """An audit row is readable by every administrator, and the token is the
    authority to fetch the file."""

    recorded = []
    monkeypatch.setattr(
        backups_route, "log_audit",
        lambda *arguments, **keywords: recorded.append(arguments),
    )

    with app.app_context():
        sign_in(monkeypatch)
        store_archive(tmp_path)

        body = app.test_client().post(
            "/api/backups/20261009-000000Z/download",
            json={"currentPassword": PASSWORD},
        ).get_json()

    category, _, action, _, target_id, detail = recorded[-1]
    assert (category, action) == ("System", "download backup")
    assert target_id == "20261009-000000Z"
    # The archive and when it was taken, but never the link.
    assert "2026-10-09T00:00:00Z" in detail
    assert body["url"].rsplit("/", 1)[1] not in detail
    assert PASSWORD not in detail


# ==========================================
# DELETING
# ==========================================

@pytest.mark.parametrize("status", ("ready", "failed"))
def test_delete_removes_the_archive_and_its_sidecar(app, monkeypatch, tmp_path, status):
    with app.app_context():
        sign_in(monkeypatch)
        store_archive(tmp_path, status=status)

        response = app.test_client().delete("/api/backups/20261009-000000Z")

        assert response.status_code == 204
        assert response.get_data() == b""
        assert app.test_client().get("/api/backups").get_json()["items"] == []

    assert list(tmp_path.iterdir()) == []


def test_delete_asks_for_a_lapsed_password_confirmation(app, monkeypatch, tmp_path):
    """The portal's existing convention: a code the frontend recognises, and no
    password in the body."""

    with app.app_context():
        sign_in(monkeypatch, confirmed=False)
        store_archive(tmp_path)

        response = app.test_client().delete("/api/backups/20261009-000000Z")

        assert response.status_code == 403
        assert response.get_json()["code"] == "password_confirmation_required"
        # Nothing was removed.
        assert app.test_client().get("/api/backups").get_json()["items"] != []


def test_delete_waits_for_a_running_operation(app, monkeypatch, tmp_path):
    """A running tool may be writing this file, or reading it."""

    monkeypatch.setenv("BACKUP_RESTORE_ENABLED", "true")
    store_archive(tmp_path)
    captured = fake_tool(monkeypatch, runtime=5)

    with app.app_context():
        sign_in(monkeypatch)
        client = app.test_client()
        job = client.post("/api/backups/20261009-000000Z/restore",
                          json={"currentPassword": PASSWORD}).get_json()
        process = running_tool(captured)

        response = client.delete("/api/backups/20261009-000000Z")

        assert response.status_code == 409
        assert "running" in response.get_json()["message"]
        process.terminate()
        wait_for_terminal(job["id"])

    assert (tmp_path / "20261009-000000Z.dump").is_file()


def test_the_last_ready_archive_can_be_deleted(app, monkeypatch, tmp_path):
    """The UI warns about it; the server does not refuse it. An archive nobody
    wants is not made safe by being the only one."""

    with app.app_context():
        sign_in(monkeypatch)
        store_archive(tmp_path)

        assert app.test_client().delete("/api/backups/20261009-000000Z").status_code == 204


def test_deleting_a_missing_archive_is_not_found(app, monkeypatch):
    with app.app_context():
        sign_in(monkeypatch)
        response = app.test_client().delete("/api/backups/no-such-backup")

    assert response.status_code == 404


def test_delete_invalidates_a_link_already_issued_for_the_archive(app, monkeypatch, tmp_path):
    with app.app_context():
        sign_in(monkeypatch)
        store_archive(tmp_path)
        client = app.test_client()
        url = client.post("/api/backups/20261009-000000Z/download",
                          json={"currentPassword": PASSWORD}).get_json()["url"]

        client.delete("/api/backups/20261009-000000Z")

        assert client.get(url).status_code == 404
    assert backup_jobs._downloads == {}


def test_the_delete_is_audited_with_the_acting_administrator(app, monkeypatch, tmp_path):
    recorded = []
    monkeypatch.setattr(
        backups_route, "log_audit",
        # The actor is the live row, which is detached once the fixture removes
        # the session, so its name is read here while it is still bound.
        lambda category, actor, action, target, target_id=None, detail=None:
            recorded.append((category, actor.username, action, target_id, detail)),
    )

    with app.app_context():
        sign_in(monkeypatch)
        store_archive(tmp_path)

        app.test_client().delete("/api/backups/20261009-000000Z")

    category, actor, action, target_id, detail = recorded[-1]
    assert (category, action) == ("System", "delete backup")
    assert actor == "admin01"
    assert target_id == "20261009-000000Z"
    assert "2026-10-09T00:00:00Z" in detail


# ==========================================
# THE SCHEDULE
# ==========================================

DAILY = {"enabled": True, "frequency": "daily", "day": None,
         "time": "02:30", "timeZone": "Asia/Manila", "keep": 14}


def test_saving_a_schedule_returns_what_was_saved(app, monkeypatch):
    with app.app_context():
        sign_in(monkeypatch)
        client = app.test_client()

        response = client.put("/api/backups/schedule", json={
            **DAILY, "frequency": "weekly", "day": 0, "time": "23:45", "keep": 30,
        })

        assert response.status_code == 200
        assert response.get_json() == {
            "enabled": True, "frequency": "weekly", "day": 0,
            "time": "23:45", "timeZone": "Asia/Manila", "keep": 30,
        }
        # And it is what the panel reads back.
        assert client.get("/api/backups").get_json()["schedule"]["time"] == "23:45"


def test_switching_it_off_keeps_the_rest_of_the_schedule(app, monkeypatch):
    """So switching it back on restores what somebody set rather than a default."""

    with app.app_context():
        sign_in(monkeypatch)
        client = app.test_client()
        client.put("/api/backups/schedule", json={
            **DAILY, "frequency": "weekly", "day": 3, "time": "04:15", "keep": 21,
        })

        off = client.put("/api/backups/schedule", json={
            "enabled": False, "frequency": "weekly", "day": 3,
            "time": "04:15", "timeZone": "Asia/Manila", "keep": 21,
        })

        assert off.status_code == 200
        assert off.get_json() == {
            "enabled": False, "frequency": "weekly", "day": 3,
            "time": "04:15", "timeZone": "Asia/Manila", "keep": 21,
        }


def test_a_daily_schedule_reports_no_day(app, monkeypatch):
    with app.app_context():
        sign_in(monkeypatch)
        client = app.test_client()
        client.put("/api/backups/schedule", json={**DAILY, "frequency": "weekly", "day": 5})

        response = client.put("/api/backups/schedule", json={**DAILY, "day": 5})

    # A stored day on a daily schedule is a value nothing reads, which is the
    # kind of thing that is later read by mistake.
    assert response.get_json()["day"] is None


@pytest.mark.parametrize("change, field", (
    ({"frequency": "fortnightly"}, "frequency"),
    ({"frequency": "weekly", "day": None}, "day"),
    ({"frequency": "weekly", "day": 7}, "day"),
    ({"frequency": "weekly", "day": True}, "day"),
    ({"time": "2:30"}, "time"),
    ({"time": "24:00"}, "time"),
    ({"time": "02:60"}, "time"),
    ({"time": "half past two"}, "time"),
    ({"time": None}, "time"),
    ({"timeZone": "UTC"}, "timeZone"),
    ({"keep": 0}, "keep"),
    ({"keep": -1}, "keep"),
    ({"keep": "lots"}, "keep"),
    ({"keep": True}, "keep"),
    ({"enabled": "yes"}, "enabled"),
))
def test_an_invalid_schedule_is_refused(app, monkeypatch, change, field):
    with app.app_context():
        sign_in(monkeypatch)

        response = app.test_client().put("/api/backups/schedule", json={**DAILY, **change})

    assert response.status_code == 422
    assert field in response.get_json()["fields"]


def test_a_missing_body_is_refused(app, monkeypatch):
    with app.app_context():
        sign_in(monkeypatch)
        assert app.test_client().put("/api/backups/schedule").status_code == 422


def test_an_invalid_schedule_changes_nothing(app, monkeypatch):
    with app.app_context():
        sign_in(monkeypatch)
        client = app.test_client()
        client.put("/api/backups/schedule", json={**DAILY, "time": "03:00"})

        client.put("/api/backups/schedule", json={**DAILY, "time": "nope"})

        assert client.get("/api/backups").get_json()["schedule"]["time"] == "03:00"


def test_saving_a_smaller_keep_deletes_nothing_by_itself(app, monkeypatch, tmp_path):
    """Retention runs after a completed backup, so lowering the limit is never
    a delete somebody did not expect."""

    with app.app_context():
        sign_in(monkeypatch)
        for name in ("20260101-000000Z", "20260102-000000Z", "20260103-000000Z"):
            store_archive(tmp_path, name, created=f"2026-01-0{name[7]}T00:00:00Z")
        client = app.test_client()

        assert client.put("/api/backups/schedule", json={**DAILY, "keep": 1}).status_code == 200

        assert len(client.get("/api/backups").get_json()["items"]) == 3


def test_the_schedule_change_is_audited_as_old_to_new(app, monkeypatch):
    recorded = []
    monkeypatch.setattr(
        backups_route, "log_audit",
        lambda category, actor, action, target, target_id=None, detail=None:
            recorded.append((category, actor.username, action, target_id, detail)),
    )

    with app.app_context():
        sign_in(monkeypatch)
        app.test_client().put("/api/backups/schedule", json={
            **DAILY, "frequency": "weekly", "day": 1, "time": "03:30", "keep": 7,
        })

    category, actor, action, _, detail = recorded[-1]
    assert (category, action) == ("System", "change backup schedule")
    assert actor == "admin01"
    assert "from off (manual only), keeping 14" in detail
    assert "to every Monday at 03:30 Asia/Manila, keeping 7" in detail


# ==========================================
# RESTORE
# ==========================================

def test_restore_is_disabled_unless_switched_on(app, monkeypatch, tmp_path):
    monkeypatch.delenv("BACKUP_RESTORE_ENABLED", raising=False)
    store_archive(tmp_path)

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
    store_archive(tmp_path)

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
    store_archive(tmp_path)

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
    store_archive(tmp_path)
    captured = fake_tool(monkeypatch)

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
    # half-replaced, and so a cancel can abandon it.
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
