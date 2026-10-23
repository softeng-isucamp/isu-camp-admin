"""The automatic backup: when it runs, what it keeps, and what it cleans up."""

import json
import subprocess
import time
from datetime import datetime, timedelta, timezone

import pytest
from flask import Flask

from extensions import db
from model.backup_schedule import ROW_ID, BackupSchedule
from services import backup_jobs, backup_schedule


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

    # Archives go to a temp directory, never the real backups/ folder.
    monkeypatch.setenv("BACKUP_DIR", str(tmp_path))
    monkeypatch.setenv("SUPABASE_DATABASE_URL",
                       "postgresql+psycopg2://u:p@db.example.com:5432/postgres")
    # These seed the schedule row the first time it is read, so a test that
    # does not set one must not inherit the developer's.
    for name in ("BACKUP_SCHEDULE_ENABLED", "BACKUP_SCHEDULE_AT", "BACKUP_KEEP"):
        monkeypatch.delenv(name, raising=False)
    # A real dump is minutes long; the tests poll a fake one.
    monkeypatch.setattr(backup_schedule, "POLL_SECONDS", 0.01)
    monkeypatch.setattr(backup_jobs, "require_tool", lambda name: f"/usr/bin/{name}")
    backup_jobs._jobs.clear()

    # The schedule lives in a row now, so the timer needs a database to read.
    with app.app_context():
        db.session.execute(db.text("ATTACH DATABASE ':memory:' AS public"))
        db.metadata.create_all(db.engine)

    yield app

    backup_schedule.stop_scheduler()
    with app.app_context():
        db.session.remove()
        db.drop_all()
    backup_jobs._jobs.clear()


def save(app, **changes):
    """Writes a schedule row, the way PUT /api/backups/schedule would."""

    values = {
        "enabled": True, "frequency": "daily", "day_of_week": None,
        "at_time": "02:30", "time_zone": "Asia/Manila", "keep": 14,
    }
    values.update(changes)
    with app.app_context():
        row = db.session.get(BackupSchedule, ROW_ID)
        if row is None:
            row = BackupSchedule(id=ROW_ID)
            db.session.add(row)
        for field, value in values.items():
            setattr(row, field, value)
        db.session.commit()
        return row.to_dict()


@pytest.fixture
def recorded(monkeypatch):
    """Captures the audit rows an automatic run writes.

    Both modules, in one list: the row describing the night is written here,
    and the rows naming what retention removed are written from inside the job,
    where the archive is actually deleted.
    """

    rows = []
    for module in (backup_schedule, backup_jobs):
        monkeypatch.setattr(
            module, "log_audit",
            lambda *arguments, **keywords: rows.append(arguments),
        )
    return rows


class FakeProcess:
    """One pg_dump, as Popen hands it back.

    ``before_exit`` runs while the tool is still working, which is how a test
    sees what the directory looks like mid-dump.
    """

    def __init__(self, returncode=0, stderr="", before_exit=None):
        self.returncode = None
        self._code = returncode
        self._stderr = stderr
        self._before_exit = before_exit

    def communicate(self, timeout=None):
        if self._before_exit:
            self._before_exit()
        self.returncode = self._code
        return "", self._stderr

    def terminate(self):
        self.returncode = -15

    kill = terminate


def fake_dump(monkeypatch, returncode=0, stderr="", before_return=None):
    """Stands in for pg_dump, writing the file the real tool would write."""

    captured = {}

    def popen(command, env=None, **keywords):
        captured["command"] = command
        target = command[command.index("--file") + 1]
        with open(target, "wb") as handle:
            handle.write(b"PGDMP-fake")
        return FakeProcess(
            returncode=returncode,
            stderr=stderr,
            before_exit=(lambda: before_return(captured)) if before_return else None,
        )

    monkeypatch.setattr(subprocess, "Popen", popen)
    return captured


def waited_for(read, seconds):
    """Reads ``read`` until it answers something truthy, or gives up.

    The timer runs on its own thread, so a test cannot look once and conclude
    anything; this returns whatever the last read saw, so the caller asserts on
    the value rather than on the wait.
    """

    deadline = time.time() + seconds
    while True:
        value = read()
        if value or time.time() >= deadline:
            return value
        time.sleep(0.02)


