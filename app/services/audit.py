"""Transaction-safe audit event recording for backend mutations."""

from flask import session

from extensions import db


def _actor_name(actor=None):
    if actor is not None:
        return getattr(actor, "username", str(actor))
    return session.get("admin_username") or "system"


def log_audit(category, actor, action, target, target_id=None, detail=None):
    """Stage an audit row in the current SQLAlchemy transaction.

    The centralized audit model is introduced by the logs contract. Keeping
    its import lazy lets mutation routes remain usable during deployments
    where that contract has not been migrated yet.
    """
    try:
        from model.audit_log import AuditLog
    except (ImportError, ModuleNotFoundError):
        return None

    # Lightweight route tests use an in-memory fake session. Do not let an
    # optional audit model pollute those fakes or change their behavior.
    if not hasattr(db.session, "get_bind"):
        return None

    entry = AuditLog(
        category=category,
        actor=_actor_name(actor),
        action=action,
        target=target,
        target_id=str(target_id) if target_id is not None else None,
        detail=detail or "",
    )
    db.session.add(entry)
    return entry
