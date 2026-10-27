"""Email-based account recovery: /api/recovery/request, /verify, /reset-password.

Driven through the Flask test client against the contract the admin frontend
was built to. The account lookup and the mail transport are fakes; the database
is real, because the attempt limits are now rows and a fake store would be a
test of the fake. SQLite in memory, except where a test needs the counters to
outlive the process, which is the point of their being rows at all.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
import re
import threading
from collections import deque

from flask import Flask
from sqlalchemy import event
import pytest

import admins as admins_module
import auth as auth_module
from admins import admins_bp
from auth import auth_bp
from extensions import db
from model.recovery_attempt import RecoveryAttempt
from services.security import hash_password, verify_password

# Commits are counted with a session event rather than by standing a fake in
# front of db.session: the routes need the real one, and Model.query is bound
# to it when the class is built, so swapping it out afterwards only half works.
COMMITS = {"count": 0}

# Commits alone no longer say what a test wants to know. Every request commits
# its attempt counters, so "one commit" stopped meaning "one password was
# written" - which is what the single-use tests are actually about. A password
# assignment arms a flag, and the commit that follows it is the one counted.
WRITES = {"password_pending": False, "password_commits": 0}


@event.listens_for(db.session, "after_commit")
def _count_commit(_session):
    COMMITS["count"] += 1
    if WRITES["password_pending"]:
        WRITES["password_pending"] = False
        WRITES["password_commits"] += 1

NEW_PASSWORD = "Passw0rd!x"
# Said only to an address found on an account; an address on none is refused.
SENT_MESSAGE = "A verification code has been sent to this email."
UNKNOWN_EMAIL_MESSAGE = (
    "That email is not registered to an administrator account. "
    "Check the address and try again."
)


class FakeAdmin:
    def __init__(self, id, username, gmail, status="active", password="old-password",
                 alternative_email=None):
        self.id = id
        self.username = username
        self.gmail = gmail
        # Recovery accepts either address, which is the whole point of
        # registering a second one.
        self.alternative_email = alternative_email
        self.status = status
        self.password = password

    @property
    def is_active(self):
        return self.status == "active"

    # A real row's password is only stored by the commit that follows it being
    # set; this records the setting so a test can tell the two apart.
    @property
    def password(self):
        return self._password

    @password.setter
    def password(self, value):
        self._password = value
        WRITES["password_pending"] = True


class Harness:
    """One app, one inbox, one database and one set of accounts per test.

    The database is a SQLite *file* attached as the "public" schema the models
    name, not an in-memory one. Two reasons, both of which a test needs: every
    connection sees the same tables, so the threaded tests below exercise real
    concurrent requests, and the file outlives the app, so a test can reopen it
    the way a restarted process would.
    """

    def __init__(self, monkeypatch, admins, store):
        self.admins = admins
        self.sent = []
        self.mail_fails = False

        auth_module.rate_limit_buckets.clear()
        auth_module.reset_otps.clear()
        auth_module.guessed_recovery_entries.clear()
        # The sweep runs at most once an interval, and the interval is longer
        # than a test run, so a test that wants it to run needs it unarmed.
        auth_module.recovery_swept_at = None
        COMMITS["count"] = 0
        WRITES.update(password_pending=False, password_commits=0)

        class FakeMessage:
            def __init__(self, **values):
                self.__dict__.update(values)

        def send(message):
            if self.mail_fails:
                raise RuntimeError("smtp is down")
            self.sent.append(message)

        monkeypatch.setattr(auth_module, "Message", FakeMessage)
        monkeypatch.setattr(auth_module, "mail", type("Mail", (), {"send": lambda _, m: send(m)})())
        monkeypatch.setattr(auth_module, "run_in_background", lambda work: work())
        # Stands in for the one query auth.admins_holding_email builds, keeping
        # the rule it stands for: either of an account's two addresses matches,
        # compared trimmed and case-insensitively.
        monkeypatch.setattr(auth_module, "admins_with_email", lambda email: [
            a for a in self.admins
            if email in {
                (held or "").strip().lower()
                for held in (a.gmail, a.alternative_email) if held
            }
        ])
        monkeypatch.setattr(auth_module, "log_audit", lambda *args, **kwargs: None)

        self.store = str(store)
        app = Flask(__name__)
        app.config["SECRET_KEY"] = "test-secret"
        app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite://"
        app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
        # Writers wait for each other instead of failing: two connections
        # writing one SQLite file is exactly what the threaded tests do.
        app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"connect_args": {"timeout": 15}}
        db.init_app(app)
        app.register_blueprint(auth_bp)
        # User Management's colleague send, which issues into this same store.
        app.register_blueprint(admins_bp)
        self.app = app

        self.context = app.app_context()
        self.context.push()

        # Every connection, not just the first: SQLite gives each thread its
        # own, and a connection that has not attached the file sees no tables
        # at all.
        store_path = self.store.replace("'", "''")

        @event.listens_for(db.engine, "connect")
        def attach_public(dbapi_connection, _record):
            dbapi_connection.execute(f"ATTACH DATABASE '{store_path}' AS public")

        self.attach_listener = attach_public
        db.session.execute(db.text("SELECT 1"))
        db.metadata.create_all(db.engine)
        db.session.commit()
        COMMITS["count"] = 0
        WRITES.update(password_pending=False, password_commits=0)

        self.client = app.test_client()

    def close(self):
        db.session.remove()
        event.remove(db.engine, "connect", self.attach_listener)
        db.engine.dispose()
        self.context.pop()

    @property
    def commits(self):
        return COMMITS["count"]

    @property
    def password_commits(self):
        """How many commits stored a password. One, for a single-use code."""
        return WRITES["password_commits"]

    def post_from(self, ip, path, **body):
        """A request from another client address, safe to send from a thread."""
        with self.app.test_client() as client:
            return client.post(f"/api/recovery/{path}", json=body, environ_overrides={"REMOTE_ADDR": ip})

    def post(self, path, **body):
        return self.client.post(f"/api/recovery/{path}", json=body)

    def request_code(self, email="admin@isu.edu.ph", purpose="password"):
        return self.post("request", email=email, purpose=purpose)

    def verify(self, code, email="admin@isu.edu.ph", purpose="password"):
        return self.post("verify", email=email, purpose=purpose, code=code)

    def reset(self, code, password=NEW_PASSWORD, email="admin@isu.edu.ph"):
        return self.post("reset-password", email=email, code=code, password=password)

    def issued_code(self):
        """The code in the latest email, as the recipient would read it."""
        return re.search(r"\b(\d{6})\b", self.sent[-1].body).group(1)

    def wrong_code(self, real):
        return "000000" if real != "000000" else "111111"

    def release_cooldown(self):
        """Lets the same address ask for another code without waiting a minute."""
        auth_module.rate_limit_buckets.clear()

    # ------------------------------------------
    # The persistent counters, as a test reads them
    # ------------------------------------------

    def subject(self, email="admin@isu.edu.ph"):
        return auth_module.recovery_identity(email)[0]

    def row(self, email="admin@isu.edu.ph"):
        """The stored counters for an address, or None when none are stored."""
        db.session.expire_all()
        return db.session.get(RecoveryAttempt, self.subject(email))

    def failures(self, email="admin@isu.edu.ph"):
        return self.failures_for(self.subject(email))

    def failures_for(self, subject):
        """Failures by subject, for a test that cannot resolve one right now.

        The gated tests below hold the account lookup open, and resolving an
        address goes through it - so a test that has installed a Gate reads its
        counters by the subject it captured beforehand.
        """
        db.session.expire_all()
        row = db.session.get(RecoveryAttempt, subject)
        return 0 if row is None else row.failures

    def restricted_for(self, email="admin@isu.edu.ph"):
        """Seconds of restriction left on an address, or 0."""
        row = self.row(email)
        if row is None or row.restricted_until is None:
            return 0
        until = auth_module.as_utc(row.restricted_until)
        return max(0, (until - datetime.now(timezone.utc)).total_seconds())

    def age_the_window(self, seconds, email="admin@isu.edu.ph"):
        """Moves everything stored for an address ``seconds`` into the past.

        How a test reaches the far side of a window without waiting a quarter
        of an hour. It writes the row the way the clock would have left it.
        """
        row = self.row(email)
        assert row is not None, "nothing is stored for that address yet"
        shift = timedelta(seconds=seconds)
        if row.restricted_until is not None:
            row.restricted_until = auth_module.as_utc(row.restricted_until) - shift
        if row.last_failure_at is not None:
            row.last_failure_at = auth_module.as_utc(row.last_failure_at) - shift
        row.requested_at = [
            (auth_module.as_utc(datetime.fromisoformat(value)) - shift).isoformat()
            for value in row.requested_at or []
        ]
        row.updated_at = auth_module.as_utc(row.updated_at) - shift
        db.session.commit()

    def set_request_ages(self, *seconds, email="admin@isu.edu.ph"):
        """Rewrites the stored request times to the given ages, oldest first.

        ``age_the_window`` shifts everything by the same amount, which cannot
        show that only part of the window has passed.
        """
        row = self.row(email)
        assert row is not None, "nothing is stored for that address yet"
        now = datetime.now(timezone.utc)
        row.requested_at = [
            (now - timedelta(seconds=age)).isoformat() for age in sorted(seconds, reverse=True)
        ]
        db.session.commit()

    def exhaust_attempts(self, email="admin@isu.edu.ph"):
        """Spends the whole attempt budget, leaving the address restricted."""
        responses = [self.verify("999999", email=email) for _ in range(auth_module.RECOVERY_ATTEMPT_LIMIT)]
        assert responses[-1].status_code == 429
        return responses


@pytest.fixture
def harness(monkeypatch, tmp_path):
    built = Harness(
        monkeypatch,
        [FakeAdmin(1, "admin_justine", "admin@isu.edu.ph")],
        store=tmp_path / "recovery.sqlite",
    )
    yield built
    built.close()


def kinds(responses):
    return [(r.status_code, r.json.get("code"), r.json.get("attemptsRemaining")) for r in responses]


# ==========================================
# Request a code
# ==========================================

def test_request_for_an_account_emails_a_six_digit_code_to_its_address(harness):
    response = harness.request_code()

    assert response.status_code == 200
    assert response.json == {
        "success": True,
        "message": SENT_MESSAGE,
        "expiresInSeconds": 600,
        "resendAfterSeconds": 60,
    }
    assert [m.recipients for m in harness.sent] == [["admin@isu.edu.ph"]]
    assert re.fullmatch(r"\d{6}", harness.issued_code())


def test_request_matches_the_email_case_insensitively_and_ignores_padding(harness):
    response = harness.request_code(email="  Admin@ISU.edu.PH ")

    assert response.status_code == 200
    assert len(harness.sent) == 1
    assert harness.sent[0].recipients == ["admin@isu.edu.ph"]
    # The code then verifies under any casing of the same address.
    assert harness.verify(harness.issued_code(), email="ADMIN@isu.edu.ph").status_code == 200


def test_request_refuses_an_email_on_no_account(harness):
    """The submitted address must be on an account before a code is sent.

    This is the answer that makes the portal able to confirm which addresses
    are administrator accounts; it is the accepted cost of telling an
    administrator that they mistyped their own.
    """

    known = harness.request_code()
    unknown = harness.request_code(email="nobody@isu.edu.ph")

    assert known.status_code == 200
    assert unknown.status_code == 400
    assert unknown.json["code"] == "email_not_found"
    assert unknown.json["message"] == UNKNOWN_EMAIL_MESSAGE
    # Only the account's own request was mailed.
    assert len(harness.sent) == 1


def test_request_refuses_a_deactivated_administrator(harness):
    """One message for every address recovery cannot act on.

    A deactivated account is not named as deactivated: that would confirm the
    account exists to whoever asked, which is more than the refusal needs to
    say in order to stop the request.
    """

    harness.admins[0].status = "inactive"

    response = harness.request_code()

    assert response.status_code == 400
    assert response.json["code"] == "email_not_found"
    assert response.json["message"] == UNKNOWN_EMAIL_MESSAGE
    assert harness.sent == []


def test_request_refuses_an_email_more_than_one_account_holds(harness):
    """The database does not enforce one email per account, so an ambiguous
    address is refused rather than picking someone's username."""

    harness.admins.append(FakeAdmin(2, "admin_other", "Admin@isu.edu.ph"))

    response = harness.request_code()

    assert response.status_code == 400
    assert response.json["code"] == "email_not_found"
    assert harness.sent == []


