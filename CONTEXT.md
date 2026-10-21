# Kumpas Campus Admin

The admin side of Kumpas, a campus navigation system: admins maintain the campus directory and map that the companion User App navigates.

## Language

### Usage analytics

**Search**:
A signed-in User App user previewing the route to a Destination or starting navigation to it, recorded once per navigation session. Selecting or viewing a Destination alone is not a Search.
_Avoid_: Query, selection (typed text and opened Destinations that never reach a route preview are not recorded)

**Visit**:
A User App user arriving at the Destination they navigated to: their position comes within reach of the Destination's map pin. An indoor Location's Visit is an arrival at its Place.
_Avoid_: Search (a Search does not imply the user arrived)

**Arrival rate**:
Visits divided by Searches for the same Destination over the same period. A low rate means users look for a Destination but don't reach it.

**Destination**:
A Place or indoor Location that a user can Search for and Visit.

### Places and Locations

**Place**:
Anything outdoors on the campus map, drawn as a footprint and given exactly one Classification. Covers both buildings and open areas such as parking lots and ovals.
_Avoid_: Building (only some Places are buildings), site, structure

**Classification**:
The kind of a Place, which also decides whether it can contain indoor Locations. One of College, Campus Services, Food, Parking, or Facility, and every Place has exactly one. The legacy value Building, carried by Places recorded before these Classifications existed, was retired once all of them had been classified.
_Avoid_: Building type, category, unclassified

**College**:
A Place whose primary occupant is an academic unit (a college, school, or institute) and which is used mainly for classes or research. Can contain indoor Locations. Graduate School and Laboratory High School are Colleges.
_Avoid_: Academic building, department

**Campus Services**:
Any Place that can contain indoor Locations and is not a College, such as administration offices, the infirmary, the library, or the student center.
_Avoid_: Executive, Non-Academic, Administrative (too narrow: it misses clinics and the library)

**Food**:
A standalone Place for eating, such as a canteen or food court. Cannot contain indoor Locations. A canteen inside a College or Campus Services Place is an indoor Location, not Food.
_Avoid_: Canteen (as a Classification name)

**Parking**:
An outdoor area for parking vehicles. Cannot contain indoor Locations.

**Facility**:
Any other outdoor area or open structure that people go to for its own sake, such as an oval, grandstand, open gym, or open study area. Cannot contain indoor Locations. It is not a placeholder for "not classified yet".
_Avoid_: Using Facility for a building that has no recorded indoor Locations yet

**Location**:
An indoor destination inside a College or Campus Services Place, on a Floor. Its type is Room, Office, Laboratory, or Restroom.
_Avoid_: Area, space

**Room**:
An enclosed indoor space whose primary purpose is not covered by Office, Laboratory, or Restroom: classrooms, lounges, study rooms, meeting rooms. An open seating area in a corridor is not a Room.
_Avoid_: Common area, classroom (as separate types)

**Office**:
An indoor Location where staff work and visitors come to transact or meet someone, such as the Registrar, a Dean's Office, or a Faculty Room.

**Laboratory**:
An indoor Location with specialized equipment for classes or research, such as a computer lab or science lab.

**Restroom**:
An indoor Location with toilets.
_Avoid_: Comfort room (as a type)

## Relationships

- A **College** or **Campus Services** Place contains zero or more **Locations**; **Food**, **Parking**, and **Facility** contain none
- A Place's **Classification** is decided by its primary occupant when it serves several purposes
- An indoor Location fitting several types takes the first that applies: **Restroom**, **Laboratory**, **Office**, then **Room**
- A **Visit** follows a **Search** for the same **Destination**; not every **Search** ends in a **Visit**

## Flagged ambiguities

- "Most visited" was proposed for what the system recorded as Searches — resolved: a **Visit** is an arrival, distinct from a **Search**.
- "Building" was used for everything outdoors on the map, including parking lots and ovals — resolved: the umbrella term is **Place** ("Site" was considered and dropped); a building is one kind of Place. In this glossary, lowercase "place" is not used as a general word.
- Facility was used both for open outdoor areas and as a "not sure yet" label — resolved: **Facility** is an outdoor Place with no indoor Locations; uncertainty is not a Classification.
- "Executive" and "Non-Academic" were proposed for non-College Places that contain Locations — resolved: **Campus Services**, defined as everything that can contain Locations and is not a College.
- Parking and canteens were proposed as indoor Location types — resolved: they are outdoor **Classifications**; a canteen inside a Place is a **Room** or **Office** Location.
- "Search" was first defined as selecting a Destination — resolved: the User App records a Search only on route preview or navigation start.
