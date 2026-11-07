import threading
import time

from flask import Flask
import pytest

import admins as admins_module
import auth as auth_module
import services.superadmin as superadmin_module
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
    # change to what counts as active or superadmin is exercised here too. The
    # same goes for the permission rules: the fake borrows them rather than
    # restating them, so "NULL means every permission" is tested as written.
    is_active = auth_module.Admin.is_active
    is_superadmin = auth_module.Admin.is_superadmin
    permissions_dto = auth_module.Admin.permissions_dto
    may = auth_module.Admin.may

    def __init__(self, username=None, password=None, gmail=None, id=None, status="active",
                 role="admin", alternative_email=None, permissions=None):
        self.id = id
        self.username = username
        self.password = password
        self.gmail = gmail
        # None is "every permission", which is what an account nothing has
        # restricted holds - and what the migration leaves a superadmin.
        self.permissions = permissions
        # The second address an account may hold. /api/admins never returns
        # anyone's, but it counts towards the pool these routes check.
        self.alternative_email = alternative_email
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


class FakeDesignation:
    """Stands in for public.superadmin_designation.

    Empty by default, which is the pre-migration state: no account is
    designated, so nothing is protected and the existing rules are the only
    ones that apply. ``designate`` is what a test uses to say "these are the
    four".

    Shares FakeQuery, so ``designated_admin_ids(lock=True)`` takes the same
    row lock the administrator rows are taken under - which is how the
    concurrency tests below can watch a designation land mid-request.
    """

    store = []
    admin_id = FakeColumn("admin_id")

    def __init__(self, admin_id):
        self.admin_id = admin_id

    class _QueryDescriptor:
        def __get__(self, _instance, owner):
            return FakeQuery(owner.store)

    query = _QueryDescriptor()


