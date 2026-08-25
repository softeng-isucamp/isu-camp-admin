# 03: Migrate save and bulk-import validation

**What to build:** Apply the shared Location policy to direct persistence and bulk-import preview/commit. Administrators get the same parent, coordinate, placement, and required-field rules whether they save one Location or import a batch, while existing matching and all-or-nothing import behavior remains unchanged.

**Blocked by:** 01: Expand the shared Location policy seam.

**Status:** ready-for-agent

- [ ] Direct Location saves evaluate and normalize records through the shared policy rather than a separate copy of Location invariants.
- [ ] Bulk-import preview evaluates every pending record through the shared policy before commit.
- [ ] Indoor children and Floors must reference a Building, not merely an existing Location of any type.
- [ ] Parent Buildings may resolve from existing records or valid pending rows in the same batch, independent of row order.
- [ ] Indoor children and Floors with outdoor coordinates or a positioned state are rejected with row- and field-associated issues.
- [ ] Outdoor Locations accept either no coordinates or a valid pair within geographic bounds during ordinary record validation.
- [ ] Placement state and denormalized Building name are normalized from authoritative imported values and resolved parents.
- [ ] Import remains preview-before-commit and all-or-nothing: any policy issue prevents every row from being committed.
- [ ] Existing Add-new and Update-existing matching, duplicate detection, audit behavior, and template shape remain unchanged.
- [ ] Direct-save and import errors retain actionable user-facing meaning without adapters parsing unstable exception text.
- [ ] Tests cover non-Building parents, batch Building parents, invalid coordinate pairs, child placement, Floor policy, and unchanged totals after failed imports.
- [ ] The ticket is verifiable through both a successful mixed Building hierarchy import and a rejected batch that leaves persisted data untouched.

