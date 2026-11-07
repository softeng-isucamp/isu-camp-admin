"""The fixed set of four superadmins, as the database enforces it.

The API refusals are covered by app/tests/admins.py against a fake directory.
They are a convenience: a readable message instead of a failed commit. What
makes the set a fact rather than a convention is in
migrations/20261107_fixed_superadmins.sql, and nothing in a fake store can
carry it. These tests run the migration file as a deployment runs it and then
try to break the invariant the way somebody with SQL would:

* promote an undesignated account directly,
* designate a fifth,
* withdraw a designation while the account still holds the role,
* delete a designated row,
* run the migration against a directory that does not match its preconditions.

**PostgreSQL only.** The invariant is a ``DEFERRABLE INITIALLY DEFERRED``
constraint trigger, checked at COMMIT, and that is not a convenience here: an
immediate check cannot be satisfied at all, because the first statement of a
transfer leaves the two tables disagreeing whichever one it writes first.
SQLite has neither deferred triggers nor session settings, so a SQLite
rendering of these rules would be a different mechanism tested in place of the
real one - which is the mistake app/tests/admin_permissions_storage.py exists
to document. Set ``ISU_TEST_DATABASE_URL`` to a disposable PostgreSQL to run
them; without it they skip.

Everything here uses disposable data. No live id, username or address appears
in this file, and the designated ids are the ones each test inserts itself.
"""

import os
import re
import time
from pathlib import Path

import pytest
from flask import Flask
from sqlalchemy import text

from admins import admins_bp
from auth import Admin
from extensions import db
from model.superadmin_designation import SuperadminDesignation

MIGRATION = Path(__file__).resolve().parents[2] / "migrations" / "20261107_fixed_superadmins.sql"

POSTGRES_URL = os.getenv("ISU_TEST_DATABASE_URL")

# The four ids these tests designate. Arbitrary and local to this file: the
# live identities are operator inputs and are deliberately nowhere in source.
FOUR = (11, 12, 13, 14)

# A fifth account, never designated, used to try to acquire the role.
OUTSIDER = 15


pytestmark = pytest.mark.skipif(
    not POSTGRES_URL,
    reason="set ISU_TEST_DATABASE_URL to a disposable PostgreSQL to run the fixed-superadmin invariants",
)


def migration_sql(*ids):
    """The migration file with its operator inputs filled in.

    psql substitutes ``:super1`` before sending the script; nothing else does,
    so the substitution happens here. Only the four placeholders are touched,
    so what runs is otherwise the tracked file byte for byte - the point being
    that a test cannot pass against a script a deployment would not run.
    """

    supplied = {f":super{index}": str(value) for index, value in enumerate(ids, start=1)}
    return re.sub(
        r":super[1-4]",
        lambda found: supplied.get(found.group(0), found.group(0)),
        MIGRATION.read_text(encoding="utf-8"),
    )


def run_script(sql):
    """Runs a multi-statement script the way psql does, with its own BEGIN.

    On its own connection in autocommit, so the file's ``begin;`` opens the
    transaction and its ``commit;`` ends it. Run inside an ORM session's
    transaction instead, the script's COMMIT would commit the session and its
    ``on commit drop`` temporary tables would outlive the statements that
    created them.
    """

    raw = db.engine.raw_connection()
    try:
        raw.autocommit = True
        with raw.cursor() as cursor:
            cursor.execute(sql)
    finally:
        raw.close()


def sql(statement, **params):
    """One statement in its own transaction, committed."""

    db.session.execute(text(statement), params)
    db.session.commit()


def refused(statement, **params):
    """Runs ``statement`` expecting the database to refuse it; returns the text."""

    with pytest.raises(Exception) as error:
        db.session.execute(text(statement), params)
        db.session.commit()
    db.session.rollback()
    return str(error.value)


