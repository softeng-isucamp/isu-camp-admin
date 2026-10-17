"""Builds the VetMed intent dataset from the campus directory in the database.

The file this writes used to be hand-maintained, and had drifted from the
directory it describes: it trained a "food court of VMC" that the database has
no record of, a generic "classroom" where the database holds named rooms, and
a "veterinary medicine laboratory" that is actually called "VetMed Laboratory".
Generating it instead means the dataset says what the directory says, and
saying it again after the directory changes costs one command.

Every destination, and every way of naming one, is read from the directory:
a row's name, its ``keywords`` - which is where the directory already records
what people call a place - its type, and the building holding it. Nothing
about the campus is written here. Phrasings are authored, because a query has
to be worded somehow, but what they are worded about comes only from the
database, and a query is never emitted for a place the directory does not
hold.

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
# answer. The bare name comes first because it is the common case: people type
# "surgery room", not a sentence.
#
# Proximity phrasings are deliberately absent. "Where is the nearest Surgery
# Room?" asks the search to rank a list of one - every destination here is a
# single named place - so it teaches a comparison that never happens.
TEMPLATES = (
    "{name}",
    "{name} location",
    "Where is the {name}?",
    "Where is {name}?",
    "Find the {name}.",
    "Find {name}.",
    "How can I find the {name}?",
    "Where can I find the {name}?",
    "Show me the {name} on the map.",
    "Show me the {name}.",
    "How do I get to the {name}?",
    "Directions to the {name}.",
    "Take me to the {name}.",
    "Go to the {name}.",
    "Locate the {name}.",
)

# How an indoor place is named together with the building holding it. The bare
# join is first because it is what a search box receives - "pharmacy vet
# clinic" - and the prepositions are the same thing written out.
CONTAINER_JOINS = (
    "{inner} {outer}",
    "{inner} of {outer}",
    "{inner} in {outer}",
    "{inner} at {outer}",
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


def clean(values):
    """Tidy, de-duplicated text, keeping the directory's own capitalisation."""

    seen = {}
    for value in values:
        text = " ".join((value or "").split())
        if len(text) < 2:
            continue
        seen.setdefault(text.lower(), text)
    return list(seen.values())


# How directly a phrasing names a place. A form is awarded to the destination
# that names it most directly, and is only ambiguous when two destinations tie.
#
# Without this, a form derived for one place can take a name away from
# another: the clinic lists "School of Veterinary Medicine" as a keyword, and
# suffixing its classification turns that into "School of Veterinary Medicine
# Building", which is the School's actual name. Ranking stops a derived
# phrasing from outranking a real one.
NAME, KEYWORD, DERIVED = 0, 1, 2


def own_forms(name, keywords):
    """What a place is called by itself: its name and its recorded keywords."""

    forms = {}
    for text in clean([name]):
        forms[text] = NAME
    for text in clean((keywords or "").split(",")):
        forms.setdefault(text, KEYWORD)
    return forms


def derive(forms, make):
    """New phrasings built from existing ones, never outranking them."""

    derived = dict(forms)
    for text in clean(make(form) for form in forms):
        derived.setdefault(text, DERIVED)
    return derived


def resolve_ownership(entries):
    """For each phrasing, the destinations that name it most directly.

    More than one slug means the phrasing is contested and belongs to nobody.
    """

    best = {}
    for entry in entries:
        for form, rank in entry["forms"].items():
            key = form.lower()
            if key not in best or rank < best[key][0]:
                best[key] = (rank, {entry["slug"]})
            elif rank == best[key][0]:
                best[key][1].add(entry["slug"])
    return best


def unambiguous_forms(entry, ownership):
    """The phrasings this entry alone names."""

    return [form for form in entry["forms"]
            if ownership[form.lower()][1] == {entry["slug"]}]


