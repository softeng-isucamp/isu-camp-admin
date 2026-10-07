"""Database preflight for dev.ps1 / dev.sh.

The dev scripts run this before starting Flask so a bad or missing
SUPABASE_DATABASE_URL fails here, with an explanation, instead of surfacing
later as a stack trace on the first request. Exits 0 when the database is
reachable and the tables the admin reads are present, 1 otherwise.
"""

import os
import sys
from urllib.parse import urlsplit, urlunsplit

from dotenv import load_dotenv
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import SQLAlchemyError

SERVICES_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(SERVICES_DIR)
ROOT_DIR = os.path.dirname(APP_DIR)

# Same order as database.py, so both read one configuration.
load_dotenv(os.path.join(ROOT_DIR, ".env"))
load_dotenv()

# The admin refuses to start usefully without these; a connection that works but
# points at an empty database is the more confusing failure of the two.
REQUIRED_TABLES = ("admin", "building", "location", "user", "userInfo")


def _safe_url(database_url):
    """The URL with any password stripped, matching database.py's logging."""
    parsed = urlsplit(database_url)
    if not parsed.hostname:
        return "********"
    netloc = parsed.hostname
    if parsed.port:
        netloc += f":{parsed.port}"
    return urlunsplit((parsed.scheme, netloc, parsed.path, parsed.query, ""))


def _fail(message, hint=None):
    # stdout is block-buffered when the dev script captures it, so flush first or
    # these lines appear above the progress line they follow.
    sys.stdout.flush()
    print(f"[DB] {message}", file=sys.stderr)
    if hint:
        print(f"[DB] {hint}", file=sys.stderr)
    return 1


def main():
    database_url = os.getenv("SUPABASE_DATABASE_URL")
    if not database_url:
        return _fail(
            "SUPABASE_DATABASE_URL is not set.",
            f"Add it to {os.path.join(ROOT_DIR, '.env')} or app/services/.env.",
        )

    print(f"[DB] Connecting to {_safe_url(database_url)}")

    engine = None
    try:
        # Fail fast: without a timeout an unreachable host hangs the dev script.
        engine = create_engine(
            database_url,
            connect_args={"connect_timeout": 10},
            pool_pre_ping=True,
        )
        with engine.connect() as connection:
            connection.execute(text("select 1"))
            present = set(inspect(connection).get_table_names(schema="public"))
    except SQLAlchemyError as error:
        # The driver's message carries the useful detail (bad password, no such
        # host, timeout); the first line keeps it without a traceback.
        return _fail(
            "Could not connect to the database.",
            str(error).splitlines()[0],
        )
    finally:
        if engine is not None:
            engine.dispose()

    missing = [table for table in REQUIRED_TABLES if table not in present]
    if missing:
        return _fail(
            f"Connected, but these tables are missing from public: {', '.join(missing)}.",
            "Check that SUPABASE_DATABASE_URL points at the ISU-CAMP project.",
        )

    print("[DB] Connection OK; required tables present.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