def designate(*admin_ids):
    """Designates these accounts as the fixed superadmins."""

    FakeDesignation.store = [FakeDesignation(admin_id) for admin_id in admin_ids]
    return FakeDesignation.store


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

    def refresh(self, record):
        # The fake directory holds live objects, so a record is always current.
        pass


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
    # Nobody is designated unless a test says so. Account 1 is therefore an
    # ordinary superadmin here, which keeps every rule that predates the fixed
    # set under test as written - and is what a deployment looks like between
    # this build and the migration.
    designate()
    session = FakeSession()
    monkeypatch.setattr(admins_module, "Admin", FakeAdmin)
    monkeypatch.setattr(auth_module, "Admin", FakeAdmin)
    monkeypatch.setattr(superadmin_module, "SuperadminDesignation", FakeDesignation)
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
    # Likewise for the shared email pool, which auth.admins_holding_email
    # builds as one OR over two columns. The rule it stands for - an address is
    # taken when any other account holds it as either of its two, compared
    # trimmed and case-insensitively - is kept here, so these tests still say
    # what the routes refuse.
    monkeypatch.setattr(admins_module, "email_taken", lambda email, excluding_id=None: any(
        (email or "").strip().lower() in {
            (held or "").strip().lower()
            for held in (record.gmail, getattr(record, "alternative_email", None))
            if held
        } and record.id != excluding_id
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

# The two ends of the four switches. ``None`` is a third thing - "no
# restriction recorded" - and is what a superadmin and an unconfigured
# administrator both hold, so it is never spelled as four trues here.
ALL_ON = {key: True for key in auth_module.PERMISSION_KEYS}
ALL_OFF = {key: False for key in auth_module.PERMISSION_KEYS}


def created_accounts():
    return [record for record in FakeAdmin.store if record.id not in (1, 2)]


def test_creating_without_a_role_makes_an_administrator(admin_directory):
    response = signed_in(admins_app()).post("/api/admins", json=NEW_ACCOUNT)

    assert response.status_code == 201
    assert response.json["admin"]["role"] == "admin"
    assert [record.role for record in created_accounts()] == ["admin"]


def test_creating_with_a_null_role_makes_an_administrator():
    response = signed_in(admins_app()).post("/api/admins", json={**NEW_ACCOUNT, "role": None})

    assert response.status_code == 201
    assert response.json["admin"]["role"] == "admin"


def test_creating_an_administrator_needs_a_password_confirmation_too():
    """Every create asks, not only a superadmin's: each one is a new way in."""

    response = signed_in(admins_app(), confirmed=False).post("/api/admins", json={**NEW_ACCOUNT, "role": "admin"})

    assert response.status_code == 403
    assert response.json["code"] == "password_confirmation_required"
    assert response.json["message"] == "Confirm your password to add an administrator."
    assert created_accounts() == []


def test_creating_an_administrator_by_role_with_a_recent_confirmation():
    response = signed_in(admins_app()).post("/api/admins", json={**NEW_ACCOUNT, "role": "admin"})

    assert response.status_code == 201
    assert response.json["admin"]["role"] == "admin"
    assert [record.role for record in created_accounts()] == ["admin"]


def test_creating_with_an_expired_confirmation_is_refused(admin_directory):
    client = signed_in(admins_app())
    with client.session_transaction() as flask_session:
        flask_session["reauth_at"] = time.time() - 3600

    response = client.post("/api/admins", json={**NEW_ACCOUNT, "role": "admin"})

    assert response.status_code == 403
    assert response.json["code"] == "password_confirmation_required"
    assert created_accounts() == []


@pytest.mark.parametrize("role", ["owner", "", "root", 1, True, ["superadmin"], {"role": "admin"}])
def test_an_unrecognized_role_is_a_field_error(role, admin_directory):
    """Administrator is the only role a create may name now, so the message
    names one choice. "superadmin" is not one of these: the route understands
    it and refuses it by policy, which the fixed-set section covers.
    """

    response = signed_in(admins_app()).post("/api/admins", json={**NEW_ACCOUNT, "role": role})

    assert response.status_code == 400
    assert response.json["fields"] == {"role": "Role must be Administrator."}
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

    short = client.post("/api/admins", json={**NEW_ACCOUNT, "password": "short", "role": "admin"})
    duplicate = client.post("/api/admins", json={**NEW_ACCOUNT, "username": "ADMIN02", "role": "admin"})

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
    client.post("/api/admins", json={**NEW_ACCOUNT, "role": "admin"})

    listed = {item["username"]: item for item in client.get("/api/admins").json["items"]}

    assert listed["admin03"]["role"] == "admin"
    assert listed["admin03"]["isProtected"] is False


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


def test_deleting_an_administrator_is_gone():
    """Removal was replaced by deactivation, so the method answers 405.

    The audit trail names an actor by username, and deleting the row left
    every row it had written pointing at nobody.
    """

    response = signed_in(admins_app(), admin_id=1).delete("/api/admins/2")

    assert response.status_code == 405
    assert response.json["success"] is False
    assert response.json["message"] == (
        "Administrators are no longer removed. Deactivate the account instead."
    )
    assert response.json["deactivate"] == "/api/admins/2/status"
    # The account is still there, which is the whole point.
    assert [record.id for record in FakeAdmin.store] == [1, 2]


@pytest.mark.parametrize("admin_id", [1, 2])
def test_deleting_is_gone_for_every_caller(admin_id):
    """Including a plain administrator, and including the caller's own row.

    Answered the same way for everybody: the method does not exist, and
    checking a role first would imply there is somebody it exists for.
    """

    response = signed_in(admins_app(), admin_id=admin_id).delete(f"/api/admins/{admin_id}")

    assert response.status_code == 405
    assert len(FakeAdmin.store) == 2


def test_a_plain_administrator_is_refused_before_the_account_is_looked_up():
    # A missing target must not tell a plain administrator anything.
    response = signed_in(admins_app(), admin_id=2).put(
        "/api/admins/99/permissions", json={"permissions": dict(ALL_ON)},
    )

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
# THE FIXED SET OF SUPERADMINS
# ==========================================

# There are four superadmins, named in public.superadmin_designation, and the
# portal cannot change which four. Promotion and demotion are gone, creating a
# superadmin is refused, and nothing here can set a designated account's status
# or permissions or remove it.
#
# Every refusal is checked for what it leaves behind as well as for its status
# code: the point of the policy is that the stored rows do not move, so a test
# that only read the response would not be testing it.

FIXED_CODE = "superadmin_set_fixed"

ROLE_FIXED_MESSAGE = (
    "The superadmin accounts are fixed. Promoting and demoting administrators "
    "is handled outside the portal."
)

CREATE_SUPERADMIN_MESSAGE = (
    "New accounts are administrators. The superadmin accounts are fixed and "
    "cannot be created here."
)

DESIGNATED_ACCOUNT_MESSAGE = (
    "This is a designated superadmin account. Its role and its access are "
    "managed outside the portal."
)


def role_of(admin_id):
    return next(item for item in FakeAdmin.store if item.id == admin_id).role


def status_of(admin_id):
    return next(item for item in FakeAdmin.store if item.id == admin_id).status


# A username and address that none of the five accounts above hold, for a
# create made from inside ``the_four``.
ANOTHER_ACCOUNT = {
    "username": "admin_new", "email": "admin_new@example.com", "password": "Another-secret1!",
}


def the_four():
    """A directory shaped like the policy: four designated superadmins.

    Accounts 1-4 are the designated set and 5 is a regular administrator, so a
    test can act as one of the four on an ordinary colleague as well as on a
    protected peer. The caller is account 1 unless a test says otherwise.
    """

    FakeAdmin.reset([
        FakeAdmin(id=1, username="admin01", password="x", gmail="a@example.com", role="superadmin"),
        FakeAdmin(id=2, username="admin02", password="x", gmail="b@example.com", role="superadmin"),
        FakeAdmin(id=3, username="admin03", password="x", gmail="c@example.com", role="superadmin"),
        FakeAdmin(id=4, username="admin04", password="x", gmail="d@example.com", role="superadmin"),
        FakeAdmin(id=5, username="admin05", password="x", gmail="e@example.com"),
    ])
    designate(1, 2, 3, 4)
    return signed_in(admins_app(), admin_id=1)


# ------------------------------------------------------------------
# The role route does not change anybody's role
# ------------------------------------------------------------------

@pytest.mark.parametrize("role", ["superadmin", "admin"])
def test_the_role_route_refuses_every_role_change(role, admin_directory):
    """Both directions, and nothing is written for either."""

    response = signed_in(admins_app(), admin_id=1).put("/api/admins/2/role", json={"role": role})

    assert response.status_code == 405
    assert response.json == {
        "success": False, "code": FIXED_CODE, "message": ROLE_FIXED_MESSAGE,
    }
    assert role_of(2) == "admin"
    assert admin_directory.committed is False


@pytest.mark.parametrize("admin_id", [1, 2, 99])
@pytest.mark.parametrize("confirmed", [True, False])
def test_the_role_route_answers_the_same_way_for_everything(admin_id, confirmed, admin_directory):
    """A plain administrator, a superadmin, the caller's own row, an id that
    does not exist, with and without a password confirmation.

    One answer for all of them. A 404 for a missing account would say that a
    real one would have worked; a 403 asking for a password would say that
    confirming it would help.
    """

    client = signed_in(admins_app(), admin_id=admin_id, confirmed=confirmed)

    response = client.put(f"/api/admins/{admin_id}/role", json={"role": "superadmin"})

    assert response.status_code == 405
    assert response.json["code"] == FIXED_CODE
    assert admin_directory.committed is False


def test_the_role_route_refuses_a_caller_who_is_not_signed_in():
    """Not 401: the operation does not exist, so there is nobody for whom
    signing in would make it exist."""

    response = admins_app().test_client().put("/api/admins/2/role", json={"role": "superadmin"})

    assert response.status_code == 405
    assert response.json["code"] == FIXED_CODE
    assert role_of(2) == "admin"


@pytest.mark.parametrize("body", [None, {}, {"role": None}, {"role": "owner"}, ["superadmin"], 42])
def test_the_role_route_does_not_read_its_body(body, admin_directory):
    """Every body gets the policy, not a field error: there is no body that
    this route would have accepted, so validating one would be theatre."""

    response = signed_in(admins_app(), admin_id=1).put("/api/admins/2/role", json=body)

    assert response.status_code == 405
    assert response.json["message"] == ROLE_FIXED_MESSAGE
    assert "fields" not in response.json


def test_the_role_route_takes_no_lock_and_writes_no_audit(monkeypatch, admin_directory):
    """It reads nothing at all, so a database that is down cannot change the
    answer and nothing is logged against an account that did not move."""

    audits = []
    monkeypatch.setattr(admins_module, "log_audit", lambda *args: audits.append(args))
    locked = []
    monkeypatch.setattr(FakeQuery, "with_for_update", lambda self: locked.append(self) or self)

    response = signed_in(admins_app(), admin_id=1).put("/api/admins/2/role", json={"role": "superadmin"})

    assert response.status_code == 405
    assert locked == []
    assert audits == []
    assert admin_directory.committed is False


def test_a_designated_superadmin_cannot_be_demoted_either(admin_directory):
    """The same 405. The route is gone for the four as well, not refused for
    them - there is no account for which it is the right answer."""

    client = the_four()

    response = client.put("/api/admins/2/role", json={"role": "admin"})

    assert response.status_code == 405
    assert response.json["code"] == FIXED_CODE
    assert role_of(2) == "superadmin"
    assert admin_directory.committed is False


# ------------------------------------------------------------------
# Creating a superadmin
# ------------------------------------------------------------------

def test_creating_a_superadmin_is_refused(admin_directory):
    """Refused, not quietly downgraded: the caller asked for an account with
    Backup & Recovery and everybody else's account, and a regular
    administrator under the same username is a different account."""

    response = signed_in(admins_app()).post("/api/admins", json={**NEW_ACCOUNT, "role": "superadmin"})

    assert response.status_code == 409
    assert response.json["code"] == FIXED_CODE
    assert response.json["message"] == CREATE_SUPERADMIN_MESSAGE
    # Against the field the form holds, so a client that does know the policy
    # can still show it where the role was chosen.
    assert response.json["fields"] == {"role": CREATE_SUPERADMIN_MESSAGE}
    assert created_accounts() == []
    assert admin_directory.committed is False


def test_the_refusal_reads_the_role_the_way_the_route_always_did():
    """So " SuperAdmin " is the policy and not a typo."""

    response = signed_in(admins_app()).post("/api/admins", json={**NEW_ACCOUNT, "role": " SuperAdmin "})

    assert response.status_code == 409
    assert response.json["code"] == FIXED_CODE
    assert created_accounts() == []


def test_creating_a_superadmin_is_refused_before_a_password_is_asked_for():
    """Nobody confirms a password for an answer that was always no."""

    response = signed_in(admins_app(), confirmed=False).post(
        "/api/admins", json={**NEW_ACCOUNT, "role": "superadmin"},
    )

    assert response.status_code == 409
    assert response.json["code"] == FIXED_CODE


def test_a_plain_administrator_is_still_refused_for_being_one(admin_directory):
    """The role check comes first, so a caller who may not create accounts at
    all is not told about the superadmin policy instead."""

    response = signed_in(admins_app(), admin_id=2, confirmed=False).post(
        "/api/admins", json={**NEW_ACCOUNT, "role": "superadmin"},
    )

    assert response.status_code == 403
    assert response.json["code"] == "superadmin_required"
    assert created_accounts() == []


def test_an_invalid_role_is_still_a_field_error():
    """A typo and the policy are different answers: one is a bad request, the
    other is a request the server understood and will not do."""

    response = signed_in(admins_app()).post("/api/admins", json={**NEW_ACCOUNT, "role": "owner"})

    assert response.status_code == 400
    assert response.json["fields"] == {"role": "Role must be Administrator."}
    assert "code" not in response.json
    assert created_accounts() == []


def test_the_details_are_still_validated_before_the_policy():
    """An incomplete body is reported as incomplete. Otherwise a client would
    fix the role, resend, and only then hear about the email."""

    response = signed_in(admins_app()).post("/api/admins", json={
        **NEW_ACCOUNT, "email": "nope", "role": "superadmin",
    })

    assert response.status_code == 400
    assert "email" in response.json["fields"]


@pytest.mark.parametrize("role", [None, "admin", " Admin "])
def test_every_other_create_still_makes_a_regular_administrator(role, admin_directory):
    """Omitted, null and "admin" all land on the same account."""

    body = dict(NEW_ACCOUNT) if role is None else {**NEW_ACCOUNT, "role": role}

    response = signed_in(admins_app()).post("/api/admins", json=body)

    assert response.status_code == 201
    assert response.json["admin"]["role"] == "admin"
    assert response.json["admin"]["isProtected"] is False
    assert [record.role for record in created_accounts()] == ["admin"]


def test_an_explicit_null_role_still_makes_an_administrator():
    response = signed_in(admins_app()).post("/api/admins", json={**NEW_ACCOUNT, "role": None})

    assert response.status_code == 201
    assert response.json["admin"]["role"] == "admin"


# ------------------------------------------------------------------
# A designated account's status is not the portal's to set
# ------------------------------------------------------------------

@pytest.mark.parametrize("status", ["Inactive", "Active"])
def test_a_designated_superadmin_s_status_cannot_be_set(status, admin_directory):
    """Both directions. Containing a compromised account deactivates it
    outside the portal; if the portal could switch it back on, the containment
    would last until whoever took the account found the button."""

    client = the_four()

    response = client.put("/api/admins/2/status", json={"status": status})

    assert response.status_code == 409
    assert response.json["code"] == FIXED_CODE
    assert response.json["message"] == DESIGNATED_ACCOUNT_MESSAGE
    assert status_of(2) == "active"
    assert admin_directory.committed is False


def test_a_designated_account_that_has_been_contained_stays_contained():
    """Deactivated outside the portal, and the portal will not undo it."""

    client = the_four()
    next(item for item in FakeAdmin.store if item.id == 2).status = "inactive"

    response = client.put("/api/admins/2/status", json={"status": "Active"})

    assert response.status_code == 409
    assert response.json["code"] == FIXED_CODE
    assert status_of(2) == "inactive"


@pytest.mark.parametrize("body", [None, {}, {"status": "Deleted"}, {"status": None}, [1]])
def test_the_protection_is_answered_before_the_status_body(body, admin_directory):
    """The refusal is about the account, not about what was asked for, so
    there is no body - valid or not - that gets a different answer. No portal
    request against one of the four is ever reported as having done anything.
    """

    client = the_four()

    response = client.put("/api/admins/2/status", json=body)

    assert response.status_code == 409
    assert response.json["code"] == FIXED_CODE
    assert admin_directory.committed is False


def test_setting_a_designated_account_to_the_status_it_already_has_is_refused(admin_directory):
    """Not the usual "already active" 200: that reads as a request that
    worked, and no request against one of the four does."""

    client = the_four()

    response = client.put("/api/admins/2/status", json={"status": "Active"})

    assert response.status_code == 409
    assert response.json["code"] == FIXED_CODE


def test_a_designated_account_cannot_deactivate_itself_either():
    """The self rule and the designation both refuse it; the designation is
    the one that answers, because it is the reason that will not change."""

    client = the_four()

    response = client.put("/api/admins/1/status", json={"status": "Inactive"})

    assert response.status_code == 409
    assert response.json["code"] == FIXED_CODE
    assert status_of(1) == "active"


def test_an_ordinary_administrator_is_still_deactivated_by_the_four(admin_directory):
    """The protection is for the four accounts, not for the directory: a
    superadmin's ordinary work on a colleague is untouched."""

    client = the_four()

    response = client.put("/api/admins/5/status", json={"status": "Inactive"})

    assert response.status_code == 200
    assert status_of(5) == "inactive"
    assert admin_directory.committed is True


def test_a_designated_account_s_permissions_cannot_be_configured(admin_directory):
    """Refused for being designated rather than for being a superadmin, so
    the frontend gets the code it can act on."""

    client = the_four()

    response = client.put("/api/admins/2/permissions", json={"permissions": dict(ALL_ON)})

    assert response.status_code == 409
    assert response.json["code"] == FIXED_CODE
    assert response.json["message"] == DESIGNATED_ACCOUNT_MESSAGE
    assert admin_directory.committed is False


def test_an_undesignated_superadmin_is_still_refused_for_being_one(admin_directory):
    """Which is every superadmin until the migration is applied. Their
    switches are still not configurable - the role carries everything."""

    response = signed_in(admins_app(), admin_id=2).put(
        "/api/admins/1/permissions", json={"permissions": dict(ALL_ON)},
    )
    # Account 2 is a plain administrator, so it is refused for that first.
    assert response.status_code == 403

    FakeAdmin.store.append(FakeAdmin(id=3, username="admin03", password="x", gmail="c@example.com", role="superadmin"))
    response = signed_in(admins_app(), admin_id=1).put(
        "/api/admins/3/permissions", json={"permissions": dict(ALL_ON)},
    )

    assert response.status_code == 409
    assert response.json["message"] == (
        "Superadmins always have every permission, so there is nothing to restrict."
    )
    assert "code" not in response.json


def test_a_designated_account_cannot_be_deleted():
    """Through the route that is gone for everybody, which is the stronger
    form of the protection: nothing can address a delete at one of the four."""

    client = the_four()

    response = client.delete("/api/admins/2")

    assert response.status_code == 405
    assert [record.id for record in FakeAdmin.store] == [1, 2, 3, 4, 5]


# ------------------------------------------------------------------
# What the listing tells the frontend
# ------------------------------------------------------------------

def test_the_listing_marks_the_designated_accounts():
    client = the_four()

    items = {item["username"]: item["isProtected"] for item in client.get("/api/admins").json["items"]}

    assert items == {
        "admin01": True, "admin02": True, "admin03": True, "admin04": True, "admin05": False,
    }


def test_the_listing_still_carries_the_role_of_a_protected_account():
    """Hidden actions, visible label: a reader has to be able to see who the
    superadmins are, and #167's explanation hangs off the role, not off the
    protection alone."""

    client = the_four()

    roles = {item["username"]: item["role"] for item in client.get("/api/admins").json["items"]}

    assert roles == {
        "admin01": "superadmin", "admin02": "superadmin", "admin03": "superadmin",
        "admin04": "superadmin", "admin05": "admin",
    }


def test_nothing_is_marked_protected_before_the_migration():
    """An empty designation table is "nobody is designated", and the existing
    rules are then the only ones in force - not "everybody is protected"."""

    items = signed_in(admins_app()).get("/api/admins").json["items"]

    assert all(item["isProtected"] is False for item in items)


def test_a_plain_administrator_sees_the_same_marks():
    """The directory is already readable by every active administrator, and
    which accounts are the fixed four is not a secret from a colleague."""

    the_four()

    items = signed_in(admins_app(), admin_id=5).get("/api/admins").json["items"]

    assert [item["isProtected"] for item in items] == [True, True, True, True, False]


def test_a_protected_account_keeps_its_mark_through_a_self_edit():
    """The response's ``admin`` object is merged into the row the client holds,
    so one that reported the caller unprotected would undo the flag."""

    the_four()
    client = signed_in(admins_app(), admin_id=2)

    response = client.put("/api/admins/2", json={
        "username": "admin02", "email": "admin02@example.com",
    })

    assert response.status_code == 200
    assert response.json["admin"]["isProtected"] is True
    assert response.json["admin"]["role"] == "superadmin"


def test_the_full_shape_of_a_listed_account():
    """Every key the contract carries, so a field cannot be dropped or
    renamed without a test saying so."""

    the_four()

    items = {item["username"]: item for item in signed_in(admins_app(), admin_id=5).get("/api/admins").json["items"]}

    assert items["admin05"] == {
        "id": "5", "username": "admin05", "email": "e@example.com",
        "status": "Active", "role": "admin", "isProtected": False,
        "isCurrent": True, "permissions": None,
    }
    assert items["admin02"] == {
        "id": "2", "username": "admin02", "email": "b@example.com",
        "status": "Active", "role": "superadmin", "isProtected": True,
        "isCurrent": False, "permissions": None,
    }


# ------------------------------------------------------------------
# A designated superadmin's own account still works
# ------------------------------------------------------------------

def test_one_of_the_four_still_edits_their_own_details():
    """What is protected is who holds the role, not the account's password.
    Otherwise the protection would be a reason to keep a stale one."""

    the_four()
    client = signed_in(admins_app(), admin_id=2)

    response = client.put("/api/admins/2", json={
        "username": "renamed", "email": "renamed@example.com", "password": "Another-secret1!",
    })

    assert response.status_code == 200
    record = next(item for item in FakeAdmin.store if item.id == 2)
    assert (record.username, record.gmail) == ("renamed", "renamed@example.com")
    assert verify_password(record.password, "Another-secret1!")[0]


def test_one_of_the_four_still_receives_a_reset_code(admin_directory):
    """The way a locked-out superadmin gets back in, and it goes to their own
    inbox. Protecting the account must not mean nobody can help them."""

    the_four()

    response = signed_in(admins_app(), admin_id=5).post("/api/admins/2/password-reset")

    assert response.status_code == 200
    assert admin_directory.reset_codes_sent == ["admin02"]


def test_one_of_the_four_still_creates_and_configures_administrators(admin_directory):
    """The role still means what it meant. Only who holds it is fixed."""

    client = the_four()

    created = client.post("/api/admins", json=ANOTHER_ACCOUNT)
    configured = client.put("/api/admins/5/permissions", json={"permissions": dict(ALL_ON)})

    assert (created.status_code, configured.status_code) == (201, 200)
    assert permissions_of(5) == ALL_ON


def test_the_role_check_on_the_next_request_still_reads_the_row():
    """Sessions after an access change: nothing caches the role, so an account
    deactivated outside the portal is refused on its next request rather than
    at its next sign-in."""

    client = the_four()
    assert client.post("/api/admins", json=ANOTHER_ACCOUNT).status_code == 201

    # Same session cookie; only the stored row changed, as a containment
    # procedure run against the database would change it.
    next(item for item in FakeAdmin.store if item.id == 1).status = "inactive"
    response = client.post("/api/admins", json={
        **ANOTHER_ACCOUNT, "username": "admin_other", "email": "other@example.com",
    })

    assert response.status_code == 401
    assert not any(record.username == "admin_other" for record in FakeAdmin.store)


# Zero active superadmins. Deactivation is the only way left to take a
# superadmin's access away, and a real caller is an active superadmin who
# cannot target themselves, so the caller always remains and these rules are
# reached only with the guards skipped and a caller who is not in the
# directory.
#
# This rule survives the fixed set because the two answer for different rows. A
# designated account is refused whatever it would leave behind; this one
# protects an *undesignated* superadmin, which is what every superadmin row
# looks like on a deployment that has the new build and not yet the migration.

LAST_SUPERADMIN_MESSAGE = "At least one active superadmin is required."


@pytest.fixture
def lone_superadmin(guards_passed):
    """One active superadmin (1), an administrator (2) and a caller (2) who acts on 1."""
    FakeAdmin.reset([
        FakeAdmin(id=1, username="admin01", password="x", gmail="a@example.com", role="superadmin"),
        FakeAdmin(id=2, username="admin02", password="x", gmail="b@example.com"),
        FakeAdmin(id=3, username="admin03", password="x", gmail="c@example.com"),
    ])
    return signed_in(admins_app(), admin_id=2)


def test_deactivating_the_last_active_superadmin_is_refused(lone_superadmin, admin_directory):
    response = lone_superadmin.put("/api/admins/1/status", json={"status": "Inactive"})

    assert response.status_code == 409
    assert response.json["message"] == LAST_SUPERADMIN_MESSAGE
    assert next(item for item in FakeAdmin.store if item.id == 1).status == "active"
    assert admin_directory.committed is False


def test_a_deactivated_superadmin_does_not_count_as_active(lone_superadmin):
    FakeAdmin.store.append(FakeAdmin(
        id=4, username="admin04", password="x", gmail="d@example.com", role="superadmin", status="inactive",
    ))

    assert lone_superadmin.put("/api/admins/1/status", json={"status": "Inactive"}).json["message"] == LAST_SUPERADMIN_MESSAGE


def test_another_active_superadmin_lets_the_deactivation_through(lone_superadmin):
    FakeAdmin.store.append(FakeAdmin(id=4, username="admin04", password="x", gmail="d@example.com", role="superadmin"))

    assert lone_superadmin.put("/api/admins/1/status", json={"status": "Inactive"}).status_code == 200
    assert lone_superadmin.put("/api/admins/1/status", json={"status": "Active"}).status_code == 200


def test_deactivating_an_account_that_is_not_an_active_superadmin_ignores_the_rule(lone_superadmin):
    # Account 3 is a plain administrator, so none of this touches the count.
    assert lone_superadmin.put("/api/admins/3/status", json={"status": "Inactive"}).status_code == 200
    assert lone_superadmin.put(
        "/api/admins/3/permissions", json={"permissions": dict(ALL_OFF)},
    ).status_code == 200


def test_the_rule_does_not_protect_a_superadmin_that_is_already_deactivated(lone_superadmin):
    """Nor does it stop one being reactivated, which is the only way an
    undesignated superadmin's access comes back now that promotion is gone."""

    FakeAdmin.store.append(FakeAdmin(
        id=4, username="admin04", password="x", gmail="d@example.com", role="superadmin", status="inactive",
    ))

    assert lone_superadmin.put("/api/admins/4/status", json={"status": "Inactive"}).status_code == 200
    assert lone_superadmin.put("/api/admins/4/status", json={"status": "Active"}).status_code == 200


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


# The only way one superadmin can strip another's access now that removal and
# demotion are both gone. Setting permissions is not one: it refuses a
# superadmin target. Deactivating a *designated* superadmin is refused too, so
# this is reachable only between two undesignated ones - which is what the
# whole directory looks like before the migration, and the window this still
# has to hold through.
PEER_REQUESTS = {
    "deactivate": lambda client, target: client.put(f"/api/admins/{target}/status", json={"status": "Inactive"}),
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


def test_a_superadmin_reactivated_mid_request_cannot_leave_the_directory_empty(monkeypatch):
    """Account 1 is the only active superadmin and deactivates account 2, an
    inactive superadmin that does not count towards the rule yet. While that
    request is in flight, 2 is reactivated and then tries to deactivate 1.

    Reactivation is the only write left that can hand superadmin access back,
    so it is the one that has to queue behind the request already deciding
    from the directory.
    """

    target = FakeAdmin.store[1]
    target.role, target.status = "superadmin", "inactive"
    # A third account, so deactivating the target is not also the last active
    # administrator - that rule answers first and this one would never run.
    FakeAdmin.store.append(FakeAdmin(id=3, username="admin03", password="x", gmail="c@example.com"))
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
    initial, initial_outcome = _start(
        lambda client: PEER_REQUESTS["deactivate"](client, 2), signed_in(app, admin_id=1),
    )
    assert in_check.wait(timeout=5)
    enabling, enabled = _start(
        lambda client: client.put("/api/admins/2/status", json={"status": "Active"}),
        signed_in(app, admin_id=1),
    )
    enabling.join(timeout=0.3)
    waiting = enabling.is_alive()
    relinquishing, relinquished = _start(
        lambda client: client.put("/api/admins/1/status", json={"status": "Inactive"}),
        signed_in(app, admin_id=2),
    )
    relinquishing.join(timeout=0.3)
    proceed.set()
    for thread in (initial, enabling, relinquishing):
        thread.join(timeout=5)

    assert active_superadmins(), "the in-flight request removed the last active superadmin"
    assert initial_outcome["response"].status_code == 200
    # Account 2 was still inactive when its own request was judged.
    assert relinquished["response"].status_code in (401, 403)
    # Reactivating the target is a write too, so it waits behind the request in flight.
    assert waiting
    assert enabled["response"].status_code == 200


def test_a_designation_committed_mid_request_refuses_the_deactivation(monkeypatch):
    """The concurrency case the fixed set adds: account 2 becomes one of the
    four while a request to deactivate it is between the guard and the lock.

    The refusal proves the designated set is read *under* the lock rather than
    before it. Read any earlier, this request would have seen an unprotected
    account and deactivated one of the four.
    """

    FakeAdmin.store[1].role = "superadmin"
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
    pending, outcome = _start(
        lambda client: client.put("/api/admins/2/status", json={"status": "Inactive"}),
        signed_in(app, admin_id=1),
    )
    assert past_guard.wait(timeout=5)
    # The transfer procedure commits, as it would against the live database.
    designate(1, 2)
    proceed.set()
    pending.join(timeout=5)

    response = outcome["response"]
    assert response.status_code == 409
    assert response.json["code"] == FIXED_CODE
    assert status_of(2) == "active"


STALE_CALLER_REQUESTS = {
    "deactivate": lambda client: client.put("/api/admins/3/status", json={"status": "Inactive"}),
    "permissions": lambda client: client.put("/api/admins/3/permissions", json={"permissions": dict(ALL_ON)}),
}


@pytest.mark.parametrize("operation", sorted(STALE_CALLER_REQUESTS))
def test_a_caller_deactivated_between_the_guard_and_the_lock_is_refused(monkeypatch, operation):
    """Deactivation rather than demotion, which is gone: the caller loses its
    superadmin access while its own request waits for the lock, and is judged
    again from the rows the lock returns."""

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
    stripped = signed_in(app, admin_id=1).put("/api/admins/2/status", json={"status": "Inactive"})
    assert stripped.status_code == 200
    proceed.set()
    stale.join(timeout=5)

    response = outcome["response"]
    # 401 for a deactivated caller, which is how that session ends; what this
    # tests is that the stale caller is judged again and not served.
    assert response.status_code in (401, 403)
    account = next(item for item in FakeAdmin.store if item.id == 3)
    assert (account.role, account.status) == ("admin", "active")


LOCKING_REQUESTS = {
    "status": lambda client, target: client.put(f"/api/admins/{target}/status", json={"status": "Inactive"}),
    "permissions": lambda client, target: client.put(
        f"/api/admins/{target}/permissions", json={"permissions": dict(ALL_ON)},
    ),
}


@pytest.mark.parametrize("target", [2, 1, 99], ids=["a plain administrator", "the caller", "a missing account"])
@pytest.mark.parametrize("operation", sorted(LOCKING_REQUESTS))
def test_every_status_and_permission_request_locks_the_whole_directory_first(monkeypatch, operation, target):
    designate(1)
    locked = []
    original = FakeQuery._matching

    def recording(self):
        if self._locking:
            locked.append(self)
        return original(self)

    monkeypatch.setattr(FakeQuery, "_matching", recording)

    LOCKING_REQUESTS[operation](signed_in(admins_app(), admin_id=1), target)

    # Two locks over every row of each table, taken whatever the request goes
    # on to decide: the administrators first, then the designated set, in the
    # order the transfer procedure takes them.
    assert len(locked) == 2
    assert [read._filters for read in locked] == [[], []]
    assert [len(read.store) for read in locked] == [2, 1]
    # And neither outlives the request, whether it wrote or was refused.
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
    assert client.put("/api/admins/1/permissions", json={"permissions": dict(ALL_ON)}).json["message"] == (
        "You cannot change your own permissions."
    )


# ==========================================
# PERMISSIONS
# ==========================================

def permissions_of(admin_id):
    return next(item for item in FakeAdmin.store if item.id == admin_id).permissions


def set_permissions(client, target, permissions):
    return client.put(f"/api/admins/{target}/permissions", json={"permissions": permissions})


def test_the_listing_carries_each_accounts_permissions():
    FakeAdmin.store[1].permissions = {"add": True, "edit": True, "delete": False, "changeUserStatus": False}

    items = {item["username"]: item["permissions"] for item in signed_in(admins_app()).get("/api/admins").json["items"]}

    assert items["admin02"] == {"add": True, "edit": True, "delete": False, "changeUserStatus": False}
    # A superadmin's are not configurable, so there is nothing to report.
    assert items["admin01"] is None


def test_an_unconfigured_administrator_is_listed_with_none():
    """Which the frontend reads as full access - the pre-migration state."""

    items = {item["username"]: item["permissions"] for item in signed_in(admins_app()).get("/api/admins").json["items"]}

    assert items["admin02"] is None


def test_a_superadmin_sets_another_administrators_permissions(admin_directory):
    response = set_permissions(signed_in(admins_app()), 2, {
        "add": True, "edit": True, "delete": False, "changeUserStatus": False,
    })

    assert response.status_code == 200
    assert response.json["success"] is True
    assert response.json["message"] == "Permissions updated for admin02."
    assert response.json["admin"]["permissions"] == {
        "add": True, "edit": True, "delete": False, "changeUserStatus": False,
    }
    assert permissions_of(2) == {"add": True, "edit": True, "delete": False, "changeUserStatus": False}
    assert admin_directory.committed is True


def test_setting_permissions_is_audited_as_what_moved(monkeypatch, admin_directory):
    audits = []
    monkeypatch.setattr(admins_module, "log_audit", lambda *args: audits.append(args))
    FakeAdmin.store[1].permissions = dict(ALL_ON)

    set_permissions(signed_in(admins_app()), 2, {**ALL_ON, "delete": False, "add": False})

    category, actor, action, target, target_id, detail = audits[-1]
    assert (action, target, target_id) == ("update permissions", "Administrator", 2)
    # Only the switches that changed, so the row says what somebody did.
    assert detail == "admin02: add: on -> off; delete: on -> off"


def test_setting_the_permissions_an_account_already_has_says_so(monkeypatch):
    audits = []
    monkeypatch.setattr(admins_module, "log_audit", lambda *args: audits.append(args))
    FakeAdmin.store[1].permissions = dict(ALL_OFF)

    response = set_permissions(signed_in(admins_app()), 2, dict(ALL_OFF))

    assert response.status_code == 200
    assert audits[-1][-1] == "admin02: no change"


def test_configuring_an_unrestricted_account_lands_on_what_was_asked_for():
    """None is full access, so the first configuration is a change from all on."""

    FakeAdmin.store[1].permissions = None

    response = set_permissions(signed_in(admins_app()), 2, dict(ALL_OFF))

    assert response.status_code == 200
    assert permissions_of(2) == ALL_OFF


@pytest.mark.parametrize("permissions", [
    {},
    {"add": True},
    {"add": True, "edit": True, "delete": True},
    {"add": True, "edit": True, "delete": True, "changeUserStatus": "yes"},
    {"add": 1, "edit": 0, "delete": 0, "changeUserStatus": 0},
    {"add": None, "edit": None, "delete": None, "changeUserStatus": None},
    "everything",
    ["add"],
    42,
])
def test_a_partial_or_mistyped_set_is_a_field_error(permissions, admin_directory):
    """All four, every time: a body that names two leaves the other two to
    whatever the reader assumes."""

    response = set_permissions(signed_in(admins_app()), 2, permissions)

    assert response.status_code == 400
    assert response.json["fields"] == {
        "permissions": "Each of the four permissions must be given as true or false."
    }
    assert permissions_of(2) is None
    assert admin_directory.committed is False


@pytest.mark.parametrize("body", [{}, {"permissions": None}, ["add"]])
def test_a_permissions_body_must_carry_the_switches(body, admin_directory):
    response = signed_in(admins_app()).put("/api/admins/2/permissions", json=body)

    assert response.status_code == 400
    assert "permissions" in response.json["fields"]
    assert admin_directory.committed is False


def test_an_account_cannot_change_its_own_permissions(admin_directory):
    """Nobody grants themselves anything, as with their own role."""

    response = set_permissions(signed_in(admins_app(), admin_id=1), 1, dict(ALL_ON))

    assert response.status_code == 409
    assert response.json["message"] == "You cannot change your own permissions."
    assert admin_directory.committed is False


def test_a_superadmins_permissions_cannot_be_configured(admin_directory):
    FakeAdmin.store[1].role = "superadmin"

    response = set_permissions(signed_in(admins_app(), admin_id=1), 2, dict(ALL_OFF))

    assert response.status_code == 409
    assert response.json["message"] == (
        "Superadmins always have every permission, so there is nothing to restrict."
    )
    assert permissions_of(2) is None
    assert admin_directory.committed is False


def test_the_permissions_of_a_missing_administrator_are_not_found():
    response = set_permissions(signed_in(admins_app()), 99, dict(ALL_ON))

    assert response.status_code == 404
    assert response.json["message"] == "Administrator not found."


def test_setting_permissions_refuses_a_plain_administrator(admin_directory):
    response = set_permissions(signed_in(admins_app(), admin_id=2), 1, dict(ALL_ON))

    assert response.status_code == 403
    assert response.json["code"] == "superadmin_required"
    assert admin_directory.committed is False


def test_setting_permissions_requires_a_signed_in_account():
    response = admins_app().test_client().put("/api/admins/2/permissions", json={"permissions": dict(ALL_ON)})

    assert response.status_code == 401


def test_setting_permissions_requires_a_recent_password_confirmation():
    client = signed_in(admins_app(), confirmed=False)
    with client.session_transaction() as flask_session:
        flask_session["reauth_at"] = time.time() - auth_module.REAUTH_MAX_AGE_SECONDS - 1

    response = set_permissions(client, 2, dict(ALL_ON))

    assert response.status_code == 403
    assert response.json["code"] == "password_confirmation_required"
    assert permissions_of(2) is None


def test_a_failed_permission_write_releases_the_lock(admin_directory, monkeypatch):
    def broken_commit():
        raise RuntimeError("database offline")

    monkeypatch.setattr(admin_directory, "commit", broken_commit)

    response = set_permissions(signed_in(admins_app()), 2, dict(ALL_ON))

    assert response.status_code == 500
    assert response.json["message"] == "Failed to update the administrator's permissions."
    assert admin_directory.rolled_back is True
    assert FakeAdmin._lock_owner is None


# ==========================================
# PERMISSIONS ON CREATE
# ==========================================

# There is no longer a demotion to land on a set of switches, nor a promotion
# to discard one: creating the account is the only place a request names them
# besides the permissions route itself.

def test_a_new_administrator_starts_with_nothing(admin_directory):
    """Not everything: an account being set up has not been given anything."""

    response = signed_in(admins_app()).post("/api/admins", json=NEW_ACCOUNT)

    assert response.status_code == 201
    assert response.json["admin"]["permissions"] == ALL_OFF
    assert created_accounts()[0].permissions == ALL_OFF


def test_a_new_administrator_can_be_created_with_permissions():
    response = signed_in(admins_app()).post("/api/admins", json={
        **NEW_ACCOUNT,
        "permissions": {"add": True, "edit": True, "delete": False, "changeUserStatus": False},
    })

    assert response.status_code == 201
    assert created_accounts()[0].permissions == {
        "add": True, "edit": True, "delete": False, "changeUserStatus": False,
    }


def test_a_superadmin_cannot_be_created_with_permissions_either():
    """The policy answers first. There is no body that creates a superadmin,
    so a well-formed set of switches does not make one."""

    response = signed_in(admins_app()).post("/api/admins", json={
        **NEW_ACCOUNT, "role": "superadmin", "permissions": dict(ALL_ON),
    })

    assert response.status_code == 409
    assert response.json["code"] == FIXED_CODE
    assert created_accounts() == []


def test_creating_with_a_partial_set_is_a_field_error(admin_directory):
    response = signed_in(admins_app()).post("/api/admins", json={
        **NEW_ACCOUNT, "permissions": {"add": True},
    })

    assert response.status_code == 400
    assert "permissions" in response.json["fields"]
    assert created_accounts() == []


# ==========================================
# A SUPPLIED NULL IS A VALUE, NOT AN OMISSION
# ==========================================

def test_creating_with_an_explicit_null_permissions_is_a_field_error(admin_directory):
    """Absent means "default"; present-and-null is a value the caller chose.

    The one shape a supplied value may take is the four booleans, so null is
    refused like any other wrong shape. Reading the two the same way meant a
    client asking for "no permissions" silently received the view-only default
    instead of being told its request made no sense (issue #145).
    """

    response = signed_in(admins_app()).post("/api/admins", json={**NEW_ACCOUNT, "permissions": None})

    assert response.status_code == 400
    assert response.json["fields"] == {
        "permissions": "Each of the four permissions must be given as true or false."
    }
    assert created_accounts() == []
    assert admin_directory.committed is False


def test_omitting_permissions_still_defaults_on_create(admin_directory):
    """The other half of the same rule, which must not change: an account being
    set up has not been given anything yet."""

    response = signed_in(admins_app()).post("/api/admins", json=NEW_ACCOUNT)

    assert response.status_code == 201
    assert created_accounts()[0].permissions == ALL_OFF


def test_asking_for_a_superadmin_with_an_explicit_null_is_still_the_policy():
    """A null is a wrong shape and the role is refused by policy; the policy
    answers, because it is the part that will not change by fixing the body."""

    response = signed_in(admins_app()).post("/api/admins", json={
        **NEW_ACCOUNT, "role": "superadmin", "permissions": None,
    })

    assert response.status_code == 409
    assert response.json["code"] == FIXED_CODE
    assert created_accounts() == []


def test_setting_permissions_to_an_explicit_null_is_still_a_field_error(admin_directory):
    """This route always refused it, and the create path agrees."""

    response = signed_in(admins_app()).put("/api/admins/2/permissions", json={"permissions": None})

    assert response.status_code == 400
    assert "permissions" in response.json["fields"]
    assert permissions_of(2) is None


@pytest.mark.parametrize("supplied", [None, "everything", 42, ["add"], {}, {"add": True}])
def test_every_wrong_shape_is_refused_the_same_way_on_create(supplied, admin_directory):
    """One answer for every value that is not the four booleans, so a client
    cannot tell which kind of wrong it was - and null is simply one of them."""

    response = signed_in(admins_app()).post("/api/admins", json={
        **NEW_ACCOUNT, "permissions": supplied,
    })

    assert response.status_code == 400
    assert response.json["fields"] == {
        "permissions": "Each of the four permissions must be given as true or false."
    }
    assert created_accounts() == []


# ==========================================
# THE SHARED EMAIL POOL
# ==========================================

@pytest.mark.parametrize("held_as", ("gmail", "alternative_email"))
def test_creating_refuses_an_address_another_account_holds(held_as):
    """Primary and alternative are one pool: either column takes the address."""

    setattr(FakeAdmin.store[1], held_as, "shared@example.com")
    client = signed_in(admins_app())

    response = client.post("/api/admins", json={
        # Different case, because the pool is compared case-insensitively.
        "username": "admin03", "email": "SHARED@example.com",
        "password": "Another-secret1!",
    })

    assert response.status_code == 409
    assert response.json["message"] == "That email address is already in use"
    assert response.json["fields"] == {"email": "That email address is already in use"}
    assert not any(record.username == "admin03" for record in FakeAdmin.store)


def test_the_conflict_never_names_the_account_that_holds_the_address():
    """One administrator does not get to read another's recovery addresses."""

    FakeAdmin.store[1].alternative_email = "admin02.home@example.com"
    client = signed_in(admins_app())

    response = client.post("/api/admins", json={
        "username": "admin03", "email": "admin02.home@example.com",
        "password": "Another-secret1!",
    })

    text = response.get_data(as_text=True)
    assert response.status_code == 409
    assert "admin02" not in text


def test_a_free_address_is_still_accepted():
    client = signed_in(admins_app())

    response = client.post("/api/admins", json={
        "username": "admin03", "email": "admin03@example.com",
        "password": "Another-secret1!",
    })

    assert response.status_code == 201


def test_no_response_carries_anyone_s_alternative_email():
    """The field belongs to My Profile. It is a recovery address, and this
    listing is readable by every active administrator."""

    FakeAdmin.store[0].alternative_email = "admin01.home@example.com"
    FakeAdmin.store[1].alternative_email = "admin02.home@example.com"
    client = signed_in(admins_app())

    listing = client.get("/api/admins")
    created = client.post("/api/admins", json={
        "username": "admin03", "email": "admin03@example.com",
        "password": "Another-secret1!",
    })

    for response in (listing, created):
        text = response.get_data(as_text=True)
        assert "alternativeEmail" not in text
        assert "home@example.com" not in text


def test_self_editing_refuses_an_address_another_account_holds():
    FakeAdmin.store[1].alternative_email = "admin02.home@example.com"
    client = signed_in(admins_app())

    response = client.put("/api/admins/1", json={
        "username": "admin01", "email": "admin02.home@example.com",
    })

    assert response.status_code == 409
    assert response.json["fields"] == {"email": "That email address is already in use"}
    assert FakeAdmin.store[0].gmail == "admin01@example.com"


def test_self_editing_keeps_an_address_that_is_already_a_duplicate():
    """Issue #108: accounts predate the pool and share addresses today, so the
    rule applies to the value a request changes, not to one it leaves alone."""

    FakeAdmin.store[1].gmail = "admin01@example.com"
    client = signed_in(admins_app())

    response = client.put("/api/admins/1", json={
        "username": "admin_renamed", "email": "admin01@example.com",
    })

    assert response.status_code == 200
    assert FakeAdmin.store[0].username == "admin_renamed"


def test_two_accounts_cannot_claim_one_unused_email_at_the_same_time(admin_directory):
    """Both requests check the shared pool before either commits; only one may
    end up holding the address."""

    app = admins_app()
    original = admins_module.email_taken
    other_checked = threading.Event()
    responses = {}
    first_call = threading.Lock()

    def create(name):
        responses[name] = signed_in(app).post("/api/admins", json={
            "username": name, "email": "shared@example.com", "password": "Another-secret1!",
        })

    def email_taken_while_another_claims(email, excluding_id=None):
        taken = original(email, excluding_id=excluding_id)
        if first_call.acquire(blocking=False):
            other = threading.Thread(target=create, args=("admin04",))
            other.start()
            # Gives the other request every chance to check and commit in this
            # gap; if a lock keeps it out, the wait simply times out.
            other_checked.wait(0.5)
            responses["other_thread"] = other
        else:
            other_checked.set()
        return taken

    admins_module.email_taken = email_taken_while_another_claims
    try:
        create("admin03")
        responses["other_thread"].join(5)
    finally:
        admins_module.email_taken = original

    holders = [record.username for record in FakeAdmin.store if record.gmail == "shared@example.com"]
    assert len(holders) == 1
    assert sorted(response.status_code for name, response in responses.items() if name != "other_thread") == [201, 409]


def test_an_update_made_from_a_stale_account_is_refused(admin_directory):
    """Admin 1 changes only the case of its address, from a snapshot taken
    before another request moved it and a new account took the old one."""

    app = admins_app()
    client = signed_in(app)
    real_lock = admins_module.identity_claim_lock
    others = {}

    class LockWithAGap:
        first = True

        def __enter__(self):
            if LockWithAGap.first:
                LockWithAGap.first = False
                others["moved"] = signed_in(app).put("/api/admins/1", json={
                    "username": "admin01", "email": "moved@example.com"})
                others["taken"] = signed_in(app).post("/api/admins", json={
                    "username": "admin03", "email": "admin01@example.com",
                    "password": "Another-secret1!"})
            return real_lock.__enter__()

        def __exit__(self, *details):
            return real_lock.__exit__(*details)

    admins_module.identity_claim_lock = LockWithAGap()
    try:
        stale = client.put("/api/admins/1", json={"username": "admin01", "email": "ADMIN01@example.com"})
    finally:
        admins_module.identity_claim_lock = real_lock

    assert others["moved"].status_code == 200
    assert others["taken"].status_code == 201
    assert stale.status_code == 409
    holders = [record.username for record in FakeAdmin.store
               if (record.gmail or "").lower() == "admin01@example.com"]
    assert holders == ["admin03"]