# Long enough that a loaded machine does not fail a passing test, and free on
# one: waited_for returns the moment the archive appears.
TIMER_PATIENCE_SECONDS = 15


def store_archive(directory, name, created_at):
    (directory / f"{name}.dump").write_bytes(b"PGDMP")
    (directory / f"{name}.json").write_text(json.dumps({
        "createdAt": created_at,
        "createdBy": "admin01",
        "scope": "public schema",
        "status": "ready",
    }), encoding="utf-8")


# ==========================================
# SETTINGS
# ==========================================

def test_the_timer_runs_even_while_the_schedule_is_off(app):
    """Being off is a value in the row, so a timer that only started when the
    row said "on" could never see it change to "on"."""

    save(app, enabled=False)

    assert backup_schedule.start_scheduler(app) is not None


def test_no_timer_without_an_application_to_read_the_schedule_with(app):
    assert backup_schedule.start_scheduler(None) is None


def test_switching_it_on_starts_one_timer_however_often_it_is_asked(app):
    """The module is imported once per process, but the dev reloader has two."""

    save(app)

    first = backup_schedule.start_scheduler(app)
    second = backup_schedule.start_scheduler(app)

    assert first is not None
    assert second is first


# ==========================================
# THE SEEDED SCHEDULE
# ==========================================

def test_the_row_is_seeded_on_first_read(app):
    with app.app_context():
        assert db.session.get(BackupSchedule, ROW_ID) is None

        schedule = backup_schedule.read_schedule()

        assert db.session.get(BackupSchedule, ROW_ID) is not None

    assert schedule == {
        "enabled": False, "frequency": "daily", "day": None,
        "time": "02:30", "timeZone": "Asia/Manila", "keep": 14,
    }


def test_the_seed_converts_the_old_utc_setting_to_local_time(app, monkeypatch):
    """BACKUP_SCHEDULE_AT named a UTC time and the row holds a local one, so
    copying the digits across would move a nightly dump by eight hours."""

    monkeypatch.setenv("BACKUP_SCHEDULE_AT", "18:30")

    with app.app_context():
        assert backup_schedule.read_schedule()["time"] == "02:30"


@pytest.mark.parametrize("value, expected", (
    ("00:00", "08:00"),
    ("16:00", "00:00"),
    ("20:15", "04:15"),
    # Unreadable settings fall back rather than stopping the backups.
    ("half past two", "02:30"),
    ("25:00", "02:30"),
    ("18:75", "02:30"),
    ("18", "02:30"),
))
def test_the_seeded_time_falls_back_rather_than_failing(app, monkeypatch, value, expected):
    monkeypatch.setenv("BACKUP_SCHEDULE_AT", value)

    with app.app_context():
        assert backup_schedule.read_schedule()["time"] == expected


@pytest.mark.parametrize("value, expected", (
    (None, 14),
    ("7", 7),
    ("1", 1),
    # Keeping nothing would delete the archive the run just took.
    ("0", 1),
    ("-3", 1),
    ("lots", 14),
))
def test_the_seeded_retention_comes_from_the_environment(app, monkeypatch, value, expected):
    if value is not None:
        monkeypatch.setenv("BACKUP_KEEP", value)

    with app.app_context():
        assert backup_schedule.read_schedule()["keep"] == expected


def test_a_deployment_that_already_runs_nightly_keeps_doing_so(app, monkeypatch):
    monkeypatch.setenv("BACKUP_SCHEDULE_ENABLED", "true")

    with app.app_context():
        assert backup_schedule.read_schedule()["enabled"] is True


def test_the_environment_is_ignored_once_the_row_exists(app, monkeypatch):
    """First-run defaults only: the row is the answer after that."""

    save(app, at_time="23:00", keep=3, enabled=False)
    monkeypatch.setenv("BACKUP_SCHEDULE_ENABLED", "true")
    monkeypatch.setenv("BACKUP_SCHEDULE_AT", "06:00")
    monkeypatch.setenv("BACKUP_KEEP", "99")

    with app.app_context():
        schedule = backup_schedule.read_schedule()

    assert schedule["time"] == "23:00"
    assert schedule["keep"] == 3
    assert schedule["enabled"] is False


def test_an_unreadable_schedule_reads_as_none(app):
    """A deployment that has not applied the migration hides the control
    rather than being offered a form that could not save."""

    with app.app_context():
        db.session.execute(db.text("DROP TABLE public.backup_schedule"))
        db.session.commit()

        assert backup_schedule.read_schedule() is None


