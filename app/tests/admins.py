import threading
import time

from flask import Flask
import pytest

import admins as admins_module
import auth as auth_module
from admins import admins_bp
from services.security import verify_password


class FakeQuery:
    """Stands in for Admin.query over an in-memory list of records."""

    def __init__(self, store):
        self.store = store
        self._filters = []

    def filter(self, predicate):
        clone = FakeQuery(self.store)
        clone._filters = [*self._filters, predicate]
        return clone

    def order_by(self, *_columns):
        return self

    def populate_existing(self):
        return self

    def with_for_update(self):
        clone = FakeQuery(self.store)
        clone._filters = list(self._filters)
        clone._locking = True
        return clone

    _locking = False

    def _matching(self):
        if self._locking:
            # A locking read waits for whoever holds the rows, then reads what
            # they left behind, as PostgreSQL does under READ COMMITTED.
            FakeAdmin.lock_rows()
        return [record for record in self.store if all(check(record) for check in self._filters)]

    def all(self):
        return list(self._matching())

    def first(self):
        matches = self._matching()
        return matches[0] if matches else None

    def count(self):
        return len(self._matching())


class FakeColumn:
    """Enough of a SQLAlchemy column for the routes' expressions to resolve.

    `Admin.username.asc()` orders the listing, and `Admin.status == "active"`
    becomes the predicate FakeQuery.filter calls per record.
    """

    def __init__(self, name):
        self.name = name

    def asc(self):
        return self

    def desc(self):
        return self

    def __eq__(self, other):
        return lambda record: getattr(record, self.name) == other

    __hash__ = None


class FakeAdmin:
    store = []
    # Shadowed by the instance attribute on every record.
    id = FakeColumn("id")
    username = FakeColumn("username")
    status = FakeColumn("status")
    role = FakeColumn("role")

    # The real properties read plain attributes, so the fake shares them and a
    # change to what counts as active or superadmin is exercised here too.
    is_active = auth_module.Admin.is_active
    is_superadmin = auth_module.Admin.is_superadmin

    def __init__(self, username=None, password=None, gmail=None, id=None, status="active", role="admin"):
        self.id = id
        self.username = username
        self.password = password
        self.gmail = gmail
        self.status = status
        self.role = role

    # Stands in for the row locks of SELECT ... FOR UPDATE: one holder at a
    # time, released when its transaction ends (commit, rollback or the end of
    # the request, where the real session is removed).
    _row_lock = threading.Lock()
    _lock_owner = None

    @classmethod
    def reset(cls, records):
        cls.store = list(records)
        cls.release_rows()

    @classmethod
    def lock_rows(cls):
        if cls._lock_owner != threading.get_ident():
            cls._row_lock.acquire()
            cls._lock_owner = threading.get_ident()

    @classmethod
    def release_rows(cls):
        if cls._lock_owner == threading.get_ident():
            cls._lock_owner = None
            cls._row_lock.release()

    class _QueryDescriptor:
        def __get__(self, _instance, owner):
            return FakeQuery(owner.store)

    query = _QueryDescriptor()


class FakeSession:
    def __init__(self):
        self.added = []
        self.deleted = []
        self.committed = False
        self.rolled_back = False
        self.next_id = 10

    def get(self, _model, key):
        return next((record for record in FakeAdmin.store if record.id == key), None)

    def add(self, record):
        self.added.append(record)

    def flush(self):
        for record in self.added:
            if record.id is None:
                record.id = self.next_id
                self.next_id += 1
            if record not in FakeAdmin.store:
                FakeAdmin.store.append(record)

    def delete(self, record):
        self.deleted.append(record)
        if record in FakeAdmin.store:
            FakeAdmin.store.remove(record)

    def commit(self):
        self.flush()
        self.committed = True
        FakeAdmin.release_rows()

    def rollback(self):
        self.rolled_back = True
        FakeAdmin.release_rows()


def admins_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = "test-secret"
    app.register_blueprint(admins_bp)
    # The real session is removed when the request ends, which ends its transaction.
    app.teardown_appcontext(lambda _error: FakeAdmin.release_rows())
    return app


def signed_in(app, admin_id=1, confirmed=True):
    client = app.test_client()
    with client.session_transaction() as flask_session:
        flask_session["admin_id"] = admin_id
        flask_session["admin_username"] = "admin01"
        if confirmed:
            flask_session["reauth_at"] = time.time()
    return client


@pytest.fixture
def guards_passed(monkeypatch):
    """Skips every guard, for rules a real caller can never reach.

    A signed-in superadmin is always an active account, so "the last active
    administrator" and "the last account" can only be tested with a caller who
    is not in the directory.
    """
    for guard in ("admin_required", "superadmin_required", "reauth_required"):
        monkeypatch.setattr(admins_module, guard, lambda *args, **kwargs: (object(), None))


@pytest.fixture(autouse=True)
def admin_directory(monkeypatch):
    """A superadmin (1) and an administrator (2), over the real guards.

    Sessions made by ``signed_in`` carry a fresh password confirmation unless
    asked not to. The guards read ``FakeAdmin`` through ``auth.Admin``.
    """
    FakeAdmin.reset([
        FakeAdmin(id=1, username="admin01", password="password123", gmail="admin01@example.com", role="superadmin"),
        FakeAdmin(id=2, username="admin02", password="password456", gmail="admin02@example.com"),
    ])
    session = FakeSession()
    monkeypatch.setattr(admins_module, "Admin", FakeAdmin)
    monkeypatch.setattr(auth_module, "Admin", FakeAdmin)
    monkeypatch.setattr(admins_module.db, "session", session)
    monkeypatch.setattr(admins_module.db.func, "lower", lambda column: column, raising=False)
    monkeypatch.setattr(admins_module, "log_audit", lambda *args, **kwargs: None)
    # Reset codes are delivered by email; the test records the recipients.
    session.reset_codes_sent = []
    monkeypatch.setattr(
        admins_module,
        "send_password_reset_otp",
        lambda admin: session.reset_codes_sent.append(admin.username),
    )
    monkeypatch.setattr(admins_module, "rate_limited", lambda *args, **kwargs: None)
    # The route builds its uniqueness predicate from SQLAlchemy expressions; the
    # fake query calls predicates, so comparisons are replaced with plain lambdas.
    monkeypatch.setattr(admins_module, "_username_taken", lambda username, excluding_id=None: any(
        record.username.lower() == username.lower() and record.id != excluding_id
        for record in FakeAdmin.store
    ))
    return session


