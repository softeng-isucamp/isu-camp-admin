import os

import pytest
import psycopg2
from dotenv import load_dotenv


load_dotenv(os.path.join(os.path.dirname(__file__), "..", "..", ".env"))


def test_location_type_seed_supports_indoor_location_inserts():
    database_url = os.getenv("SUPABASE_DATABASE_URL")
    if not database_url:
        pytest.skip("SUPABASE_DATABASE_URL is not configured")

    connection = psycopg2.connect(database_url)
    try:
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT type_id, type_name FROM public.location_type "
                "WHERE type_id IN (1, 2, 3, 4, 5) ORDER BY type_id"
            )
            assert cursor.fetchall() == [
                (1, "Room"),
                (2, "Laboratory"),
                (3, "Office"),
                (4, "Facility"),
                (5, "Restroom"),
            ]
    finally:
        connection.close()