@pytest.fixture
def app(monkeypatch):
    """A fresh schema, four designated superadmins, one outsider."""

    app = Flask(__name__)
    app.config.update(
        SQLALCHEMY_DATABASE_URI=POSTGRES_URL,
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        TESTING=True,
        SECRET_KEY="test-secret",
    )
    db.init_app(app)
    app.register_blueprint(admins_bp)

    with app.app_context():
        db.session.execute(text("drop schema if exists public cascade"))
        db.session.execute(text("create schema public"))
        db.session.commit()
        db.metadata.create_all(db.engine)
        # The model carries no foreign key - see its docstring - so the table
        # create_all just made is not the one a deployment has. Dropped, so the
        # migration below creates the genuine article, references and all.
        db.session.execute(text("drop table public.superadmin_designation"))
        db.session.commit()

        for identifier in (*FOUR, OUTSIDER):
            db.session.add(Admin(
                id=identifier,
                username=f"account{identifier}",
                password="not-verified-here",
                gmail=f"account{identifier}@example.test",
                role="superadmin" if identifier in FOUR else "admin",
                permissions=None if identifier in FOUR else {
                    "add": False, "edit": False, "delete": False, "changeUserStatus": False,
                },
            ))
        db.session.commit()

        yield app

        db.session.rollback()
        # The schema goes with the test, triggers and foreign keys included.
        # Left behind, the designation table's reference to public.admin stops
        # any other test file in the same disposable database from dropping its
        # own tables.
        db.session.execute(text("drop schema if exists public cascade"))
        db.session.execute(text("create schema public"))
        db.session.commit()
        db.session.remove()


@pytest.fixture
def designated(app):
    """The migration applied, so the four are designated and the rules armed."""

    with app.app_context():
        run_script(migration_sql(*FOUR))
        yield app


def designations(app):
    """The designated ids, or ``[]`` when there is no table to read.

    A migration that fails rolls its own table back with everything else, so
    "nothing is designated" and "there is nothing to be designated in" are the
    same answer to the question these tests ask.
    """

    with app.app_context():
        present = db.session.execute(
            text("select to_regclass('public.superadmin_designation') is not null")
        ).scalar()
        if not present:
            return []
        return sorted(
            row.admin_id for row in db.session.execute(db.select(SuperadminDesignation)).scalars()
        )


def role_of(app, identifier):
    with app.app_context():
        return db.session.get(Admin, identifier).role


def signed_in(app, admin_id):
    client = app.test_client()
    with client.session_transaction() as flask_session:
        flask_session["admin_id"] = admin_id
        flask_session["admin_username"] = f"account{admin_id}"
        flask_session["reauth_at"] = time.time()
    return client


# ==========================================
# The migration itself
# ==========================================

def test_the_migration_designates_the_four_ids_it_is_given(app):
    with app.app_context():
        run_script(migration_sql(*FOUR))

    assert designations(app) == sorted(FOUR)


def test_the_migration_is_safe_to_re_run_with_the_same_ids(designated):
    with designated.app_context():
        run_script(migration_sql(*FOUR))

    assert designations(designated) == sorted(FOUR)


def test_re_running_with_a_different_id_is_refused(designated):
    """A replacement goes through the transfer procedure, where it is reviewed
    and audited, not through a migration run again with one id changed.

    Caught by the "not an active superadmin" precondition rather than by the
    "already designated" one, and that is the stronger answer: once the
    invariant is armed, an id that is not already designated cannot hold the
    role at all, so there is no fifth candidate for a re-run to name.
    """

    with designated.app_context():
        with pytest.raises(Exception) as error:
            run_script(migration_sql(FOUR[0], FOUR[1], FOUR[2], OUTSIDER))

    assert "are not active superadmins" in str(error.value)
    assert designations(designated) == sorted(FOUR)


