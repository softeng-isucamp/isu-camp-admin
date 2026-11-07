"""Which administrator accounts are the fixed superadministrators.

The portal has four superadmins and no way to appoint a fifth. Until now the
role was an ordinary column anybody holding it could grant to anybody else, so
"the four superadmins" was a convention rather than a fact: one promotion, by
accident or by a stolen session, and it was five.

This table is the fact. One row per designated account, and the database
enforces both halves of the rule against it - a designated account holds the
superadmin role, and an account without a row here cannot acquire it - so the
set survives a direct ``update public.admin set role = 'superadmin'`` as well
as a request to the API. See migrations/20261107_fixed_superadmins.sql for the
triggers, the four-row cap, and the restricted procedure that replaces a
designation.

Deliberately no ORM foreign key to ``public.admin``. The migration declares
one (``on delete restrict``, which is half of why a designated row cannot be
dropped), but the ``Admin`` model lives in ``services.auth`` rather than in
this package, and a foreign key named here would make ``create_all`` fail for
every test file that builds the metadata without importing auth - see the note
in app/tests/conftest.py. Nothing in the application resolves the relationship
anyway: the rows are read as a set of ids.
"""

from datetime import datetime, timezone

from extensions import db


class SuperadminDesignation(db.Model):

    __tablename__ = "superadmin_designation"

    __table_args__ = {"schema": "public"}

    # public.admin.id. The primary key, so one account cannot be designated
    # twice and the operator inputs to the migration cannot contain a duplicate
    # that would look like four accounts and designate three.
    admin_id = db.Column(
        db.SmallInteger,
        primary_key=True
    )

    # When the designation was recorded, for the audit trail of transfers. Not
    # who recorded it: a transfer is an operator action taken with database
    # access, and the name that belongs in the history is written to
    # public.audit_log, where every other account change is already readable.
    designated_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc)
    )

    def __repr__(self):
        return f"<SuperadminDesignation admin_id={self.admin_id}>"
