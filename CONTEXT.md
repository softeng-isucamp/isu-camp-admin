# Kumpas Campus Admin

The admin side of Kumpas, a campus navigation system: admins maintain the campus directory and map that the companion User App navigates.

## Language

### Usage analytics

**Search**:
A signed-in User App user previewing the route to a Destination or starting navigation to it, recorded once per navigation session. Selecting or viewing a Destination alone is not a Search.
_Avoid_: Query, selection (typed text and opened Destinations that never reach a route preview are not recorded)

**Visit**:
A User App user arriving at the Destination they navigated to: their position comes within reach of the Destination's map pin. An indoor Location's Visit is an arrival at its Building.
_Avoid_: Search (a Search does not imply the user arrived)

**Arrival rate**:
Visits divided by Searches for the same Destination over the same period. A low rate means users look for a place but don't reach it.

**Destination**:
A Building or indoor Location that a user can Search for and Visit.

## Relationships

- A **Visit** follows a **Search** for the same **Destination**; not every **Search** ends in a **Visit**

## Flagged ambiguities

- "Most visited" was proposed for what the system recorded as Searches — resolved: a **Visit** is an arrival, distinct from a **Search**.
- "Search" was first defined as selecting a Destination — resolved: the User App records a Search only on route preview or navigation start.