def test_the_already_designated_check_catches_a_set_that_has_drifted(designated):
    """The backstop, for a database whose two tables disagree.

    Unreachable while the triggers are armed, which is the point of them, so it
    is set up with the triggers disabled - a hand-edited or partially restored
    database, which is exactly when an operator reaches for the migration file
    again and must be sent to the transfer procedure instead.
    """

    with designated.app_context():
        run_script(f"""
            begin;
            alter table public.superadmin_designation
                disable trigger assert_superadmin_designation_on_designation;
            alter table public.admin
                disable trigger assert_superadmin_designation_on_admin;
            set local isu.superadmin_transfer = 'on';
            delete from public.superadmin_designation where admin_id = {FOUR[0]};
            insert into public.superadmin_designation (admin_id) values ({OUTSIDER});
            alter table public.superadmin_designation
                enable trigger assert_superadmin_designation_on_designation;
            alter table public.admin
                enable trigger assert_superadmin_designation_on_admin;
            commit;
        """)

        with pytest.raises(Exception) as error:
            run_script(migration_sql(*FOUR))

    assert "a different set of superadmins is already designated" in str(error.value)
    # And the drifted set is left exactly as it was, for somebody to repair.
    assert designations(designated) == sorted((*FOUR[1:], OUTSIDER))


def test_the_migration_refuses_an_id_that_is_not_an_account(app):
    with app.app_context():
        with pytest.raises(Exception) as error:
            run_script(migration_sql(FOUR[0], FOUR[1], FOUR[2], 99))

    assert "no administrator account exists with id(s) 99" in str(error.value)
    assert designations(app) == []


def test_the_migration_refuses_a_duplicate_id(app):
    """Four ids where two are the same would designate three accounts and look
    like four, which is the one arithmetic error this cannot be allowed."""

    with app.app_context():
        with pytest.raises(Exception) as error:
            run_script(migration_sql(FOUR[0], FOUR[0], FOUR[1], FOUR[2]))

    assert "duplicate key" in str(error.value) or "designated_input_pkey" in str(error.value)
    assert designations(app) == []


def test_the_migration_refuses_an_account_that_is_not_a_superadmin(app):
    with app.app_context():
        with pytest.raises(Exception) as error:
            run_script(migration_sql(FOUR[0], FOUR[1], FOUR[2], OUTSIDER))

    assert "are not active superadmins" in str(error.value)
    assert designations(app) == []


def test_the_migration_refuses_an_inactive_account(app):
    """The four are verified live accounts. An inactive one is a decision
    somebody has to make before this runs, not one this run makes."""

    with app.app_context():
        sql("update public.admin set status = 'inactive' where id = :id", id=FOUR[3])

        with pytest.raises(Exception) as error:
            run_script(migration_sql(*FOUR))

    assert "are not active superadmins" in str(error.value)
    assert designations(app) == []


def test_the_migration_refuses_an_extra_superadmin_and_does_not_demote_it(app):
    """An extra superadmin is a live account somebody is signing in with, and
    whether it loses that access is not a migration's decision."""

    with app.app_context():
        sql("update public.admin set role = 'superadmin' where id = :id", id=OUTSIDER)

        with pytest.raises(Exception) as error:
            run_script(migration_sql(*FOUR))

    assert "and are not among the four supplied ids" in str(error.value)
    assert designations(app) == []
    assert role_of(app, OUTSIDER) == "superadmin"


def test_a_failed_migration_leaves_no_schema_behind(app):
    """One transaction: a precondition that fails rolls the table and the
    triggers back with it, so a half-applied deployment is not a state."""

    with app.app_context():
        with pytest.raises(Exception):
            run_script(migration_sql(FOUR[0], FOUR[1], FOUR[2], 99))

        present = db.session.execute(
            text("select to_regclass('public.superadmin_designation') is not null")
        ).scalar()

    assert present is False


def test_the_migration_audits_each_designation(app):
    with app.app_context():
        run_script(migration_sql(*FOUR))

        rows = db.session.execute(text(
            "select target_id, detail from public.audit_log"
            " where action = 'designate superadmin' order by target_id::int"
        )).all()

    assert [(row[0], row[1]) for row in rows] == [
        (str(identifier), f"account{identifier}") for identifier in sorted(FOUR)
    ]


def test_re_running_does_not_audit_the_same_designation_twice(designated):
    with designated.app_context():
        run_script(migration_sql(*FOUR))

        count = db.session.execute(text(
            "select count(*) from public.audit_log where action = 'designate superadmin'"
        )).scalar()

    assert count == len(FOUR)