def test_listing_marks_the_signed_in_administrator():
    client = signed_in(admins_app(), admin_id=2)

    response = client.get("/api/admins")

    assert response.status_code == 200
    assert response.json["total"] == 2
    current = {item["username"]: item["isCurrent"] for item in response.json["items"]}
    assert current == {"admin01": False, "admin02": True}
    assert {item["status"] for item in response.json["items"]} == {"Active"}
    # The listing must never expose stored passwords.
    assert all("password" not in item for item in response.json["items"])


def test_listing_requires_an_administrator():
    assert admins_app().test_client().get("/api/admins").status_code == 401


def test_listing_carries_each_accounts_role():
    FakeAdmin.store.extend([
        FakeAdmin(id=3, username="admin03", password="x", gmail="c@example.com", role=None),
        FakeAdmin(id=4, username="admin04", password="x", gmail="d@example.com", role="owner"),
    ])

    # A plain administrator may read the list.
    response = signed_in(admins_app(), admin_id=2).get("/api/admins")

    assert response.status_code == 200
    roles = {item["username"]: item["role"] for item in response.json["items"]}
    # A missing or unrecognized stored role never reads as superadmin.
    assert roles == {"admin01": "superadmin", "admin02": "admin", "admin03": "admin", "admin04": "admin"}


def test_a_demoted_superadmin_is_refused_on_the_next_request():
    client = signed_in(admins_app(), admin_id=1)
    body = {"username": "admin03", "email": "admin03@example.com", "password": "Another-secret1!"}
    assert client.post("/api/admins", json=body).status_code == 201

    # Same session cookie: only the stored row changed.
    next(item for item in FakeAdmin.store if item.id == 1).role = "admin"
    response = client.post("/api/admins", json={**body, "username": "admin04"})

    assert response.status_code == 403
    assert response.json["message"] == "Superadmin access required"
    assert not any(record.username == "admin04" for record in FakeAdmin.store)


def test_creating_an_administrator_adds_the_record(admin_directory):
    client = signed_in(admins_app())

    response = client.post("/api/admins", json={
        "username": "admin03", "email": "admin03@example.com", "password": "Another-secret1!",
    })

    assert response.status_code == 201
    assert response.json["admin"]["username"] == "admin03"
    assert admin_directory.committed is True
    assert any(record.username == "admin03" for record in FakeAdmin.store)


def test_creating_refuses_a_plain_administrator(admin_directory):
    response = signed_in(admins_app(), admin_id=2).post("/api/admins", json={
        "username": "admin03", "email": "admin03@example.com", "password": "Another-secret1!",
    })

    assert response.status_code == 403
    assert response.json == {
        "success": False, "code": "superadmin_required", "message": "Superadmin access required",
    }
    assert admin_directory.committed is False
    assert [record.id for record in FakeAdmin.store] == [1, 2]


def test_creating_requires_a_signed_in_account():
    response = admins_app().test_client().post("/api/admins", json={
        "username": "admin03", "email": "admin03@example.com", "password": "Another-secret1!",
    })

    assert response.status_code == 401


NEW_ACCOUNT = {"username": "admin03", "email": "admin03@example.com", "password": "Another-secret1!"}


def created_accounts():
    return [record for record in FakeAdmin.store if record.id not in (1, 2)]


def test_creating_without_a_role_makes_an_administrator(admin_directory):
    response = signed_in(admins_app(), confirmed=False).post("/api/admins", json=NEW_ACCOUNT)

    assert response.status_code == 201
    assert response.json["admin"]["role"] == "admin"
    assert [record.role for record in created_accounts()] == ["admin"]


def test_creating_with_a_null_role_makes_an_administrator():
    response = signed_in(admins_app(), confirmed=False).post("/api/admins", json={**NEW_ACCOUNT, "role": None})

    assert response.status_code == 201
    assert response.json["admin"]["role"] == "admin"


def test_creating_an_administrator_by_role_needs_no_password_confirmation():
    response = signed_in(admins_app(), confirmed=False).post("/api/admins", json={**NEW_ACCOUNT, "role": "admin"})

    assert response.status_code == 201
    assert response.json["admin"]["role"] == "admin"
    assert [record.role for record in created_accounts()] == ["admin"]


def test_creating_a_superadmin_with_a_recent_confirmation():
    response = signed_in(admins_app()).post("/api/admins", json={**NEW_ACCOUNT, "role": "superadmin"})

    assert response.status_code == 201
    assert response.json["admin"]["role"] == "superadmin"
    assert [record.role for record in created_accounts()] == ["superadmin"]


def test_the_role_is_read_like_the_role_routes_does():
    response = signed_in(admins_app()).post("/api/admins", json={**NEW_ACCOUNT, "role": " SuperAdmin "})

    assert response.status_code == 201
    assert response.json["admin"]["role"] == "superadmin"


def test_creating_a_superadmin_without_a_confirmation_is_refused(admin_directory):
    response = signed_in(admins_app(), confirmed=False).post("/api/admins", json={**NEW_ACCOUNT, "role": "superadmin"})

    assert response.status_code == 403
    assert response.json == {
        "success": False,
        "code": "password_confirmation_required",
        "message": "Confirm your password to create a superadmin.",
    }
    assert admin_directory.committed is False
    assert created_accounts() == []


def test_creating_a_superadmin_with_an_expired_confirmation_is_refused(admin_directory):
    client = signed_in(admins_app())
    with client.session_transaction() as flask_session:
        flask_session["reauth_at"] = time.time() - 3600

    response = client.post("/api/admins", json={**NEW_ACCOUNT, "role": "superadmin"})

    assert response.status_code == 403
    assert response.json["code"] == "password_confirmation_required"
    assert created_accounts() == []


@pytest.mark.parametrize("role", ["owner", "", "root", 1, True, ["superadmin"], {"role": "admin"}])
def test_an_unrecognized_role_is_a_field_error(role, admin_directory):
    response = signed_in(admins_app()).post("/api/admins", json={**NEW_ACCOUNT, "role": role})

    assert response.status_code == 400
    assert response.json["fields"] == {"role": "Role must be Administrator or Superadmin."}
    assert admin_directory.committed is False
    assert created_accounts() == []


def test_an_unrecognized_role_is_a_field_error_even_without_a_confirmation():
    response = signed_in(admins_app(), confirmed=False).post("/api/admins", json={**NEW_ACCOUNT, "role": "owner"})

    assert response.status_code == 400
    assert "role" in response.json["fields"]


