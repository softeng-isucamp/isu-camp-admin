import pytest
from flask import Flask

import profile as profile_route
from auth import Admin
from extensions import db
from profile import profile_bp
from services.security import hash_password, is_hashed, verify_password

CURRENT_PASSWORD = "Str0ngCurrent1"
NEW_PASSWORD = "Str0ngReplacement2"


@pytest.fixture
def app(monkeypatch):
    app = Flask(__name__)
    app.config.update(
        SQLALCHEMY_DATABASE_URI="sqlite://",
        SQLALCHEMY_TRACK_MODIFICATIONS=False,
        TESTING=True,
        SECRET_KEY="test-secret",
    )
    db.init_app(app)
    app.register_blueprint(profile_bp)
    monkeypatch.setattr(profile_route, "rate_limited", lambda *args, **kwargs: None)
    monkeypatch.setattr(profile_route, "log_audit", lambda *args, **kwargs: None)

    with app.app_context():
        db.session.execute(db.text("ATTACH DATABASE ':memory:' AS public"))
        db.metadata.create_all(db.engine)
        yield app
        db.session.remove()
        db.drop_all()


def add_admin(identifier=1, username="admin01", email="admin01@isu.edu.ph",
              password=None, role="admin", hashed=True):
    stored = password if password is not None else CURRENT_PASSWORD
    record = Admin(
        id=identifier,
        username=username,
        gmail=email,
        password=hash_password(stored) if hashed else stored,
        status="active",
        role=role,
    )
    db.session.add(record)
    db.session.commit()
    return record


def sign_in_as(app, monkeypatch, record):
    """Point admin_required at a stored account, as a real session would."""

    identifier = record.id
    monkeypatch.setattr(
        profile_route, "admin_required",
        lambda: (db.session.get(Admin, identifier), None),
    )


# ==========================================
# READING THE PROFILE
# ==========================================

def test_profile_is_returned_unenveloped_for_the_frontend_schema(app, monkeypatch):
    """services/profile.ts parses the response body itself, so no envelope."""

    with app.app_context():
        record = add_admin(role="superadmin")
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().get("/api/profile")

    assert response.status_code == 200
    assert response.get_json() == {
        "id": "1",
        "username": "admin01",
        "email": "admin01@isu.edu.ph",
        "role": "superadmin",
    }


def test_an_account_without_the_higher_role_reads_as_admin(app, monkeypatch):
    with app.app_context():
        record = add_admin(role="admin")
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().get("/api/profile")

    assert response.get_json()["role"] == "admin"


def test_a_missing_email_reads_as_empty_rather_than_null(app, monkeypatch):
    """The frontend's schema requires a string, so null would fail to parse."""

    with app.app_context():
        record = add_admin(email="")
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().get("/api/profile")

    assert response.get_json()["email"] == ""


def test_profile_requires_a_session(app, monkeypatch):
    from flask import jsonify

    monkeypatch.setattr(
        profile_route, "admin_required",
        lambda: (None, (jsonify({"success": False, "message": "Authentication required"}), 401)),
    )

    with app.app_context():
        assert app.test_client().get("/api/profile").status_code == 401
        assert app.test_client().patch("/api/profile", json={}).status_code == 401
        assert app.test_client().post("/api/profile/password", json={}).status_code == 401


# ==========================================
# EDITING THE PROFILE
# ==========================================

def test_profile_update_renames_the_account_and_returns_the_new_state(app, monkeypatch):
    with app.app_context():
        record = add_admin()
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().patch("/api/profile", json={
            "username": "admin_renamed", "email": "renamed@isu.edu.ph",
        })

        assert response.status_code == 200
        assert response.get_json()["username"] == "admin_renamed"
        assert db.session.get(Admin, 1).gmail == "renamed@isu.edu.ph"


@pytest.mark.parametrize("body, field", (
    ({"username": "", "email": "a@b.co"}, "username"),
    ({"username": "x" * 256, "email": "a@b.co"}, "username"),
    ({"username": "admin", "email": ""}, "email"),
    ({"username": "admin", "email": "not-an-email"}, "email"),
))
def test_profile_update_validates_its_fields(app, monkeypatch, body, field):
    with app.app_context():
        record = add_admin()
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().patch("/api/profile", json=body)

    assert response.status_code == 400
    assert field in response.get_json()["fields"]


def test_profile_update_refuses_a_username_another_account_holds(app, monkeypatch):
    with app.app_context():
        record = add_admin(1, "admin01")
        add_admin(2, "admin_registrar", "registrar@isu.edu.ph")
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().patch("/api/profile", json={
            # Different case, same name: the check is case-insensitive because
            # the directory's own uniqueness check is.
            "username": "ADMIN_REGISTRAR", "email": "admin01@isu.edu.ph",
        })

    assert response.status_code == 409
    assert "already taken" in response.get_json()["message"]