def test_the_audit_records_no_credential(designated):
    """A transfer is a change of who, not of any secret."""

    with designated.app_context():
        rows = db.session.execute(text(
            "select actor, detail from public.audit_log where action = 'designate superadmin'"
        )).all()
        stored = db.session.execute(text("select password, gmail from public.admin")).all()

    secrets = {value for row in stored for value in row}
    assert all(row[1] not in secrets and row[0] not in secrets for row in rows)


# ==========================================
# The invariant, against direct SQL
# ==========================================

def test_an_undesignated_account_cannot_acquire_the_role(designated):
    """The acceptance criterion in one statement: the thing the portal no
    longer offers cannot be done behind it either."""

    with designated.app_context():
        message = refused(
            "update public.admin set role = 'superadmin' where id = :id", id=OUTSIDER
        )

    assert "superadmin_not_designated" in message
    assert role_of(designated, OUTSIDER) == "admin"


def test_an_undesignated_superadmin_cannot_be_inserted(designated):
    with designated.app_context():
        # status spelled out: NOT NULL with its default in the model, so a
        # plain SQL insert has to supply it.
        message = refused(
            "insert into public.admin (id, username, password, gmail, role, status)"
            " values (:id, 'intruder', 'x', 'intruder@example.test', 'superadmin', 'active')",
            id=99,
        )

    assert "superadmin_not_designated" in message


def test_a_fifth_account_cannot_be_designated(designated):
    with designated.app_context():
        message = refused(
            "set local isu.superadmin_transfer = 'on';"
            " insert into public.superadmin_designation (admin_id) values (:id)",
            id=OUTSIDER,
        )

    # Designating the fifth also promotes nobody, so it trips the half of the
    # rule that notices a designated account without the role; the cap below
    # is what refuses a fifth that *is* promoted.
    assert "designated_not_superadmin" in message
    assert designations(designated) == sorted(FOUR)


def test_a_fifth_superadmin_cannot_be_designated_and_promoted_together(designated):
    """Both halves of the rule satisfied, and still refused: four is the cap."""

    with designated.app_context():
        message = refused(
            "set local isu.superadmin_transfer = 'on';"
            " insert into public.superadmin_designation (admin_id) values (:id);"
            " update public.admin set role = 'superadmin' where id = :id",
            id=OUTSIDER,
        )

    assert "too_many_superadmins" in message
    assert designations(designated) == sorted(FOUR)
    assert role_of(designated, OUTSIDER) == "admin"


def test_a_designation_cannot_be_withdrawn_while_the_account_holds_the_role(designated):
    with designated.app_context():
        message = refused(
            "set local isu.superadmin_transfer = 'on';"
            " delete from public.superadmin_designation where admin_id = :id",
            id=FOUR[0],
        )

    assert "superadmin_not_designated" in message
    assert designations(designated) == sorted(FOUR)


def test_a_designated_row_cannot_be_deleted(designated):
    with designated.app_context():
        message = refused("delete from public.admin where id = :id", id=FOUR[0])

    assert "designated_superadmin_protected" in message
    assert designations(designated) == sorted(FOUR)


def test_the_designation_table_cannot_be_written_without_the_transfer_gate(designated):
    """Every write to it, not only a delete: a maintenance script that has not
    said it is a transfer does not get to move the set by accident."""

    with designated.app_context():
        inserted = refused(
            "insert into public.superadmin_designation (admin_id) values (:id)", id=OUTSIDER
        )
        updated = refused(
            "update public.superadmin_designation set admin_id = :new where admin_id = :old",
            new=OUTSIDER, old=FOUR[0],
        )
        deleted = refused(
            "delete from public.superadmin_designation where admin_id = :id", id=FOUR[0]
        )

    assert all(
        "superadmin_designation_protected" in message
        for message in (inserted, updated, deleted)
    )
    assert designations(designated) == sorted(FOUR)


def test_the_gate_lasts_only_for_its_own_transaction(designated):
    """``set local`` ends with the transaction, so a transfer cannot leave the
    door open for whatever runs next on the same connection."""

    with designated.app_context():
        sql("set local isu.superadmin_transfer = 'on'")

        message = refused(
            "delete from public.superadmin_designation where admin_id = :id", id=FOUR[0]
        )

    assert "superadmin_designation_protected" in message