def test_a_plain_administrator_is_refused_before_a_password_is_asked_for(admin_directory):
    response = signed_in(admins_app(), admin_id=2, confirmed=False).post(
        "/api/admins", json={**NEW_ACCOUNT, "role": "superadmin"},
    )

    assert response.status_code == 403
    assert response.json["code"] == "superadmin_required"
    assert created_accounts() == []


def test_a_confirmation_does_not_override_the_other_validation():
    client = signed_in(admins_app())

    short = client.post("/api/admins", json={**NEW_ACCOUNT, "password": "short", "role": "superadmin"})
    duplicate = client.post("/api/admins", json={**NEW_ACCOUNT, "username": "ADMIN02", "role": "superadmin"})

    assert short.status_code == 400 and "password" in short.json["fields"]
    assert duplicate.status_code == 409 and "username" in duplicate.json["fields"]
    assert created_accounts() == []


def test_incomplete_details_are_reported_before_a_missing_confirmation_is():
    response = signed_in(admins_app(), confirmed=False).post(
        "/api/admins", json={**NEW_ACCOUNT, "email": "nope", "role": "superadmin"},
    )

    assert response.status_code == 400
    assert "email" in response.json["fields"]


def test_a_created_account_is_listed_with_its_role():
    client = signed_in(admins_app())
    client.post("/api/admins", json={**NEW_ACCOUNT, "role": "superadmin"})

    roles = {item["username"]: item["role"] for item in client.get("/api/admins").json["items"]}

    assert roles["admin03"] == "superadmin"


@pytest.mark.parametrize(
    "body,expected_field",
    [
        ({"email": "a@example.com", "password": "Longenough1!"}, "username"),
        ({"username": "admin03", "password": "Longenough1!"}, "email"),
        ({"username": "admin03", "email": "not-an-email", "password": "Longenough1!"}, "email"),
        ({"username": "admin03", "email": "a@example.com", "password": "short"}, "password"),
    ],
)
def test_creating_rejects_an_incomplete_account(body, expected_field):
    response = signed_in(admins_app()).post("/api/admins", json=body)

    assert response.status_code == 400
    assert expected_field in response.json["fields"]


@pytest.mark.parametrize(
    "password,message",
    [
        ("", "Password must be at least 8 characters."),
        ("Abcde1!", "Password must be at least 8 characters."),
        ("abcdefg1!", "Password must include an uppercase letter."),
        ("ABCDEFG1!", "Password must include a lowercase letter."),
        ("Abcdefgh!", "Password must include a number."),
        ("Abcdefg12", "Password must include a symbol."),
        ("longenough", "Password must include an uppercase letter."),
    ],
)
def test_creating_enforces_the_shared_password_rules_against_the_password_field(password, message):
    response = signed_in(admins_app()).post("/api/admins", json={**NEW_ACCOUNT, "password": password})

    assert response.status_code == 400
    assert response.json["message"] == message
    assert response.json["fields"] == {"password": message}
    assert created_accounts() == []


@pytest.mark.parametrize("password", ["Élève123!", "Aa1😀😀😀😀😀", "Abcdefg1😀"])
def test_creating_accepts_non_ascii_letters_and_counts_code_points(password):
    response = signed_in(admins_app()).post("/api/admins", json={**NEW_ACCOUNT, "password": password})

    assert response.status_code == 201
    assert verify_password(created_accounts()[0].password, password)[0]


def test_creating_reports_the_username_before_the_password():
    response = signed_in(admins_app()).post("/api/admins", json={**NEW_ACCOUNT, "username": "", "password": "weak"})

    assert response.status_code == 400
    assert list(response.json["fields"]) == ["username"]


def test_creating_a_weak_password_is_refused_before_the_duplicate_username():
    response = signed_in(admins_app()).post("/api/admins", json={**NEW_ACCOUNT, "username": "ADMIN02", "password": "weakweak"})

    assert response.status_code == 400
    assert list(response.json["fields"]) == ["password"]


def test_creating_rejects_a_duplicate_username():
    response = signed_in(admins_app()).post("/api/admins", json={
        "username": "ADMIN02", "email": "new@example.com", "password": "Longenough1!",
    })

    assert response.status_code == 409
    assert "username" in response.json["fields"]


def test_updating_renames_without_touching_the_password():
    client = signed_in(admins_app(), admin_id=2)

    response = client.put("/api/admins/2", json={"username": "renamed", "email": "renamed@example.com"})

    assert response.status_code == 200
    record = next(item for item in FakeAdmin.store if item.id == 2)
    assert (record.username, record.gmail) == ("renamed", "renamed@example.com")
    assert record.password == "password456"


def test_updating_sets_a_supplied_password():
    client = signed_in(admins_app(), admin_id=2)

    response = client.put("/api/admins/2", json={
        "username": "admin02", "email": "admin02@example.com", "password": "Replacement1!",
    })

    assert response.status_code == 200
    stored = next(item for item in FakeAdmin.store if item.id == 2).password
    # Hashed on the way in, so the column never receives the raw password.
    assert stored != "Replacement1!"
    assert verify_password(stored, "Replacement1!")[0]


@pytest.mark.parametrize("password", ["replacement", "Replacement1", "replacement1!", "Rep1!"])
def test_updating_enforces_the_shared_password_rules_on_a_supplied_password(password):
    client = signed_in(admins_app(), admin_id=2)

    response = client.put("/api/admins/2", json={
        "username": "admin02", "email": "admin02@example.com", "password": password,
    })

    assert response.status_code == 400
    assert list(response.json["fields"]) == ["password"]
    assert response.json["message"].startswith("Password must ")
    assert next(item for item in FakeAdmin.store if item.id == 2).password == "password456"


def test_updating_a_missing_administrator_is_not_found():
    assert signed_in(admins_app()).put("/api/admins/99", json={
        "username": "ghost", "email": "ghost@example.com",
    }).status_code == 404


def test_updating_refuses_another_administrators_details():
    response = signed_in(admins_app(), admin_id=1).put("/api/admins/2", json={
        "username": "hijacked", "email": "hijacked@example.com", "password": "Replacement1!",
    })

    assert response.status_code == 403
    assert response.json["message"] == "You can only edit your own administrator account."
    record = next(item for item in FakeAdmin.store if item.id == 2)
    assert (record.username, record.gmail, record.password) == (
        "admin02", "admin02@example.com", "password456",
    )


