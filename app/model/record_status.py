"""Lifecycle status shared by the tables that have one.

public.building and public.location came first, followed by public.admin and
public."user", whose status says whether the account may sign in. Every one of
them keeps the value lowercase, matching the two status columns that were in
the schema before them (public.route_node.status and public.pathway.status).
The directories spell the same two values "Active"/"Inactive", so a read
projects and a write normalizes through here rather than each model inventing
its own translation.
"""

RECORD_STATUSES = ("active", "inactive")
STATUS_LABELS = {"active": "Active", "inactive": "Inactive"}


def normalized_status(value, default="active"):
    """The stored spelling for a requested status, or None if there isn't one.

    Accepts either spelling so the admin form's label and the column's own
    value both round-trip. A missing or blank request field means the caller
    did not touch the field, which keeps ``default``; anything else - the
    form's third option "Unknown", say, which no column can hold - returns
    None for the caller to reject.
    """
    if value is None or str(value).strip() == "":
        return default

    candidate = str(value).strip().lower()

    return candidate if candidate in RECORD_STATUSES else None


def status_label(value):
    """The directory's spelling of a stored status."""
    return STATUS_LABELS.get(value, "Active")