def test_an_ordinary_update_to_a_designated_row_still_works(designated):
    """The invariant fires on every update to public.admin, so a password
    change for one of the four has to pass it - and does."""

    with designated.app_context():
        sql("update public.admin set password = 'rotated' where id = :id", id=FOUR[0])

        stored = db.session.execute(
            text("select password from public.admin where id = :id"), {"id": FOUR[0]}
        ).scalar()

    assert stored == "rotated"


def test_a_designated_account_can_be_deactivated_for_containment(designated):
    """Urgent containment, left possible on purpose: the cap counts
    designations, not active accounts, so the portal keeping three active
    superadmins for a while does not break anything."""

    with designated.app_context():
        sql("update public.admin set status = 'inactive' where id = :id", id=FOUR[0])

        active = db.session.execute(text(
            "select count(*) from public.admin"
            " where role = 'superadmin' and status = 'active'"
        )).scalar()

    assert active == len(FOUR) - 1
    assert designations(designated) == sorted(FOUR)


# ==========================================
# An authorized transfer
# ==========================================

TRANSFER = """
begin;
set local isu.superadmin_transfer = 'on';
select 1 from public.admin where id in (:outgoing, :incoming) for update;
select 1 from public.superadmin_designation order by admin_id for update;
delete from public.superadmin_designation where admin_id = :outgoing;
update public.admin set role = 'admin',
       permissions = '{"add": false, "edit": false, "delete": false, "changeUserStatus": false}'::jsonb
 where id = :outgoing;
insert into public.superadmin_designation (admin_id) values (:incoming);
update public.admin set role = 'superadmin', permissions = null where id = :incoming;
insert into public.audit_log
       (created_at, category, actor, action, target, target_id, detail)
select now(), 'Admin', 'operator', 'transfer superadmin', 'Administrator',
       a.id::text, a.username
  from public.admin a where a.id in (:outgoing, :incoming) order by a.id;
commit;
"""


def transfer(outgoing, incoming):
    run_script(
        TRANSFER.replace(":outgoing", str(outgoing)).replace(":incoming", str(incoming))
    )


def test_an_authorized_transfer_replaces_one_of_the_four(designated):
    """One transaction, both tables, and the invariant holds at COMMIT. This is
    the procedure the README documents, run as written."""

    with designated.app_context():
        transfer(FOUR[0], OUTSIDER)

    assert designations(designated) == sorted((*FOUR[1:], OUTSIDER))
    assert role_of(designated, FOUR[0]) == "admin"
    assert role_of(designated, OUTSIDER) == "superadmin"


def test_a_transfer_can_designate_before_it_demotes(designated):
    """Which is why the invariant is deferred. Either statement order leaves
    the two tables disagreeing for a moment, and neither is an error."""

    with designated.app_context():
        run_script(f"""
            begin;
            set local isu.superadmin_transfer = 'on';
            insert into public.superadmin_designation (admin_id) values ({OUTSIDER});
            update public.admin set role = 'superadmin' where id = {OUTSIDER};
            delete from public.superadmin_designation where admin_id = {FOUR[0]};
            update public.admin set role = 'admin' where id = {FOUR[0]};
            commit;
        """)

    assert designations(designated) == sorted((*FOUR[1:], OUTSIDER))


def test_a_transfer_that_forgets_half_of_itself_is_refused(designated):
    """The outgoing designation withdrawn and the role left behind. Deferred
    means "checked at COMMIT", not "not checked"."""

    with designated.app_context():
        with pytest.raises(Exception) as error:
            run_script(f"""
                begin;
                set local isu.superadmin_transfer = 'on';
                delete from public.superadmin_designation where admin_id = {FOUR[0]};
                insert into public.superadmin_designation (admin_id) values ({OUTSIDER});
                update public.admin set role = 'superadmin' where id = {OUTSIDER};
                commit;
            """)

    assert "superadmin_not_designated" in str(error.value)
    assert designations(designated) == sorted(FOUR)
    assert role_of(designated, OUTSIDER) == "admin"