def test_updating_refuses_another_administrator_before_validating_the_body():
    # A rejected edit must not leak which fields the other account would accept.
    response = signed_in(admins_app(), admin_id=1).put("/api/admins/2", json={})

    assert response.status_code == 403
    assert "fields" not in response.json


def test_deactivating_another_administrator_keeps_the_record(admin_directory):
    response = signed_in(admins_app(), admin_id=1).put("/api/admins/2/status", json={"status": "Inactive"})

    assert response.status_code == 200
    assert response.json["message"] == "admin02 was deactivated successfully."
    assert response.json["admin"]["status"] == "Inactive"
    record = next(item for item in FakeAdmin.store if item.id == 2)
    assert record.status == "inactive" and record.is_active is False
    # Deactivation is not a delete: the account is still there to be restored.
    assert len(FakeAdmin.store) == 2
    assert admin_directory.committed is True


def test_activating_restores_access():
    FakeAdmin.reset([
        FakeAdmin(id=1, username="admin01", password="x", gmail="a@example.com", role="superadmin"),
        FakeAdmin(id=2, username="admin02", password="x", gmail="b@example.com", status="inactive"),
    ])

    response = signed_in(admins_app(), admin_id=1).put("/api/admins/2/status", json={"status": "Active"})

    assert response.status_code == 200
    assert response.json["message"] == "admin02 was activated successfully."
    assert next(item for item in FakeAdmin.store if item.id == 2).status == "active"


def test_deactivating_refuses_the_signed_in_account():
    response = signed_in(admins_app(), admin_id=1).put("/api/admins/1/status", json={"status": "Inactive"})

    assert response.status_code == 409
    assert response.json["message"] == "You cannot deactivate your own administrator account."
    assert next(item for item in FakeAdmin.store if item.id == 1).status == "active"


def test_deactivating_refuses_the_last_active_administrator(guards_passed):
    # admin02 is already inactive, so admin01 is the only one who can sign in.
    FakeAdmin.reset([
        FakeAdmin(id=1, username="admin01", password="x", gmail="a@example.com"),
        FakeAdmin(id=2, username="admin02", password="x", gmail="b@example.com", status="inactive"),
    ])

    response = signed_in(admins_app(), admin_id=2).put("/api/admins/1/status", json={"status": "Inactive"})

    assert response.status_code == 409
    assert response.json["message"] == "The last active administrator cannot be deactivated."
    assert next(item for item in FakeAdmin.store if item.id == 1).status == "active"


@pytest.mark.parametrize("body", [{}, {"status": "Unknown"}, {"status": "archived"}])
def test_status_must_be_one_of_the_two_states(body):
    response = signed_in(admins_app(), admin_id=1).put("/api/admins/2/status", json=body)

    assert response.status_code == 400
    assert "status" in response.json["fields"]


def test_setting_the_status_it_already_has_is_a_no_op(admin_directory):
    response = signed_in(admins_app(), admin_id=1).put("/api/admins/2/status", json={"status": "Active"})

    assert response.status_code == 200
    assert response.json["message"] == "admin02 is already active."
    assert admin_directory.committed is False


def test_setting_the_status_of_a_missing_administrator_is_not_found():
    assert signed_in(admins_app()).put("/api/admins/99/status", json={"status": "Inactive"}).status_code == 404


def test_setting_a_status_requires_a_signed_in_account():
    response = admins_app().test_client().put("/api/admins/2/status", json={"status": "Inactive"})

    assert response.status_code == 401
    assert next(item for item in FakeAdmin.store if item.id == 2).status == "active"


@pytest.mark.parametrize("status", ["Inactive", "Active"])
def test_setting_a_status_refuses_a_plain_administrator(status, admin_directory):
    # The caller (2) acts on the superadmin (1), so only the role can refuse.
    response = signed_in(admins_app(), admin_id=2).put("/api/admins/1/status", json={"status": status})

    assert response.status_code == 403
    assert response.json["code"] == "superadmin_required"
    assert response.json["message"] == "Superadmin access required"
    assert next(item for item in FakeAdmin.store if item.id == 1).status == "active"
    assert admin_directory.committed is False


def test_sending_a_reset_code_mails_the_other_account(admin_directory):
    response = signed_in(admins_app(), admin_id=1).post("/api/admins/2/password-reset")

    assert response.status_code == 200
    assert response.json["message"] == "A password reset code was sent to admin02@example.com."
    assert admin_directory.reset_codes_sent == ["admin02"]
    # The caller never learns the code itself.
    assert "otp" not in response.json and "code" not in response.json


def test_a_plain_administrator_can_send_a_reset_code_to_a_superadmin(admin_directory):
    response = signed_in(admins_app(), admin_id=2).post("/api/admins/1/password-reset")

    assert response.status_code == 200
    assert admin_directory.reset_codes_sent == ["admin01"]


def test_sending_a_reset_code_needs_an_address_on_file(admin_directory):
    FakeAdmin.reset([
        FakeAdmin(id=1, username="admin01", password="x", gmail="admin01@example.com"),
        FakeAdmin(id=2, username="admin02", password="x", gmail=None),
    ])

    response = signed_in(admins_app(), admin_id=1).post("/api/admins/2/password-reset")

    assert response.status_code == 409
    assert admin_directory.reset_codes_sent == []


def test_sending_a_reset_code_is_rate_limited_per_account(monkeypatch, admin_directory):
    monkeypatch.setattr(admins_module, "rate_limited", lambda *args, **kwargs: (
        {"success": False, "message": "A reset code was just sent to that account."}, 429
    ))

    response = signed_in(admins_app(), admin_id=1).post("/api/admins/2/password-reset")

    assert response.status_code == 429
    assert admin_directory.reset_codes_sent == []


def test_sending_a_reset_code_reports_a_mail_failure(monkeypatch):
    def explode(_admin):
        raise RuntimeError("smtp is down")

    monkeypatch.setattr(admins_module, "send_password_reset_otp", explode)

    response = signed_in(admins_app(), admin_id=1).post("/api/admins/2/password-reset")

    assert response.status_code == 502
    assert response.json["message"] == "Failed to send the password reset code."


def test_sending_a_reset_code_for_a_missing_administrator_is_not_found():
    assert signed_in(admins_app()).post("/api/admins/99/password-reset").status_code == 404


def test_sending_a_reset_code_requires_a_signed_in_account():
    assert admins_app().test_client().post("/api/admins/2/password-reset").status_code == 401


