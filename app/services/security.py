"""Password hashing for administrator accounts.

Taken from the password half of ``services/security.py`` on
feat/passwoed-hashing, unchanged, so the two merge without a decision to make.
That branch's upload-sniffing and origin-policy helpers are deliberately not
copied here - this module exists because a password-change endpoint cannot be
written without taking a position on how passwords are stored, and the
position was already decided there.

``public.admin.password`` currently holds plaintext for every existing row.
``verify_password`` therefore accepts a legacy row once and reports
``needs_rehash``, so a sign-in replaces it with a real hash and nobody is
locked out mid-migration. Every reader and writer of that column goes through
here; a single one left comparing plaintext would lock out the first account
to change its password.
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
