# Spec: Deepen frontend Location policy

Status: ready-for-agent
Triage: ready-for-agent

## Problem Statement

Administrators can create, edit, import, and position campus Locations through several frontend workflows, but those workflows do not agree on what makes a Location valid. Indoor child types are identified independently by the Locations directory, validation schemas, bulk import, and Map Editor. Parent requirements, coordinate rules, and derived placement state therefore vary depending on which workflow the administrator uses.

Today, the Locations directory can let an administrator prepare an indoor child with coordinates or without a parent Building, while later validation rejects that same record. Bulk import checks that a parent exists but does not consistently prove that the parent is a Building. Map editing applies stricter coordinate requirements than ordinary record editing, without expressing that the two workflows validate different readiness states. Type changes also require callers to manually clear or preserve parent, Building name, floor, coordinate, and placement fields in the correct order.

This policy leakage makes the current modules shallow: every caller must learn and reproduce Location invariants. It also creates misleading form behavior. Function / Purpose and Description appear as separate inputs while sharing one stored value, and fields described as required by the interface are optional in validation. A rule fixed in one workflow can remain broken in the others.

## Solution

Create one deep frontend Location policy module with a single public interface used by the Locations directory, validation/import, and Map Editor adapters. The module will own Location type classification, parent eligibility, coordinate consistency, placement derivation, and normalized draft transitions. Each adapter will provide workflow context and render or translate the policy result; it will not reimplement policy.

The policy will distinguish record validity from map readiness. A valid outdoor Location record may exist before it is positioned, while a map-ready outdoor Location must have valid paired coordinates. Indoor Locations remain unpositioned and must reference a valid parent Building. Derived fields such as the denormalized Building name and `positioned` state will be normalized from authoritative inputs instead of being independently maintained by callers.

The Location form will expose one canonical purpose/description value unless the domain model is deliberately expanded in a separate change. It will not render two independent-looking inputs backed by the same field. User-visible validation will come from the same policy interface used by imports and map editing, so a record accepted in one workflow is not unexpectedly rejected by another for the same validation context.

## User Stories

1. As an administrator, I want Location rules to be consistent across directory editing, bulk import, and map editing, so that a record accepted in one workflow behaves predictably in the others.
2. As an administrator, I want indoor Rooms, Offices, Laboratories, and Restrooms to require a parent Building, so that every indoor destination resolves to a real campus structure.
3. As an administrator, I want a child Location's parent reference to identify a Building rather than merely any existing Location, so that invalid hierarchies cannot be saved.
4. As an administrator, I want indoor child Locations to remain unpositioned on the outdoor map, so that rooms and offices do not create misleading outdoor markers.
5. As an administrator, I want changing a Location to an indoor child type to clear incompatible outdoor coordinates automatically, so that type changes do not leave an invalid draft.
6. As an administrator, I want changing a Location to a standalone outdoor type to clear incompatible parent and floor data automatically, so that stale hierarchy data is not retained.
7. As an administrator, I want selecting a parent Building to derive the stored Building name consistently, so that parent identifiers and displayed Building names cannot disagree.
8. As an administrator, I want clearing a parent Building to clear its derived Building name, so that removed relationships leave no stale metadata.
9. As an administrator, I want latitude and longitude to be accepted only as a pair, so that partially positioned Locations cannot be saved.
10. As an administrator, I want latitude values constrained to valid geographic bounds, so that impossible map positions are rejected with a useful message.
11. As an administrator, I want longitude values constrained to valid geographic bounds, so that impossible map positions are rejected with a useful message.
12. As an administrator, I want placement state derived from valid paired coordinates, so that the placement icon cannot contradict the stored coordinates.
13. As an administrator, I want an outdoor Building or Facility record to be saved before it is positioned, so that data entry and map calibration can remain separate workflows.
14. As an administrator, I want Map Editor readiness to require valid coordinates for outdoor Locations included in a map save, so that the saved map contains usable outdoor positions.
15. As an administrator, I want validation messages to explain the violated Location rule, so that I can correct a draft without guessing.
16. As an administrator, I want the Add Location form to prevent or explain invalid combinations before submission, so that avoidable save failures do not occur after I finish the form.
17. As an administrator, I want the Edit Location form to normalize legacy or inconsistent records when I change their type or parent, so that editing improves data quality rather than preserving contradictions.
18. As an administrator, I want bulk-import validation to apply the same parent and coordinate policy as direct editing, so that imported records are not privileged over manually entered records.
19. As an administrator, I want bulk-import parent checks to resolve both existing Buildings and valid Buildings within the pending batch, so that complete Building hierarchies can still be imported together.
20. As an administrator, I want a bulk import with policy violations to remain all-or-nothing, so that invalid Location relationships are not partially committed.
21. As an administrator, I want Map Editor validation to distinguish an invalid record from a record that is valid but not yet ready for the map, so that the error accurately describes the required action.
22. As an administrator, I want Floor relationship rules to be represented by the same policy module rather than inferred independently by each workflow, so that Floor records do not receive contradictory parent or placement treatment.
23. As an administrator, I want floor-level metadata on indoor Locations to use the supported floor values when present, so that directory grouping remains consistent.
24. As an administrator, I want one purpose/description input to map to one stored value, so that editing one visible field does not unexpectedly overwrite another.
25. As an administrator, I want fields marked required in the form to be required by validation as well, so that the interface and implementation communicate the same contract.
26. As a frontend contributor, I want one policy interface to describe Location invariants, so that I do not have to rediscover rules across multiple modules.
27. As a frontend contributor, I want type transitions to return normalized drafts, so that callers do not depend on a fragile sequence of state updates.
28. As a frontend contributor, I want policy evaluation to return structured issues, so that directory, import, and map adapters can present errors appropriately without parsing exception text.
29. As a frontend contributor, I want policy behavior testable without rendering the full Locations page or Map Editor, so that rule matrices remain fast and comprehensive.
30. As a frontend contributor, I want adapter tests to prove that each workflow delegates to the shared policy, so that future changes cannot silently reintroduce local rule copies.
31. As a frontend contributor, I want legacy Location fixtures evaluated against the shared policy, so that adopting the module reveals incompatible records before they cause regressions.
32. As a frontend contributor, I want the policy seam to remain independent of React, query caching, routing, and persistence transport, so that domain rules stay reusable and deterministic.

