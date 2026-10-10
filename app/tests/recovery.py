"""Email-based account recovery: /api/recovery/request, /verify, /reset-password.

Driven through the Flask test client against the contract the admin frontend
was built to. Nothing here reaches a database or an SMTP server: the account
lookup, the mail transport and the database session are all fakes.
"""

from datetime import datetime, timedelta
import re

from flask import Flask
import pytest

import auth as auth_module
from auth import auth_bp
from services.security import hash_password, verify_password

NEW_PASSWORD = "Passw0rd!x"
GENERIC_MESSAGE = "If an account exists for this email, a code has been sent."


class FakeAdmin:
    def __init__(self, id, username, gmail, status="active", password="old-password"):
        self.id = id
        self.username = username
        self.gmail = gmail
        self.status = status
        self.password = password

    @property
    def is_active(self):
        return self.status == "active"


class Harness:
    """One app, one inbox and one set of accounts per test."""

    def __init__(self, monkeypatch, admins):
        self.admins = admins
        self.sent = []
        self.commits = 0
        self.mail_fails = False

        auth_module.rate_limit_buckets.clear()
        auth_module.reset_otps.clear()

        class FakeMessage:
            def __init__(self, **values):
                self.__dict__.update(values)

        def send(message):
            if self.mail_fails:
                raise RuntimeError("smtp is down")
            self.sent.append(message)

        harness = self

        class FakeSession:
            def commit(self):
                harness.commits += 1

            def rollback(self):
                pass

        monkeypatch.setattr(auth_module, "Message", FakeMessage)
        monkeypatch.setattr(auth_module, "mail", type("Mail", (), {"send": lambda _, m: send(m)})())
        monkeypatch.setattr(auth_module, "run_in_background", lambda work: work())
        monkeypatch.setattr(auth_module, "admins_with_email", lambda email: [
            a for a in self.admins if (a.gmail or "").lower() == email
        ])
        monkeypatch.setattr(auth_module, "log_audit", lambda *args, **kwargs: None)
        monkeypatch.setattr(auth_module.db, "session", FakeSession())

        app = Flask(__name__)
        app.config["SECRET_KEY"] = "test-secret"
        app.register_blueprint(auth_bp)
        self.client = app.test_client()

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


@pytest.fixture
def harness(monkeypatch):
    return Harness(monkeypatch, [FakeAdmin(1, "admin_justine", "admin@isu.edu.ph")])


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
        "message": GENERIC_MESSAGE,
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


def test_request_answers_an_unknown_email_exactly_like_a_known_one(harness):
    known = harness.request_code()
    unknown = harness.request_code(email="nobody@isu.edu.ph")

    assert unknown.status_code == known.status_code == 200
    assert unknown.json == known.json
    assert len(harness.sent) == 1


def test_request_sends_nothing_and_answers_the_same_for_a_deactivated_administrator(harness):
    harness.admins[0].status = "inactive"

    response = harness.request_code()

    assert response.status_code == 200
    assert response.json["message"] == GENERIC_MESSAGE
    assert response.json["expiresInSeconds"] == 600
    assert harness.sent == []


def test_request_sends_nothing_when_an_email_belongs_to_more_than_one_account(harness):
    """The database does not enforce one email per account, so an ambiguous
    address is refused quietly rather than picking someone's username."""

    harness.admins.append(FakeAdmin(2, "admin_other", "Admin@isu.edu.ph"))

    response = harness.request_code()

    assert response.status_code == 200
    assert response.json["message"] == GENERIC_MESSAGE
    assert harness.sent == []


def test_request_still_answers_200_when_the_mail_cannot_be_delivered(harness):
    harness.mail_fails = True

    response = harness.request_code()

    assert response.status_code == 200
    assert response.json["message"] == GENERIC_MESSAGE


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
    first = harness.request_code()
    again = harness.request_code()
    unknown_first = harness.request_code(email="nobody@isu.edu.ph")
    unknown_again = harness.request_code(email="nobody@isu.edu.ph")

    assert (first.status_code, unknown_first.status_code) == (200, 200)
    for limited in (again, unknown_again):
        assert limited.status_code == 429
        assert limited.is_json
        assert 0 < int(limited.headers["Retry-After"]) <= 60
    assert len(harness.sent) == 1