def test_deleting_removes_another_administrator(admin_directory):
    response = signed_in(admins_app(), admin_id=1).delete("/api/admins/2")

    assert response.status_code == 200
    assert [record.id for record in FakeAdmin.store] == [1]
    assert admin_directory.committed is True


def test_deleting_refuses_the_signed_in_account():
    response = signed_in(admins_app(), admin_id=1).delete("/api/admins/1")

    assert response.status_code == 409
    assert response.json["message"] == "You cannot remove your own administrator account."
    assert len(FakeAdmin.store) == 2


def test_deleting_refuses_the_last_administrator(guards_passed):
    FakeAdmin.reset([FakeAdmin(id=2, username="admin02", password="x", gmail="a@example.com")])

    response = signed_in(admins_app(), admin_id=1).delete("/api/admins/2")

    assert response.status_code == 409
    assert response.json["message"] == "The last administrator account cannot be removed."
    assert len(FakeAdmin.store) == 1


def test_deleting_requires_a_confirmed_password():
    response = signed_in(admins_app(), admin_id=1, confirmed=False).delete("/api/admins/2")

    assert response.status_code == 403
    assert response.json["code"] == "password_confirmation_required"
    assert len(FakeAdmin.store) == 2


def test_deleting_requires_a_recent_password_confirmation():
    client = signed_in(admins_app(), admin_id=1, confirmed=False)
    with client.session_transaction() as flask_session:
        flask_session["reauth_at"] = time.time() - auth_module.REAUTH_MAX_AGE_SECONDS - 1

    response = client.delete("/api/admins/2")

    assert response.status_code == 403
    assert response.json["code"] == "password_confirmation_required"
    assert len(FakeAdmin.store) == 2


@pytest.mark.parametrize("confirmed", [True, False])
def test_deleting_refuses_a_plain_administrator_before_asking_for_a_password(confirmed):
    # Even with no confirmation the caller hears about the role, not a prompt.
    response = signed_in(admins_app(), admin_id=2, confirmed=confirmed).delete("/api/admins/1")

    assert response.status_code == 403
    assert response.json["code"] == "superadmin_required"
    assert response.json["message"] == "Superadmin access required"
    assert len(FakeAdmin.store) == 2


def test_deleting_requires_a_signed_in_account():
    assert admins_app().test_client().delete("/api/admins/2").status_code == 401


def test_a_plain_administrator_is_refused_before_the_account_is_looked_up():
    # A missing target must not tell a plain administrator anything.
    response = signed_in(admins_app(), admin_id=2).delete("/api/admins/99")

    assert response.status_code == 403
    assert response.json["code"] == "superadmin_required"


def test_a_deactivated_superadmin_is_refused():
    next(item for item in FakeAdmin.store if item.id == 1).status = "inactive"

    response = signed_in(admins_app(), admin_id=1).post("/api/admins", json={
        "username": "admin03", "email": "admin03@example.com", "password": "Another-secret1!",
    })

    assert response.status_code == 401


def test_self_edit_works_for_a_plain_administrator_and_cannot_change_the_role():
    client = signed_in(admins_app(), admin_id=2)

    response = client.put("/api/admins/2", json={
        "username": "admin02", "email": "admin02@example.com", "role": "superadmin",
    })

    assert response.status_code == 200
    assert response.json["admin"]["role"] == "admin"
    assert next(item for item in FakeAdmin.store if item.id == 2).role == "admin"


def test_a_superadmin_self_edit_keeps_the_role():
    response = signed_in(admins_app(), admin_id=1).put("/api/admins/1", json={
        "username": "admin01", "email": "admin01@example.com", "role": "admin",
    })

    assert response.status_code == 200
    assert response.json["admin"]["role"] == "superadmin"
    assert next(item for item in FakeAdmin.store if item.id == 1).role == "superadmin"


# ==========================================
# ROLE CHANGES
# ==========================================

def role_of(admin_id):
    return next(item for item in FakeAdmin.store if item.id == admin_id).role


def test_a_superadmin_promotes_an_administrator(admin_directory):
    response = signed_in(admins_app(), admin_id=1).put("/api/admins/2/role", json={"role": "superadmin"})

    assert response.status_code == 200
    assert response.json["success"] is True
    assert response.json["message"] == "admin02 was promoted to superadmin successfully."
    assert response.json["admin"] == {
        "id": "2", "username": "admin02", "email": "admin02@example.com",
        "status": "Active", "role": "superadmin", "isCurrent": False,
    }
    assert role_of(2) == "superadmin"
    assert admin_directory.committed is True


def test_a_superadmin_demotes_another_superadmin(admin_directory):
    next(item for item in FakeAdmin.store if item.id == 2).role = "superadmin"

    response = signed_in(admins_app(), admin_id=1).put("/api/admins/2/role", json={"role": "admin"})

    assert response.status_code == 200
    assert response.json["message"] == "admin02 was demoted to administrator successfully."
    assert response.json["admin"]["role"] == "admin"
    assert role_of(2) == "admin"
    assert admin_directory.committed is True


def test_a_demoted_superadmin_cannot_use_the_role_route_next(admin_directory):
    next(item for item in FakeAdmin.store if item.id == 2).role = "superadmin"
    client = signed_in(admins_app(), admin_id=2)
    signed_in(admins_app(), admin_id=1).put("/api/admins/2/role", json={"role": "admin"})

    # Same cookie as before the demotion: only the stored row changed.
    response = client.put("/api/admins/1/role", json={"role": "admin"})

    assert response.status_code == 403
    assert response.json["code"] == "superadmin_required"
    assert role_of(1) == "superadmin"


@pytest.mark.parametrize("role", ["superadmin", "admin"])
def test_the_role_route_refuses_a_plain_administrator(role, admin_directory):
    # The caller (2) acts on the superadmin (1), so only the role can refuse.
    response = signed_in(admins_app(), admin_id=2).put("/api/admins/1/role", json={"role": role})

    assert response.status_code == 403
    assert response.json == {
        "success": False, "code": "superadmin_required", "message": "Superadmin access required",
    }
    assert role_of(1) == "superadmin"
    assert role_of(2) == "admin"
    assert admin_directory.committed is False


@pytest.mark.parametrize("confirmed", [True, False])
def test_the_role_route_refuses_a_plain_administrator_before_asking_for_a_password(confirmed):
    response = signed_in(admins_app(), admin_id=2, confirmed=confirmed).put("/api/admins/99/role", json={})

    assert response.status_code == 403
    assert response.json["code"] == "superadmin_required"


