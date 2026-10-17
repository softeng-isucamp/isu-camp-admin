"""Keeps the Logs page showing current entries across a database restore.

A restore replaces the ``public`` schema with the archive's copy of it, logs
included, so without this the Logs page loses every entry recorded since the
backup was taken: the User App's destination history, and the audit trail of
what administrators did - up to and including the record of who started the
restore. The archive still holds the snapshot's copy of both tables, exactly
as before. It simply stops being what the portal displays.

Both tables are read just before ``pg_restore`` runs and written back once it
succeeds, replacing whatever the snapshot put there. ``audit_log`` has no
foreign keys and comes back byte for byte. ``UserHistory`` points at ``user``,
``building`` and ``location``, which the restore has just rolled back, so a row
whose destination the snapshot predates would violate its foreign key. Those
references are nulled rather than the row being dropped: all three columns are
nullable, the projection in ``routes/logs.py`` already renders a null target as
"Unknown destination", and keeping the entry preserves the count and the
timestamp that the Logs page is being asked not to change.

Columns are read from the catalogue rather than listed here, because the
database holds columns no model declares - ``UserHistory.client_event_id`` is
one - and a hardcoded list would silently drop them on the way through.

psycopg2 is used directly rather than SQLAlchemy because this runs on the job
thread in ``backup_jobs``, which has no application context, and because the
connection details are already assembled there as libpq environment variables.
"""

import logging
from contextlib import closing

import psycopg2
from psycopg2 import sql

logger = logging.getLogger(__name__)

# Read before a restore and written back after it, in this order.
PRESERVED_TABLES = ("UserHistory", "audit_log")

# Where each preserved table's foreign keys point, as
# ``column -> (referenced table, referenced column)``. A captured value that
# the restored snapshot no longer contains is nulled before the row is written
# back. audit_log has none, which is why it survives a restore untouched.
FOREIGN_KEYS = {
    "UserHistory": {
        "User_id": ("user", "id"),
        "Building_id": ("building", "building_id"),
        "Location_id": ("location", "location_id"),
    },
    "audit_log": {},
}


def _connect(environment):
    """A connection built from the same libpq variables pg_restore is given."""

    return psycopg2.connect(
        host=environment["PGHOST"],
        port=environment["PGPORT"],
        user=environment["PGUSER"],
        password=environment["PGPASSWORD"],
        dbname=environment["PGDATABASE"],
        sslmode=environment.get("PGSSLMODE", "require"),
    )


def _columns(cursor, table):
    """Every column of ``table`` in declaration order, or [] if it is absent."""

    cursor.execute(
        """
        select column_name
        from information_schema.columns
        where table_schema = 'public' and table_name = %s
        order by ordinal_position
        """,
        (table,),
    )
    return [row[0] for row in cursor.fetchall()]


def capture(environment):
    """Read the preserved tables as they stand before the restore.

    A table that does not exist is skipped rather than failing: a deployment
    that predates the audit log should still be restorable.
    """

    captured = {}
    with closing(_connect(environment)) as connection:
        with connection.cursor() as cursor:
            for table in PRESERVED_TABLES:
                columns = _columns(cursor, table)
                if not columns:
                    logger.info("No public.%s to preserve across the restore", table)
                    continue
                cursor.execute(
                    sql.SQL("select {} from public.{}").format(
                        sql.SQL(", ").join(sql.Identifier(name) for name in columns),
                        sql.Identifier(table),
                    )
                )
                captured[table] = {"columns": columns, "rows": cursor.fetchall()}
    return captured


def _surviving_targets(cursor, table):
    """The ids each of ``table``'s foreign keys can still point at."""

    targets = {}
    for column, (referenced_table, referenced_column) in FOREIGN_KEYS.get(table, {}).items():
        cursor.execute(
            sql.SQL("select {} from public.{}").format(
                sql.Identifier(referenced_column),
                sql.Identifier(referenced_table),
            )
        )
        targets[column] = {row[0] for row in cursor.fetchall()}
    return targets


def _reattach(columns, rows, surviving):
    """Null the references the restored snapshot can no longer satisfy.

    Returns ``(rows, cleared)``, where ``cleared`` counts rows that lost at
    least one reference - the number the job reports, so a quietly degraded
    entry is still accounted for.
    """

    if not surviving:
        return rows, 0

    position_of = {column: position for position, column in enumerate(columns)}
    rewritten = []
    cleared = 0

    for row in rows:
        values = list(row)
        changed = False
        for column, alive in surviving.items():
            position = position_of.get(column)
            if position is None:
                continue
            if values[position] is not None and values[position] not in alive:
                values[position] = None
                changed = True
        if changed:
            cleared += 1
        rewritten.append(tuple(values))

    return rewritten, cleared


def _resync_identity(cursor, table):
    """Move the identity sequence past the highest id written back.

    Both preserved tables are GENERATED BY DEFAULT AS IDENTITY, so explicit ids
    insert cleanly but leave the sequence behind them; the next insert would
    then collide. The three-argument setval marks the sequence uncalled when
    the table is empty, so the first row still gets id 1.
    """

    # format('public.%I', ...) does the quoting in the database, so the mixed
    # case of "UserHistory" survives without this having to quote by hand.
    cursor.execute(
        sql.SQL(
            "select setval(pg_get_serial_sequence(format('public.%I', %s), 'id'),"
            " coalesce(max(id), 1), max(id) is not null) from public.{}"
        ).format(sql.Identifier(table)),
        (table,),
    )


def write_back(environment, captured):
    """Replace the restored snapshot's logs with the ones captured beforehand.

    One transaction over both tables, so the Logs page never reads a half
    written state. Returns a sentence for the job to report, or None when
    there was nothing to preserve.
    """

    if not captured:
        return None

    written = {}
    cleared_total = 0

    with closing(_connect(environment)) as connection:
        connection.autocommit = False
        try:
            with connection.cursor() as cursor:
                for table, data in captured.items():
                    columns = data["columns"]
                    rows, cleared = _reattach(
                        columns, data["rows"], _surviving_targets(cursor, table)
                    )
                    cursor.execute(
                        sql.SQL("delete from public.{}").format(sql.Identifier(table))
                    )
                    if rows:
                        # executemany rather than execute_values: the latter
                        # wants the statement already rendered to a string,
                        # which needs a live connection to quote identifiers
                        # with. Both preserved tables are small - hundreds of
                        # rows against a restore measured in minutes - so the
                        # extra round trips cost nothing worth the coupling.
                        cursor.executemany(
                            sql.SQL("insert into public.{} ({}) values ({})").format(
                                sql.Identifier(table),
                                sql.SQL(", ").join(sql.Identifier(name) for name in columns),
                                sql.SQL(", ").join(sql.Placeholder() * len(columns)),
                            ),
                            rows,
                        )
                    _resync_identity(cursor, table)
                    written[table] = len(rows)
                    cleared_total += cleared
            connection.commit()
        except Exception:
            connection.rollback()
            raise

    return _summary(written, cleared_total)


def _summary(written, cleared):
    """What the job says it did, in the panel's own vocabulary."""

    parts = []
    if written.get("UserHistory"):
        parts.append(f"{written['UserHistory']} user history")
    if written.get("audit_log"):
        parts.append(f"{written['audit_log']} audit log")

    if not parts:
        return "The logs were already empty, so none were carried across."

    sentence = f"Kept the current logs: {' and '.join(parts)} entries."
    if cleared:
        sentence += (
            f" {cleared} referred to a record the restored backup predates,"
            " so those entries kept their time but lost their target."
        )
    return sentence
