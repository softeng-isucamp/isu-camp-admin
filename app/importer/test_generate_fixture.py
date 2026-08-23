import json
from pathlib import Path
import tempfile
import unittest

from app.importer.generate_fixture import generate


class GeneratedFixtureTests(unittest.TestCase):
    def test_recorded_response_generates_reproducible_complete_fixture(self):
        source = Path(__file__).with_name("fixtures") / "overpass-recorded.json"
        with tempfile.TemporaryDirectory() as directory:
            first_path = Path(directory) / "first.json"
            second_path = Path(directory) / "second.json"
            first = generate(source, first_path, imported_at="2026-08-24")
            second = generate(source, second_path, imported_at="2026-08-24")
        self.assertEqual(first, second)
        self.assertIn("source", first)
        self.assertIn("campus", first)
        self.assertIn("walkingNetwork", first)
        self.assertEqual(first["attribution"], "© OpenStreetMap contributors")

    def test_checked_in_fixture_has_no_live_import_requirement(self):
        path = Path("frontend/admin/src/services/generated-map-fixture.json")
        self.assertTrue(path.exists())
        fixture = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(fixture["source"]["imported_at"], "2026-08-24")


if __name__ == "__main__":
    unittest.main()