def test_request_still_answers_200_when_the_mail_cannot_be_delivered(harness):
    harness.mail_fails = True

    response = harness.request_code()

    assert response.status_code == 200
    assert response.json["message"] == SENT_MESSAGE


def test_username_code_email_does_not_name_the_account(harness):
    harness.request_code(purpose="username")

    assert "admin_justine" not in harness.sent[0].body
    assert harness.issued_code()


def test_request_rejects_malformed_input_with_json(harness):
    bodies = [
        {"email": "not-an-email", "purpose": "password"},
        {"email": "", "purpose": "password"},
        {"email": ["a@b.co"], "purpose": "password"},
        {"email": "admin@isu.edu.ph", "purpose": "other"},
        {"email": "admin@isu.edu.ph"},
    ]
    bad = []
    for body in bodies:
        harness.release_cooldown()
        bad.append(harness.post("request", **body))

    assert [r.status_code for r in bad] == [400] * 5
    assert all(isinstance(r.json["message"], str) and r.json["message"] for r in bad)
    assert harness.sent == []


def test_request_without_a_json_body_is_a_json_400(harness):
    response = harness.client.post("/api/recovery/request", data="plain text", content_type="text/plain")

    assert response.status_code == 400
    assert response.is_json


def test_request_enforces_the_resend_cooldown_for_known_and_unknown_emails(harness):
    """The cooldown is keyed on client and address, and is spent before the
    address is looked up - so asking twice about the same unregistered address
    is throttled like any other repeat, rather than answered twice."""

    first = harness.request_code()
    again = harness.request_code()
    unknown_first = harness.request_code(email="nobody@isu.edu.ph")
    unknown_again = harness.request_code(email="nobody@isu.edu.ph")

    assert first.status_code == 200
    assert unknown_first.status_code == 400
    assert unknown_first.json["code"] == "email_not_found"
    for limited in (again, unknown_again):
        assert limited.status_code == 429
        assert limited.is_json
        assert 0 < int(limited.headers["Retry-After"]) <= 60
    assert len(harness.sent) == 1


def test_request_limits_how_many_addresses_one_client_can_probe(harness):
    """The per-client cap is what remains of the brake on probing, now that the
    answer itself says whether an address has an account."""

    responses = [harness.request_code(email=f"person{n}@isu.edu.ph") for n in range(12)]

    assert [r.status_code for r in responses[:10]] == [400] * 10
    assert {r.json["code"] for r in responses[:10]} == {"email_not_found"}
    assert responses[10].status_code == 429
    assert int(responses[10].headers["Retry-After"]) > 0


def test_a_new_request_replaces_the_old_code_without_restoring_the_attempts(harness):
    """The whole point of counting against the account instead of the code.

    A code used to carry its own budget, so asking for another one handed back
    five more guesses - five a minute, for as long as anybody cared to keep
    asking.
    """

    harness.request_code()
    old = harness.issued_code()
    harness.verify(harness.wrong_code(old))
    harness.verify(harness.wrong_code(old))
    harness.release_cooldown()

    harness.request_code()
    new = harness.issued_code()
    fresh_wrong = harness.verify(harness.wrong_code(new))

    # Two guesses were already spent, so this is the third.
    assert fresh_wrong.json["attemptsRemaining"] == 2
    assert harness.failures() == 3
    if old != new:
        assert harness.verify(old).json["code"] == "invalid_code"
    # The new code still works while attempts remain, and using it clears them.
    assert harness.verify(new).status_code == 200
    assert harness.failures() == 0


def test_a_new_request_cannot_lift_a_restriction(harness):
    """Requesting is closed while a restriction stands, so the restriction
    cannot be waited out by mailing yourself codes until it lifts."""

    harness.request_code()
    harness.exhaust_attempts()
    harness.release_cooldown()

    asked_again = harness.request_code()

    assert asked_again.status_code == 429
    assert asked_again.json["code"] == "recovery_restricted"
    assert int(asked_again.headers["Retry-After"]) > 0
    assert harness.verify("999999").json["code"] == "recovery_restricted"


def test_an_unregistered_address_is_refused_before_any_restriction_is_consulted(harness):
    """Guessing at an address with no account still earns that address a
    restriction, and verifying keeps reporting it - but requesting is refused
    for not being on an account, which is true whatever the counters say and
    costs no account's budget to answer."""

    email = "nobody@isu.edu.ph"
    harness.exhaust_attempts(email=email)
    harness.release_cooldown()

    asked = harness.request_code(email=email)

    assert asked.status_code == 400
    assert asked.json["code"] == "email_not_found"
    assert harness.verify("999999", email=email).json["code"] == "recovery_restricted"


def test_unexpected_errors_are_json_and_do_not_leak_the_cause(harness, monkeypatch):
    def broken(email):
        raise RuntimeError("connection to db-host:5432 refused")

    harness.request_code()
    harness.release_cooldown()
    monkeypatch.setattr(auth_module, "admins_with_email", broken)

    for response in (
        harness.request_code(),
        harness.verify("123456"),
        harness.reset("123456"),
    ):
        assert response.status_code == 500
        assert response.is_json
        assert "db-host" not in response.get_data(as_text=True)


# ==========================================
# Verify a code
# ==========================================

def test_verify_returns_the_username_without_consuming_the_code(harness):
    harness.request_code()
    code = harness.issued_code()

    first = harness.verify(code)
    second = harness.verify(code)

    assert first.status_code == second.status_code == 200
    assert first.json["username"] == second.json["username"] == "admin_justine"


def test_verify_serves_the_username_flow_too(harness):
    harness.request_code(purpose="username")

    response = harness.verify(harness.issued_code(), purpose="username")

    assert response.status_code == 200
    assert response.json["username"] == "admin_justine"


def test_wrong_codes_count_down_then_the_fifth_restricts_recovery(harness):
    """The fifth wrong code is told recovery is restricted, not that this code
    is used up: being told to request another one is advice that would have led
    straight back to five more guesses."""

    harness.request_code()
    code = harness.issued_code()
    wrong = harness.wrong_code(code)

    attempts = [harness.verify(wrong) for _ in range(5)]
    after = [harness.verify(code), harness.verify(wrong)]

    assert kinds(attempts) == [
        (400, "invalid_code", 4),
        (400, "invalid_code", 3),
        (400, "invalid_code", 2),
        (400, "invalid_code", 1),
        (429, "recovery_restricted", None),
    ]
    assert all(r.json["message"] for r in attempts)
    assert int(attempts[-1].headers["Retry-After"]) == 900
    # The correct code is refused too, which is what makes it a restriction on
    # recovery rather than on one code.
    assert kinds(after) == [(429, "recovery_restricted", None)] * 2


def test_an_expired_code_is_rejected_even_with_the_right_digits(harness):
    harness.request_code()
    code = harness.issued_code()
    auth_module.reset_otps[("password", "admin@isu.edu.ph")]["expires_at"] = datetime.utcnow() - timedelta(seconds=1)

    response = harness.verify(code)

    assert response.status_code == 400
    assert response.json["code"] == "code_expired"
    assert "attemptsRemaining" not in response.json


def test_expiry_is_checked_before_exhaustion(harness):
    harness.request_code()
    entry = auth_module.reset_otps[("password", "admin@isu.edu.ph")]
    entry["attempts"] = 5
    entry["expires_at"] = datetime.utcnow() - timedelta(seconds=1)

    assert harness.verify("123456").json["code"] == "code_expired"


def test_expired_stays_expired_and_a_new_request_recovers(harness):
    harness.request_code()
    auth_module.reset_otps[("password", "admin@isu.edu.ph")]["expires_at"] = datetime.utcnow() - timedelta(seconds=1)
    assert harness.verify("123456").json["code"] == "code_expired"
    assert harness.verify("123456").json["code"] == "code_expired"
    harness.release_cooldown()

    harness.request_code()

    assert harness.verify(harness.issued_code()).status_code == 200


def test_an_unknown_email_gets_the_same_countdown_and_exhaustion(harness):
    harness.request_code()
    harness.request_code(email="nobody@isu.edu.ph")

    known = [harness.verify("999999") for _ in range(7)]
    unknown = [harness.verify("999999", email="nobody@isu.edu.ph") for _ in range(7)]

    assert kinds(unknown) == kinds(known)
    assert [r.json["message"] for r in unknown] == [r.json["message"] for r in known]


def test_a_code_that_was_never_requested_behaves_like_a_wrong_code(harness):
    for email in ("admin@isu.edu.ph", "nobody@isu.edu.ph"):
        responses = [harness.verify("123456", email=email) for _ in range(5)]

        assert kinds(responses) == [
            (400, "invalid_code", 4),
            (400, "invalid_code", 3),
            (400, "invalid_code", 2),
            (400, "invalid_code", 1),
            (429, "recovery_restricted", None),
        ]
        harness.release_cooldown()