def test_keeping_your_own_username_is_not_a_conflict(app, monkeypatch):
    with app.app_context():
        record = add_admin()
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().patch("/api/profile", json={
            "username": "admin01", "email": "moved@isu.edu.ph",
        })

    assert response.status_code == 200
    assert response.get_json()["email"] == "moved@isu.edu.ph"


def test_profile_update_ignores_a_password_field(app, monkeypatch):
    """Changing a password is a separate request that re-authenticates."""

    with app.app_context():
        record = add_admin()
        sign_in_as(app, monkeypatch, record)
        before = db.session.get(Admin, 1).password

        app.test_client().patch("/api/profile", json={
            "username": "admin01", "email": "admin01@isu.edu.ph",
            "password": "smuggled-in-here",
        })

        assert db.session.get(Admin, 1).password == before


# ==========================================
# CHANGING THE PASSWORD
# ==========================================

def test_password_change_stores_a_hash_and_accepts_the_new_password(app, monkeypatch):
    with app.app_context():
        record = add_admin()
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().post("/api/profile/password", json={
            "currentPassword": CURRENT_PASSWORD, "newPassword": NEW_PASSWORD,
        })

        assert response.status_code == 200
        stored = db.session.get(Admin, 1).password
        # Never the raw password, and the new one verifies against it.
        assert stored != NEW_PASSWORD
        assert is_hashed(stored)
        assert verify_password(stored, NEW_PASSWORD)[0]
        assert not verify_password(stored, CURRENT_PASSWORD)[0]


def test_password_change_refuses_a_wrong_current_password(app, monkeypatch):
    with app.app_context():
        record = add_admin()
        sign_in_as(app, monkeypatch, record)
        before = db.session.get(Admin, 1).password

        response = app.test_client().post("/api/profile/password", json={
            "currentPassword": "not-it", "newPassword": NEW_PASSWORD,
        })

        assert response.status_code == 401
        assert "currentPassword" in response.get_json()["fields"]
        assert db.session.get(Admin, 1).password == before


def test_a_legacy_plaintext_row_can_still_change_its_password(app, monkeypatch):
    """Nobody is locked out mid-migration: the column holds plaintext today."""

    with app.app_context():
        record = add_admin(password=CURRENT_PASSWORD, hashed=False)
        sign_in_as(app, monkeypatch, record)
        assert not is_hashed(db.session.get(Admin, 1).password)

        response = app.test_client().post("/api/profile/password", json={
            "currentPassword": CURRENT_PASSWORD, "newPassword": NEW_PASSWORD,
        })

        assert response.status_code == 200
        assert is_hashed(db.session.get(Admin, 1).password)


@pytest.mark.parametrize("new_password, reason", (
    ("short1", "at least"),
    ("1234567890123", "letter"),
    ("abcdefghijklm", "number"),
))
def test_password_change_enforces_the_password_policy(app, monkeypatch, new_password, reason):
    with app.app_context():
        record = add_admin()
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().post("/api/profile/password", json={
            "currentPassword": CURRENT_PASSWORD, "newPassword": new_password,
        })

    assert response.status_code == 400
    assert reason in response.get_json()["message"]


def test_a_new_password_may_not_contain_the_username(app, monkeypatch):
    with app.app_context():
        record = add_admin(username="admin01")
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().post("/api/profile/password", json={
            "currentPassword": CURRENT_PASSWORD, "newPassword": "xxadmin01xx99",
        })

    assert response.status_code == 400
    assert "username" in response.get_json()["message"]


def test_a_new_password_must_differ_from_the_current_one(app, monkeypatch):
    with app.app_context():
        record = add_admin()
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().post("/api/profile/password", json={
            "currentPassword": CURRENT_PASSWORD, "newPassword": CURRENT_PASSWORD,
        })

    assert response.status_code == 400
    assert "different" in response.get_json()["message"]


@pytest.mark.parametrize("body, field", (
    ({"newPassword": NEW_PASSWORD}, "currentPassword"),
    ({"currentPassword": CURRENT_PASSWORD}, "newPassword"),
))
def test_password_change_requires_both_fields(app, monkeypatch, body, field):
    with app.app_context():
        record = add_admin()
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().post("/api/profile/password", json=body)

    assert response.status_code == 400
    assert field in response.get_json()["fields"]


def test_password_change_is_rate_limited(app, monkeypatch):
    from flask import jsonify

    with app.app_context():
        record = add_admin()
        sign_in_as(app, monkeypatch, record)
        monkeypatch.setattr(
            profile_route, "rate_limited",
            lambda *args, **kwargs: (jsonify({"success": False, "message": "Too many"}), 429),
        )
        before = db.session.get(Admin, 1).password

        response = app.test_client().post("/api/profile/password", json={
            "currentPassword": CURRENT_PASSWORD, "newPassword": NEW_PASSWORD,
        })

        assert response.status_code == 429
        assert db.session.get(Admin, 1).password == before