def test_the_role_route_requires_a_confirmed_password(admin_directory):
    response = signed_in(admins_app(), admin_id=1, confirmed=False).put(
        "/api/admins/2/role", json={"role": "superadmin"},
    )

    assert response.status_code == 403
    assert response.json["code"] == "password_confirmation_required"
    # Worded for a role change, not for the delete the default message names.
    assert response.json["message"] == "Confirm your password to change this administrator's role."
    assert role_of(2) == "admin"
    assert admin_directory.committed is False


def test_the_role_route_requires_a_recent_password_confirmation():
    client = signed_in(admins_app(), admin_id=1, confirmed=False)
    with client.session_transaction() as flask_session:
        flask_session["reauth_at"] = time.time() - auth_module.REAUTH_MAX_AGE_SECONDS - 1

    response = client.put("/api/admins/2/role", json={"role": "superadmin"})

    assert response.status_code == 403
    assert response.json["code"] == "password_confirmation_required"
    assert role_of(2) == "admin"


def test_the_role_route_asks_for_the_password_even_when_nothing_would_change():
    response = signed_in(admins_app(), admin_id=1, confirmed=False).put(
        "/api/admins/2/role", json={"role": "admin"},
    )

    assert response.status_code == 403
    assert response.json["code"] == "password_confirmation_required"


def test_deleting_still_words_the_confirmation_for_a_delete():
    response = signed_in(admins_app(), admin_id=1, confirmed=False).delete("/api/admins/2")

    assert response.json["message"] == "Confirm your password to delete this record."


def test_the_role_route_requires_a_signed_in_account():
    response = admins_app().test_client().put("/api/admins/2/role", json={"role": "superadmin"})

    assert response.status_code == 401
    assert role_of(2) == "admin"


def test_the_role_route_refuses_a_deactivated_superadmin():
    next(item for item in FakeAdmin.store if item.id == 1).status = "inactive"

    response = signed_in(admins_app(), admin_id=1).put("/api/admins/2/role", json={"role": "superadmin"})

    assert response.status_code == 401
    assert role_of(2) == "admin"


def test_the_role_of_a_missing_administrator_is_not_found():
    response = signed_in(admins_app(), admin_id=1).put("/api/admins/99/role", json={"role": "superadmin"})

    assert response.status_code == 404
    assert response.json["message"] == "Administrator not found."


@pytest.mark.parametrize("body", [{}, {"role": ""}, {"role": "owner"}, {"role": "Superadmin2"}, {"role": 1}, {"role": None}])
def test_the_role_must_be_one_of_the_two_roles(body, admin_directory):
    response = signed_in(admins_app(), admin_id=1).put("/api/admins/2/role", json=body)

    assert response.status_code == 400
    assert response.json["fields"] == {"role": "Role must be Administrator or Superadmin."}
    assert role_of(2) == "admin"
    assert admin_directory.committed is False


def test_a_role_body_must_be_an_object(admin_directory):
    response = signed_in(admins_app(), admin_id=1).put("/api/admins/2/role", json=["superadmin"])

    assert response.status_code == 400
    assert "role" in response.json["fields"]


def test_an_account_cannot_change_its_own_role(admin_directory):
    # A second superadmin is present, so only the self rule can refuse.
    next(item for item in FakeAdmin.store if item.id == 2).role = "superadmin"

    response = signed_in(admins_app(), admin_id=1).put("/api/admins/1/role", json={"role": "admin"})

    assert response.status_code == 409
    assert response.json["message"] == "You cannot change your own role."
    assert role_of(1) == "superadmin"
    assert admin_directory.committed is False


def test_an_account_cannot_set_its_own_role_to_the_one_it_has(admin_directory):
    response = signed_in(admins_app(), admin_id=1).put("/api/admins/1/role", json={"role": "superadmin"})

    assert response.status_code == 409
    assert response.json["message"] == "You cannot change your own role."


@pytest.mark.parametrize("role, target_id", [("superadmin", 1), ("admin", 2)])
def test_setting_the_role_it_already_has_is_a_no_op(role, target_id, admin_directory, monkeypatch):
    audits = []
    monkeypatch.setattr(admins_module, "log_audit", lambda *args: audits.append(args))
    # A second superadmin, so the caller can act on account 1 or 2 alike.
    FakeAdmin.store.append(FakeAdmin(id=3, username="admin03", password="x", gmail="c@example.com", role="superadmin"))

    response = signed_in(admins_app(), admin_id=3).put(f"/api/admins/{target_id}/role", json={"role": role})

    assert response.status_code == 200
    assert response.json["admin"]["role"] == role
    assert response.json["message"].endswith(
        "is already a superadmin." if role == "superadmin" else "is already an administrator."
    )
    assert audits == []
    assert admin_directory.committed is False


def test_promoting_is_audited_against_the_affected_account(monkeypatch):
    audits = []
    monkeypatch.setattr(admins_module, "log_audit", lambda *args: audits.append(args))

    signed_in(admins_app(), admin_id=1).put("/api/admins/2/role", json={"role": "superadmin"})

    assert audits == [("Admin", None, "promote", "Administrator", 2, "admin02")]


def test_demoting_is_audited_against_the_affected_account(monkeypatch):
    audits = []
    monkeypatch.setattr(admins_module, "log_audit", lambda *args: audits.append(args))
    next(item for item in FakeAdmin.store if item.id == 2).role = "superadmin"

    signed_in(admins_app(), admin_id=1).put("/api/admins/2/role", json={"role": "admin"})

    assert audits == [("Admin", None, "demote", "Administrator", 2, "admin02")]


def test_a_refused_role_change_writes_no_audit_entry(monkeypatch):
    audits = []
    monkeypatch.setattr(admins_module, "log_audit", lambda *args: audits.append(args))

    signed_in(admins_app(), admin_id=2).put("/api/admins/1/role", json={"role": "admin"})
    signed_in(admins_app(), admin_id=1).put("/api/admins/1/role", json={"role": "admin"})
    signed_in(admins_app(), admin_id=1).put("/api/admins/2/role", json={"role": "owner"})

    assert audits == []


def test_a_failed_role_write_rolls_back(admin_directory, monkeypatch):
    def broken_commit():
        raise RuntimeError("database offline")

    monkeypatch.setattr(admin_directory, "commit", broken_commit)

    response = signed_in(admins_app(), admin_id=1).put("/api/admins/2/role", json={"role": "superadmin"})

    assert response.status_code == 500
    assert response.json["message"] == "Failed to update the administrator's role."
    assert admin_directory.rolled_back is True


