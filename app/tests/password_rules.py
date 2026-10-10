import json
from pathlib import Path

import pytest

from services.password_rules import PASSWORD_RULES, first_password_issue

# The same table the frontend's passwordRules.test.ts reads, so the two rule
# lists are checked against one set of samples.
CASES = json.loads(
    (Path(__file__).resolve().parents[2] / "frontend/admin/src/services/passwordRuleCases.json").read_text(encoding="utf-8")
)


def failing_rule_ids(password):
    return [rule.id for rule in PASSWORD_RULES if not rule.test(password)]


@pytest.mark.parametrize("case", CASES, ids=lambda case: case.get("note") or repr(case["password"]))
def test_each_rule_agrees_with_the_frontend_on_the_shared_samples(case):
    assert failing_rule_ids(case["password"]) == case["fails"]


def test_the_rules_are_the_frontends_five_in_the_frontends_order():
    assert [rule.id for rule in PASSWORD_RULES] == ["length", "uppercase", "lowercase", "number", "symbol"]


@pytest.mark.parametrize(
    "password,message",
    [
        ("", "Password must be at least 8 characters."),
        ("Abcde1!", "Password must be at least 8 characters."),
        ("abcdefg1!", "Password must include an uppercase letter."),
        ("ABCDEFG1!", "Password must include a lowercase letter."),
        ("Abcdefgh!", "Password must include a number."),
        ("Abcdefg12", "Password must include a symbol."),
        ("abcdefg", "Password must be at least 8 characters."),
        ("abcdefgh", "Password must include an uppercase letter."),
    ],
)
def test_the_first_unmet_rule_is_reported_with_the_frontends_wording(password, message):
    assert first_password_issue(password) == message


def test_a_password_meeting_every_rule_has_no_issue():
    assert first_password_issue("Abcdef1!") is None
