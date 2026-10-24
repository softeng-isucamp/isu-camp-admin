"""What account recovery remembers about one subject between requests.

The forgot-password and forgot-username flows cap how often a code can be
asked for and how many wrong ones can be guessed. Those counts used to live in
process memory, which made them two different things from what they claimed to
be: a restart handed every attacker a fresh budget, and a second worker gave
them a second one at the same time.

One row per *subject*, which is an account when the address belongs to one -
so an account's primary and alternative addresses share a single budget - and
the address itself otherwise. ``auth.recovery_subject`` builds the value; see
there for why an address that has no account is stored as a keyed hash rather
than as itself.

Everything here is a limit, never a credential: the codes themselves stay in
memory, so a restart still invalidates outstanding codes and the admin asks
for another. What survives a restart is the part an attacker benefits from
losing.
"""

from datetime import datetime, timezone

from extensions import db


class RecoveryAttempt(db.Model):

    __tablename__ = "recovery_attempt"

    __table_args__ = {"schema": "public"}

    # 'admin:<id>' or 'email:<64 hex>'. Opaque to this model on purpose - it is
    # the one place the two kinds of subject are told apart, and they are told
    # apart in auth, not here.
    subject = db.Column(
        db.String(128),
        primary_key=True
    )

    # Wrong codes guessed inside the current failure window, counted across
    # resends, purposes and both of an account's addresses. Not per code: a
    # resend used to hand back a full budget, which made five guesses a minute
    # the real limit.
    failures = db.Column(
        db.Integer,
        nullable=False,
        default=0
    )

    # When the newest of those failures landed. The window is measured from
    # here, so a mistake made last month is not still being held against an
    # account that has since recovered successfully - without this, five
    # lifetime mistakes would lock an address out for good.
    last_failure_at = db.Column(
        db.DateTime(timezone=True),
        nullable=True
    )

    # Set when the failures run out, and the only thing that refuses a correct
    # code. NULL means nothing is holding this subject back.
    restricted_until = db.Column(
        db.DateTime(timezone=True),
        nullable=True
    )

    # The most recent code requests, newest last, as ISO-8601 UTC strings, kept
    # only as far back as the cap needs. A list rather than a count because the
    # cap is a sliding window: a count with a window start lets somebody send
    # the cap twice in a moment by straddling the boundary.
    #
    # A JSON column does not notice a list mutated in place, so every write
    # assigns a new list.
    requested_at = db.Column(
        db.JSON,
        nullable=False,
        default=list
    )

    # What the sweep reads. A row nobody has touched for longer than both
    # windows remembers nothing, so it is deleted rather than kept for ever -
    # which also means a flood of invented addresses cannot grow this table
    # beyond the addresses actually seen in the last few minutes.
    updated_at = db.Column(
        db.DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        index=True
    )

    def __repr__(self):
        return f"<RecoveryAttempt {self.subject} failures={self.failures}>"
