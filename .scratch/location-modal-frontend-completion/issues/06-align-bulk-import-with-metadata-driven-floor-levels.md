# 06: Align Bulk Import with metadata-driven Floor Levels

**What to build:** Make Bulk Import teach and enforce the same Building and Floor Level model as direct editing. Administrators must be able to import complete Building families with Indoor Locations referencing Buildings directly, while legacy Floor records remain readable compatibility data rather than the recommended creation path.

**Blocked by:** 01: Establish representative Building families and Floor Level contract.

**Status:** done

- [ ] The downloadable template demonstrates a Building, multiple Building-parented Indoor Locations on Floor Levels, and a standalone outdoor Facility.
- [ ] New template examples do not create or require Floor records.
- [ ] Imported Indoor Locations require a valid Building parent and a specific standard or normalized custom Floor Level.
- [ ] Parent references resolve against existing Buildings and Buildings in the same pending batch regardless of row order.
- [ ] Indoor coordinates and independent positioned state are rejected or normalized consistently with direct editing policy.
- [ ] Existing legacy Floor records remain readable without making Floor a recommended import type.
- [ ] Preview and commit remain all-or-nothing: any invalid hierarchy or Floor Level prevents every row from being committed.
- [ ] Per-row errors identify the relevant field and reason.
- [ ] Add and update modes retain their established duplicate and matching semantics.
- [ ] A successful import refreshes the directory, preserves usable pagination, and displays imported Building families correctly.
- [ ] Service-boundary tests cover template content, batch parents, custom Floor Levels, invalid relationships, atomic failure, and successful commit.
- [ ] Rendered-page tests cover the user-visible template, file selection, validation result, commit result, and resulting hierarchy.
