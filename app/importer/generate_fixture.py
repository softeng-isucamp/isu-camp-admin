"""Generate the checked-in development map fixture from recorded OSM input."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from app.importer.osm_extraction import load_and_extract
from app.importer.osm_normalization import normalize_import


def generate(input_path: str | Path, output_path: str | Path, *, imported_at: str) -> dict[str, Any]:
    source = load_and_extract(str(input_path), imported_at=imported_at)
    result = normalize_import(source)
    fixture = {
        "schemaVersion": 1,
        "generatedAt": imported_at,
        "source": source,
        "campus": result["campus"],
        "walkingNetwork": result["walkingNetwork"],
        "attribution": "© OpenStreetMap contributors",
        "license": "Open Database License (ODbL)",
    }
    with open(output_path, "w", encoding="utf-8") as output:
        json.dump(fixture, output, indent=2, sort_keys=True)
        output.write("\n")
    return fixture


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="app/importer/fixtures/overpass-recorded.json")
    parser.add_argument("--output", default="frontend/admin/src/services/generated-map-fixture.json")
    parser.add_argument("--imported-at", default="2026-08-24")
    args = parser.parse_args()
    generate(args.input, args.output, imported_at=args.imported_at)


if __name__ == "__main__":
    main()