def test_a_password_code_does_not_open_the_username_flow_and_vice_versa(harness):
    harness.request_code(purpose="password")
    password_code = harness.issued_code()
    harness.release_cooldown()
    harness.request_code(purpose="username")
    username_code = harness.issued_code()

    cross = harness.verify(password_code, purpose="username")
    spent = [harness.verify("999999", purpose="username") for _ in range(3)]

    assert password_code == username_code or cross.json["code"] == "invalid_code"
    # One budget for both pages: four guesses through the username flow leave
    # one, whichever flow spends it. Both verify the same inbox, so counting
    # them apart would just double the guesses on offer.
    assert spent[-1].json["attemptsRemaining"] == 1
    # The password code still opens the password flow while an attempt remains,
    # and spending it on the right code clears the count.
    assert harness.verify(password_code, purpose="password").status_code == 200
    assert harness.failures() == 0


def test_verify_keeps_leading_zeros_in_the_code(harness):
    harness.request_code()
    auth_module.reset_otps[("password", "admin@isu.edu.ph")]["otp"] = "004213"

    assert harness.verify("4213").json["code"] == "invalid_code"
    assert harness.verify("004213").status_code == 200


def test_a_code_does_not_work_once_its_account_is_deactivated(harness):
    harness.request_code()
    code = harness.issued_code()
    harness.admins[0].status = "inactive"

    response = harness.verify(code)

    assert response.status_code == 400
    assert response.json["code"] == "invalid_code"


def test_a_code_does_not_follow_an_email_to_another_account(harness):
    harness.request_code()
    code = harness.issued_code()
    harness.admins[0].gmail = "moved@isu.edu.ph"
    harness.admins.append(FakeAdmin(2, "admin_new", "admin@isu.edu.ph"))

    assert harness.verify(code).json["code"] == "invalid_code"


def test_a_non_ascii_code_is_just_a_wrong_code(harness):
    harness.request_code()

    response = harness.verify("é23456")

    assert response.status_code == 400
    assert response.json["code"] == "invalid_code"


def test_verify_rejects_malformed_requests_with_json(harness):
    bad = [
        harness.post("verify", email="admin@isu.edu.ph", purpose="password"),
        harness.post("verify", email="admin@isu.edu.ph", purpose="password", code=123456),
        harness.post("verify", email="nope", purpose="password", code="123456"),
        harness.post("verify", email="admin@isu.edu.ph", purpose="x", code="123456"),
    ]

    assert [r.status_code for r in bad] == [400] * 4
    assert all(r.is_json and r.json["message"] for r in bad)


def test_verify_tells_a_flood_limit_apart_from_a_restriction(harness):
    """Both are 429 and both carry Retry-After, but they mean different things:
    one is about how fast this client is going, the other about the account."""

    responses = [harness.verify("999999") for _ in range(12)]

    assert [r.status_code for r in responses] == [400] * 4 + [429] * 8
    assert all(r.is_json for r in responses)
    # The first four spend the budget, the fifth restricts, and the rest are
    # refused by the restriction until the per-address flood limit of ten
    # guesses a minute takes over.
    assert [r.json["code"] for r in responses[4:10]] == ["recovery_restricted"] * 6
    assert [r.json["code"] for r in responses[10:]] == ["rate_limited"] * 2
    assert int(responses[4].headers["Retry-After"]) == 900
    assert 0 < int(responses[10].headers["Retry-After"]) <= 60


def test_verify_429_does_not_count_against_the_attempts(harness, monkeypatch):
    """A refused request is not a guess: the flood limit stops it before the
    code is looked at, so it must not spend one of the five."""

    harness.request_code()
    code = harness.issued_code()
    monkeypatch.setattr(auth_module, "RECOVERY_GUESS_LIMIT_PER_EMAIL", 2)

    first = harness.verify(harness.wrong_code(code))
    second = harness.verify(harness.wrong_code(code))
    limited = harness.verify(harness.wrong_code(code))

    assert (first.status_code, second.status_code, limited.status_code) == (400, 400, 429)
    assert limited.json["code"] == "rate_limited"
    assert harness.failures() == 2


# ==========================================
# Reset the password
# ==========================================

def test_reset_sets_the_password_returns_the_username_and_kills_the_code(harness):
    harness.request_code()
    code = harness.issued_code()

    response = harness.reset(code)

    assert response.status_code == 200
    assert response.json["username"] == "admin_justine"
    assert verify_password(harness.admins[0].password, NEW_PASSWORD)[0]
    assert harness.admins[0].password != NEW_PASSWORD
    assert harness.commits >= 1
    # A used code cannot be used again, for either step.
    assert harness.reset(code, password="An0ther!pass").json["code"] == "invalid_code"
    assert verify_password(harness.admins[0].password, NEW_PASSWORD)[0]
    assert harness.verify(code).json["code"] == "invalid_code"


def test_the_code_from_verify_works_for_the_reset(harness):
    harness.request_code()
    code = harness.issued_code()

    assert harness.verify(code).status_code == 200
    assert harness.reset(code).status_code == 200


@pytest.mark.parametrize(
    "password,message",
    [
        ("Abcde1!", "Password must be at least 8 characters."),
        ("abcdefg1!", "Password must include an uppercase letter."),
        ("ABCDEFG1!", "Password must include a lowercase letter."),
        ("Abcdefgh!", "Password must include a number."),
        ("Abcdefg12", "Password must include a symbol."),
    ],
)
def test_reset_enforces_the_password_rules_without_spending_the_code(harness, password, message):
    harness.request_code()
    code = harness.issued_code()
    admin = harness.admins[0]

    weak = [harness.reset(code, password=password) for _ in range(6)]

    for response in weak:
        assert response.status_code == 400
        assert response.json["code"] == "weak_password"
        assert response.json["message"] == message
    assert admin.password == "old-password"
    # Six weak submissions did not use any of the five attempts.
    assert harness.reset(code).status_code == 200


def test_reset_checks_the_code_before_the_password(harness):
    harness.request_code()
    wrong = harness.wrong_code(harness.issued_code())

    response = harness.reset(wrong, password="weak")

    assert response.status_code == 400
    assert response.json["code"] == "invalid_code"
    assert response.json["attemptsRemaining"] == 4


def test_reset_and_verify_share_one_attempt_budget(harness):
    harness.request_code()
    code = harness.issued_code()
    wrong = harness.wrong_code(code)

    harness.verify(wrong)
    harness.verify(wrong)
    shared = harness.reset(wrong)

    assert shared.json["attemptsRemaining"] == 2


def test_reset_exhausting_the_code_kills_it_for_verify_too(harness):
    harness.request_code()
    code = harness.issued_code()
    wrong = harness.wrong_code(code)

    responses = [harness.reset(wrong) for _ in range(5)]

    assert responses[-1].status_code == 429
    assert responses[-1].json["code"] == "recovery_restricted"
    assert harness.reset(code).json["code"] == "recovery_restricted"
    assert harness.verify(code).json["code"] == "recovery_restricted"
    assert harness.admins[0].password == "old-password"


def test_reset_rejects_an_expired_code(harness):
    harness.request_code()
    code = harness.issued_code()
    auth_module.reset_otps[("password", "admin@isu.edu.ph")]["expires_at"] = datetime.utcnow() - timedelta(seconds=1)

    response = harness.reset(code)

    assert response.status_code == 400
    assert response.json["code"] == "code_expired"
    assert harness.admins[0].password == "old-password"


def test_reset_counts_attempts_the_same_for_an_unknown_email(harness):
    harness.request_code()
    harness.request_code(email="nobody@isu.edu.ph")

    known = [harness.reset("999999") for _ in range(6)]
    unknown = [harness.reset("999999", email="nobody@isu.edu.ph") for _ in range(6)]

    assert kinds(unknown) == kinds(known)


def test_reset_cannot_recover_a_deactivated_administrator(harness):
    harness.request_code()
    code = harness.issued_code()
    harness.admins[0].status = "inactive"

    response = harness.reset(code)

    assert response.status_code == 400
    assert response.json["code"] == "invalid_code"
    assert harness.admins[0].password == "old-password"


def test_reset_uses_only_the_password_code_not_the_username_code(harness):
    harness.request_code(purpose="username")
    username_code = harness.issued_code()

    assert harness.reset(username_code).json["code"] == "invalid_code"
    assert harness.verify(username_code, purpose="username").status_code == 200


def test_reset_is_rate_limited_with_retry_after_and_json(harness):
    harness.request_code()
    code = harness.issued_code()
    wrong = harness.wrong_code(code)

    responses = [harness.reset(wrong) for _ in range(12)]

    limited = next(r for r in responses if r.status_code == 429)
    assert limited.is_json
    assert int(limited.headers["Retry-After"]) > 0


def test_reset_rejects_malformed_requests_with_json(harness):
    bad = [
        harness.post("reset-password", email="admin@isu.edu.ph", code="123456"),
        harness.post("reset-password", email="admin@isu.edu.ph", password=NEW_PASSWORD),
        harness.post("reset-password", email="admin@isu.edu.ph", code=123456, password=NEW_PASSWORD),
        harness.post("reset-password", code="123456", password=NEW_PASSWORD),
    ]

    assert [r.status_code for r in bad] == [400] * 4
    assert all(r.is_json and r.json["message"] for r in bad)


def test_the_new_password_is_what_signs_in(harness, monkeypatch):
    """The reset writes the same kind of hash /api/login verifies."""

    harness.admins[0].password = hash_password("Old!pass123")
    harness.request_code()

    harness.reset(harness.issued_code())

    assert verify_password(harness.admins[0].password, NEW_PASSWORD)[0]
    assert not verify_password(harness.admins[0].password, "Old!pass123")[0]


def test_the_old_username_keyed_reset_routes_are_gone(harness):
    """Every code is now issued and redeemed by address.

    The routes these replaced keyed codes by username, answered an unknown one
    with 404 "Admin account not found" - naming which accounts exist - and
    never consulted ``alternative_email``. Nothing may answer there again.
    """

    for path, body in (
        ("/api/reset/request", {"username": "admin_justine"}),
        ("/api/reset/verify", {"username": "admin_justine", "code": "123456"}),
        ("/api/reset-password", {"username": "admin_justine", "code": "123456", "password": NEW_PASSWORD}),
    ):
        response = harness.client.post(path, json=body)
        assert response.status_code == 404, path
        # Flask's own 404, not a JSON refusal from a route that still exists.
        assert response.get_json() is None, path

    harness.request_code()
    assert all(isinstance(key, tuple) for key in auth_module.reset_otps)


