"""Why a superadmin was demoted: the request contract and the audit record.

``PUT /api/admins/<id>/role`` takes, for a superadmin-to-administrator change
and for nothing else::

    {"role": "admin", "reasons": ["left_team", "other"], "otherReason": "Moved to Registrar"}

``reasons`` is a nonempty list of distinct codes from :data:`REASONS`.
``otherReason`` is required when ``other`` is one of them - 1 to
:data:`OTHER_REASON_MAX_LENGTH` characters once trimmed, counted as Unicode
code points - and refused when it is not. Nothing is truncated: a reason that
is too long is a field error, never a shorter reason.

The record is kept in the existing ``audit_log.detail`` text column, as one
JSON object (:func:`encode_detail`), so no migration is needed. ``detail`` is
unbounded text and already the column a demotion wrote the target's name to.
:func:`describe` turns it back into what the logs API returns: a readable
``detail`` sentence, which is what an older frontend shows and what the log
search matches, plus a structured ``demotion`` object for a client that knows
the codes. Every demotion written before this change stored just the name,
and still reads as just the name.
"""

import json

# The order the dialog lists them in (issue #167), and the order they are
# stored and returned in, whatever order a request sent them in.
REASONS = {
    "role_changed": "Role changed",
    "left_team": "No longer part of the team",
    "granted_by_mistake": "Access granted by mistake",
    "security_concern": "Security concern",
    "other": "Other reason",
}

OTHER = "other"
OTHER_REASON_MAX_LENGTH = 500
DETAIL_KIND = "demotion"

REASONS_REQUIRED_MESSAGE = "Choose at least one reason for the demotion."
REASONS_UNKNOWN_MESSAGE = "Choose reasons from the list."
REASONS_DUPLICATE_MESSAGE = "Choose each reason only once."
OTHER_REASON_REQUIRED_MESSAGE = "Explain the other reason."
OTHER_REASON_TYPE_MESSAGE = "The other reason must be text."
OTHER_REASON_TOO_LONG_MESSAGE = (
    f"Keep the other reason to {OTHER_REASON_MAX_LENGTH} characters or fewer."
)
OTHER_REASON_UNEXPECTED_MESSAGE = "Only explain a reason when Other reason is chosen."


def read(data):
    """The reasons a demotion body gives, or the field it got wrong.

    Returns ``((codes, other_reason), None)`` or ``(None, (field, message))``.
    ``codes`` is in :data:`REASONS` order; ``other_reason`` is the trimmed
    explanation, or ``None`` when ``other`` was not chosen.
    """

    body = data if isinstance(data, dict) else {}
    codes = body.get("reasons")

    if not isinstance(codes, list) or not codes:
        return None, ("reasons", REASONS_REQUIRED_MESSAGE)
    if any(not isinstance(code, str) or code not in REASONS for code in codes):
        return None, ("reasons", REASONS_UNKNOWN_MESSAGE)
    if len(set(codes)) != len(codes):
        return None, ("reasons", REASONS_DUPLICATE_MESSAGE)

    # Absent and null both mean "no explanation"; anything else is one.
    explanation = body.get("otherReason")
    if OTHER not in codes:
        if explanation is not None:
            return None, ("otherReason", OTHER_REASON_UNEXPECTED_MESSAGE)
        return (_ordered(codes), None), None

    if explanation is None:
        return None, ("otherReason", OTHER_REASON_REQUIRED_MESSAGE)
    if not isinstance(explanation, str):
        return None, ("otherReason", OTHER_REASON_TYPE_MESSAGE)
    explanation = explanation.strip()
    if not explanation:
        return None, ("otherReason", OTHER_REASON_REQUIRED_MESSAGE)
    if len(explanation) > OTHER_REASON_MAX_LENGTH:
        return None, ("otherReason", OTHER_REASON_TOO_LONG_MESSAGE)

    return (_ordered(codes), explanation), None


def _ordered(codes):
    chosen = set(codes)
    return [code for code in REASONS if code in chosen]


def encode_detail(target_name, codes, other_reason):
    """The ``audit_log.detail`` value for one demotion.

    The target's name is the one it had at the time, so the row still says who
    was demoted after the account is renamed or its row is gone.
    """

    return json.dumps({
        "kind": DETAIL_KIND,
        "targetName": target_name,
        "reasons": list(codes),
        "otherReason": other_reason,
    }, ensure_ascii=False, separators=(",", ":"))


def decode_detail(detail):
    """The structured record :func:`encode_detail` wrote, or ``None``."""

    if not isinstance(detail, str) or not detail.startswith("{"):
        return None
    try:
        record = json.loads(detail)
    except ValueError:
        return None
    if not isinstance(record, dict) or record.get("kind") != DETAIL_KIND:
        return None

    codes = record.get("reasons")
    other_reason = record.get("otherReason")
    if not isinstance(codes, list) or not all(code in REASONS for code in codes):
        return None
    return {
        "targetName": record.get("targetName") if isinstance(record.get("targetName"), str) else None,
        "reasons": codes,
        "otherReason": other_reason if isinstance(other_reason, str) else None,
    }


def describe(detail):
    """``(readable_detail, demotion_or_None)`` for one demote audit row."""

    record = decode_detail(detail)
    if record is None:
        return detail, None

    sentence = "Reasons: " + ", ".join(REASONS[code] for code in record["reasons"]) + "."
    if record["otherReason"]:
        sentence += f" Other reason: {record['otherReason']}"
    if record["targetName"]:
        sentence = f"{record['targetName']}. {sentence}"
    return sentence, record
