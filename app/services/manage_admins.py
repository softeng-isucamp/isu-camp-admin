"""Admin account maintenance: create accounts, hash passwords, backfill old rows.

Three subcommands, all of which hash on this machine so a plaintext password is
never sent to the database:

    create    Create an admin account with its password already hashed.
    hash      Print a hash for one password, for pasting into Supabase by hand.
    backfill  Replace every remaining plaintext password in the table.

Run with no arguments to see them. Examples:

    venv/Scripts/python.exe app/services/manage_admins.py create      (Windows)
    venv/bin/python app/services/manage_admins.py backfill            (macOS/Linux)

Passwords are always prompted for, never passed as arguments, so they stay out
of the shell history and the process list.
"""

import argparse
import os
import sys
from getpass import getpass

SERVICES_DIR = os.path.dirname(os.path.abspath(__file__))
APP_DIR = os.path.dirname(SERVICES_DIR)
ROOT_DIR = os.path.dirname(APP_DIR)

for entry in (SERVICES_DIR, APP_DIR):
    if entry not in sys.path:
        sys.path.insert(0, entry)

from dotenv import load_dotenv  # noqa: E402
from flask import Flask  # noqa: E402
from sqlalchemy import func  # noqa: E402

from extensions import db  # noqa: E402
from services.security import (  # noqa: E402
    hash_password,
    is_hashed,
    password_policy_error,
)


# ==========================================
# Shared Helpers
# ==========================================

def build_app():
    """A minimal app with just the database bound, for the two DB subcommands."""
    load_dotenv(os.path.join(ROOT_DIR, ".env"))
    load_dotenv()

    database_url = os.getenv("SUPABASE_DATABASE_URL")

    if not database_url:
        raise SystemExit("SUPABASE_DATABASE_URL is missing from .env")

    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = database_url
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    db.init_app(app)
    return app


def prompt_password(username=None):
    """Read a new password twice and hold it to the same policy as a reset."""
    password = getpass("Password: ")

    if not password:
        raise SystemExit("No password entered.")
    if password != getpass("Confirm password: "):
        raise SystemExit("The two entries did not match.")

    policy_error = password_policy_error(password, username)

    if policy_error:
        raise SystemExit(f"{policy_error}.")

    return password


# ==========================================
# create
# ==========================================

def command_create(arguments):
    """Insert a new admin row with the password hashed before it is sent."""
    username = (arguments.username or input("Username: ")).strip()

    if not username:
        raise SystemExit("A username is required.")

    gmail = (arguments.gmail or input("Gmail (for password resets): ")).strip()

    if not gmail:
        raise SystemExit("A Gmail address is required, or password reset cannot work.")

    password = prompt_password(username)

    with build_app().app_context():
        from auth import Admin

        if Admin.query.filter_by(username=username).first():
            raise SystemExit(f"An admin named '{username}' already exists.")

        admin = Admin(username=username, password=hash_password(password), gmail=gmail)

        # The id column is a plain smallint rather than an identity column, so
        # the next value is chosen here instead of by the database.
        if admin.id is None:
            highest = db.session.query(func.max(Admin.id)).scalar()
            admin.id = (highest or 0) + 1

        db.session.add(admin)
        db.session.commit()

        print(f"Created admin '{username}' (id {admin.id}) with a hashed password.")


# ==========================================
# hash
# ==========================================

def command_hash(arguments):
    """Print a hash to paste into the admin.password column. Touches no database."""
    password = prompt_password()

    print()
    print("Paste this into the admin.password column in Supabase:")
    print()
    print(hash_password(password))


# ==========================================
# backfill
# ==========================================

def command_backfill(arguments):
    """Hash every row still holding a plaintext password.

    The login route upgrades a row the first time its owner signs in, so this
    exists for accounts nobody has used since hashing was introduced. Rows that
    already hold a hash are skipped, so re-running is safe.
    """
    with build_app().app_context():
        from auth import Admin

        converted = 0
        skipped = 0

        for admin in Admin.query.all():
            if is_hashed(admin.password):
                skipped += 1
                continue
            admin.password = hash_password(admin.password)
            converted += 1
            print(f"Hashed password for admin '{admin.username}'")

        db.session.commit()

    print(f"Done. {converted} password(s) hashed, {skipped} already hashed.")


# ==========================================
# Entry Point
# ==========================================

def main():
    parser = argparse.ArgumentParser(
        description="Create admin accounts and hash admin passwords."
    )
    subcommands = parser.add_subparsers(dest="command", required=True)

    create = subcommands.add_parser("create", help="Create an admin account.")
    create.add_argument("--username", help="Admin username (prompted for if omitted).")
    create.add_argument("--gmail", help="Address that receives password reset codes.")
    create.set_defaults(handler=command_create)

    hash_one = subcommands.add_parser(
        "hash", help="Print a hash for one password, for pasting into Supabase."
    )
    hash_one.set_defaults(handler=command_hash)

    backfill = subcommands.add_parser(
        "backfill", help="Hash every remaining plaintext password in the table."
    )
    backfill.set_defaults(handler=command_backfill)

    arguments = parser.parse_args()
    arguments.handler(arguments)


if __name__ == "__main__":
    main()
