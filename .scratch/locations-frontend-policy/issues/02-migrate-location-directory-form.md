# 02: Migrate the Location directory form

**What to build:** Make Add/Edit Location behavior use the shared policy from user input through save intent. Administrators receive immediate, consistent form behavior when changing a Location type, choosing a parent Building, entering coordinates, or correcting invalid data, and the form no longer presents two independent-looking purpose fields backed by one value.

**Blocked by:** 01: Expand the shared Location policy seam.

**Status:** complete

- [x] Add and Edit workflows classify Location types through the shared policy rather than maintaining a local child-type rule.
- [x] Selecting an indoor child type requires a valid parent Building and prevents outdoor coordinate placement.
- [x] Changing from an outdoor type to an indoor child clears incompatible coordinates and derives an unpositioned state atomically.
- [x] Changing to a standalone outdoor type clears incompatible parent, Building-name, and floor metadata atomically.
- [x] Selecting or clearing a parent derives or clears the denormalized Building name through policy normalization.
- [x] Latitude and longitude edits cannot leave placement state inconsistent with the coordinate pair.
- [x] Policy issues are shown as actionable, user-visible form validation rather than surfacing only after an adapter rejects the save.
- [x] The form exposes one canonical purpose/description input backed by the existing domain value; no duplicate input silently overwrites it.
- [x] Any field visually marked as required in this workflow is enforced before save intent proceeds.
- [x] Existing Add Room, edit-child, success, cancellation, and map-placement navigation behavior remains intact.
- [x] Directory tests assert user-visible transitions and validation outcomes without asserting internal policy helpers.
- [x] The ticket is demoable by creating and editing indoor and outdoor Locations through the directory with normalized resulting records.