## Implementation Decisions

- Build one framework-independent frontend Location policy module. Its public interface is the primary seam for callers and tests.
- The policy interface will provide cohesive operations for classifying Location types, normalizing drafts after meaningful transitions, and evaluating a Location for a named workflow context. Internal helper functions remain implementation details rather than additional public seams.
- The existing Locations directory, validation/import, and Map Editor modules become adapters to the policy interface. They may translate user input or display structured issues, but they must not keep independent copies of child-type, parent, coordinate, or placement rules.
- Preserve the established indoor child classification for Room, Office, Laboratory, and Restroom. These types require a parent Building and cannot carry outdoor coordinates or a positioned state.
- Represent Floor policy explicitly in the shared module. A Floor may participate in the Building hierarchy, but callers must not infer its parent or placement behavior independently. Before enforcement, existing fixtures and workflows will be checked against the chosen canonical Floor rule; incompatible fixture data must be migrated in the same change rather than grandfathered through adapter exceptions.
- Building and Facility are outdoor-positionable types. Their records may be valid with no coordinates during directory entry or import, but paired valid coordinates are required when the record is evaluated for map readiness.
- Parent eligibility is validated by parent type, not only parent existence. Indoor children must reference a Building. Standalone outdoor types must not retain parent or floor metadata.
- The parent identifier is authoritative. The denormalized Building name is derived from the selected parent record and is cleared whenever the parent reference is cleared or becomes invalid.
- Latitude and longitude form one value-level invariant: both are absent or both are present and within valid geographic bounds.
- Placement state is derived from type and coordinates. Callers do not independently toggle `positioned` in response to individual field changes.
- Type and parent transitions are normalized atomically through the policy interface. Callers do not manually coordinate multiple field-clearing rules.
- Record validation and map-readiness validation are distinct contexts behind the same interface. This preserves the valid workflow in which an outdoor Location is created first and positioned later without weakening Map Editor requirements.
- Policy issues are structured and stable enough for adapters to associate an issue with a field or record. User-facing wording may be adapted by each workflow, but issue meaning is owned by the policy module.
- Bulk import retains preview-before-commit and all-or-nothing behavior. Its existing parsing, duplicate detection, and matching rules remain in their current module; only shared Location policy moves behind the new seam.
- The form will expose one canonical purpose/description field backed by the existing domain value. A separate Description field will not be added without a distinct domain-model decision and persistence contract.
- Any field presented as required must be enforced in the relevant policy context. Requiredness must not exist only as visual form metadata.
- Existing HTTP and local persistence adapters retain their current transport interfaces. This work changes frontend policy ownership, not transport contracts.
- Existing records and fixtures will be assessed through the new policy before strict adapter delegation is enabled. Necessary fixture normalization belongs to this work; silent adapter-specific exceptions do not.
- No additional seam will be introduced solely to make small helpers testable. The deletion test should continue to show that removing the policy module would spread its implementation back across at least three callers.

