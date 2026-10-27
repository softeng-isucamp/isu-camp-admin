import smtplib

from flask import current_app
from flask_sqlalchemy import SQLAlchemy
from flask_mail import Connection, Mail

# Deadlines for what a request thread can block on. The API serves requests on
# several threads in one Gunicorn gthread worker, and its timeout does not
# recycle a worker whose threads are stuck, so each call must give up itself.
# Statements are already bounded by the database role's statement_timeout
# (2 minutes on Supabase, lock waits included); the Supabase transaction pooler
# ignores per-connection timeout options, so those are not set here.
SMTP_TIMEOUT_SECONDS = 30


def engine_options(database_url):
    """SQLAlchemy engine options: connect and dead-link deadlines for Postgres."""

    if not str(database_url or "").startswith("postgresql"):
        return {}
    return {"connect_args": {
        "connect_timeout": 10,
        # A pooler or network that silently drops the connection is noticed
        # instead of waited on forever.
        "keepalives": 1,
        "keepalives_idle": 30,
        "keepalives_interval": 10,
        "keepalives_count": 3,
        "tcp_user_timeout": 30000,
    }}


class BoundedConnection(Connection):
    """Flask-Mail's connection, opened with a socket timeout.

    Flask-Mail 0.10 opens smtplib connections without one, so a stalled mail
    server held the request thread indefinitely. Otherwise as the library does.
    """

    def configure_host(self):
        factory = smtplib.SMTP_SSL if self.mail.use_ssl else smtplib.SMTP
        host = factory(self.mail.server, self.mail.port, timeout=SMTP_TIMEOUT_SECONDS)
        host.set_debuglevel(int(self.mail.debug))
        if self.mail.use_tls:
            host.starttls()
        if self.mail.username and self.mail.password:
            host.login(self.mail.username, self.mail.password)
        return host


class BoundedMail(Mail):
    def connect(self):
        app = getattr(self, "app", None) or current_app
        try:
            return BoundedConnection(app.extensions["mail"])
        except KeyError as err:
            raise RuntimeError("The current application was not configured with Flask-Mail") from err


db = SQLAlchemy()
mail = BoundedMail()
