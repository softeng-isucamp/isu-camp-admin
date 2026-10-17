"""Builds the VetMed intent dataset from the campus directory in the database.

The file this writes used to be hand-maintained, and had drifted from the
directory it describes: it trained a "food court of VMC" that the database has
no record of, a generic "classroom" where the database holds named rooms, and
a "veterinary medicine laboratory" that is actually called "VetMed Laboratory".
Generating it instead means the dataset says what the directory says, and
saying it again after the directory changes costs one command.

Surface forms come from each destination's own name and its ``keywords``
column, which is where the directory already records what people call a place.
Nothing is invented here.

Usage:
    python scripts/generate_vetmed_queries.py [output.csv]

Reads SUPABASE_DATABASE_URL the same way the application does.
"""

import csv
import os
import re
import sys
from collections import defaultdict
from pathlib import Path
from urllib.parse import urlsplit

import psycopg2
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / ".claude" / "vetmed_queries.csv"

# Which part of the directory this dataset covers. Matched against a
# destination's name and keywords, so widening the dataset is a change here
# rather than a change to the queries.
SUBJECT = re.compile(r"\bvet\b|vetmed|veterinar", re.I)

# What someone types into a search box, which is all this dataset has to
# answer. A subset of the phrasings in the hand-written file this replaces -
# every one here appeared there, so nothing new is being invented.
#
# The bare name comes first because it is the common case: people type
# "surgery room", not a sentence.
TEMPLATES = (
    "{name}",
    "Where is the {name}?",
    "Find the {name}.",
    "How can I find the {name}?",
    "Show me the {name} on the map.",
)

# Deliberately not generated, and why:
#
# The proximity phrasings - "Where is the nearest {name}?", "Find the closest
# {name}.", "Which {name} is closest to me?", "Locate the nearest {name} from
# here.", "I need the closest {name}.", "Show the nearest {name} to my current
# location." - ask a question the directory cannot have. Every destination
# here is a single named place: there is one Surgery Room, one Pharmacy. A
# "nearest" that ranks one candidate teaches a comparison that never happens,
# and it is the phrasing that made the old hand-written file look larger than
# it was.
#
# The conversational ones - "I am looking for the {name}.", "Help me locate
# the {name}.", "Can you point me to the {name}?", "I need directions to the
# {name}." - are assistant phrasings, not search input. They inflate the row
# count with restatements of "Where is the {name}?" and teach nothing the
# first three templates do not already carry.

# Questions that name a VetMed destination but are not asking to be taken
# there. They are the dataset's only hand-written rows, because nothing in a
# campus directory can imply them, and without them every mention of a clinic
# is read as a request for directions.
OUT_OF_SCOPE = (
    "Who is the dean of the School of Veterinary Medicine?",
    "What courses does the School of Veterinary Medicine offer?",
    "Is the Veterinary Medicine Clinic open right now?",
    "What are the clinic hours of the Veterinary Medicine Clinic?",
    "How much does a dog vaccination cost?",
    "Can I bring my cat for a check-up?",
    "Who is the veterinarian on duty?",
    "What is the contact number of the Veterinary Medicine Clinic?",
    "Do you treat large animals like carabao?",
    "How do I enroll in the School of Veterinary Medicine?",
    "Is there a class in the anatomy laboratory today?",
    "What time does the Veterinary Medicine Clinic open?",
    "Do I need an appointment at the vet clinic?",
    "What are the requirements for the DVM program?",
)


def connect():
    load_dotenv(ROOT / "app" / "services" / ".env")
    load_dotenv(ROOT / ".env")
    load_dotenv()

    url = os.getenv("SUPABASE_DATABASE_URL")
    if not url:
        raise SystemExit("SUPABASE_DATABASE_URL is not set.")

    parsed = urlsplit(url)
    return psycopg2.connect(
        host=parsed.hostname,
        port=parsed.port or 5432,
        user=parsed.username or "postgres",
        password=parsed.password or "",
        dbname=(parsed.path or "/postgres").lstrip("/") or "postgres",
        sslmode=os.getenv("PGSSLMODE", "require"),
    )