# ==========================================
# WHEN THE NEXT RUN IS DUE
# ==========================================

def test_the_time_of_day_is_local_not_utc(app):
    """02:30 means 02:30 on a Manila clock, which is 18:30 the day before UTC."""

    due = backup_schedule.next_run_after(
        datetime(2026, 10, 12, 9, 0, tzinfo=timezone.utc),
        {"frequency": "daily", "day": None, "time": "02:30"},
    )

    assert due == datetime(2026, 10, 12, 18, 30, tzinfo=timezone.utc)


def test_the_next_run_is_today_while_the_time_is_still_ahead(app):
    due = backup_schedule.next_run_after(
        datetime(2026, 10, 12, 9, 0, tzinfo=timezone.utc),
        {"frequency": "daily", "day": None, "time": "23:00"},
    )

    # 23:00 Manila on the 12th is 15:00 UTC on the 12th.
    assert due == datetime(2026, 10, 12, 15, 0, tzinfo=timezone.utc)


def test_the_next_run_is_tomorrow_once_the_time_has_passed(app):
    due = backup_schedule.next_run_after(
        datetime(2026, 10, 12, 15, 0, tzinfo=timezone.utc),
        {"frequency": "daily", "day": None, "time": "23:00"},
    )

    assert due == datetime(2026, 10, 13, 15, 0, tzinfo=timezone.utc)


@pytest.mark.parametrize("day, expected_local_date", (
    # 2026-10-12 is a Monday in Manila; the API counts Sunday as 0.
    (1, 19),   # Monday: today has passed, so next week
    (2, 13),   # Tuesday
    (6, 17),   # Saturday
    (0, 18),   # Sunday
))
def test_a_weekly_schedule_runs_on_the_day_it_names(app, day, expected_local_date):
    # 10:00 UTC on the 12th is 18:00 Manila, after a 02:30 run time.
    due = backup_schedule.next_run_after(
        datetime(2026, 10, 12, 10, 0, tzinfo=timezone.utc),
        {"frequency": "weekly", "day": day, "time": "02:30"},
    )

    local = due.astimezone(backup_schedule.schedule_zone())
    assert (local.day, local.hour, local.minute) == (expected_local_date, 2, 30)


def test_a_weekly_run_still_ahead_today_is_not_pushed_a_week(app):
    # 2026-10-13 is a Tuesday; 00:00 UTC is 08:00 Manila, before a 23:00 run.
    due = backup_schedule.next_run_after(
        datetime(2026, 10, 13, 0, 0, tzinfo=timezone.utc),
        {"frequency": "weekly", "day": 2, "time": "23:00"},
    )

    local = due.astimezone(backup_schedule.schedule_zone())
    assert (local.day, local.hour) == (13, 23)


# ==========================================
# CLAIMING A RUN
# ==========================================

def test_only_one_process_takes_a_given_run(app):
    """Two processes reach the same minute; one dump comes out of it."""

    due = datetime(2026, 10, 12, 18, 30, tzinfo=timezone.utc)

    assert backup_schedule.claim(due) is True
    assert backup_schedule.claim(due) is False
    # A different night is a different claim.
    assert backup_schedule.claim(due + timedelta(days=1)) is True


def test_a_claim_outlives_the_process_that_made_it(app, tmp_path):
    """So a restart does not re-dump a night that has already been taken."""

    due = datetime(2026, 10, 12, 18, 30, tzinfo=timezone.utc)
    backup_schedule.claim(due)

    assert list(tmp_path.glob(".claimed-*"))
    # Claims are hidden files, so they are not mistaken for archives.
    assert backup_jobs.list_backups() == []


# ==========================================
# WHEN A RUN IS OWED
# ==========================================

def test_a_backup_is_owed_when_there_is_no_archive_at_all(app):
    assert backup_schedule.is_overdue() is True


def test_nothing_is_owed_right_after_a_backup(app, tmp_path):
    store_archive(tmp_path, "20261012-120000Z",
                  backup_jobs.iso_utc(datetime.now(timezone.utc)))

    assert backup_schedule.is_overdue() is False