def test_request_limits_how_many_addresses_one_client_can_probe(harness):
    responses = [harness.request_code(email=f"person{n}@isu.edu.ph") for n in range(12)]

    assert [r.status_code for r in responses[:10]] == [200] * 10
    assert responses[10].status_code == 429
    assert int(responses[10].headers["Retry-After"]) > 0


def test_a_new_request_replaces_the_old_code_and_restores_the_attempts(harness):
    harness.request_code()
    old = harness.issued_code()
    harness.verify(harness.wrong_code(old))
    harness.verify(harness.wrong_code(old))
    harness.release_cooldown()

    harness.request_code()
    new = harness.issued_code()
    fresh_wrong = harness.verify(harness.wrong_code(new))

    assert fresh_wrong.json["attemptsRemaining"] == 4
    if old != new:
        assert harness.verify(old).json["code"] == "invalid_code"
    assert harness.verify(new).status_code == 200


def test_a_new_request_revives_an_exhausted_code_for_known_and_unknown_emails(harness):
    for email in ("admin@isu.edu.ph", "nobody@isu.edu.ph"):
        harness.request_code(email=email)
        for _ in range(5):
            harness.verify("999999", email=email)
        assert harness.verify("999999", email=email).json["code"] == "code_exhausted"
        harness.release_cooldown()

        harness.request_code(email=email)

        assert harness.verify("999999", email=email).json["attemptsRemaining"] == 4
        harness.release_cooldown()


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


def test_wrong_codes_count_down_then_the_code_is_dead_even_if_correct(harness):
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
        (400, "code_exhausted", 0),
    ]
    assert all(r.json["message"] for r in attempts)
    assert kinds(after) == [(400, "code_exhausted", 0)] * 2


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
            (400, "code_exhausted", 0),
        ]
        harness.release_cooldown()


def test_a_password_code_does_not_open_the_username_flow_and_vice_versa(harness):
    harness.request_code(purpose="password")
    password_code = harness.issued_code()
    harness.release_cooldown()
    harness.request_code(purpose="username")
    username_code = harness.issued_code()

    cross = harness.verify(password_code, purpose="username")
    spent = [harness.verify("999999", purpose="username") for _ in range(4)]

    assert password_code == username_code or cross.json["code"] == "invalid_code"
    assert spent[-1].json["code"] == "code_exhausted"
    # Exhausting the username code leaves the password code untouched.
    assert harness.verify(password_code, purpose="password").status_code == 200


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


def test_verify_is_rate_limited_with_retry_after_and_json(harness):
    responses = [harness.verify("999999") for _ in range(12)]

    assert [r.status_code for r in responses[:10]] == [400] * 10
    assert responses[10].status_code == 429
    assert responses[10].is_json
    assert int(responses[10].headers["Retry-After"]) > 0


def test_verify_429_does_not_count_against_the_code(harness, monkeypatch):
    harness.request_code()
    code = harness.issued_code()
    monkeypatch.setattr(auth_module, "RECOVERY_GUESS_LIMIT_PER_EMAIL", 2)

    first = harness.verify(harness.wrong_code(code))
    second = harness.verify(harness.wrong_code(code))
    limited = harness.verify(harness.wrong_code(code))

    assert (first.status_code, second.status_code, limited.status_code) == (400, 400, 429)
    assert auth_module.reset_otps[("password", "admin@isu.edu.ph")]["attempts"] == 2


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

    assert responses[-1].json["code"] == "code_exhausted"
    assert responses[-1].json["attemptsRemaining"] == 0
    assert harness.reset(code).json["code"] == "code_exhausted"
    assert harness.verify(code).json["code"] == "code_exhausted"
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


def test_the_old_reset_routes_still_use_their_own_store(harness):
    """Recovery codes live under (purpose, email) keys, apart from username keys."""

    auth_module.reset_otps["admin_justine"] = {
        "otp": "123456",
        "expires_at": datetime.utcnow() + timedelta(minutes=1),
    }

    legacy = harness.client.post("/api/reset/verify", json={"username": "admin_justine", "code": "123456"})

    assert legacy.status_code == 200
    assert harness.verify("123456").json["code"] == "invalid_code"
