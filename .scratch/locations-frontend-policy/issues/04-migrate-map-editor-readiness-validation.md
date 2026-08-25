# 04: Migrate Map Editor readiness validation

**What to build:** Make Map Editor validation use the shared Location policy's map-readiness context. Administrators can keep valid outdoor Location records before placement, while map saves clearly require usable outdoor coordinates and continue to keep indoor destinations attached to their parent Buildings rather than plotted outdoors.

**Blocked by:** 01: Expand the shared Location policy seam.

**Status:** complete

- [x] Map Editor evaluates Location readiness through the shared policy rather than maintaining local child-type, parent, and coordinate rules.
- [x] An unpositioned Building or Facility remains a valid ordinary record but receives a clear readiness issue when included in a map save that requires placement.
- [x] A positioned outdoor Location requires a valid latitude/longitude pair within geographic bounds.
- [x] Room, Office, Laboratory, Restroom, and Floor remain unpositioned and cannot gain outdoor coordinates through map editing.
- [x] Indoor children and Floors require an existing Building parent when evaluated for map readiness.
- [x] Readiness messages distinguish missing map placement from an intrinsically invalid Location record.
- [x] Existing change detection, node validation, pathway validation, preview, and save behavior remain unchanged outside Location policy evaluation.
- [x] Map-editing tests cover valid unpositioned records in record context, the same records failing readiness until positioned, invalid indoor coordinates, missing parents, and non-Building parents.
- [x] Tests assert observable validation results and save eligibility rather than internal policy calls.
- [x] The ticket is demoable by positioning an outdoor Location successfully and by receiving a precise readiness issue for an unpositioned one.