def test_a_backup_is_owed_once_a_day_has_gone_by(app, tmp_path):
    stale = datetime.now(timezone.utc) - timedelta(days=1, minutes=1)
    store_archive(tmp_path, "20261011-120000Z", backup_jobs.iso_utc(stale))

    assert backup_schedule.is_overdue() is True


# ==========================================
# ONE RUN
# ==========================================

def test_a_run_takes_the_same_dump_the_panel_takes(app, monkeypatch, tmp_path, recorded):
    captured = fake_dump(monkeypatch)

    with app.app_context():
        job = backup_schedule.run_backup_now(app)

    assert job["status"] == "succeeded", job
    items = backup_jobs.list_backups()
    assert len(items) == 1
    # Distinguishable from a button press only by this.
    assert items[0]["createdBy"] == "scheduled"
    assert items[0]["scope"] == "public schema"
    assert "--format=custom" in captured["command"]
    assert "--schema=public" in captured["command"]


def test_an_archive_is_invisible_until_the_dump_has_finished(app, monkeypatch, tmp_path):
    """A truncated file must never be offered as a backup to restore from."""

    seen = {}

    def while_dumping(captured):
        seen["listed"] = backup_jobs.list_backups()
        seen["target"] = captured["command"][captured["command"].index("--file") + 1]

    fake_dump(monkeypatch, before_return=while_dumping)

    with app.app_context():
        backup_schedule.run_backup_now(app)

    assert seen["target"].endswith(".dump.partial")
    assert seen["listed"] == []
    assert len(backup_jobs.list_backups()) == 1


def test_a_failed_dump_leaves_nothing_behind(app, monkeypatch, tmp_path, recorded):
    """The failure yesterday was a dropped connection mid building_photo."""

    fake_dump(monkeypatch, returncode=1, stderr=(
        "pg_dump: error: Dumping the contents of table \"building_photo\" failed\n"
        "pg_dump: detail: SSL connection has been closed unexpectedly"
    ))

    with app.app_context():
        job = backup_schedule.run_backup_now(app)

    assert job["status"] == "failed"
    assert "SSL connection" in job["message"]
    assert backup_jobs.list_backups() == []
    assert list(tmp_path.glob("*.dump")) == []
    assert list(tmp_path.glob("*.dump.partial")) == []
    assert [row[2] for row in recorded] == ["backup failed"]


def test_leftovers_from_an_earlier_crash_are_swept_before_a_run(app, monkeypatch, tmp_path):
    abandoned = tmp_path / "20261011-075702Z.dump.partial"
    abandoned.write_bytes(b"PGDMP-half")
    fake_dump(monkeypatch)

    with app.app_context():
        backup_schedule.run_backup_now(app)

    assert not abandoned.exists()
    assert len(backup_jobs.list_backups()) == 1


def test_retention_keeps_the_newest_and_takes_the_sidecars_with_it(app, monkeypatch, tmp_path):
    save(app, keep=2)
    for day in (9, 10, 11):
        store_archive(tmp_path, f"202610{day:02d}-120000Z",
                      f"2026-10-{day:02d}T12:00:00Z")
    fake_dump(monkeypatch)

    with app.app_context():
        backup_schedule.run_backup_now(app, keep=2)

    kept = sorted(path.stem for path in tmp_path.glob("*.dump"))
    assert len(kept) == 2
    assert "20261011-120000Z" in kept
    # The two oldest are gone, and so are their sidecars.
    assert not (tmp_path / "20261009-120000Z.json").exists()
    assert not (tmp_path / "20261010-120000Z.json").exists()
    assert (tmp_path / "20261011-120000Z.json").exists()


def test_a_run_stands_aside_for_a_job_that_is_already_going(app, monkeypatch, recorded):
    """Somebody is restoring, or dumping by hand; their job is the backup."""

    def refuse(actor, keep=None, app=None):
        raise backup_jobs.BackupError("Another backup or restore is already running.", status=409)

    monkeypatch.setattr(backup_schedule, "start_backup", refuse)

    with app.app_context():
        assert backup_schedule.run_backup_now(app) is None

    assert [row[2] for row in recorded] == ["backup skipped"]


# ==========================================
# WHAT THE LOGS PAGE SEES
# ==========================================

