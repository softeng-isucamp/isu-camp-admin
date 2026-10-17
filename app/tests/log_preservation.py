"""Logs survive a restore, which rolls the rest of the schema back.

The contract these pin: a restore replaces public with the archive's copy,
and the Logs page must still show the entries that were there a moment before
rather than the ones the backup was taken with.
"""

import pytest
from psycopg2 import sql

from services import log_preservation


def render(statement):
    """Spell a psycopg2 Composable as text, without a live connection.

    ``Identifier.as_string`` quotes through the C extension and insists on a
    real connection, so these tests render the parts themselves. Only the
    shapes this module builds are handled.
    """

    if isinstance(statement, str):
        return statement
    if isinstance(statement, sql.SQL):
        return statement.string
    if isinstance(statement, sql.Identifier):
        return ".".join(f'"{part}"' for part in statement.strings)
    if isinstance(statement, sql.Placeholder):
        return "%s"
    if isinstance(statement, sql.Composed):
        return "".join(render(part) for part in statement.seq)
    raise AssertionError(f"unrendered SQL part: {statement!r}")


ENVIRONMENT = {
    "PGHOST": "db.example",
    "PGPORT": "5432",
    "PGUSER": "postgres",
    "PGPASSWORD": "secret",
    "PGDATABASE": "postgres",
    "PGSSLMODE": "require",
}

USER_HISTORY_COLUMNS = [
    "id", "User_id", "Building_id", "Location_id", "created_at", "client_event_id",
]
AUDIT_COLUMNS = [
    "id", "created_at", "category", "actor", "action", "target", "target_id", "detail",
]


class FakeCursor:
    """Answers the catalogue and the table reads; records what was written."""

    def __init__(self, tables, columns):
        self.tables = tables
        self.columns = columns
        self.executed = []
        self.inserted = {}
        self._result = []

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def executemany(self, statement, rows):
        text = render(statement)
        self.executed.append(text)
        for table in ("UserHistory", "audit_log"):
            if f'"{table}"' in text:
                self.inserted.setdefault(table, []).extend(rows)
                return
        self.inserted.setdefault("unknown", []).extend(rows)

    def execute(self, statement, parameters=None):
        text = render(statement)
        self.executed.append(text)

        if "information_schema.columns" in text:
            self._result = [(name,) for name in self.columns.get(parameters[0], [])]
            return
        if text.startswith("select setval"):
            self._result = [(1,)]
            return
        if text.startswith("delete from"):
            self._result = []
            return

        for table, rows in self.tables.items():
            if f'"{table}"' in text or f"public.{table}" in text:
                self._result = rows
                return
        self._result = []

    def fetchall(self):
        return self._result


class FakeConnection:
    def __init__(self, cursor):
        self._cursor = cursor
        self.committed = False
        self.rolled_back = False
        self.autocommit = True
        self.closed = False
        self.encoding = "UTF8"

    def cursor(self):
        return self._cursor

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


@pytest.fixture
def connected(monkeypatch):
    """Point _connect at a fake connection and hand the test its cursor."""

    state = {}

    def build(tables, columns, surviving=None):
        cursor = FakeCursor(tables, columns)
        for table, rows in (surviving or {}).items():
            cursor.tables[table] = rows
        connection = FakeConnection(cursor)
        state["cursor"] = cursor
        state["connection"] = connection
        monkeypatch.setattr(log_preservation, "_connect", lambda _environment: connection)
        return cursor, connection

    state["build"] = build
    return state


# ==========================================
# CAPTURE
# ==========================================

def test_capture_reads_every_column_including_ones_no_model_declares(connected):
    """client_event_id is in the database and in no model, so a hardcoded
    column list would drop it silently on the way back."""

    cursor, _ = connected["build"](
        tables={
            "UserHistory": [(1, 7, None, 42, "2026-10-01", "abc-uuid")],
            "audit_log": [],
        },
        columns={"UserHistory": USER_HISTORY_COLUMNS, "audit_log": AUDIT_COLUMNS},
    )

    captured = log_preservation.capture(ENVIRONMENT)

    assert captured["UserHistory"]["columns"] == USER_HISTORY_COLUMNS
    assert captured["UserHistory"]["rows"] == [(1, 7, None, 42, "2026-10-01", "abc-uuid")]


def test_capture_skips_a_table_the_deployment_does_not_have(connected):
    """A deployment predating the audit log must still be restorable."""

    connected["build"](
        tables={"UserHistory": [(1, None, None, None, "2026-10-01", None)]},
        columns={"UserHistory": USER_HISTORY_COLUMNS, "audit_log": []},
    )

    captured = log_preservation.capture(ENVIRONMENT)

    assert "audit_log" not in captured
    assert "UserHistory" in captured


