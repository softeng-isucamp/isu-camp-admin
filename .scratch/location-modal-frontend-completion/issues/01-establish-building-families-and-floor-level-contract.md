# 01: Establish representative Building families and Floor Level contract

**What to build:** Make the default Locations directory immediately demonstrate the agreed Campus Locations model. Populate three existing Buildings with a realistic mixture of Indoor Locations across multiple Floor Levels, and establish the compatibility behavior that lets the frontend derive floor groupings from Indoor Location metadata without requiring new Floor records.

**Blocked by:** None (can start immediately).

**Status:** complete

- [x] The default mock directory contains approximately fifteen Rooms, Offices, Laboratories, and Restrooms distributed across three existing Buildings.
- [x] Seeded Indoor Locations have meaningful names, codes, descriptions, keywords, and a useful mixture of statuses.
- [x] Every seeded Indoor Location references an existing Building directly and carries a specific Floor Level.
- [x] Seeded Indoor Locations have no outdoor coordinates and are not independently positioned.
- [x] Expanding the seeded Buildings visibly groups their Indoor Locations beneath derived Floor Level headings.
- [x] At least one Building remains without Indoor Locations so the empty-Building state remains reviewable.
- [x] Existing Indoor Locations without floor metadata remain visible under Unspecified Floor.
- [x] Existing Floor records remain readable as compatibility data and do not become normal actionable Campus Locations.
- [x] The shared Location policy expresses the agreed Building, Indoor Location, and Floor Level rules without duplicating classifications in new callers.
- [x] Tests prove the representative dataset and observable hierarchy through stable policy, service, or rendered-page behavior rather than fixture internals.
