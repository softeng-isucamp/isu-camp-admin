"""The purge order is the contract: the live schema holds NO ACTION keys to
``building``, ``location`` and ``floor``, so a dependent cleared out of order
raises ForeignKeyViolation and the whole delete fails with a 500.
"""

import pytest

import record_deletion as purge_module


class FakeStatement:
    """One query stage; records what the purge asked for, in call order."""

    def __init__(self, journal, table, criteria, rows):
        self.journal = journal
        self.table = table
        self.criteria = criteria
        self.rows = rows

    def all(self):
        return self.rows

    def delete(self, synchronize_session=None):
        self.journal.append(("delete", self.table, self.criteria))

    def update(self, values, synchronize_session=None):
        self.journal.append(("update", self.table, self.criteria, values))


class FakeQuery:
    def __init__(self, journal, table, rows):
        self.journal = journal
        self.table = table
        self.rows = rows

    def filter(self, *criteria):
        return FakeStatement(self.journal, self.table, criteria, self.rows)

    def filter_by(self, **criteria):
        return FakeStatement(self.journal, self.table, criteria, self.rows)


class FakeColumn:
    def __init__(self, name):
        self.name = name

    def in_(self, values):
        return (self.name, "in", list(values))


def fake_model(journal, table, rows=(), columns=()):
    namespace = {"query": FakeQuery(journal, table, list(rows))}
    for column in columns:
        namespace[column] = FakeColumn(column)
    return type(f"Fake{table}", (), namespace)


@pytest.fixture
def journal(monkeypatch):
    """Stand every model in the purge up as a recorder, Locations included."""
    entries = []
    rooms = [
        type("LocationRecord", (), {"location_id": 12})(),
        type("LocationRecord", (), {"location_id": 13})(),
    ]
    monkeypatch.setattr(purge_module, "Location", fake_model(entries, "location", rooms))
    monkeypatch.setattr(purge_module, "LocationPhoto", fake_model(entries, "location_photo", columns=["location_id"]))
    monkeypatch.setattr(purge_module, "BuildingPhoto", fake_model(entries, "building_photo"))
    monkeypatch.setattr(purge_module, "UserHistory", fake_model(entries, "user_history", columns=["location_id"]))
    monkeypatch.setattr(purge_module, "PathPoint", fake_model(entries, "path_point"))
    monkeypatch.setattr(purge_module, "Floor", fake_model(entries, "floor"))
    monkeypatch.setattr(purge_module, "Building", fake_model(entries, "building"))
    return entries


def test_purge_building_clears_every_dependent_before_its_owner(journal):
    location_ids = purge_module.purge_building(4)

    assert location_ids == [12, 13]
    assert [entry[1] for entry in journal] == [
        "location_photo",
        "user_history",
        "building_photo",
        "user_history",
        "path_point",
        "location",
        "floor",
        "building",
    ]


def test_purge_building_deletes_locations_before_the_floors_they_sit_on(journal):
    """``location.floor_id`` is a NO ACTION key into ``public.floor``."""
    purge_module.purge_building(4)

    tables = [entry[1] for entry in journal]
    assert tables.index("location") < tables.index("floor") < tables.index("building")


def test_purge_building_clears_saved_user_history_for_the_building_and_its_rooms(journal):
    purge_module.purge_building(4)

    history = [entry for entry in journal if entry[1] == "user_history"]
    assert history == [
        ("delete", "user_history", (("location_id", "in", [12, 13]),)),
        ("delete", "user_history", {"building_id": 4}),
    ]


def test_purge_building_keeps_waypoints_and_only_clears_their_reference(journal):
    purge_module.purge_building(4)

    assert ("update", "path_point", {"building_id": 4}, {"building_id": None}) in journal
    assert not [entry for entry in journal if entry[1] == "path_point" and entry[0] == "delete"]


def test_purge_building_without_rooms_skips_the_room_owned_tables(monkeypatch):
    entries = []
    monkeypatch.setattr(purge_module, "Location", fake_model(entries, "location", []))
    monkeypatch.setattr(purge_module, "LocationPhoto", fake_model(entries, "location_photo", columns=["location_id"]))
    monkeypatch.setattr(purge_module, "BuildingPhoto", fake_model(entries, "building_photo"))
    monkeypatch.setattr(purge_module, "UserHistory", fake_model(entries, "user_history", columns=["location_id"]))
    monkeypatch.setattr(purge_module, "PathPoint", fake_model(entries, "path_point"))
    monkeypatch.setattr(purge_module, "Floor", fake_model(entries, "floor"))
    monkeypatch.setattr(purge_module, "Building", fake_model(entries, "building"))

    assert purge_module.purge_building(4) == []
    assert [entry[1] for entry in entries] == [
        "building_photo",
        "user_history",
        "path_point",
        "location",
        "floor",
        "building",
    ]


def test_purge_location_clears_its_photos_and_history_before_the_record(journal):
    journal.clear()

    purge_module.purge_location(12)

    assert journal == [
        ("delete", "location_photo", (("location_id", "in", [12]),)),
        ("delete", "user_history", (("location_id", "in", [12]),)),
        ("delete", "location", {"location_id": 12}),
    ]
