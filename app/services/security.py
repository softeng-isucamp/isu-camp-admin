"""Shared security primitives: password hashing, upload sniffing, origin policy.

Kept in one module so the auth blueprint, the app factory, and the photo
routes all enforce the same rules instead of each re-deriving them.
"""

import os
import secrets

from werkzeug.security import check_password_hash, generate_password_hash


# ==========================================
# Password Hashing
# ==========================================

# PBKDF2-SHA256 is chosen over scrypt because it only needs hashlib, so the
# same hashes verify on any Python build the deployment happens to run.
PASSWORD_HASH_METHOD = "pbkdf2:sha256:600000"

# Werkzeug hashes always look like "method$salt$digest". Anything else in the
# column is a legacy plaintext password left over from before hashing.
_HASH_PREFIXES = ("pbkdf2:", "scrypt:", "argon2")

# Verified against a throwaway hash when the username does not exist, so a
# missing account costs the same time as a wrong password.
_DUMMY_HASH = generate_password_hash("dummy-password", method=PASSWORD_HASH_METHOD)

MIN_PASSWORD_LENGTH = 10


def hash_password(raw_password):
    """Return a storable hash for a new or reset password."""
    return generate_password_hash(str(raw_password), method=PASSWORD_HASH_METHOD)


def is_hashed(stored_password):
    value = str(stored_password or "")
    return "$" in value and value.startswith(_HASH_PREFIXES)


def verify_password(stored_password, raw_password):
    """Check a password and report whether the stored value needs upgrading.

    Returns ``(matches, needs_rehash)``. Legacy plaintext rows still
    authenticate once so nobody is locked out, and ``needs_rehash`` tells the
    caller to replace the column with a real hash on that successful login.
    """
    stored = str(stored_password or "")
    candidate = str(raw_password or "")

    if is_hashed(stored):
        return check_password_hash(stored, candidate), False

    if not stored:
        return False, False

    # Legacy plaintext: compare in constant time, then ask for an upgrade.
    # compare_digest refuses str values holding non-ASCII characters, so both
    # sides are encoded first -- a password typed with an accent or any other
    # non-ASCII character must still authenticate.
    matches = secrets.compare_digest(stored.encode("utf-8"), candidate.encode("utf-8"))
    return matches, matches


def burn_password_comparison(raw_password):
    """Spend the same work as a real check for an account that does not exist."""
    check_password_hash(_DUMMY_HASH, str(raw_password or ""))


def password_policy_error(password, username=None):
    """Return a human-readable reason the password is unacceptable, or None."""
    value = str(password or "")

    if len(value) < MIN_PASSWORD_LENGTH:
        return f"Password must be at least {MIN_PASSWORD_LENGTH} characters"
    if not any(character.isalpha() for character in value):
        return "Password must include at least one letter"
    if not any(character.isdigit() for character in value):
        return "Password must include at least one number"
    if username and str(username).strip().lower() in value.lower():
        return "Password must not contain the username"
    return None


# ==========================================
# Image Upload Verification
# ==========================================

PHOTO_MIME_TYPES = {"image/png", "image/jpeg", "image/webp"}

# Leading bytes for the three formats the uploader accepts. A browser-supplied
# Content-Type is attacker-controlled, so the bytes decide what a photo is.
_IMAGE_SIGNATURES = (
    (bytes.fromhex("89504e470d0a1a0a"), "image/png"),
    (bytes.fromhex("ffd8ff"), "image/jpeg"),
)


def image_mime_from_content(content):
    """Return the MIME type implied by the file's own bytes, or None."""
    data = content or b""

    for signature, mime_type in _IMAGE_SIGNATURES:
        if data.startswith(signature):
            return mime_type
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def verified_image_mime(content, declared_mime_type):
    """Resolve the MIME type to trust for an upload, or None if it is not an image.

    The declared type must both be on the allowlist and agree with the bytes;
    otherwise the upload is rejected rather than stored under a type that would
    later be echoed back to a browser.
    """
    if declared_mime_type not in PHOTO_MIME_TYPES:
        return None

    sniffed = image_mime_from_content(content)

    if sniffed is None:
        return None
    if sniffed != declared_mime_type:
        # A JPEG sent as image/jpeg may legitimately vary; anything else is a
        # mismatch worth refusing.
        return None
    return sniffed


def harden_media_response(response):
    """Stop a stored file from being interpreted as anything but its own type."""
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Content-Disposition"] = "inline"
    response.headers["Content-Security-Policy"] = "default-src 'none'; sandbox"
    return response


# ==========================================
# Origin Policy
# ==========================================

DEFAULT_ALLOWED_ORIGINS = (
    "http://localhost:5173",
    "http://localhost:5174",
)


def allowed_origins():
    """Browser origins allowed to call the admin API, from the environment.

    Set ADMIN_ALLOWED_ORIGINS to a comma-separated list in every deployment
    that is not a developer's machine; the localhost default exists only so a
    fresh checkout runs.
    """
    configured = os.getenv("ADMIN_ALLOWED_ORIGINS", "")
    origins = [origin.strip().rstrip("/") for origin in configured.split(",") if origin.strip()]
    return tuple(origins) if origins else DEFAULT_ALLOWED_ORIGINS


def is_production():
    """True unless the process was explicitly started as a development run."""
    environment = os.getenv("ISUCAMP_ENV") or os.getenv("FLASK_ENV") or "production"
    return environment.strip().lower() not in ("development", "dev", "local", "test", "testing")