# Zero active superadmins. A real caller is an active superadmin who cannot
# target themselves, so the caller always remains and these rules are reached
# only with the guards skipped and a caller who is not in the directory.

LAST_SUPERADMIN_MESSAGE = "At least one active superadmin is required. Promote another account first."


@pytest.fixture
def lone_superadmin(guards_passed):
    """One active superadmin (1), an administrator (2) and a caller (2) who acts on 1."""
    FakeAdmin.reset([
        FakeAdmin(id=1, username="admin01", password="x", gmail="a@example.com", role="superadmin"),
        FakeAdmin(id=2, username="admin02", password="x", gmail="b@example.com"),
        FakeAdmin(id=3, username="admin03", password="x", gmail="c@example.com"),
    ])
    return signed_in(admins_app(), admin_id=2)


def test_demoting_the_last_active_superadmin_is_refused(lone_superadmin, admin_directory):
    response = lone_superadmin.put("/api/admins/1/role", json={"role": "admin"})

    assert response.status_code == 409
    assert response.json["message"] == LAST_SUPERADMIN_MESSAGE
    assert role_of(1) == "superadmin"
    assert admin_directory.committed is False


def test_deactivating_the_last_active_superadmin_is_refused(lone_superadmin, admin_directory):
    response = lone_superadmin.put("/api/admins/1/status", json={"status": "Inactive"})

    assert response.status_code == 409
    assert response.json["message"] == LAST_SUPERADMIN_MESSAGE
    assert next(item for item in FakeAdmin.store if item.id == 1).status == "active"
    assert admin_directory.committed is False


def test_removing_the_last_active_superadmin_is_refused(lone_superadmin, admin_directory):
    response = lone_superadmin.delete("/api/admins/1")

    assert response.status_code == 409
    assert response.json["message"] == LAST_SUPERADMIN_MESSAGE
    assert [record.id for record in FakeAdmin.store] == [1, 2, 3]
    assert admin_directory.committed is False


def test_a_deactivated_superadmin_does_not_count_as_active(lone_superadmin):
    FakeAdmin.store.append(FakeAdmin(
        id=4, username="admin04", password="x", gmail="d@example.com", role="superadmin", status="inactive",
    ))

    assert lone_superadmin.put("/api/admins/1/role", json={"role": "admin"}).json["message"] == LAST_SUPERADMIN_MESSAGE
    assert lone_superadmin.put("/api/admins/1/status", json={"status": "Inactive"}).json["message"] == LAST_SUPERADMIN_MESSAGE
    assert lone_superadmin.delete("/api/admins/1").json["message"] == LAST_SUPERADMIN_MESSAGE


def test_another_active_superadmin_lets_each_change_through(lone_superadmin):
    FakeAdmin.store.append(FakeAdmin(id=4, username="admin04", password="x", gmail="d@example.com", role="superadmin"))

    assert lone_superadmin.put("/api/admins/1/status", json={"status": "Inactive"}).status_code == 200
    assert lone_superadmin.put("/api/admins/1/status", json={"status": "Active"}).status_code == 200
    assert lone_superadmin.put("/api/admins/1/role", json={"role": "admin"}).status_code == 200
    assert role_of(1) == "admin"


def test_changing_an_account_that_is_not_an_active_superadmin_ignores_the_rule(lone_superadmin):
    # Accounts 2 and 3 are plain administrators, so none of this touches the count.
    assert lone_superadmin.put("/api/admins/3/role", json={"role": "admin"}).status_code == 200
    assert lone_superadmin.put("/api/admins/3/status", json={"status": "Inactive"}).status_code == 200
    assert lone_superadmin.delete("/api/admins/3").status_code == 200


def test_a_deactivated_last_superadmin_can_be_demoted_or_removed(lone_superadmin):
    # Already inactive, so it is not an active superadmin whose loss counts.
    FakeAdmin.store.append(FakeAdmin(
        id=4, username="admin04", password="x", gmail="d@example.com", role="superadmin", status="inactive",
    ))

    assert lone_superadmin.put("/api/admins/4/role", json={"role": "admin"}).status_code == 200
    assert lone_superadmin.delete("/api/admins/4").status_code == 200


def _start(send, client):
    """Runs one request on its own thread. Returns the thread and its outcome."""

    outcome = {}
    thread = threading.Thread(target=lambda: outcome.update(response=send(client)))
    thread.start()
    return thread, outcome


def _peer_superadmins_act_together(monkeypatch, request_for):
    """Two active superadmins each act on the other, the first held mid-check.

    The first request is paused once its last-superadmin check has run, so a
    second one arrives while it still has to write. Returns both status codes.
    """
    next(item for item in FakeAdmin.store if item.id == 2).role = "superadmin"
    app = admins_app()
    in_check = threading.Event()
    proceed = threading.Event()
    original = admins_module._is_last_active_superadmin

    def paused_after_check(record, *args):
        result = original(record, *args)
        if not in_check.is_set():
            in_check.set()
            assert proceed.wait(timeout=5)
        return result

    monkeypatch.setattr(admins_module, "_is_last_active_superadmin", paused_after_check)
    first, first_outcome = _start(lambda client: request_for(client, 2), signed_in(app, admin_id=1))
    assert in_check.wait(timeout=5)
    second, second_outcome = _start(lambda client: request_for(client, 1), signed_in(app, admin_id=2))
    # Long enough for an unlocked second request to run to the end.
    time.sleep(0.3)
    proceed.set()
    first.join(timeout=5)
    second.join(timeout=5)
    return first_outcome["response"].status_code, second_outcome["response"].status_code


PEER_REQUESTS = {
    "demote": lambda client, target: client.put(f"/api/admins/{target}/role", json={"role": "admin"}),
    "deactivate": lambda client, target: client.put(f"/api/admins/{target}/status", json={"status": "Inactive"}),
    "remove": lambda client, target: client.delete(f"/api/admins/{target}"),
}


def active_superadmins():
    return [record.id for record in FakeAdmin.store if record.is_active and record.is_superadmin]


@pytest.mark.parametrize("operation", sorted(PEER_REQUESTS))
def test_two_superadmins_cannot_remove_each_others_access_at_once(monkeypatch, operation):
    statuses = _peer_superadmins_act_together(monkeypatch, PEER_REQUESTS[operation])

    # One wins. The other waited for the lock, found its own caller stripped of
    # superadmin access (or gone) by then, and was refused.
    assert sorted(statuses) == [200, 403]
    assert active_superadmins()


