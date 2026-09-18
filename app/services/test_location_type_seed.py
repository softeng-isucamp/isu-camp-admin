import os
from pathlib import Path
from uuid import uuid4

import psycopg2
import pytest
from dotenv import load_dotenv


ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")


def _migration_body(path: Path, schema: str) -> str:
    statements = [
        line
        for line in path.read_text().splitlines()
        if line.strip() not in {"BEGIN;", "COMMIT;"}
    ]
    return "\n".join(statements).replace("public.", f"{schema}.").replace(
        "'public'",
        f"'{schema}'",
    )


def test_location_type_seed_and_facility_cleanup_migration_contract():
    database_url = os.getenv("SUPABASE_DATABASE_URL")
    if not database_url:
        pytest.skip("SUPABASE_DATABASE_URL is not configured")

    schema = f"facility_migration_test_{uuid4().hex}"
    connection = psycopg2.connect(database_url)
    try:
        with connection.cursor() as cursor:
            cursor.execute(f"CREATE SCHEMA {schema}")
            cursor.execute(
                f"""
                CREATE TABLE {schema}.location_type (
                  type_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                  type_name VARCHAR NOT NULL UNIQUE,
                  description TEXT
                );
                CREATE TABLE {schema}.building (
                  building_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                  building_code VARCHAR NOT NULL UNIQUE,
                  building_name VARCHAR NOT NULL,
                  classification VARCHAR(32) NOT NULL DEFAULT 'Building',
                  description TEXT,
                  latitude NUMERIC,
                  longitude NUMERIC,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                  polygon_coordinates JSONB
                );
                CREATE TABLE {schema}.location (
                  location_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                  building_id BIGINT REFERENCES {schema}.building(building_id)
                    ON DELETE CASCADE,
                  floor_id BIGINT,
                  type_id BIGINT NOT NULL REFERENCES {schema}.location_type(type_id)
                    ON DELETE RESTRICT,
                  location_code VARCHAR NOT NULL UNIQUE,
                  location_name VARCHAR NOT NULL,
                  description TEXT,
                  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                  keywords TEXT,
                  photo BYTEA
                );
                CREATE TABLE {schema}.route_node (
                  node_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
                  location_id BIGINT REFERENCES {schema}.location(location_id)
                    ON DELETE SET NULL,
                  building_id BIGINT REFERENCES {schema}.building(building_id)
                    ON DELETE SET NULL
                );
                """
            )

            cursor.execute(
                _migration_body(
                    ROOT / "migrations" / "20260913_seed_location_types.sql",
                    schema,
                )
            )
            cursor.execute(
                f"SELECT type_id, type_name FROM {schema}.location_type ORDER BY type_id"
            )
            assert cursor.fetchall() == [
                (1, "Room"),
                (2, "Laboratory"),
                (3, "Office"),
                (5, "Restroom"),
            ]

            cursor.execute(
                f"""
                INSERT INTO {schema}.location_type(type_id, type_name)
                OVERRIDING SYSTEM VALUE VALUES (4, 'Facility');
                INSERT INTO {schema}.building(
                  building_id, building_code, building_name
                ) OVERRIDING SYSTEM VALUE VALUES (50, 'ENG', 'Engineering Hall');
                INSERT INTO {schema}.location(
                  location_id, type_id, location_code, location_name,
                  description, created_at, updated_at
                ) OVERRIDING SYSTEM VALUE VALUES (
                  70, 4, 'COURT', 'Covered Court', 'Open gym',
                  '2024-01-02T03:04:05Z', '2025-02-03T04:05:06Z'
                );
                INSERT INTO {schema}.route_node(location_id) VALUES (70);
                """
            )

            cursor.execute(
                _migration_body(
                    ROOT
                    / "migrations"
                    / "20260918_remove_legacy_facility_location_type.sql",
                    schema,
                )
            )

            cursor.execute(
                f"SELECT type_id, type_name FROM {schema}.location_type ORDER BY type_id"
            )
            assert cursor.fetchall() == [
                (1, "Room"),
                (2, "Laboratory"),
                (3, "Office"),
                (5, "Restroom"),
            ]
            cursor.execute(
                f"SELECT COUNT(*) FROM {schema}.location WHERE type_id = 4"
            )
            assert cursor.fetchone() == (0,)
            cursor.execute(
                f"""
                SELECT building_id, building_code, building_name, classification,
                       description, created_at, updated_at
                FROM {schema}.building
                WHERE building_id = 70
                """
            )
            migrated = cursor.fetchone()
            assert migrated[:5] == (
                70,
                "COURT",
                "Covered Court",
                "Facility",
                "Open gym",
            )
            assert migrated[5].isoformat() == "2024-01-02T03:04:05+00:00"
            assert migrated[6].isoformat() == "2025-02-03T04:05:06+00:00"
            cursor.execute(
                f"SELECT location_id, building_id FROM {schema}.route_node"
            )
            assert cursor.fetchone() == (None, 70)
            cursor.execute(
                f"SELECT nextval(pg_get_serial_sequence('{schema}.building', 'building_id'))"
            )
            assert cursor.fetchone() == (71,)
    finally:
        connection.rollback()
        connection.close()