# ==========================================
# WRITE BACK
# ==========================================

def test_write_back_replaces_the_snapshot_logs_with_the_captured_ones(connected):
    cursor, connection = connected["build"](
        tables={"location": [(42,)], "building": [], "user": [(7,)]},
        columns={"UserHistory": USER_HISTORY_COLUMNS, "audit_log": AUDIT_COLUMNS},
    )

    captured = {
        "UserHistory": {
            "columns": USER_HISTORY_COLUMNS,
            "rows": [(1, 7, None, 42, "2026-10-01", None)],
        },
        "audit_log": {
            "columns": AUDIT_COLUMNS,
            "rows": [(5, "2026-10-02", "Admin", "root", "login", "Admin", "1", "")],
        },
    }

    message = log_preservation.write_back(ENVIRONMENT, captured)

    assert any(text.startswith("delete from") for text in cursor.executed)
    assert cursor.inserted["UserHistory"] == [(1, 7, None, 42, "2026-10-01", None)]
    assert cursor.inserted["audit_log"] == [
        (5, "2026-10-02", "Admin", "root", "login", "Admin", "1", "")
    ]
    assert connection.committed
    assert "1 user history" in message and "1 audit log" in message


def test_a_reference_the_restored_backup_predates_is_nulled_not_dropped(connected):
    """A search for a Location created after the backup cannot keep its foreign
    key, but the entry itself still belongs in the Logs page."""

    cursor, _ = connected["build"](
        tables={"location": [(42,)], "building": [], "user": [(7,)]},
        columns={"UserHistory": USER_HISTORY_COLUMNS, "audit_log": AUDIT_COLUMNS},
    )

    captured = {
        "UserHistory": {
            "columns": USER_HISTORY_COLUMNS,
            "rows": [
                (1, 7, None, 42, "2026-10-01", None),     # location survives
                (2, 7, None, 999, "2026-10-02", None),    # location is gone
                (3, 123, None, 42, "2026-10-03", None),   # user is gone
            ],
        },
    }

    message = log_preservation.write_back(ENVIRONMENT, captured)

    written = cursor.inserted["UserHistory"]
    assert len(written) == 3, "no entry may be dropped"
    assert written[0][3] == 42
    assert written[1][3] is None, "the missing Location is cleared"
    assert written[2][1] is None, "the missing User is cleared"
    assert written[2][3] == 42, "a surviving reference on the same row is kept"
    assert "2 referred to a record the restored backup predates" in message


def test_audit_log_has_no_foreign_keys_so_it_round_trips_untouched(connected):
    cursor, _ = connected["build"](
        tables={},
        columns={"audit_log": AUDIT_COLUMNS},
    )
    rows = [
        (1, "2026-10-01", "Admin", "root", "delete", "Location", "999", "gone"),
        (2, "2026-10-02", "System", "system", "login", "Admin", "1", ""),
    ]

    message = log_preservation.write_back(
        ENVIRONMENT, {"audit_log": {"columns": AUDIT_COLUMNS, "rows": rows}}
    )

    assert cursor.inserted["audit_log"] == rows
    assert "predates" not in message


def test_the_identity_sequence_is_moved_past_the_ids_written_back(connected):
    """Explicit ids leave the sequence behind them, so the next insert would
    collide without this."""

    cursor, _ = connected["build"](
        tables={},
        columns={"audit_log": AUDIT_COLUMNS},
    )

    log_preservation.write_back(
        ENVIRONMENT,
        {"audit_log": {"columns": AUDIT_COLUMNS, "rows": [(9, "x", "a", "b", "c", "d", None, None)]}},
    )

    setval = [text for text in cursor.executed if "setval" in text]
    assert setval, "the sequence must be resynced"
    assert "max(id) is not null" in setval[0], "an empty table must still start at 1"


def test_a_write_back_failure_rolls_back_rather_than_half_replacing(connected):
    cursor, connection = connected["build"](
        tables={},
        columns={"audit_log": AUDIT_COLUMNS},
    )

    def explode(*_args, **_kwargs):
        raise RuntimeError("connection lost")

    cursor.executemany = explode

    with pytest.raises(RuntimeError):
        log_preservation.write_back(
            ENVIRONMENT,
            {"audit_log": {"columns": AUDIT_COLUMNS, "rows": [(1, "x", "a", "b", "c", "d", None, None)]}},
        )

    assert connection.rolled_back
    assert not connection.committed


def test_nothing_captured_is_not_an_error(connected):
    connected["build"](tables={}, columns={})

    assert log_preservation.write_back(ENVIRONMENT, {}) is None
