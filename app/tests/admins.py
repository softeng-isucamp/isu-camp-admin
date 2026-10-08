from flask import Flask
import pytest

import admins as admins_module
from admins import admins_bp


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

    def _matching(self):
        return [record for record in self.store if all(check(record) for check in self._filters)]

    def all(self):
        return list(self._matching())

    def first(self):
        matches = self._matching()
        return matches[0] if matches else None

    def count(self):
        return len(self._matching())


class FakeColumn:
    """Enough of a SQLAlchemy column for `Admin.username.asc()` to resolve."""

    def asc(self):
        return self

    def desc(self):
        return self


class FakeAdmin:
    store = []
    # Shadowed by the instance attribute on every record.
    username = FakeColumn()

    def __init__(self, username=None, password=None, gmail=None, id=None):
        self.id = id
        self.username = username
        self.password = password
        self.gmail = gmail

    @classmethod
    def reset(cls, records):
        cls.store = list(records)

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

    def rollback(self):
        self.rolled_back = True


def admins_app():
    app = Flask(__name__)
    app.config["SECRET_KEY"] = "test-secret"
    app.register_blueprint(admins_bp)
    return app


def signed_in(app, admin_id=1):
    client = app.test_client()
    with client.session_transaction() as flask_session:
        flask_session["admin_id"] = admin_id
        flask_session["admin_username"] = "admin01"
    return client


@pytest.fixture(autouse=True)
def admin_directory(monkeypatch):
    """Two administrators, an authenticated session, and a confirmed password."""
    FakeAdmin.reset([
        FakeAdmin(id=1, username="admin01", password="password123", gmail="admin01@example.com"),
        FakeAdmin(id=2, username="admin02", password="password456", gmail="admin02@example.com"),
    ])
    session = FakeSession()
    monkeypatch.setattr(admins_module, "Admin", FakeAdmin)
    monkeypatch.setattr(admins_module.db, "session", session)
    monkeypatch.setattr(admins_module.db.func, "lower", lambda column: column, raising=False)
    monkeypatch.setattr(admins_module, "admin_required", lambda: (object(), None))
    monkeypatch.setattr(admins_module, "reauth_required", lambda: (object(), None))
    monkeypatch.setattr(admins_module, "log_audit", lambda *args, **kwargs: None)
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
    # The listing must never expose stored passwords.
    assert all("password" not in item for item in response.json["items"])


def test_listing_requires_an_administrator(monkeypatch):
    monkeypatch.setattr(admins_module, "admin_required", lambda: (None, ({"success": False}, 401)))

    assert admins_app().test_client().get("/api/admins").status_code == 401


def test_creating_an_administrator_adds_the_record(admin_directory):
    client = signed_in(admins_app())

    response = client.post("/api/admins", json={
        "username": "admin03", "email": "admin03@example.com", "password": "another-secret",
    })

    assert response.status_code == 201
    assert response.json["admin"]["username"] == "admin03"
    assert admin_directory.committed is True
    assert any(record.username == "admin03" for record in FakeAdmin.store)


@pytest.mark.parametrize(
    "body,expected_field",
    [
        ({"email": "a@example.com", "password": "longenough"}, "username"),
        ({"username": "admin03", "password": "longenough"}, "email"),
        ({"username": "admin03", "email": "not-an-email", "password": "longenough"}, "email"),
        ({"username": "admin03", "email": "a@example.com", "password": "short"}, "password"),
    ],
)
def test_creating_rejects_an_incomplete_account(body, expected_field):
    response = signed_in(admins_app()).post("/api/admins", json=body)

    assert response.status_code == 400
    assert expected_field in response.json["fields"]


def test_creating_rejects_a_duplicate_username():
    response = signed_in(admins_app()).post("/api/admins", json={
        "username": "ADMIN02", "email": "new@example.com", "password": "longenough",
    })

    assert response.status_code == 409
    assert "username" in response.json["fields"]


def test_updating_renames_without_touching_the_password():
    client = signed_in(admins_app())

    response = client.put("/api/admins/2", json={"username": "renamed", "email": "renamed@example.com"})

    assert response.status_code == 200
    record = next(item for item in FakeAdmin.store if item.id == 2)
    assert (record.username, record.gmail) == ("renamed", "renamed@example.com")
    assert record.password == "password456"


def test_updating_sets_a_supplied_password():
    client = signed_in(admins_app())

    response = client.put("/api/admins/2", json={
        "username": "admin02", "email": "admin02@example.com", "password": "replacement",
    })

    assert response.status_code == 200
    assert next(item for item in FakeAdmin.store if item.id == 2).password == "replacement"


def test_updating_a_missing_administrator_is_not_found():
    assert signed_in(admins_app()).put("/api/admins/99", json={
        "username": "ghost", "email": "ghost@example.com",
    }).status_code == 404


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


def test_deleting_refuses_the_last_administrator():
    FakeAdmin.reset([FakeAdmin(id=2, username="admin02", password="x", gmail="a@example.com")])

    response = signed_in(admins_app(), admin_id=1).delete("/api/admins/2")

    assert response.status_code == 409
    assert response.json["message"] == "The last administrator account cannot be removed."
    assert len(FakeAdmin.store) == 1


def test_deleting_requires_a_confirmed_password(monkeypatch):
    monkeypatch.setattr(admins_module, "reauth_required", lambda: (None, (
        {"success": False, "code": "password_confirmation_required"}, 403,
    )))

    response = signed_in(admins_app(), admin_id=1).delete("/api/admins/2")

    assert response.status_code == 403
    assert response.json["code"] == "password_confirmation_required"
    assert len(FakeAdmin.store) == 2