## Testing Decisions

- Good tests assert observable policy results and user-visible adapter behavior. They do not assert private helper calls, internal branch structure, module filenames, or the number of functions used by the implementation.
- The primary and highest shared test seam is the public Location policy interface. Most rule combinations will be tested directly through this seam without React rendering or persistence setup.
- Policy tests will use a table of Location types and workflow contexts to cover classification, allowed parents, coordinate eligibility, placement derivation, and record-versus-map readiness.
- Policy tests will verify atomic type transitions: outdoor to indoor, indoor to outdoor, child type to Floor, Floor to standalone, and changes involving existing parent, floor, and coordinate values.
- Policy tests will verify parent normalization: valid Building parent, missing parent, nonexistent parent, non-Building parent, cleared parent, and changed parent with a newly derived Building name.
- Policy tests will verify coordinate normalization and issues: both absent, both valid, latitude only, longitude only, out-of-range latitude, out-of-range longitude, and coordinates supplied for an indoor child.
- Policy tests will verify that placement state cannot contradict normalized type and coordinates.
- Policy tests will verify the canonical purpose/description value and required-field behavior without coupling to visual field markup.
- Directory adapter tests will remain at the existing React Testing Library seam and cover only user-visible integration: invalid combinations are prevented or explained, type changes clear incompatible values, parent selection derives Building metadata, and the single purpose/description field persists correctly.
- Validation and import adapter tests will remain at the existing frontend persistence seam and verify that shared policy issues reject invalid parent types, invalid coordinates, and invalid child placement while preserving all-or-nothing import behavior.
- Map Editor tests will remain at its existing editing-validation seam and verify the distinction between record validity and map readiness, including valid unpositioned outdoor records that require positioning before a map save.
- Existing schema, Location directory, import, and map-editing tests are the prior art. Relevant assertions should be retained or moved to the shared policy seam rather than duplicated at every adapter.
- Add regression coverage for the current contradictions: an indoor child with coordinates, an indoor child without a Building parent, a parent that exists but is not a Building, an unpositioned Building during record editing, and that same Building during map-readiness evaluation.
- Add a fixture-compatibility test that evaluates representative generated and curated Location records through the policy. This prevents hidden adapter exceptions while allowing deliberate fixture migration.
- The full frontend test suite and production build are regression gates after adapter migration.

## Out of Scope

- Deepening the Location directory hierarchy projection, filtering, collapse, or pagination module.
- Fixing query-cache identity, invalidation choreography, URL search synchronization, or mock-data loading fallback.
- Redesigning the bulk-import file-session workflow, loading indicators, double-submit protection, or stale-preview handling.
- Changing bulk-import matching, duplicate detection, template format, or all-or-nothing semantics except where required to invoke shared Location policy.
- Redesigning the Locations page, Map Editor layout, visual styling, action menus, dialogs, or table rendering.
- Introducing real photo upload storage or adding photo fields to the Location domain model.
- Changing backend endpoints, production persistence schemas, or remote transport contracts.
- Reworking outdoor routing, pathway calculation, entrance-node behavior, or arrival guidance.
- Replacing React Query, React Router, the existing Services interface, or the HTTP/local adapters.
- Creating a general-purpose validation framework for domains other than Location.
- Resolving unrelated existing working-tree changes in Map Editor files.

## Further Notes

- No repository-level `CONTEXT.md` or relevant ADR was found during the architecture scan. This spec therefore uses the established frontend terms Location, Building, Floor, Room, Office, Laboratory, Restroom, Facility, Location directory, bulk import, and Map Editor.
- The selected seam was presented before continuation: one frontend Location policy interface, with directory, validation/import, and map editing as adapters. Continuing this workflow confirms that direction.
- The current locations screen-level suite passes all 17 tests, but it does not expose the cross-workflow contradictions or the Function / Purpose and Description alias.
- The Location policy module should increase depth through leverage, not by moving every existing helper into a new file. Rendering, persistence transport, query state, and import-session state stay outside its implementation.
- Floor behavior is the one area where current callers and fixtures may encode incompatible assumptions. The implementation should inventory those records and choose one canonical policy within this spec's constraints rather than preserve contradictory adapter-specific rules.