def test_a_transfer_is_audited_against_both_accounts(designated):
    with designated.app_context():
        transfer(FOUR[0], OUTSIDER)

        rows = db.session.execute(text(
            "select target_id from public.audit_log"
            " where action = 'transfer superadmin' order by target_id::int"
        )).scalars().all()

    assert rows == sorted([str(FOUR[0]), str(OUTSIDER)], key=int)


def test_the_portal_follows_the_transfer_without_a_restart(designated):
    """Database-backed role checks on subsequent requests: the incoming
    account can manage administrators on its next request, and the outgoing one
    cannot, with no sign-out in between."""

    def creates(client, username):
        return client.post("/api/admins", json={
            "username": username, "email": f"{username}@example.test",
            "password": "Another-secret1!",
        })

    incoming = signed_in(designated, OUTSIDER)
    outgoing = signed_in(designated, FOUR[0])
    before = creates(incoming, "too_early")

    with designated.app_context():
        transfer(FOUR[0], OUTSIDER)

    # Same session cookies on both sides of the transfer. Both accounts stay
    # active throughout, so what moved is the role and nothing else.
    assert before.status_code == 403
    assert creates(incoming, "allowed_now").status_code == 201
    assert creates(outgoing, "too_late").status_code == 403
    with designated.app_context():
        assert Admin.query.filter_by(username="allowed_now").one().role == "admin"
        assert Admin.query.filter_by(username="too_late").first() is None


# ==========================================
# The portal against the real schema
# ==========================================

def test_the_api_refuses_what_the_database_would_have_refused(designated):
    """The same three requests the fake-store tests cover, run against the
    genuine triggers - so a refusal that only existed in Python would show up
    here as a 500 from a failed COMMIT instead of a 409."""

    client = signed_in(designated, FOUR[0])

    created = client.post("/api/admins", json={
        "username": "wanted", "email": "wanted@example.test",
        "password": "Another-secret1!", "role": "superadmin",
    })
    promoted = client.put(f"/api/admins/{OUTSIDER}/role", json={"role": "superadmin"})
    deactivated = client.put(f"/api/admins/{FOUR[1]}/status", json={"status": "Inactive"})

    assert (created.status_code, promoted.status_code, deactivated.status_code) == (409, 405, 409)
    assert all(
        response.json["code"] == "superadmin_set_fixed"
        for response in (created, promoted, deactivated)
    )
    assert role_of(designated, OUTSIDER) == "admin"
    with designated.app_context():
        assert Admin.query.filter_by(username="wanted").first() is None


def test_the_listing_marks_the_four_from_the_real_table(designated):
    items = signed_in(designated, FOUR[0]).get("/api/admins").json["items"]

    protected = {int(item["id"]) for item in items if item["isProtected"]}
    assert protected == set(FOUR)


def test_ordinary_administrator_management_still_works(designated):
    """The acceptance criterion that nothing else moved: a superadmin creates,
    configures and deactivates a regular administrator against this schema."""

    client = signed_in(designated, FOUR[0])

    created = client.post("/api/admins", json={
        "username": "colleague", "email": "colleague@example.test",
        "password": "Another-secret1!",
    })
    new_id = int(created.json["admin"]["id"])
    configured = client.put(f"/api/admins/{new_id}/permissions", json={
        "permissions": {"add": True, "edit": True, "delete": False, "changeUserStatus": False},
    })
    deactivated = client.put(f"/api/admins/{new_id}/status", json={"status": "Inactive"})
    renamed = signed_in(designated, FOUR[0]).put(f"/api/admins/{FOUR[0]}", json={
        "username": "renamed", "email": "renamed@example.test",
    })

    assert created.status_code == 201
    assert (configured.status_code, deactivated.status_code, renamed.status_code) == (200, 200, 200)
    with designated.app_context():
        stored = db.session.get(Admin, new_id)
        assert (stored.status, stored.permissions["add"]) == ("inactive", True)
        assert db.session.get(Admin, FOUR[0]).username == "renamed"
