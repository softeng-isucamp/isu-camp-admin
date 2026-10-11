"""The rules a new administrator password must meet.

The same five rules, in the same order and with the same wording, as the
admin portal's ``passwordRules.ts``, which drives the live checklist on the
reset-password page and the Add Administrator form. ``tests/password_rules.py``
checks both lists against one table of sample passwords. Applies to setting a
password only; sign-in never re-checks one, so accounts created under an
older policy keep working.
"""

import re
import unicodedata
from collections import namedtuple

PASSWORD_MIN_LENGTH = 8

PasswordRule = namedtuple("PasswordRule", "id message test")

# JavaScript's \s, which the frontend's symbol rule excludes. Python's own
# str.isspace differs (it counts U+001C-U+001F and U+0085, and not U+FEFF).
_WHITESPACE = frozenset(
    "\t\n\v\f\r       　﻿"
    + "".join(chr(code) for code in range(0x2000, 0x200B))
)
_ASCII_DIGIT = re.compile("[0-9]")


def _has_category(password, category):
    return any(unicodedata.category(character) == category for character in password)


def _is_symbol(character):
    return unicodedata.category(character)[0] not in "LN" and character not in _WHITESPACE


# len() counts code points, so an emoji is one character, as in the frontend.
PASSWORD_RULES = (
    PasswordRule("length", f"Password must be at least {PASSWORD_MIN_LENGTH} characters.", lambda p: len(p) >= PASSWORD_MIN_LENGTH),
    PasswordRule("uppercase", "Password must include an uppercase letter.", lambda p: _has_category(p, "Lu")),
    PasswordRule("lowercase", "Password must include a lowercase letter.", lambda p: _has_category(p, "Ll")),
    PasswordRule("number", "Password must include a number.", lambda p: bool(_ASCII_DIGIT.search(p))),
    PasswordRule("symbol", "Password must include a symbol.", lambda p: any(_is_symbol(c) for c in p)),
)


def first_password_issue(password):
    """The message for the first unmet rule, or None when the password passes."""
    value = str(password or "")
    return next((rule.message for rule in PASSWORD_RULES if not rule.test(value)), None)