@pytest.mark.parametrize("operation", sorted(PEER_REQUESTS))
def test_a_target_enabled_mid_request_cannot_leave_the_directory_without_a_superadmin(monkeypatch, operation):
    """Account 1 is the only active superadmin and acts on account 2, which is
    not an active superadmin yet. While that request is in flight, 2 is enabled
    and then tries to demote 1."""

    target = FakeAdmin.store[1]
    if operation == "deactivate":
        target.role, target.status = "admin", "active"
        enable = lambda client: client.put("/api/admins/2/role", json={"role": "superadmin"})
    else:
        target.role, target.status = "superadmin", "inactive"
        enable = lambda client: client.put("/api/admins/2/status", json={"status": "Active"})
    app = admins_app()
    in_check = threading.Event()
    proceed = threading.Event()
    original = admins_module._is_last_active_superadmin

    def paused_after_check(record, *args):
        result = original(record, *args)
        if record.id == 2 and not in_check.is_set():
            in_check.set()
            assert proceed.wait(timeout=5)
        return result

    monkeypatch.setattr(admins_module, "_is_last_active_superadmin", paused_after_check)
    initial, initial_outcome = _start(lambda client: PEER_REQUESTS[operation](client, 2), signed_in(app, admin_id=1))
    assert in_check.wait(timeout=5)
    enabling, enabled = _start(enable, signed_in(app, admin_id=1))
    enabling.join(timeout=0.3)
    waiting = enabling.is_alive()
    relinquishing, relinquished = _start(
        lambda client: client.put("/api/admins/1/role", json={"role": "admin"}),
        signed_in(app, admin_id=2),
    )
    relinquishing.join(timeout=0.3)
    proceed.set()
    for thread in (initial, enabling, relinquishing):
        thread.join(timeout=5)

    assert active_superadmins(), "the in-flight request removed the last active superadmin"
    assert initial_outcome["response"].status_code == 200
    assert relinquished["response"].status_code in (401, 403)
    # Enabling the target is a write too, so it waits behind the request in flight.
    assert waiting
    assert enabled["response"].status_code == (404 if operation == "remove" else 200)


STALE_CALLER_REQUESTS = {
    "promote": lambda client: client.put("/api/admins/3/role", json={"role": "superadmin"}),
    "deactivate": lambda client: client.put("/api/admins/3/status", json={"status": "Inactive"}),
    "remove": lambda client: client.delete("/api/admins/3"),
}


@pytest.mark.parametrize("operation", sorted(STALE_CALLER_REQUESTS))
def test_a_caller_demoted_between_the_guard_and_the_lock_is_refused(monkeypatch, operation):
    FakeAdmin.store[1].role = "superadmin"
    FakeAdmin.store.append(FakeAdmin(id=3, username="admin03", password="x", gmail="c@example.com"))
    app = admins_app()
    past_guard = threading.Event()
    proceed = threading.Event()
    original = admins_module.superadmin_required

    def paused_after_guard(*args):
        result = original(*args)
        if not past_guard.is_set():
            past_guard.set()
            assert proceed.wait(timeout=5)
        return result

    monkeypatch.setattr(admins_module, "superadmin_required", paused_after_guard)
    stale, outcome = _start(STALE_CALLER_REQUESTS[operation], signed_in(app, admin_id=2))
    assert past_guard.wait(timeout=5)
    demoted = signed_in(app, admin_id=1).put("/api/admins/2/role", json={"role": "admin"})
    assert demoted.status_code == 200
    proceed.set()
    stale.join(timeout=5)

    response = outcome["response"]
    assert response.status_code == 403
    assert response.json["code"] == "superadmin_required"
    account = next(item for item in FakeAdmin.store if item.id == 3)
    assert (account.role, account.status) == ("admin", "active")


LOCKING_REQUESTS = {
    "role": lambda client, target: client.put(f"/api/admins/{target}/role", json={"role": "superadmin"}),
    "status": lambda client, target: client.put(f"/api/admins/{target}/status", json={"status": "Inactive"}),
    "remove": lambda client, target: client.delete(f"/api/admins/{target}"),
}


@pytest.mark.parametrize("target", [2, 1, 99], ids=["a plain administrator", "the caller", "a missing account"])
@pytest.mark.parametrize("operation", sorted(LOCKING_REQUESTS))
def test_every_role_status_and_remove_request_locks_the_whole_directory_first(monkeypatch, operation, target):
    locked = []
    original = FakeQuery._matching

    def recording(self):
        if self._locking:
            locked.append(self)
        return original(self)

    monkeypatch.setattr(FakeQuery, "_matching", recording)

    LOCKING_REQUESTS[operation](signed_in(admins_app(), admin_id=1), target)

    # One lock over every row, taken whatever the request goes on to decide.
    assert len(locked) == 1
    assert locked[0]._filters == []
    # And it does not outlive the request, whether it wrote or was refused.
    assert FakeAdmin._lock_owner is None


@pytest.mark.parametrize("operation", sorted(LOCKING_REQUESTS))
def test_a_plain_administrator_is_refused_without_taking_the_lock(monkeypatch, operation):
    locked = []
    monkeypatch.setattr(FakeQuery, "with_for_update", lambda self: locked.append(self) or self)

    response = LOCKING_REQUESTS[operation](signed_in(admins_app(), admin_id=2), 1)

    assert response.status_code == 403
    assert locked == []


def test_a_failed_write_releases_the_lock(admin_directory, monkeypatch):
    def broken_commit():
        raise RuntimeError("database offline")

    monkeypatch.setattr(admin_directory, "commit", broken_commit)

    response = signed_in(admins_app(), admin_id=1).put("/api/admins/2/status", json={"status": "Inactive"})

    assert response.status_code == 500
    assert admin_directory.rolled_back is True
    assert FakeAdmin._lock_owner is None


def test_the_existing_self_rules_still_hold_for_a_superadmin(admin_directory):
    next(item for item in FakeAdmin.store if item.id == 2).role = "superadmin"
    client = signed_in(admins_app(), admin_id=1)

    assert client.put("/api/admins/1/status", json={"status": "Inactive"}).json["message"] == (
        "You cannot deactivate your own administrator account."
    )
    assert client.delete("/api/admins/1").json["message"] == "You cannot remove your own administrator account."