def slug(value):
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", value.lower())).strip("_")


def surface_forms(name, keywords):
    """What a place can be called: its name, plus the keywords already recorded.

    Deduplicated case-insensitively, keeping the first spelling seen, because
    the templates read better with the directory's own capitalisation.
    """

    seen = {}
    for value in [name, *(keywords or "").split(",")]:
        text = " ".join(value.split())
        if len(text) < 2:
            continue
        seen.setdefault(text.lower(), text)
    return list(seen.values())


def read_destinations(cursor):
    """Active Buildings and indoor Locations this dataset covers.

    Only active rows: a deactivated place is not one the User App routes to,
    so training for it teaches a destination the app will refuse.
    """

    cursor.execute(
        """
        select building_id, building_name, coalesce(keywords, '')
        from public.building
        where status = 'active'
        order by building_name
        """
    )
    buildings = [
        {"slug": slug(name), "name": name, "forms": surface_forms(name, keywords)}
        for _id, name, keywords in cursor.fetchall()
        if SUBJECT.search(f"{name} {keywords}")
    ]
    covered = {entry["slug"] for entry in buildings}

    cursor.execute(
        """
        select l.location_name, coalesce(l.keywords, ''), b.building_name
        from public.location l
        join public.building b on b.building_id = l.building_id
        where l.status = 'active' and b.status = 'active'
        order by b.building_name, l.location_name
        """
    )
    locations = []
    for name, keywords, building in cursor.fetchall():
        if slug(building) not in covered and not SUBJECT.search(f"{name} {keywords}"):
            continue
        # Qualified by its building: two buildings may each hold a "Storage
        # Room", and a bare slug would train both onto one label.
        locations.append({
            "slug": f"{slug(building)}__{slug(name)}",
            "name": name,
            # The building is part of how an indoor place is asked for, so it
            # is a surface form of its own rather than only a disambiguator.
            "forms": surface_forms(name, keywords) + [f"{name} of {building}"],
        })

    return buildings + locations


def build_rows(destinations):
    """Query/target pairs, with every ambiguous phrasing dropped.

    Buildings 21 and 36 share keywords in the live directory - "VetMed" and
    "veterinary medicine" name both - so a form claimed by more than one
    destination would emit the same query under two labels and teach the
    classifier that the question has no answer. Dropping it is the honest
    outcome, and the dropped forms are reported so the directory can be fixed
    where the overlap was not intended.
    """

    claimed = defaultdict(set)
    for destination in destinations:
        for form in destination["forms"]:
            claimed[form.lower()].add(destination["slug"])

    ambiguous = {form for form, owners in claimed.items() if len(owners) > 1}

    rows = []
    seen = set()
    for destination in destinations:
        for form in destination["forms"]:
            if form.lower() in ambiguous:
                continue
            for template in TEMPLATES:
                query = template.format(name=form)
                if query.lower() in seen:
                    continue
                seen.add(query.lower())
                rows.append((query, destination["slug"]))

    for question in OUT_OF_SCOPE:
        if question.lower() not in seen:
            seen.add(question.lower())
            rows.append((question, "none"))

    return rows, sorted(ambiguous)


def main():
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_OUTPUT

    with connect() as connection:
        with connection.cursor() as cursor:
            destinations = read_destinations(cursor)

    rows, ambiguous = build_rows(destinations)

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, quoting=csv.QUOTE_ALL)
        writer.writerow(("query", "target"))
        writer.writerows(rows)

    per_target = defaultdict(int)
    for _query, target in rows:
        per_target[target] += 1

    print(f"{output}: {len(rows)} rows across {len(per_target)} targets")
    for target in sorted(per_target, key=lambda key: (-per_target[key], key)):
        print(f"  {per_target[target]:4}  {target}")

    if ambiguous:
        print(f"\n{len(ambiguous)} phrasing(s) name more than one destination and were dropped.")
        print("Fix the overlap in the directory's keywords if that was not intended:")
        for form in ambiguous:
            print(f"  - {form}")


if __name__ == "__main__":
    main()