def read_destinations(cursor):
    """Active Buildings and indoor Locations this dataset covers.

    Only active rows: a deactivated place is not one the User App routes to,
    so training for it teaches a destination the app will refuse.
    """

    cursor.execute(
        """
        select building_id, building_name, coalesce(keywords, ''),
               coalesce(classification, '')
        from public.building
        where status = 'active'
        order by building_name
        """
    )

    buildings = {}
    for building_id, name, keywords, classification in cursor.fetchall():
        if not SUBJECT.search(f"{name} {keywords}"):
            continue
        forms = own_forms(name, keywords)
        # "Veterinary Medicine Clinic building", from the row's own
        # classification, for names that do not already end that way.
        if classification:
            forms = derive(forms, lambda form: (
                "" if form.lower().endswith(classification.lower())
                else f"{form} {classification}"
            ))
        buildings[building_id] = {"slug": slug(name), "forms": forms}

    cursor.execute(
        """
        select l.building_id, l.location_name, coalesce(l.keywords, ''),
               coalesce(t.type_name, ''), b.building_name
        from public.location l
        join public.building b on b.building_id = l.building_id
        left join public.location_type t on t.type_id = l.type_id
        where l.status = 'active' and b.status = 'active'
        order by b.building_name, l.location_name
        """
    )

    # Which phrasings each building alone names, settled before any room is
    # described as being inside one. The clinic lists "School of Veterinary
    # Medicine" among its keywords, and that phrase is the School's name, so
    # joining a room to it would place the room in the wrong building -
    # "Pharmacy of School of Veterinary Medicine" for a pharmacy that is in
    # the clinic. A contested phrasing names no building, so no room is put
    # inside it.
    building_ownership = resolve_ownership(buildings.values())
    for building in buildings.values():
        building["container_forms"] = unambiguous_forms(building, building_ownership)

    locations = []
    for building_id, name, keywords, type_name, building_name in cursor.fetchall():
        holder = buildings.get(building_id)
        if holder is None and not SUBJECT.search(f"{name} {keywords}"):
            continue

        inner = own_forms(name, keywords)
        # The room's type is another way to ask for it - "laboratory of the
        # vet clinic". Where a building holds more than one of a type the
        # phrasing names several destinations, and build_rows drops it.
        if type_name:
            inner.setdefault(type_name, DERIVED)

        forms = dict(inner)
        for outer in (holder or {}).get("container_forms", []):
            for join in CONTAINER_JOINS:
                for form in inner:
                    forms.setdefault(join.format(inner=form, outer=outer), DERIVED)

        locations.append({
            # Qualified by its building: two buildings may each hold a
            # "Storage Room", and a bare slug would train both onto one label.
            "slug": f"{slug(building_name)}__{slug(name)}",
            "forms": forms,
        })

    return list(buildings.values()) + locations


def build_rows(destinations):
    """Query/target pairs, with every ambiguous phrasing dropped.

    Buildings 21 and 36 share keywords in the live directory - "VetMed" and
    "veterinary medicine" name both - and a type names every room of that type
    in its building. A form claimed by more than one destination would emit the
    same query under two labels and teach the classifier that the question has
    no answer. Dropping it is the honest outcome, and the dropped forms are
    reported so the directory can be fixed where the overlap was not intended.
    """

    best = resolve_ownership(destinations)

    ambiguous = {form for form, (_rank, owners) in best.items() if len(owners) > 1}

    rows = []
    seen = set()
    for destination in destinations:
        for form in destination["forms"]:
            key = form.lower()
            # Dropped if it is contested, and skipped if another destination
            # names it more directly than this one does.
            if key in ambiguous or destination["slug"] not in best[key][1]:
                continue
            for template in TEMPLATES:
                query = template.format(name=form)
                if query.lower() in seen:
                    continue
                seen.add(query.lower())
                rows.append((query, destination["slug"]))

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
        print(f"  {per_target[target]:5}  {target}")

    if ambiguous:
        print(f"\n{len(ambiguous)} phrasing(s) name more than one destination and were dropped.")
        print("Fix the overlap in the directory where it was not intended:")
        for form in ambiguous:
            print(f"  - {form}")


if __name__ == "__main__":
    main()