# ==========================================
# A code a colleague sent from User Management
# ==========================================
#
# The real route and the real helper, into the same store, budget and inbox as
# the pages above. Only who is signed in, the account lookup by id and the
# audit trail are stood in for.

@pytest.fixture
def colleague(harness, monkeypatch):
    caller = FakeAdmin(2, "admin_helper", "helper@isu.edu.ph")
    audits = []

    class Directory:
        """``db.session`` as the admins route sees it: accounts by id, the rest real."""

        def get(self, model, ident, **kwargs):
            if model is auth_module.Admin:
                return next((a for a in harness.admins if a.id == ident), None)
            return db.session.get(model, ident, **kwargs)

        def __getattr__(self, name):
            return getattr(db.session, name)

    monkeypatch.setattr(admins_module, "db", SimpleNamespace(session=Directory()))
    monkeypatch.setattr(admins_module, "admin_required", lambda: (caller, None))
    monkeypatch.setattr(admins_module, "log_audit", lambda *args, **kwargs: audits.append(args))

    def send(admin_id=1):
        return harness.client.post(f"/api/admins/{admin_id}/password-reset")

    return SimpleNamespace(send=send, audits=audits)


def requests_counted(harness):
    row = harness.row()
    return 0 if row is None else len(auth_module.recovery_request_times(row))


def test_a_colleague_sent_code_is_redeemed_without_asking_for_another(harness, colleague):
    response = colleague.send()

    assert response.status_code == 200
    assert len(colleague.audits) == 1
    message = harness.sent[-1]
    assert message.recipients == ["admin@isu.edu.ph"]
    # The recipient did not ask for it, so the email says how to use it
    # without requesting one that would replace it.
    assert "I already have a code" in message.body
    code = harness.issued_code()

    assert harness.verify(code).status_code == 200
    reset = harness.reset(code)
    assert reset.status_code == 200
    assert verify_password(harness.admins[0].password, NEW_PASSWORD)[0]


def test_a_colleague_sent_code_still_works_once_the_request_budget_is_spent(harness, colleague):
    harness.request_code()
    harness.release_cooldown()
    harness.request_code()
    harness.release_cooldown()
    assert colleague.send().status_code == 200
    code = harness.issued_code()
    assert requests_counted(harness) == auth_module.RECOVERY_REQUEST_LIMIT

    # The forgot-password page can no longer ask, and neither can User
    # Management, but the code already in the inbox is untouched by either.
    harness.release_cooldown()
    refused = harness.request_code()
    assert refused.status_code == 429 and refused.json["code"] == "recovery_restricted"
    harness.release_cooldown()
    assert colleague.send().status_code == 429
    assert len(colleague.audits) == 1

    assert harness.reset(code).status_code == 200


def test_a_colleague_send_the_mail_server_refuses_is_reported_and_costs_nothing(harness, colleague):
    """502, no audit, the budget given back, and the colleague's code kept.

    The code is stored only after the mail server takes it, so a failed send
    cannot replace a code the colleague already holds with one that never
    reached them.
    """

    harness.request_code()
    held = harness.issued_code()
    harness.mail_fails = True

    failed = colleague.send()

    assert failed.status_code == 502
    assert failed.json["success"] is False
    assert colleague.audits == []
    assert requests_counted(harness) == 1
    assert len(harness.sent) == 1
    assert harness.verify(held).status_code == 200

    # Retried at once: the minute's limit was given back with the budget.
    harness.mail_fails = False
    retried = colleague.send()
    assert retried.status_code == 200
    assert len(colleague.audits) == 1
    assert requests_counted(harness) == 2
    assert harness.reset(harness.issued_code()).status_code == 200


def test_a_failed_colleague_send_refunds_its_own_request_not_a_later_one(harness, colleague, monkeypatch):
    started = datetime.now(timezone.utc)
    clock = [started]
    monkeypatch.setattr(auth_module, "utc_now", lambda: clock[0])

    def fail_after_another_request(message):
        # Another thread can request through the alternative address while
        # SMTP is waiting. Its later timestamp must keep its own full window.
        clock[0] = started + timedelta(seconds=30)
        assert auth_module.authorize_recovery_subject(harness.subject()) is None
        raise RuntimeError("smtp is down")

    monkeypatch.setattr(auth_module.mail, "send", fail_after_another_request)
    assert colleague.send().status_code == 502
    assert auth_module.recovery_request_times(harness.row()) == [clock[0]]