def test_a_completed_run_is_recorded_as_a_system_event(app, monkeypatch, recorded):
    fake_dump(monkeypatch)

    with app.app_context():
        backup_schedule.run_backup_now(app)

    assert len(recorded) == 1
    category, actor, action, target, archive_id, detail = recorded[0]
    # "System" is a category the logs route already accepts and the frontend
    # already normalizes; the actor is not a person.
    assert (category, actor, action, target) == ("System", "scheduler", "backup", "Database")
    assert archive_id == backup_jobs.list_backups()[0]["id"]
    assert "completed" in detail


def test_retention_is_named_in_the_record(app, monkeypatch, tmp_path, recorded):
    save(app, keep=1)
    store_archive(tmp_path, "20261009-120000Z", "2026-10-09T12:00:00Z")
    fake_dump(monkeypatch)

    with app.app_context():
        backup_schedule.run_backup_now(app, keep=1)

    # One row for the night, plus one naming the archive retention removed.
    nightly = next(row for row in recorded if row[2] == "backup")
    assert "removed 1 archive(s) past the 1 kept" in nightly[5]
    assert [row[2] for row in recorded if row[2] == "delete backup"] == ["delete backup"]


def test_a_broken_audit_write_does_not_lose_the_backup(app, monkeypatch):
    """The dump is the point; the history of it is not worth a thread for."""

    fake_dump(monkeypatch)

    def explode(*arguments, **keywords):
        raise RuntimeError("audit_log is missing")

    monkeypatch.setattr(backup_schedule, "log_audit", explode)

    with app.app_context():
        job = backup_schedule.run_backup_now(app)

    assert job["status"] == "succeeded"
    assert len(backup_jobs.list_backups()) == 1

# ==========================================
# PICKING UP A SAVED CHANGE
# ==========================================

def test_the_timer_reads_the_schedule_from_the_row_each_time(app):
    save(app, at_time="04:00")
    assert backup_schedule.current_schedule(app)["time"] == "04:00"

    save(app, at_time="21:15")

    assert backup_schedule.current_schedule(app)["time"] == "21:15"


def test_a_schedule_it_cannot_read_is_not_guessed_at(app):
    with app.app_context():
        db.session.execute(db.text("DROP TABLE public.backup_schedule"))
        db.session.commit()

    assert backup_schedule.current_schedule(app) is None
    assert backup_schedule.current_schedule(None) is None


def test_a_saved_change_takes_effect_without_a_restart(app, monkeypatch, recorded):
    """The whole reason the schedule moved into the database: switching it on
    has to work on the running process, with nothing to redeploy."""

    save(app, enabled=False)
    fake_dump(monkeypatch)
    monkeypatch.setattr(backup_schedule, "SLEEP_SLICE_SECONDS", 0.01)
    monkeypatch.setattr(backup_schedule, "CATCHUP_DELAY_SECONDS", 0.01)
    # Always due, so the only thing deciding whether a dump happens is the row.
    monkeypatch.setattr(
        backup_schedule, "next_run_after",
        lambda moment, schedule=None: moment - timedelta(seconds=1),
    )

    # A job another test left unfinished would make start_backup refuse this
    # one, which should read as a leak rather than as a timer that never fired.
    assert backup_jobs.active_job() is None

    backup_schedule.start_scheduler(app)

    # Off: the timer is awake and looking, and takes nothing.
    assert waited_for(lambda: backup_jobs.list_backups(), 0.3) == []

    save(app, enabled=True)

    assert waited_for(lambda: backup_jobs.list_backups(), TIMER_PATIENCE_SECONDS)


def test_switching_it_off_stops_the_runs(app, monkeypatch, recorded):
    save(app, enabled=True)
    fake_dump(monkeypatch)
    monkeypatch.setattr(backup_schedule, "SLEEP_SLICE_SECONDS", 0.01)
    monkeypatch.setattr(backup_schedule, "CATCHUP_DELAY_SECONDS", 0.01)
    monkeypatch.setattr(
        backup_schedule, "next_run_after",
        lambda moment, schedule=None: moment - timedelta(seconds=1),
    )

    assert backup_jobs.active_job() is None

    backup_schedule.start_scheduler(app)
    assert waited_for(lambda: backup_jobs.list_backups(), TIMER_PATIENCE_SECONDS)

    save(app, enabled=False)
    # Let the pass that was already going finish, then count what is there.
    time.sleep(0.2)
    settled = len(backup_jobs.list_backups())
    time.sleep(0.3)

    assert len(backup_jobs.list_backups()) == settled
