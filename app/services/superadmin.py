"""The fixed set of superadministrators, as the application sees it.

Policy: there are four superadmin accounts, they are named in
``public.superadmin_designation``, and the portal cannot change which four.
Promotion and demotion are gone from the API, creating a superadmin is refused,
and a designated account's status cannot be set from the portal. Replacing one
is a restricted operator procedure run against the database - see the
"Fixed superadministrators" section of README.md.

The database enforces the set itself (see
migrations/20261107_fixed_superadmins.sql): these helpers are how a request is
refused with a readable message instead of a failed commit, not the
enforcement. A route that skipped them would be stopped at COMMIT by a trigger
rather than allowed through.
"""

from model.superadmin_designation import SuperadminDesignation

# There is deliberately no count constant here. Nothing in the application
# needs to know that the set is four: it asks whether an account is designated,
# and the cap belongs to the database, which cannot read a Python constant
# anyway. A four here would be a second place for the number to drift.

# The frontend recognises this code, not the message text, so it can stop
# offering promotion, demotion and a role selector when it meets a build of the
# server that no longer has them - which is what a client left over from before
# this deployment is. One code for both refusals: a client that understands
# either understands the policy.
SUPERADMIN_SET_FIXED_CODE = "superadmin_set_fixed"

ROLE_FIXED_MESSAGE = (
    "The superadmin accounts are fixed. Promoting and demoting administrators "
    "is handled outside the portal."
)

CREATE_SUPERADMIN_MESSAGE = (
    "New accounts are administrators. The superadmin accounts are fixed and "
    "cannot be created here."
)

DESIGNATED_ACCOUNT_MESSAGE = (
    "This is a designated superadmin account. Its role and its access are "
    "managed outside the portal."
)


def designated_admin_ids(*, lock=False):
    """The ids of the designated superadmin accounts.

    A set rather than rows, because every caller asks the same question of it -
    is this account one of the four - and nothing in the application reads the
    designation date.

    ``lock`` takes the rows for the current transaction, in id order, the way
    :func:`routes.admins._lock_administrators` takes the administrator rows.
    A write that decides from this must hold it: without the lock, a transfer
    committing between the read and the write would let the portal deactivate
    an account that had just become one of the four. Taken *after* the
    administrator rows and in the same order as the transfer procedure, so two
    writers queue rather than deadlock.
    """

    query = SuperadminDesignation.query.order_by(SuperadminDesignation.admin_id)
    if lock:
        query = query.populate_existing().with_for_update()
    return {row.admin_id for row in query.all()}