def test_a_failed_slow_send_does_not_refund_a_later_send_cooldown(harness, colleague, monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(auth_module.time, "monotonic", lambda: clock[0])

    def fail_after_cooldown_was_reused(message):
        clock[0] += auth_module.RATE_LIMIT_WINDOW_SECONDS + 1
        assert auth_module.rate_limited("admin-reset", "1", 1, "slow") is None
        raise RuntimeError("smtp is down")

    monkeypatch.setattr(auth_module.mail, "send", fail_after_cooldown_was_reused)
    assert colleague.send().status_code == 502
    assert list(auth_module.rate_limit_buckets[("admin-reset", "1")]) == [clock[0]]


def test_a_code_requested_from_the_page_stays_asynchronous_when_mail_fails(harness, colleague):
    """The unauthenticated page still answers before the mail server does."""

    harness.mail_fails = True

    assert harness.request_code().status_code == 200
    assert requests_counted(harness) == 1


# ==========================================
# Review round 1
# ==========================================

def many_accounts(harness, count, start=2):
    """Registers ``count`` more accounts and returns their addresses.

    The store tests below need a lot of *requested* entries, and a request only
    stores one for an address that is on an account - an address on none is
    refused before anything is stored.
    """

    emails = []
    for offset in range(count):
        identifier = start + offset
        email = f"person{identifier}@isu.edu.ph"
        harness.admins.append(FakeAdmin(identifier, f"admin_{identifier}", email))
        emails.append(email)
    return emails


def pending_entries():
    """Entries /request created. Every one is a code for a real account."""
    return {k: v for k, v in auth_module.reset_otps.items() if isinstance(k, tuple)}


def guessed_entries():
    """Entries made because a guess arrived for an address with none."""
    return dict(auth_module.guessed_recovery_entries)


def recovery_entries():
    return {**pending_entries(), **guessed_entries()}


def outcome(response):
    return (response.status_code, response.json)


MALFORMED_CODES = ["\ud800", "12345", "1234567", "abcdef", "１２３４５６", "123456\n", " 123456", "1234 6"]


@pytest.mark.parametrize("code", MALFORMED_CODES)
def test_a_code_that_cannot_be_a_code_is_a_counted_wrong_guess_for_every_email(harness, code):
    """An unpaired surrogate used to be a 500 only for real accounts."""

    harness.request_code()
    harness.request_code("absent@isu.edu.ph")

    for path_body in ("verify", "reset"):
        if path_body == "verify":
            known = harness.verify(code)
            unknown = harness.verify(code, email="absent@isu.edu.ph")
        else:
            harness.release_cooldown()
            known = harness.reset(code)
            unknown = harness.reset(code, email="absent@isu.edu.ph")
        assert outcome(known) == outcome(unknown)
        assert known.status_code == 400 and known.json["code"] == "invalid_code"

    # Two guesses each, counted against the real account as against the
    # address that has none.
    assert harness.failures() == 2
    assert harness.failures("absent@isu.edu.ph") == 2


def test_a_malformed_code_still_spends_the_attempts(harness):
    harness.request_code()
    real = harness.issued_code()

    for _ in range(5):
        response = harness.verify("\ud800")

    assert response.json["code"] == "recovery_restricted"
    assert harness.verify(real).json["code"] == "recovery_restricted"


def test_a_wrong_code_does_the_same_account_lookup_for_every_email(harness, monkeypatch):
    harness.request_code()
    harness.request_code("absent@isu.edu.ph")
    lookups = []
    original = auth_module.admins_with_email
    monkeypatch.setattr(auth_module, "admins_with_email", lambda email: lookups.append(email) or original(email))

    harness.verify("999999" if harness.issued_code() != "999999" else "888888")
    harness.verify("999999", email="absent@isu.edu.ph")
    harness.verify("999999", email="never@isu.edu.ph")

    assert lookups == ["admin@isu.edu.ph", "absent@isu.edu.ph", "never@isu.edu.ph"]


def test_the_email_is_bounded_before_any_state_is_created(harness):
    huge = "a" * 1_000_000 + "@isu.edu.ph"
    too_long = "a" * 250 + "@isu.edu.ph"
    assert len(too_long) > auth_module.EMAIL_MAX_LENGTH

    responses = [
        harness.post("request", email=huge, purpose="password"),
        harness.post("verify", email=huge, purpose="password", code="123456"),
        harness.post("reset-password", email=huge, code="123456", password=NEW_PASSWORD),
        harness.post("request", email=too_long, purpose="password"),
        harness.post("verify", email=too_long, purpose="password", code="123456"),
    ]

    assert [r.status_code for r in responses] == [400] * 5
    assert recovery_entries() == {}
    assert all(len(str(key)) < 64 for key in auth_module.rate_limit_buckets)


def test_an_email_at_the_column_width_is_still_read(harness):
    """An address as long as the column holds is measured, not truncated: it
    reaches the account lookup and is answered for not being on an account,
    rather than being rejected as malformed."""

    email = "a" * (auth_module.EMAIL_MAX_LENGTH - len("@isu.edu.ph")) + "@isu.edu.ph"
    assert len(email) == auth_module.EMAIL_MAX_LENGTH

    requested = harness.request_code(email=email)

    assert requested.status_code == 400
    assert requested.json["code"] == "email_not_found"
    assert harness.verify("000000", email=email).json["code"] == "invalid_code"


def test_an_account_at_the_column_width_recovers(harness):
    """The same length, on an account: nothing about the width blocks a code."""

    email = "a" * (auth_module.EMAIL_MAX_LENGTH - len("@isu.edu.ph")) + "@isu.edu.ph"
    harness.admins.append(FakeAdmin(2, "admin_long", email))

    assert harness.request_code(email=email).status_code == 200
    assert harness.verify(harness.issued_code(), email=email).status_code == 200


def test_request_entries_are_capped_and_keep_the_newest(harness, monkeypatch):
    monkeypatch.setattr(auth_module, "RECOVERY_MAX_ENTRIES", 5)
    emails = many_accounts(harness, 20)

    for email in emails:
        harness.release_cooldown()
        harness.request_code(email)

    assert len(pending_entries()) == 5
    assert ("password", emails[-1]) in pending_entries()
    assert ("password", emails[0]) not in pending_entries()


def test_an_evicted_real_code_behaves_like_one_never_requested(harness, monkeypatch):
    """Eviction leaves nothing behind, so the code it dropped is as dead as a
    code for an address that never asked for one."""

    monkeypatch.setattr(auth_module, "RECOVERY_MAX_ENTRIES", 3)
    harness.request_code()
    real = harness.issued_code()
    for email in many_accounts(harness, 3):
        harness.release_cooldown()
        harness.request_code(email)

    harness.release_cooldown()
    evicted = harness.verify(real)
    never_asked = harness.verify("000000", email="absent@isu.edu.ph")

    assert evicted.json == never_asked.json
    assert evicted.json["attemptsRemaining"] == 4


def test_the_rate_limiter_drops_idle_buckets(monkeypatch):
    auth_module.rate_limit_buckets.clear()
    clock = [1000.0]
    monkeypatch.setattr(auth_module.time, "monotonic", lambda: clock[0])
    app = Flask(__name__)

    with app.test_request_context():
        for n in range(300):
            clock[0] += 61
            assert auth_module.rate_limited("scope", f"key{n}", 1, "slow") is None

    assert len(auth_module.rate_limit_buckets) < 5


def test_the_rate_limiter_limits_exactly_as_before_and_keeps_live_buckets(monkeypatch):
    """Replays a mixed workload through the old algorithm and the new one."""

    import math
    import random
    from collections import defaultdict, deque

    auth_module.rate_limit_buckets.clear()
    clock = [5000.0]
    monkeypatch.setattr(auth_module.time, "monotonic", lambda: clock[0])
    window = auth_module.RATE_LIMIT_WINDOW_SECONDS
    reference = defaultdict(deque)

    def old(scope, key, limit):
        now = clock[0]
        bucket = reference[(scope, key)]
        cutoff = now - window
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()
        if len(bucket) >= limit:
            return 429, max(1, math.ceil(window - (now - bucket[0])))
        bucket.append(now)
        return None

    def new(scope, key, limit):
        limited = auth_module.rate_limited(scope, key, limit, "slow")
        if limited is None:
            return None
        response, status = limited
        return status, int(response.headers["Retry-After"])

    rng = random.Random(7)
    app = Flask(__name__)
    with app.test_request_context():
        for _ in range(4000):
            clock[0] += rng.choice([0, 0, 0.5, 1, 7, 20, 59.9, 60, 61, 130])
            call = (rng.choice(["a", "b"]), f"k{rng.randrange(6)}", rng.choice([1, 2, 5]))
            assert new(*call) == old(*call), call


def test_a_bucket_inside_its_window_survives_a_sweep(monkeypatch):
    auth_module.rate_limit_buckets.clear()
    clock = [100.0]
    monkeypatch.setattr(auth_module.time, "monotonic", lambda: clock[0])
    app = Flask(__name__)

    with app.test_request_context():
        assert auth_module.rate_limited("s", "live", 1, "slow") is None
        clock[0] += 30
        for n in range(5):
            auth_module.rate_limited("s", f"other{n}", 1, "slow")
        clock[0] += 31  # the sweep runs; "live" is 61 seconds old, the others 31
        assert auth_module.rate_limited("s", "other0", 1, "slow") is not None
        assert auth_module.rate_limited("s", "live", 1, "slow") is None


class Gate:
    """Holds named threads inside the account lookup until released."""

    def __init__(self, monkeypatch, admins, parties):
        self.barrier = threading.Barrier(parties)
        self.release = {}
        original = lambda email: [a for a in admins if (a.gmail or "").lower() == email]

        def lookup(email):
            self.barrier.wait(timeout=5)
            event = self.release.get(threading.current_thread().name)
            if event is not None:
                assert event.wait(5)
            return original(email)

        monkeypatch.setattr(auth_module, "admins_with_email", lookup)


def run_threads(**work):
    results = {}

    def wrap(name, fn):
        def run():
            results[name] = fn()
        return threading.Thread(target=run, name=name)

    threads = [wrap(name, fn) for name, fn in work.items()]
    for t in threads:
        t.start()
    for t in threads:
        t.join(10)
    return results


def test_a_right_guess_cannot_win_after_a_concurrent_last_wrong_guess(harness, monkeypatch):
    harness.request_code()
    real = harness.issued_code()
    wrong = harness.wrong_code(real)
    for _ in range(4):
        harness.release_cooldown()
        harness.verify(wrong)
    harness.release_cooldown()
    gate = Gate(monkeypatch, harness.admins, 2)
    wrong_done = threading.Event()
    gate.release["right"] = wrong_done

    def wrong_guess():
        response = harness.post_from("192.0.2.2", "verify", email="admin@isu.edu.ph", purpose="password", code=wrong)
        wrong_done.set()
        return response

    results = run_threads(
        right=lambda: harness.post_from("192.0.2.3", "verify", email="admin@isu.edu.ph", purpose="password", code=real),
        wrong=wrong_guess,
    )

    assert results["wrong"].json["code"] == "recovery_restricted"
    assert results["right"].status_code == 429
    assert results["right"].json["code"] == "recovery_restricted"


def test_concurrent_wrong_guesses_each_spend_exactly_one_attempt(harness, monkeypatch):
    harness.request_code()
    wrong = harness.wrong_code(harness.issued_code())
    harness.release_cooldown()
    subject = harness.subject()
    Gate(monkeypatch, harness.admins, 4)

    results = run_threads(**{
        f"guess{n}": (lambda n=n: harness.post_from(f"192.0.2.{n + 10}", "verify", email="admin@isu.edu.ph", purpose="password", code=wrong))
        for n in range(4)
    })

    assert sorted(r.json["attemptsRemaining"] for r in results.values()) == [1, 2, 3, 4]
    assert harness.failures_for(subject) == 4


def test_the_same_code_cannot_reset_two_passwords_at_once(harness, monkeypatch):
    harness.request_code()
    real = harness.issued_code()
    barrier = threading.Barrier(2)
    first_done = threading.Event()

    def slow_hash(password):
        # Both requests have validated the code before either goes on to write.
        barrier.wait(timeout=5)
        if password == "Second!pass2":
            assert first_done.wait(5)
        return "HASH:" + password

    monkeypatch.setattr(auth_module, "hash_password", slow_hash)

    def first():
        response = harness.post_from("192.0.2.2", "reset-password", email="admin@isu.edu.ph", code=real, password="First!pass1")
        first_done.set()
        return response

    results = run_threads(
        first=first,
        second=lambda: harness.post_from("192.0.2.3", "reset-password", email="admin@isu.edu.ph", code=real, password="Second!pass2"),
    )

    assert sorted(r.status_code for r in results.values()) == [200, 400]
    assert results["second"].json["code"] == "code_exhausted"
    assert harness.admins[0].password == "HASH:First!pass1"
    assert harness.password_commits == 1


def test_a_failed_write_still_consumes_the_code(harness, monkeypatch):
    """A claimed code is spent for good; the admin asks for a new one."""

    harness.request_code()
    real = harness.issued_code()
    original_commit = auth_module.db.session.commit

    # Only the write that stores the password fails. The commit before it
    # belongs to the attempt counters, and a request that cannot even count
    # its own attempt is refused before the code is claimed - which is a
    # different thing from the one being tested here.
    def broken_after_the_counters(allowed=[0]):
        allowed[0] += 1
        if allowed[0] == 1:
            return original_commit()
        raise RuntimeError("database is down")

    monkeypatch.setattr(auth_module.db.session, "commit", broken_after_the_counters)
    failed = harness.reset(real)
    monkeypatch.setattr(auth_module.db.session, "commit", original_commit)
    harness.release_cooldown()
    retry = harness.reset(real, password="Retry!pass12")

    assert failed.status_code == 500
    assert failed.json == {"success": False, "message": "Account recovery failed. Please try again."}
    assert "database is down" not in failed.get_data(as_text=True)
    assert retry.status_code == 400 and retry.json["code"] == "invalid_code"
    assert not verify_password(harness.admins[0].password, "Retry!pass12")[0]
    assert ("password", "admin@isu.edu.ph") not in pending_entries()

    harness.request_code()
    assert harness.reset(harness.issued_code(), password="Retry!pass12").status_code == 200


def test_a_reset_that_committed_reports_success_even_if_the_row_cannot_be_read_again(harness, monkeypatch):
    """Nothing after the commit may fail the response: the password has already changed."""

    harness.request_code()
    admin = harness.admins[0]
    username = admin.username
    original_commit = auth_module.db.session.commit

    def commit_then_lose_the_row(committed=[0]):
        original_commit()
        committed[0] += 1
        # Stands in for the expired row whose refresh fails after COMMIT. Only
        # after the password write, which is the second commit: the first one
        # belongs to the attempt counters.
        if committed[0] >= 2:
            del admin.username

    monkeypatch.setattr(auth_module.db.session, "commit", commit_then_lose_the_row)
    response = harness.reset(harness.issued_code(), password="Fresh!pass12")

    assert response.status_code == 200
    assert response.json["username"] == username
    assert verify_password(admin.password, "Fresh!pass12")[0]


def test_a_failed_old_reset_cannot_bring_its_code_back_after_a_newer_one_was_used(harness, monkeypatch):
    harness.request_code()
    old = harness.issued_code()
    entered = threading.Event()
    release = threading.Event()
    original_commit = auth_module.db.session.commit
    monkeypatch.setattr(auth_module, "generate_otp", lambda: "654321" if old != "654321" else "654322")

    def commit():
        if threading.current_thread().name == "old-reset":
            entered.set()
            assert release.wait(5)
            raise RuntimeError("database is down")
        original_commit()

    monkeypatch.setattr(auth_module.db.session, "commit", commit)

    def old_reset():
        return harness.post_from("192.0.2.2", "reset-password", email="admin@isu.edu.ph", code=old, password="First!pass1")

    def newer():
        assert entered.wait(5)
        harness.release_cooldown()
        assert harness.post_from("192.0.2.3", "request", email="admin@isu.edu.ph", purpose="password").status_code == 200
        new = harness.post_from("192.0.2.4", "reset-password", email="admin@isu.edu.ph", code="654321" if old != "654321" else "654322", password="Newer!pass2")
        release.set()
        return new

    results = run_threads(**{"old-reset": old_reset, "newer": newer})
    again = harness.post_from("192.0.2.5", "reset-password", email="admin@isu.edu.ph", code=old, password="Third!pass3")

    assert results["newer"].status_code == 200
    assert results["old-reset"].status_code == 500
    assert again.status_code == 400 and again.json["code"] == "invalid_code"
    assert verify_password(harness.admins[0].password, "Newer!pass2")[0]
    assert harness.password_commits == 1


def test_a_reset_that_loses_the_code_to_a_new_request_is_refused(harness, monkeypatch):
    harness.request_code()
    old = harness.issued_code()
    first_hashing = threading.Event()
    reissued = threading.Event()
    monkeypatch.setattr(auth_module, "generate_otp", lambda: "654321" if old != "654321" else "654322")

    def hashing(password):
        first_hashing.set()
        assert reissued.wait(5)
        return "HASH:" + password

    monkeypatch.setattr(auth_module, "hash_password", hashing)

    def reset():
        return harness.post_from("192.0.2.2", "reset-password", email="admin@isu.edu.ph", code=old, password=NEW_PASSWORD)

    def renew():
        assert first_hashing.wait(5)
        harness.release_cooldown()
        response = harness.post_from("192.0.2.3", "request", email="admin@isu.edu.ph", purpose="password")
        reissued.set()
        return response

    results = run_threads(reset=reset, renew=renew)

    assert results["renew"].status_code == 200
    assert results["reset"].status_code == 400
    assert harness.admins[0].password == "old-password"


def test_signing_in_with_the_new_password_works_and_the_old_one_is_refused(harness, monkeypatch):
    """Through POST /api/login, not just the verifier."""

    admin = harness.admins[0]
    admin.password = hash_password("Old!pass123")
    admin.to_profile = lambda: {"id": "1", "username": admin.username, "email": admin.gmail, "role": "admin"}
    monkeypatch.setattr(auth_module, "Admin", SimpleNamespace(query=SimpleNamespace(
        filter_by=lambda **kw: SimpleNamespace(first=lambda: admin if kw["username"] == admin.username else None)
    )))
    harness.request_code()

    assert harness.reset(harness.issued_code()).status_code == 200

    with harness.app.test_client() as client:
        old = client.post("/api/login", json={"username": "admin_justine", "password": "Old!pass123"})
        new = client.post("/api/login", json={"username": "admin_justine", "password": NEW_PASSWORD})
        with client.session_transaction() as session:
            signed_in = session.get("admin_id")

    assert old.status_code == 401
    assert new.status_code == 200 and new.json["admin"]["username"] == "admin_justine"
    assert signed_in == 1


# ==========================================
# Review round 2
# ==========================================

def test_guesses_for_unrequested_addresses_cannot_evict_a_pending_code(harness, monkeypatch):
    monkeypatch.setattr(auth_module, "RECOVERY_MAX_ENTRIES", 3)
    monkeypatch.setattr(auth_module, "RECOVERY_MAX_GUESSED_ENTRIES", 3)
    harness.request_code()
    real = harness.issued_code()

    for n in range(20):
        harness.release_cooldown()
        assert harness.verify("000000", email=f"nobody{n}@isu.edu.ph").status_code == 400

    harness.release_cooldown()
    verified = harness.verify(real)
    assert verified.status_code == 200 and verified.json["username"] == "admin_justine"


def test_guessed_entries_have_their_own_cap_and_evict_only_each_other(harness, monkeypatch):
    monkeypatch.setattr(auth_module, "RECOVERY_MAX_ENTRIES", 3)
    monkeypatch.setattr(auth_module, "RECOVERY_MAX_GUESSED_ENTRIES", 5)
    harness.request_code()

    for n in range(20):
        harness.release_cooldown()
        harness.verify("000000", email=f"nobody{n}@isu.edu.ph")

    assert len(guessed_entries()) == 5
    assert ("password", "nobody19@isu.edu.ph") in guessed_entries()
    assert ("password", "nobody0@isu.edu.ph") not in guessed_entries()
    # Guesses never add to the requested pool, which only the account's own
    # request put anything in.
    assert set(pending_entries()) == {("password", "admin@isu.edu.ph")}


def test_a_flood_of_requests_does_not_evict_guessed_entries(harness, monkeypatch):
    monkeypatch.setattr(auth_module, "RECOVERY_MAX_ENTRIES", 3)
    monkeypatch.setattr(auth_module, "RECOVERY_MAX_GUESSED_ENTRIES", 3)
    harness.verify("000000", email="guessed@isu.edu.ph")
    harness.verify("000000", email="guessed@isu.edu.ph")

    for email in many_accounts(harness, 10):
        harness.release_cooldown()
        harness.request_code(email)

    # The entry survives the flood; what it no longer holds is a budget.
    assert ("password", "guessed@isu.edu.ph") in guessed_entries()
    assert harness.failures("guessed@isu.edu.ph") == 2
    assert len(pending_entries()) == 3


def test_a_guessed_address_counts_down_exactly_like_a_requested_one(harness):
    harness.request_code("requested@isu.edu.ph")
    for remaining in (4, 3, 2, 1):
        harness.release_cooldown()
        requested = harness.verify("000000", email="requested@isu.edu.ph")
        guessed = harness.verify("000000", email="guessed@isu.edu.ph")
        assert outcome(requested) == outcome(guessed)
        assert guessed.json["attemptsRemaining"] == remaining
    harness.release_cooldown()
    assert outcome(harness.verify("000000", email="requested@isu.edu.ph")) == outcome(harness.verify("000000", email="guessed@isu.edu.ph"))
    assert harness.verify("000000", email="guessed@isu.edu.ph").json["code"] == "recovery_restricted"


def test_a_request_replaces_an_address_guessed_before_it(harness):
    for _ in range(3):
        harness.verify("000000")
    assert ("password", "admin@isu.edu.ph") in guessed_entries()

    harness.request_code()
    real = harness.issued_code()

    assert ("password", "admin@isu.edu.ph") not in guessed_entries()
    # The entry is replaced; the three guesses already made are not.
    assert harness.verify(harness.wrong_code(real)).json["attemptsRemaining"] == 1
    assert harness.verify(real).status_code == 200


def test_a_flood_of_requests_that_evicts_a_real_code_leaves_a_fresh_guessed_entry(harness, monkeypatch):
    monkeypatch.setattr(auth_module, "RECOVERY_MAX_ENTRIES", 2)
    harness.request_code()
    real = harness.issued_code()
    for email in many_accounts(harness, 2):
        harness.release_cooldown()
        harness.request_code(email)

    harness.release_cooldown()
    refused = harness.verify(real)

    assert refused.json["code"] == "invalid_code" and refused.json["attemptsRemaining"] == 4
    assert ("password", "admin@isu.edu.ph") in guessed_entries()


def test_the_rate_limiter_reads_the_clock_inside_its_lock(monkeypatch):
    auth_module.rate_limit_buckets.clear()
    held = []

    def clock():
        held.append(auth_module.rate_limit_lock.locked())
        return 100.0

    monkeypatch.setattr(auth_module.time, "monotonic", clock)
    with Flask(__name__).test_request_context():
        auth_module.rate_limited("s", "k", 5, "slow")

    assert held and all(held)


def test_a_bucket_with_hits_out_of_order_keeps_its_live_hits(monkeypatch):
    """Four hits still inside the window must count, whatever order they were stored in."""

    auth_module.rate_limit_buckets.clear()
    monkeypatch.setattr(auth_module, "rate_limit_swept_at", None)
    monkeypatch.setattr(auth_module.time, "monotonic", lambda: 160.0)
    auth_module.rate_limit_buckets[("login", "client")] = deque([101.0, 101.0, 101.0, 101.0, 100.0])

    with Flask(__name__).test_request_context():
        first = auth_module.rate_limited("login", "client", 5, "slow")
        second = auth_module.rate_limited("login", "client", 5, "slow")

    assert first is None
    assert second is not None and second[1] == 429
    assert second[0].headers["Retry-After"] == "1"
    assert sorted(auth_module.rate_limit_buckets[("login", "client")]) == [101.0] * 4 + [160.0]


def test_a_stale_hit_stored_behind_a_live_one_does_not_count(monkeypatch):
    auth_module.rate_limit_buckets.clear()
    monkeypatch.setattr(auth_module, "rate_limit_swept_at", 150.0)
    monkeypatch.setattr(auth_module.time, "monotonic", lambda: 160.0)
    auth_module.rate_limit_buckets[("s", "k")] = deque([130.0, 99.0])

    with Flask(__name__).test_request_context():
        assert auth_module.rate_limited("s", "k", 2, "slow") is None
        limited = auth_module.rate_limited("s", "k", 2, "slow")

    assert limited is not None
    assert limited[0].headers["Retry-After"] == str(30)


def test_an_address_that_only_fits_before_lowercasing_is_still_accepted(harness):
    email = "İ" + "a" * (auth_module.EMAIL_MAX_LENGTH - len("@isu.edu.ph") - 1) + "@isu.edu.ph"
    assert len(email) == auth_module.EMAIL_MAX_LENGTH and len(email.lower()) == auth_module.EMAIL_MAX_LENGTH + 1
    harness.admins.append(FakeAdmin(2, "long_address", email))

    requested = harness.request_code(email=email)

    assert requested.status_code == 200
    assert len(harness.sent) == 1
    assert harness.verify(harness.issued_code(), email=email).json["username"] == "long_address"


def test_an_address_one_character_over_the_column_is_still_refused(harness):
    email = "a" * (auth_module.EMAIL_MAX_LENGTH + 1 - len("@isu.edu.ph")) + "@isu.edu.ph"

    assert harness.request_code(email=email).status_code == 400
    assert recovery_entries() == {}


# ==========================================
# Recovering through the alternative address
# ==========================================

ALTERNATIVE = "justine.home@gmail.com"


@pytest.fixture
def two_addresses(monkeypatch, tmp_path):
    """One account reachable at either of its two registered addresses."""

    built = Harness(
        monkeypatch,
        [FakeAdmin(1, "admin_justine", "admin@isu.edu.ph", alternative_email=ALTERNATIVE)],
        store=tmp_path / "recovery.sqlite",
    )
    yield built
    built.close()


@pytest.mark.parametrize("purpose", ("password", "username"))
def test_either_address_recovers_the_same_account(two_addresses, purpose):
    response = two_addresses.request_code(email=ALTERNATIVE, purpose=purpose)

    assert response.status_code == 200
    assert len(two_addresses.sent) == 1
    verified = two_addresses.verify(
        two_addresses.issued_code(), email=ALTERNATIVE, purpose=purpose,
    )
    assert verified.status_code == 200
    assert verified.json["username"] == "admin_justine"


def test_the_code_goes_only_to_the_address_that_was_typed(two_addresses):
    """Mailing the primary instead would tell whoever typed the alternative
    that the two belong together, and would put a code in an inbox nobody
    asked about."""

    two_addresses.request_code(email=ALTERNATIVE)

    assert [m.recipients for m in two_addresses.sent] == [[ALTERNATIVE]]


def test_the_alternative_address_matches_case_insensitively(two_addresses):
    response = two_addresses.request_code(email="  JUSTINE.Home@Gmail.com ")

    assert response.status_code == 200
    assert two_addresses.sent[0].recipients == [ALTERNATIVE.lower()]


def test_a_code_for_one_address_does_not_verify_through_the_other(two_addresses):
    """Codes are keyed on the typed address, so the two are separate requests."""

    two_addresses.request_code(email=ALTERNATIVE)
    code = two_addresses.issued_code()

    through_primary = two_addresses.verify(code, email="admin@isu.edu.ph")

    assert through_primary.status_code == 400
    assert through_primary.json["code"] == "invalid_code"
    # The code still works where it was issued.
    assert two_addresses.verify(code, email=ALTERNATIVE).status_code == 200


def test_a_password_reset_through_the_alternative_address_changes_the_password(two_addresses):
    two_addresses.admins[0].password = hash_password("old-password")
    two_addresses.request_code(email=ALTERNATIVE)

    response = two_addresses.reset(two_addresses.issued_code(), email=ALTERNATIVE)

    assert response.status_code == 200
    assert verify_password(two_addresses.admins[0].password, NEW_PASSWORD)[0]


def test_an_address_two_accounts_hold_between_them_recovers_neither(two_addresses):
    """One account's primary and another's alternative are still one pool: an
    ambiguous address is refused quietly rather than picking a username."""

    two_addresses.admins.append(FakeAdmin(2, "admin_other", ALTERNATIVE))

    response = two_addresses.request_code(email=ALTERNATIVE)

    assert response.status_code == 400
    assert response.json["code"] == "email_not_found"
    assert two_addresses.sent == []


def test_an_address_matching_neither_column_never_recovers_an_account(two_addresses):
    """The rule the whole flow rests on, in one place.

    An address that is neither any account's ``gmail`` nor any account's
    ``alternative_email`` is answered like one that is - same status, same
    message - but no code is ever mailed for it and none can be redeemed with
    it. So typing a stranger's address, or one nobody holds, reaches no
    account's password while telling the sender nothing either way.
    """

    stranger = "someone.else@example.com"

    requested = two_addresses.request_code(email=stranger)

    assert requested.status_code == 400
    assert requested.json["code"] == "email_not_found"
    assert requested.json["message"] == UNKNOWN_EMAIL_MESSAGE
    # Nothing was mailed, so there is no code for this address to read anywhere.
    assert two_addresses.sent == []

    stored = two_addresses.admins[0].password
    attempts = [
        two_addresses.reset(code, email=stranger)
        for code in ("000000", "123456", "111111", "999999", "654321")
    ]

    assert [a.status_code for a in attempts] == [400, 400, 400, 400, 429]
    # Not one of them reset anything, including "000000" - the value a codeless
    # entry is compared against so an unknown address answers in the same time.
    assert two_addresses.admins[0].password == stored
    assert two_addresses.password_commits == 0
    # And the account itself is still recoverable by its own address.
    two_addresses.release_cooldown()
    two_addresses.request_code(email=ALTERNATIVE)
    assert two_addresses.reset(two_addresses.issued_code(), email=ALTERNATIVE).status_code == 200


# ==========================================
# Cumulative, persistent attempt limits
# ==========================================
# ==========================================
# Three codes per fifteen minutes
# ==========================================

def ask_three_times(harness, email="admin@isu.edu.ph"):
    """Fills the request cap, waiting out the resend cooldown each time."""

    responses = []
    for _ in range(auth_module.RECOVERY_REQUEST_LIMIT):
        harness.release_cooldown()
        responses.append(harness.request_code(email=email))
    return responses


def test_three_codes_are_allowed_and_the_fourth_is_refused(harness):
    allowed = ask_three_times(harness)
    harness.release_cooldown()

    fourth = harness.request_code()

    assert [r.status_code for r in allowed] == [200] * 3
    assert fourth.status_code == 429
    assert fourth.json["code"] == "recovery_restricted"
    assert int(fourth.headers["Retry-After"]) > 0
    # Three codes went out and the fourth request mailed nothing, which is the
    # whole point of the cap.
    assert len(harness.sent) == 3


def test_an_unregistered_address_spends_no_accounts_request_budget(harness):
    """Probing costs the accounts nothing. The cap belongs to a subject, and an
    address on no account is refused before a subject is counted against - so
    the account's own three requests are still there afterwards."""

    for n in range(5):
        harness.release_cooldown()
        refused = harness.request_code(email=f"nobody{n}@isu.edu.ph")
        assert refused.json["code"] == "email_not_found"

    harness.release_cooldown()
    mine = ask_three_times(harness)

    assert [r.status_code for r in mine] == [200, 200, 200]
    harness.release_cooldown()
    assert harness.request_code().json["code"] == "recovery_restricted"


def test_the_request_cap_is_a_sliding_window_not_a_fixed_one(harness):
    """Only the requests that have aged out are forgiven. A fixed window would
    restart on its boundary and hand back the whole cap at once, which is how
    the cap gets spent twice in a moment."""

    ask_three_times(harness)
    harness.release_cooldown()
    assert harness.request_code().status_code == 429

    # The oldest of the three is now outside the window; the other two are not.
    harness.set_request_ages(auth_module.RECOVERY_WINDOW_SECONDS + 1, 300, 200)

    harness.release_cooldown()
    assert harness.request_code().status_code == 200
    harness.release_cooldown()
    assert harness.request_code().status_code == 429


def test_the_request_window_clears_once_every_request_ages_out(harness):
    ask_three_times(harness)
    harness.release_cooldown()
    assert harness.request_code().status_code == 429

    harness.age_the_window(auth_module.RECOVERY_WINDOW_SECONDS + 1)

    assert [r.status_code for r in ask_three_times(harness)] == [200] * 3
    harness.release_cooldown()
    assert harness.request_code().status_code == 429


def test_the_request_cap_counts_an_accounts_two_addresses_together(two_addresses):
    """One account, one cap. Otherwise registering a second address would be a
    way to double how much mail the form can be made to send."""

    two_addresses.release_cooldown()
    assert two_addresses.request_code(email="admin@isu.edu.ph").status_code == 200
    two_addresses.release_cooldown()
    assert two_addresses.request_code(email=ALTERNATIVE).status_code == 200
    two_addresses.release_cooldown()
    assert two_addresses.request_code(email="admin@isu.edu.ph").status_code == 200

    two_addresses.release_cooldown()
    fourth = two_addresses.request_code(email=ALTERNATIVE)

    assert fourth.status_code == 429
    assert fourth.json["code"] == "recovery_restricted"
    assert len(two_addresses.sent) == 3


def test_the_sixty_second_cooldown_still_applies_under_the_cap(harness):
    """The two limits are different things: one is how fast, one is how many."""

    assert harness.request_code().status_code == 200

    too_soon = harness.request_code()

    assert too_soon.status_code == 429
    # A cooldown is a flood limit, not a restriction on the account.
    assert too_soon.json["code"] == "rate_limited"
    assert int(too_soon.headers["Retry-After"]) <= 60


def test_a_refused_request_never_answers_200(harness):
    """Every 200 means a code was issued, so the frontend may always start its
    countdown on one."""

    responses = ask_three_times(harness)
    for _ in range(3):
        harness.release_cooldown()
        responses.append(harness.request_code())

    assert [r.status_code for r in responses] == [200, 200, 200, 429, 429, 429]
    assert len(harness.sent) == 3


def test_every_allowed_request_issues_a_new_code_and_kills_the_old_one(harness):
    harness.request_code()
    first = harness.issued_code()
    harness.release_cooldown()

    harness.request_code()
    second = harness.issued_code()

    assert len(harness.sent) == 2
    if first != second:
        assert harness.verify(first).json["code"] == "invalid_code"
    assert harness.verify(second).status_code == 200


# ==========================================
# Five wrong codes, counted cumulatively
# ==========================================

def test_resends_do_not_hand_back_guesses(harness):
    """Four guesses, a new code, and the fifth guess is still the fifth."""

    harness.request_code()
    for _ in range(4):
        harness.verify("999999")
    harness.release_cooldown()
    harness.request_code()

    fifth = harness.verify("999999")

    assert fifth.status_code == 429
    assert fifth.json["code"] == "recovery_restricted"


def test_the_attempts_are_counted_across_an_accounts_two_addresses(two_addresses):
    """Guessing at each address in turn must not buy two budgets."""

    two_addresses.request_code()
    spent = [two_addresses.verify("999999", email="admin@isu.edu.ph") for _ in range(2)]
    spent += [two_addresses.verify("999999", email=ALTERNATIVE) for _ in range(2)]

    fifth = two_addresses.verify("999999", email=ALTERNATIVE)

    assert [r.json["attemptsRemaining"] for r in spent] == [4, 3, 2, 1]
    assert fifth.status_code == 429
    assert fifth.json["code"] == "recovery_restricted"
    # And the restriction covers the other address as well, since it is the
    # same account being restricted.
    assert two_addresses.verify("999999", email="admin@isu.edu.ph").json["code"] == "recovery_restricted"


def test_the_attempts_are_counted_across_both_purposes(harness):
    harness.request_code(purpose="password")
    harness.release_cooldown()
    harness.request_code(purpose="username")

    spent = [harness.verify("999999", purpose="password") for _ in range(2)]
    spent += [harness.verify("999999", purpose="username") for _ in range(2)]
    fifth = harness.verify("999999", purpose="username")

    assert [r.json["attemptsRemaining"] for r in spent] == [4, 3, 2, 1]
    assert fifth.json["code"] == "recovery_restricted"


def test_attempts_remaining_counts_down_cumulatively_not_per_code(harness):
    harness.request_code()
    remaining = []
    for _ in range(4):
        remaining.append(harness.verify("999999").json["attemptsRemaining"])
        harness.release_cooldown()
        harness.request_code()

    assert remaining == [4, 3, 2, 1]


def test_two_unrelated_addresses_keep_their_own_budgets(harness):
    """Cumulative does not mean shared: one address running out must not
    restrict another, or guessing at an invented address would be a way to lock
    somebody else out."""

    harness.exhaust_attempts(email="nobody@isu.edu.ph")
    harness.release_cooldown()

    assert harness.verify("999999").json["attemptsRemaining"] == 4


def test_the_failure_count_decays_after_the_window(harness):
    """Five mistakes *in fifteen minutes*, not five in a lifetime: without this
    an address that mistyped four codes last month would be one slip away from
    being locked out for ever."""

    harness.request_code()
    for _ in range(4):
        harness.verify("999999")
    assert harness.failures() == 4

    harness.age_the_window(auth_module.RECOVERY_WINDOW_SECONDS + 1)

    assert harness.verify("999999").json["attemptsRemaining"] == 4
    assert harness.failures() == 1


# ==========================================
# The fifteen-minute restriction
# ==========================================

def test_every_route_is_refused_while_a_subject_is_restricted(harness):
    harness.request_code()
    code = harness.issued_code()
    harness.exhaust_attempts()
    harness.release_cooldown()

    responses = [
        harness.request_code(),
        harness.verify(code),
        harness.verify(code, purpose="username"),
        harness.reset(code),
    ]

    assert [r.status_code for r in responses] == [429] * 4
    assert [r.json["code"] for r in responses] == ["recovery_restricted"] * 4
    assert all(int(r.headers["Retry-After"]) > 0 for r in responses)
    # Nothing was sent and nothing was changed.
    assert len(harness.sent) == 1
    assert harness.admins[0].password == "old-password"


def test_the_correct_code_is_refused_while_restricted(harness):
    """A restriction the right code could walk through would only ever hold up
    the people who had lost their code."""

    harness.request_code()
    code = harness.issued_code()
    harness.exhaust_attempts()

    refused = harness.verify(code)

    assert refused.status_code == 429
    assert refused.json["code"] == "recovery_restricted"


def test_a_restriction_reached_while_a_reset_is_hashing_refuses_that_reset(harness, monkeypatch):
    """The code was right when checked, but five wrong guesses landed while the
    new password was being hashed. Redeeming re-reads the restriction."""

    harness.request_code()
    code = harness.issued_code()
    real_hash = auth_module.hash_password
    guessed = {}

    def hash_while_guesses_land(password):
        if not guessed:
            guessed["done"] = True
            harness.exhaust_attempts()
        return real_hash(password)

    monkeypatch.setattr(auth_module, "hash_password", hash_while_guesses_land)

    refused = harness.reset(code)

    assert guessed
    assert refused.status_code == 429
    assert refused.json["code"] == "recovery_restricted"
    assert harness.password_commits == 0


def test_recovery_works_again_once_the_restriction_lifts(harness):
    harness.request_code()
    harness.exhaust_attempts()
    harness.age_the_window(auth_module.RECOVERY_RESTRICTION_SECONDS + 1)
    harness.release_cooldown()

    asked = harness.request_code()
    verified = harness.verify(harness.issued_code())

    assert asked.status_code == 200
    assert verified.status_code == 200
    assert verified.json["username"] == "admin_justine"


def test_a_lifted_restriction_hands_back_the_whole_budget(harness):
    """Otherwise the next single mistake would restrict the account again, and
    the next, which is a permanent lockout wearing a fifteen-minute label."""

    harness.request_code()
    harness.exhaust_attempts()
    harness.age_the_window(auth_module.RECOVERY_RESTRICTION_SECONDS + 1)
    harness.release_cooldown()
    harness.request_code()

    assert harness.verify("999999").json["attemptsRemaining"] == 4


def test_the_retry_after_on_a_restriction_is_a_whole_number_of_seconds(harness):
    harness.request_code()
    restricted = harness.exhaust_attempts()[-1]

    header = restricted.headers["Retry-After"]

    assert header.isdigit()
    assert int(header) == auth_module.RECOVERY_RESTRICTION_SECONDS


def test_a_restriction_counts_down_rather_than_restarting(harness):
    harness.request_code()
    harness.exhaust_attempts()

    harness.age_the_window(600)
    harness.release_cooldown()
    refused = harness.request_code()

    assert refused.status_code == 429
    assert 0 < int(refused.headers["Retry-After"]) <= 300


def test_an_unknown_address_is_restricted_exactly_like_a_real_one(harness):
    known = [harness.verify("999999") for _ in range(6)]
    harness.release_cooldown()
    unknown = [harness.verify("999999", email="nobody@isu.edu.ph") for _ in range(6)]

    assert kinds(unknown) == kinds(known)
    assert [r.json["message"] for r in unknown] == [r.json["message"] for r in known]
    assert [r.headers.get("Retry-After") for r in unknown] == [r.headers.get("Retry-After") for r in known]


# ==========================================
# What a success clears
# ==========================================

def test_a_successful_verification_clears_the_failures(harness):
    """Documented answer to "does a successful username recovery clear the
    counters": the failures, yes. A correct code proves whoever is asking is
    reading the inbox, which is the only thing the attempt limit was there to
    establish."""

    harness.request_code(purpose="username")
    for _ in range(3):
        harness.verify("999999", purpose="username")
    assert harness.failures() == 3

    verified = harness.verify(harness.issued_code(), purpose="username")

    assert verified.status_code == 200
    assert harness.failures() == 0
    # And the budget really is back, not just the stored number.
    assert harness.verify("999999", purpose="username").json["attemptsRemaining"] == 4


def test_a_successful_verification_does_not_clear_the_request_window(harness):
    """The request cap is about how much mail the form may send, which a
    success does not excuse."""

    ask_three_times(harness)
    verified = harness.verify(harness.issued_code())
    harness.release_cooldown()

    asked_again = harness.request_code()

    assert verified.status_code == 200
    assert asked_again.status_code == 429
    assert asked_again.json["code"] == "recovery_restricted"


def test_a_successful_password_reset_clears_the_failures(harness):
    harness.request_code()
    code = harness.issued_code()
    for _ in range(2):
        harness.verify("999999")

    reset = harness.reset(code)

    assert reset.status_code == 200
    assert harness.failures() == 0


# ==========================================
# Surviving a restart
# ==========================================

def test_the_counters_survive_a_restart(monkeypatch, tmp_path):
    """The reason they are rows. An in-memory counter is a limit an attacker
    waits out: a restart used to hand back every budget at once."""

    store = tmp_path / "recovery.sqlite"
    accounts = [FakeAdmin(1, "admin_justine", "admin@isu.edu.ph")]

    before = Harness(monkeypatch, accounts, store=store)
    try:
        before.request_code()
        for _ in range(3):
            before.verify("999999")
        assert before.failures() == 3
    finally:
        before.close()

    # A new process: the same database, and nothing at all in memory.
    auth_module.reset_otps.clear()
    auth_module.guessed_recovery_entries.clear()
    after = Harness(monkeypatch, accounts, store=store)
    try:
        assert after.failures() == 3

        # Two more guesses, not five: the three from before the restart count.
        fourth = after.verify("999999")
        fifth = after.verify("999999")

        assert fourth.json["attemptsRemaining"] == 1
        assert fifth.status_code == 429
        assert fifth.json["code"] == "recovery_restricted"
    finally:
        after.close()


def test_a_restriction_survives_a_restart(monkeypatch, tmp_path):
    store = tmp_path / "recovery.sqlite"
    accounts = [FakeAdmin(1, "admin_justine", "admin@isu.edu.ph")]

    before = Harness(monkeypatch, accounts, store=store)
    try:
        before.request_code()
        before.exhaust_attempts()
    finally:
        before.close()

    auth_module.reset_otps.clear()
    auth_module.guessed_recovery_entries.clear()
    after = Harness(monkeypatch, accounts, store=store)
    try:
        asked = after.request_code()

        assert asked.status_code == 429
        assert asked.json["code"] == "recovery_restricted"
        assert after.sent == []
    finally:
        after.close()


def test_the_request_window_survives_a_restart(monkeypatch, tmp_path):
    store = tmp_path / "recovery.sqlite"
    accounts = [FakeAdmin(1, "admin_justine", "admin@isu.edu.ph")]

    before = Harness(monkeypatch, accounts, store=store)
    try:
        ask_three_times(before)
    finally:
        before.close()

    after = Harness(monkeypatch, accounts, store=store)
    try:
        refused = after.request_code()

        assert refused.status_code == 429
        assert refused.json["code"] == "recovery_restricted"
        assert after.sent == []
    finally:
        after.close()


# ==========================================
# What is stored, and what is not
# ==========================================

def test_an_address_with_no_account_is_not_stored_as_itself(harness):
    """This table would otherwise become a list of every address anybody has
    typed into Forgot Password - addresses that by definition belong to people
    with no account here."""

    harness.verify("999999", email="nobody@isu.edu.ph")

    rows = RecoveryAttempt.query.all()

    assert [row.subject for row in rows] == [harness.subject("nobody@isu.edu.ph")]
    assert rows[0].subject.startswith("email:")
    assert "nobody" not in rows[0].subject
    assert "isu.edu.ph" not in rows[0].subject


def test_an_account_is_stored_by_its_id(two_addresses):
    """Which is what makes one account's two addresses one subject."""

    two_addresses.verify("999999", email=ALTERNATIVE)

    rows = RecoveryAttempt.query.all()

    assert [row.subject for row in rows] == ["admin:1"]
    assert two_addresses.subject("admin@isu.edu.ph") == "admin:1"


def test_no_code_is_ever_written_to_the_counters(harness):
    """The codes stay in memory. Losing them to a restart costs an attacker
    nothing, which is exactly why they are the part that may be lost."""

    harness.request_code()
    code = harness.issued_code()
    harness.verify("999999")

    stored = [
        str(value)
        for row in RecoveryAttempt.query.all()
        for value in (row.subject, row.failures, row.restricted_until, row.requested_at)
    ]

    assert code not in " ".join(stored)


def test_rows_that_remember_nothing_are_swept(harness):
    harness.verify("999999", email="nobody@isu.edu.ph")
    assert RecoveryAttempt.query.count() == 1

    harness.age_the_window(
        auth_module.RECOVERY_WINDOW_SECONDS + auth_module.RECOVERY_RESTRICTION_SECONDS + 60,
        email="nobody@isu.edu.ph",
    )
    # The sweep runs at most once an interval, so it has to be unarmed first.
    auth_module.recovery_swept_at = None
    harness.verify("999999")

    assert [row.subject for row in RecoveryAttempt.query.all()] == [harness.subject()]


def test_a_restricted_row_is_not_swept_early(harness):
    harness.request_code()
    harness.exhaust_attempts()
    subject = harness.subject()

    harness.age_the_window(auth_module.RECOVERY_WINDOW_SECONDS + auth_module.RECOVERY_RESTRICTION_SECONDS + 60)
    # Still restricted despite being old: the row says so, and the sweep must
    # read the restriction rather than only the age.
    row = harness.row()
    row.restricted_until = datetime.now(timezone.utc) + timedelta(seconds=300)
    db.session.commit()
    auth_module.recovery_swept_at = None

    harness.release_cooldown()
    refused = harness.request_code()

    assert refused.status_code == 429
    assert db.session.get(RecoveryAttempt, subject) is not None
