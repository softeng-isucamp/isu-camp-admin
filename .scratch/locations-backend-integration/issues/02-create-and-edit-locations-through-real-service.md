# 02: Create and edit Locations through the real service

**Area:** Backend + Frontend

**What to build:** Administrators can create and edit Buildings, Indoor Locations, Outdoor Point Locations, and standalone Facilities through the real Locations service. Required fields, relational references, duplicate codes, Floor Level rules, and separate DESCRIPTION / KEYWORDS values are validated consistently, and successful changes remain visible after refetch or reload.

**Blocked by:** 01: Establish the persisted Location contract and authenticated list/search

**Status:** done

**Backend**

- [x] Valid create requests persist and return a normalized Location DTO.
- [x] Valid update requests persist identity and descriptive changes without overwriting keywords or function/description.
- [x] Required Building, type, and Floor Level rules match the Locations glossary and ADR 0001.
- [x] Invalid or missing relational references return clear field or relationship errors without partial writes.
- [x] Duplicate location codes return a predictable conflict response.
- [x] Successful create/update results are visible through a subsequent list request.
- [x] Backend tests cover create/update round trips, validation, relationship errors, conflicts, and transaction safety.

**Frontend**

- [x] The adapter sends the documented JSON or multipart request and unwraps the normalized response consistently.
- [x] Add/edit forms preserve separate DESCRIPTION and KEYWORDS / TAGS values.
- [x] The Locations page renders backend validation/conflict errors, successful saves, and refreshed persisted data.
- [x] Frontend service and UI tests cover request mapping, validation errors, success states, and refetch behavior.
