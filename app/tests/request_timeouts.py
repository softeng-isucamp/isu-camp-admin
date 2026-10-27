"""Outbound calls a request thread can block on have deadlines.

With several request threads in one Gunicorn gthread worker, a blocked thread
is no longer recycled by the worker timeout, so the database connection and
the SMTP connection must give up on their own.
"""

import smtplib

from flask import Flask
from flask_mail import Message

import extensions
from extensions import engine_options, mail


def test_postgres_connections_time_out_and_detect_dead_links():
    options = engine_options("postgresql+psycopg2://u:p@db.example.com:6543/postgres")["connect_args"]

    assert options["connect_timeout"] == 10
    assert options["keepalives"] == 1
    assert options["tcp_user_timeout"] > 0


def test_sqlite_gets_no_postgres_only_arguments():
    assert engine_options("sqlite://") == {}


def test_mail_opens_its_smtp_connection_with_a_timeout(monkeypatch):
    opened = {}

    class FakeSMTP:
        def __init__(self, host, port, timeout=None):
            opened.update(host=host, port=port, timeout=timeout)

        def set_debuglevel(self, level):
            pass

        def starttls(self):
            opened["tls"] = True

        def login(self, username, password):
            pass

        def sendmail(self, *args, **kwargs):
            opened["sent"] = True

        def quit(self):
            pass

    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    app = Flask(__name__)
    app.config.update(MAIL_SERVER="smtp.example.com", MAIL_PORT=587, MAIL_USE_TLS=True,
                      MAIL_USERNAME="user", MAIL_PASSWORD="secret", MAIL_DEFAULT_SENDER="from@example.com")
    mail.init_app(app)

    with app.app_context():
        mail.send(Message(subject="Code", recipients=["to@example.com"], body="123456"))

    assert opened["timeout"] == extensions.SMTP_TIMEOUT_SECONDS
    assert opened["tls"] and opened["sent"]
