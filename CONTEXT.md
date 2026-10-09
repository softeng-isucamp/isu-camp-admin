# Kumpas Campus Admin

The admin side of Kumpas, a campus navigation system: admins maintain the campus directory and map that the companion User App navigates.

## Language

### Usage analytics

**Search**:
A User App user selecting a Destination to navigate to.
_Avoid_: Query (typed text that leads nowhere is not recorded)

**Visit**:
A User App user arriving at the Destination they navigated to: their position comes within reach of the Destination's map pin. An indoor Location's Visit is an arrival at its Building.
_Avoid_: Search, selection (a Search does not imply the user arrived)

**Arrival rate**:
Visits divided by Searches for the same Destination over the same period. A low rate means users look for a place but don't reach it.

**Destination**:
A Building or indoor Location that a user can Search for and Visit.

## Relationships

- A **Visit** follows a **Search** for the same **Destination**; not every **Search** ends in a **Visit**

## Flagged ambiguities

- "Most visited" was proposed for what the system recorded as Searches — resolved: a **Visit** is an arrival, distinct from a **Search**.
