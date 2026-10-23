"""The saved automatic backup schedule: one row, read on every timer pass.

The schedule was three environment variables until Backup & Recovery offered it
as a form. A form needs somewhere to write, and the running process has to read
the change back without a restart, which is what a row gives and an environment
variable does not.

One row by construction, not by habit: ``id`` defaults to 1 and the database
refuses any other value, so there is never a second row for the timer and the
API to disagree about. See migrations/20261023_add_backup_schedule.sql.
"""

from datetime import datetime, timezone

from extensions import db

# The id of the only row. Named so the queries read as what they mean rather
# than as a magic number.
ROW_ID = 1

# Sunday first, matching the API's ``day`` and the frontend's day picker. Used
# for the audit log's description of a change, where "Monday" says more than 1.
DAY_NAMES = (
    "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
)


class BackupSchedule(db.Model):

    __tablename__ = "backup_schedule"

    __table_args__ = {"schema": "public"}

    id = db.Column(db.SmallInteger, primary_key=True, default=ROW_ID)

    # Off means manual backups only. The other columns are still kept and still
    # returned, so switching it back on restores the schedule somebody set
    # rather than a default they would have to re-enter.
    enabled = db.Column(db.Boolean, nullable=False, default=False)

    frequency = db.Column(db.String(10), nullable=False, default="daily")

    # 0 is Sunday through 6 is Saturday; NULL for a daily schedule.
    day_of_week = db.Column(db.SmallInteger, nullable=True)

    # 24-hour HH:MM in ``time_zone``, not in UTC: a campus system's quiet hour
    # is a local hour, and the server converts when it works out the next run.
    at_time = db.Column(db.String(5), nullable=False, default="02:30")

    time_zone = db.Column(db.String(64), nullable=False, default="Asia/Manila")

    keep = db.Column(db.Integer, nullable=False, default=14)

    updated_at = db.Column(
        db.DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
        nullable=False,
    )

    def to_dict(self):
        """The schedule as the API carries it, in the frontend's spelling.

        ``day`` is null on a daily schedule rather than absent, because the
        frontend's schema reads the key either way and an absent one would mean
        "the server does not know about this field".
        """

        return {
            "enabled": bool(self.enabled),
            "frequency": self.frequency,
            "day": self.day_of_week if self.frequency == "weekly" else None,
            "time": self.at_time,
            "timeZone": self.time_zone,
            "keep": int(self.keep),
        }

    def describe(self):
        """One line naming this schedule, for the audit log's old -> new detail."""

        if not self.enabled:
            return f"off (manual only), keeping {self.keep}"
        when = (
            f"every {DAY_NAMES[self.day_of_week]}"
            if self.frequency == "weekly" and self.day_of_week is not None
            else "daily"
        )
        return f"{when} at {self.at_time} {self.time_zone}, keeping {self.keep}"
