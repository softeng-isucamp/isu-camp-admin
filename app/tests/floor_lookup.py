"""Ground Floor and 1st Floor are one storey, stored as 1.

The directory used to offer both and they named the same place. These pin
the merge, including the part that matters during a deployment: rows written
before the migration still hold 0, and must not read as a floor of their own.
"""

import pytest

from services.floor_lookup import (
    GROUND_FLOOR,
    floor_label,
    floor_number_from_label,
    resolve_floor,
)


class FakeFloor:
    def __init__(self, floor_number, building_id=1, floor_id=None):
        self.floor_number = floor_number
        self.building_id = building_id
        self.floor_id = floor_id


class FakeQuery:
    def __init__(self, rows):
        self.rows = rows
        self.terms = {}

    def filter_by(self, **terms):
        self.terms = terms
        return self

    def first(self):
        return next(
            (row for row in self.rows
             if all(getattr(row, key) == value for key, value in self.terms.items())),
            None,
        )


class FakeModel:
    def __init__(self, rows):
        self.query = FakeQuery(rows)
        self.created = []

    def __call__(self, **values):
        record = FakeFloor(**values)
        self.created.append(record)
        return record


class FakeSession:
    def __init__(self):
        self.added = []

    def add(self, record):
        self.added.append(record)

    def flush(self):
        pass


# ==========================================
# LABELS
# ==========================================

def test_the_ground_floor_is_stored_as_one():
    assert floor_number_from_label("Ground Floor") == 1
    assert GROUND_FLOOR == 1


def test_floor_one_renders_as_the_ground_floor_not_the_first():
    assert floor_label(FakeFloor(1)) == "Ground Floor"


def test_a_row_written_before_the_merge_still_reads_as_the_ground_floor():
    """The migration rewrites these, but the portal runs either side of it:
    reading 0 as "0th Floor" would strand every location on a storey that
    does not exist."""

    assert floor_label(FakeFloor(0)) == "Ground Floor"


@pytest.mark.parametrize("number, label", (
    (-1, "Basement"), (2, "2nd Floor"), (3, "3rd Floor"), (4, "4th Floor"), (11, "11th Floor"),
))
def test_every_other_floor_is_unchanged(number, label):
    assert floor_label(FakeFloor(number)) == label


def test_a_client_still_sending_the_old_first_floor_lands_on_the_ground_floor():
    """An older copy of the vocabulary must not open a second storey."""

    assert floor_number_from_label("1st Floor") == floor_number_from_label("Ground Floor")


@pytest.mark.parametrize("label", ("", None, "Mezzanine", "Floor 1", "0th Floor"))
def test_an_unknown_label_is_refused(label):
    assert floor_number_from_label(label) is None


# ==========================================
# RESOLVING THE ROW
# ==========================================

def test_a_pre_merge_ground_floor_row_is_reused_rather_than_duplicated():
    """public.floor is unique on (building_id, floor_number), so inserting a
    second Ground Floor would be rejected - and the locations already on the
    old row would be stranded."""

    legacy = FakeFloor(0, building_id=7, floor_id=42)
    model = FakeModel([legacy])
    session = FakeSession()

    resolved = resolve_floor(model, session, 7, GROUND_FLOOR)

    assert resolved is legacy
    assert session.added == [], "no second Ground Floor may be created"


def test_the_migrated_row_is_preferred_when_a_building_somehow_has_both():
    migrated = FakeFloor(1, building_id=7, floor_id=43)
    legacy = FakeFloor(0, building_id=7, floor_id=42)
    model = FakeModel([legacy, migrated])

    assert resolve_floor(model, FakeSession(), 7, GROUND_FLOOR) is migrated


def test_a_building_with_no_ground_floor_yet_gets_one_numbered_one():
    model = FakeModel([])
    session = FakeSession()

    created = resolve_floor(model, session, 7, GROUND_FLOOR)

    assert created.floor_number == 1
    assert session.added == [created]


def test_another_floor_is_resolved_exactly_as_before():
    second = FakeFloor(2, building_id=7, floor_id=44)
    model = FakeModel([second])

    assert resolve_floor(model, FakeSession(), 7, 2) is second
