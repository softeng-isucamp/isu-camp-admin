import pytest
from flask import Flask

import profile as profile_route
from auth import Admin
from extensions import db
from profile import profile_bp
from services.security import hash_password, is_hashed, verify_password

CURRENT_PASSWORD = "Str0ngCurrent1"
# The signed-in password predates the five rules (no symbol), as an older account's would.
NEW_PASSWORD = "Str0ngReplacement2!"


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
              password=None, role="admin", hashed=True, alternative_email=None):
    stored = password if password is not None else CURRENT_PASSWORD
    record = Admin(
        id=identifier,
        username=username,
        gmail=email,
        alternative_email=alternative_email,
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
        # Present and null rather than absent: the key is the capability flag
        # that tells My Profile the server knows about the field at all.
        "alternativeEmail": None,
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
    """A rename alone needs no password: only moving an email address does."""

    with app.app_context():
        record = add_admin()
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().patch("/api/profile", json={
            "username": "admin_renamed", "email": "admin01@isu.edu.ph",
        })

        assert response.status_code == 200
        assert response.get_json()["username"] == "admin_renamed"
        assert db.session.get(Admin, 1).username == "admin_renamed"


def test_profile_update_moves_the_email_with_the_current_password(app, monkeypatch):
    with app.app_context():
        record = add_admin()
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().patch("/api/profile", json={
            "username": "admin_renamed", "email": "renamed@isu.edu.ph",
            "currentPassword": CURRENT_PASSWORD,
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
            "currentPassword": CURRENT_PASSWORD,
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
# THE ALTERNATIVE EMAIL
# ==========================================

def test_a_registered_alternative_email_is_reported(app, monkeypatch):
    with app.app_context():
        record = add_admin(alternative_email="admin01.home@gmail.com")
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().get("/api/profile")

    assert response.get_json()["alternativeEmail"] == "admin01.home@gmail.com"


def test_an_alternative_email_is_saved_with_the_current_password(app, monkeypatch):
    with app.app_context():
        record = add_admin()
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().patch("/api/profile", json={
            "username": "admin01", "email": "admin01@isu.edu.ph",
            "alternativeEmail": "admin01.home@gmail.com",
            "currentPassword": CURRENT_PASSWORD,
        })

        assert response.status_code == 200
        assert response.get_json()["alternativeEmail"] == "admin01.home@gmail.com"
        assert db.session.get(Admin, 1).alternative_email == "admin01.home@gmail.com"


@pytest.mark.parametrize("cleared", (None, ""))
def test_null_or_blank_clears_the_alternative_email(app, monkeypatch, cleared):
    """Both spellings of no address reach the column as NULL, never as empty."""

    with app.app_context():
        record = add_admin(alternative_email="admin01.home@gmail.com")
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().patch("/api/profile", json={
            "username": "admin01", "email": "admin01@isu.edu.ph",
            "alternativeEmail": cleared, "currentPassword": CURRENT_PASSWORD,
        })

        assert response.status_code == 200
        assert response.get_json()["alternativeEmail"] is None
        assert db.session.get(Admin, 1).alternative_email is None


def test_leaving_the_field_out_keeps_the_stored_alternative_email(app, monkeypatch):
    """An older client sends only username and email; its save must not clear it."""

    with app.app_context():
        record = add_admin(alternative_email="admin01.home@gmail.com")
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().patch("/api/profile", json={
            "username": "admin_renamed", "email": "admin01@isu.edu.ph",
        })

        assert response.status_code == 200
        assert db.session.get(Admin, 1).alternative_email == "admin01.home@gmail.com"


def test_resending_the_same_alternative_email_needs_no_password(app, monkeypatch):
    """The form posts every field, so an unchanged address is not a change."""

    with app.app_context():
        record = add_admin(alternative_email="admin01.home@gmail.com")
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().patch("/api/profile", json={
            "username": "admin_renamed", "email": "admin01@isu.edu.ph",
            "alternativeEmail": "ADMIN01.HOME@gmail.com",
        })

    assert response.status_code == 200


def test_an_invalid_alternative_email_is_refused(app, monkeypatch):
    with app.app_context():
        record = add_admin()
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().patch("/api/profile", json={
            "username": "admin01", "email": "admin01@isu.edu.ph",
            "alternativeEmail": "not-an-email", "currentPassword": CURRENT_PASSWORD,
        })

    assert response.status_code == 400
    body = response.get_json()
    assert body["message"] == "Enter a valid email address"
    assert body["fields"] == {"alternativeEmail": "Enter a valid email address"}


def test_the_alternative_email_cannot_repeat_the_primary(app, monkeypatch):
    """Two copies of one address are one address, and recovery could not tell."""

    with app.app_context():
        record = add_admin()
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().patch("/api/profile", json={
            "username": "admin01", "email": "admin01@isu.edu.ph",
            # Same address, different case and padding.
            "alternativeEmail": "  ADMIN01@ISU.EDU.PH  ",
            "currentPassword": CURRENT_PASSWORD,
        })

    assert response.status_code == 400
    body = response.get_json()
    assert body["message"] == "Use a different address from your primary email"
    assert "alternativeEmail" in body["fields"]


def test_both_email_fields_can_be_refused_at_once(app, monkeypatch):
    """The form shows them together, so one request reports both problems."""

    with app.app_context():
        record = add_admin()
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().patch("/api/profile", json={
            "username": "admin01", "email": "bad-primary",
            "alternativeEmail": "bad-alternative", "currentPassword": CURRENT_PASSWORD,
        })

    assert response.status_code == 400
    body = response.get_json()
    assert set(body["fields"]) == {"email", "alternativeEmail"}
    # The message is the first refusal, in the order the form reads.
    assert body["message"] == body["fields"]["email"]


def test_an_over_long_alternative_email_is_refused(app, monkeypatch):
    """Longer than the column holds could never collide with a stored address."""

    with app.app_context():
        record = add_admin()
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().patch("/api/profile", json={
            "username": "admin01", "email": "admin01@isu.edu.ph",
            "alternativeEmail": "a" * 250 + "@isu.edu.ph",
            "currentPassword": CURRENT_PASSWORD,
        })

    assert response.status_code == 400
    assert "alternativeEmail" in response.get_json()["fields"]


# ==========================================
# THE PASSWORD THAT GUARDS AN EMAIL CHANGE
# ==========================================

@pytest.mark.parametrize("body", (
    {"username": "admin01", "email": "moved@isu.edu.ph"},
    {"username": "admin01", "email": "admin01@isu.edu.ph",
     "alternativeEmail": "admin01.home@gmail.com"},
))
def test_moving_an_email_without_the_password_is_refused(app, monkeypatch, body):
    with app.app_context():
        record = add_admin()
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().patch("/api/profile", json=body)

        assert response.status_code == 401
        assert response.get_json()["fields"] == {
            "currentPassword": "Enter your current password to change an email address",
        }
        # Nothing moved.
        stored = db.session.get(Admin, 1)
        assert stored.gmail == "admin01@isu.edu.ph"
        assert stored.alternative_email is None


def test_moving_an_email_with_the_wrong_password_is_refused(app, monkeypatch):
    with app.app_context():
        record = add_admin()
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().patch("/api/profile", json={
            "username": "admin01", "email": "moved@isu.edu.ph",
            "currentPassword": "not-it",
        })

        assert response.status_code == 401
        assert response.get_json()["fields"] == {
            "currentPassword": "Your current password is incorrect",
        }
        assert db.session.get(Admin, 1).gmail == "admin01@isu.edu.ph"


def test_the_password_is_checked_before_the_duplicate_check(app, monkeypatch):
    """Otherwise an unattended session could ask which addresses exist."""

    with app.app_context():
        record = add_admin(1, "admin01")
        add_admin(2, "admin_registrar", "registrar@isu.edu.ph")
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().patch("/api/profile", json={
            "username": "admin01", "email": "registrar@isu.edu.ph",
            "currentPassword": "not-it",
        })

    # 401 for the password, not 409 for the address that is already in use.
    assert response.status_code == 401
    assert response.get_json()["message"] == "Your current password is incorrect"


def test_a_rename_alone_never_asks_for_the_password(app, monkeypatch):
    with app.app_context():
        record = add_admin(alternative_email="admin01.home@gmail.com")
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().patch("/api/profile", json={
            "username": "admin_renamed", "email": "ADMIN01@isu.edu.ph",
            "alternativeEmail": "admin01.home@gmail.com",
        })

    assert response.status_code == 200


def test_an_email_change_is_rate_limited(app, monkeypatch):
    """The password check here is an online guess, like the change-password one."""

    from flask import jsonify

    with app.app_context():
        record = add_admin()
        sign_in_as(app, monkeypatch, record)
        monkeypatch.setattr(
            profile_route, "rate_limited",
            lambda *args, **kwargs: (jsonify({"success": False, "message": "Too many"}), 429),
        )

        response = app.test_client().patch("/api/profile", json={
            "username": "admin01", "email": "moved@isu.edu.ph",
            "currentPassword": CURRENT_PASSWORD,
        })

        assert response.status_code == 429
        assert db.session.get(Admin, 1).gmail == "admin01@isu.edu.ph"


# ==========================================
# THE SHARED EMAIL POOL
# ==========================================

@pytest.mark.parametrize("field, held_as", (
    ("email", "gmail"),
    ("email", "alternative_email"),
    ("alternativeEmail", "gmail"),
    ("alternativeEmail", "alternative_email"),
))
def test_an_address_another_account_holds_is_in_use(app, monkeypatch, field, held_as):
    """Primary and alternative are one pool: either column takes the address."""

    with app.app_context():
        record = add_admin(1, "admin01")
        other = add_admin(2, "admin_registrar", "registrar@isu.edu.ph")
        setattr(other, held_as, "shared@isu.edu.ph")
        db.session.commit()
        sign_in_as(app, monkeypatch, record)

        body = {
            "username": "admin01", "email": "admin01@isu.edu.ph",
            "currentPassword": CURRENT_PASSWORD,
        }
        # Different case, because the pool is compared case-insensitively.
        body[field] = "SHARED@isu.edu.ph"
        response = app.test_client().patch("/api/profile", json=body)

    assert response.status_code == 409
    refused = response.get_json()
    assert refused["message"] == "That email address is already in use"
    assert refused["fields"] == {field: "That email address is already in use"}


def test_the_conflict_never_names_the_account_that_holds_the_address(app, monkeypatch):
    with app.app_context():
        record = add_admin(1, "admin01")
        add_admin(2, "admin_registrar", "registrar@isu.edu.ph")
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().patch("/api/profile", json={
            "username": "admin01", "email": "registrar@isu.edu.ph",
            "currentPassword": CURRENT_PASSWORD,
        })

    text = response.get_data(as_text=True)
    assert response.status_code == 409
    assert "admin_registrar" not in text


def test_your_own_alternative_email_may_become_your_primary(app, monkeypatch):
    """Swapping your two addresses is not a collision with yourself."""

    with app.app_context():
        record = add_admin(alternative_email="admin01.home@gmail.com")
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().patch("/api/profile", json={
            "username": "admin01", "email": "admin01.home@gmail.com",
            "alternativeEmail": "admin01@isu.edu.ph",
            "currentPassword": CURRENT_PASSWORD,
        })

        assert response.status_code == 200
        stored = db.session.get(Admin, 1)
        assert stored.gmail == "admin01.home@gmail.com"
        assert stored.alternative_email == "admin01@isu.edu.ph"


def test_an_existing_duplicate_primary_does_not_block_an_unrelated_edit(app, monkeypatch):
    """Issue #108: accounts predate the pool, and share addresses today.

    The rule applies to the value a request is changing, so an account whose
    stored address is already a duplicate can still be renamed - otherwise the
    only way out of a duplicate would be to fix it in the database by hand.
    """

    with app.app_context():
        record = add_admin(1, "admin01", "shared@isu.edu.ph")
        add_admin(2, "admin_registrar", "shared@isu.edu.ph")
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().patch("/api/profile", json={
            "username": "admin_renamed", "email": "shared@isu.edu.ph",
        })

        assert response.status_code == 200
        assert db.session.get(Admin, 1).username == "admin_renamed"


def test_a_username_and_an_email_can_be_refused_together(app, monkeypatch):
    with app.app_context():
        record = add_admin(1, "admin01")
        add_admin(2, "admin_registrar", "registrar@isu.edu.ph")
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().patch("/api/profile", json={
            "username": "admin_registrar", "email": "registrar@isu.edu.ph",
            "currentPassword": CURRENT_PASSWORD,
        })

    assert response.status_code == 409
    refused = response.get_json()
    assert set(refused["fields"]) == {"username", "email"}
    assert refused["message"] == "That username is already taken"


def test_the_alternative_email_change_is_audited_without_the_address(app, monkeypatch):
    """Every administrator reads the audit log, and no password is ever logged."""

    recorded = []
    monkeypatch.setattr(
        profile_route, "log_audit",
        lambda *arguments, **keywords: recorded.append(arguments),
    )

    with app.app_context():
        record = add_admin()
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().patch("/api/profile", json={
            "username": "admin01", "email": "admin01@isu.edu.ph",
            "alternativeEmail": "admin01.home@gmail.com",
            "currentPassword": CURRENT_PASSWORD,
        })

    assert response.status_code == 200
    detail = recorded[-1][-1]
    assert detail == "Changed own alternative email"
    assert "admin01.home@gmail.com" not in detail
    assert CURRENT_PASSWORD not in detail


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


@pytest.mark.parametrize("new_password, message", (
    ("Ab1!xyz", "Password must be at least 8 characters."),
    ("lowercase1!", "Password must include an uppercase letter."),
    ("UPPERCASE1!", "Password must include a lowercase letter."),
    ("NoDigitsHere!", "Password must include a number."),
    ("NoSymbol123", "Password must include a symbol."),
))
def test_password_change_enforces_the_shared_password_rules(app, monkeypatch, new_password, message):
    with app.app_context():
        record = add_admin()
        sign_in_as(app, monkeypatch, record)
        before = db.session.get(Admin, 1).password

        response = app.test_client().post("/api/profile/password", json={
            "currentPassword": CURRENT_PASSWORD, "newPassword": new_password,
        })

        assert response.status_code == 400
        body = response.get_json()
        assert body["message"] == message
        assert "newPassword" in body["fields"]
        assert db.session.get(Admin, 1).password == before


def test_password_change_reports_only_the_first_unmet_rule(app, monkeypatch):
    with app.app_context():
        record = add_admin()
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().post("/api/profile/password", json={
            "currentPassword": CURRENT_PASSWORD, "newPassword": "abc",
        })

    assert response.get_json()["message"] == "Password must be at least 8 characters."


def test_a_new_password_may_contain_the_username_and_non_ascii_letters(app, monkeypatch):
    """The five rules are the whole policy: no username check, any script's letters."""

    with app.app_context():
        record = add_admin(username="admin01")
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().post("/api/profile/password", json={
            "currentPassword": CURRENT_PASSWORD, "newPassword": "Admin01-Ñandú9",
        })

        assert response.status_code == 200


def test_an_account_with_a_weak_password_still_changes_to_a_compliant_one(app, monkeypatch):
    with app.app_context():
        record = add_admin(password="weak")
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().post("/api/profile/password", json={
            "currentPassword": "weak", "newPassword": NEW_PASSWORD,
        })

        assert response.status_code == 200
        assert verify_password(db.session.get(Admin, 1).password, NEW_PASSWORD)[0]


def test_a_wrong_current_password_is_reported_before_a_weak_new_one(app, monkeypatch):
    with app.app_context():
        record = add_admin()
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().post("/api/profile/password", json={
            "currentPassword": "not-it", "newPassword": "abc",
        })

    assert response.status_code == 401


def test_a_new_password_must_differ_from_the_current_one(app, monkeypatch):
    with app.app_context():
        record = add_admin(password=NEW_PASSWORD)
        sign_in_as(app, monkeypatch, record)

        response = app.test_client().post("/api/profile/password", json={
            "currentPassword": NEW_PASSWORD, "newPassword": NEW_PASSWORD,
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
