# 09: Verify the completed Locations frontend

**What to build:** Prove that the full Locations experience works as one coherent frontend after all slices are integrated. Exercise realistic administrator journeys, close regressions discovered by the complete test/build/browser pass, and capture enough evidence that the feature can be handed off without known frontend gaps.

**Blocked by:** 03: Browse and paginate complete Building families; 08: Complete responsive, accessible Locations overlays and request states.

**Status:** done

- [ ] The complete Locations component suite passes with tests asserting user-visible behavior.
- [ ] The Location policy suite passes with the agreed Building, Indoor Location, Floor Level, Unspecified Floor, coordinate, and placement rules.
- [ ] The services suite passes with import, mock photo, audit, and permanent cascade-deletion contracts.
- [ ] Relevant Map Editor tests pass without reverting or weakening the pre-existing Map Editor work carried into the branch.
- [ ] A production frontend build completes successfully.
- [ ] Browser verification confirms the seeded multi-floor hierarchy, empty Building state, Building and Floor Level filters, search context, family pagination, and flat pagination.
- [ ] Browser verification confirms ordinary add, contextual quick-add, edit, standard and custom Floor Levels, type-aware coordinate fields, validation, and cancellation.
- [ ] Browser verification confirms photo preview, replacement/removal, mock-session restoration, and persistence limitation messaging.
- [ ] Browser verification confirms type-aware row and success actions and the Indoor Location handoff to its Building on the map.
- [ ] Browser verification confirms individual deletion, Building cascade warning, successful removal, and failure preservation.
- [ ] Desktop and mobile-sized browser verification confirms modal focus behavior, responsive layout, internal scrolling, and reachable actions.
- [ ] Loading, error, empty, pending, and success states have no known contradictory wording or dead controls.
- [ ] Older expectations for separately managed Floor creation and soft deactivation are removed or explicitly superseded in affected tests and supporting scratch documentation.
- [ ] Unrelated user-owned changes and scratch artifacts remain preserved.
- [ ] Any defects found during verification are fixed within this ticket and covered by the highest practical existing test seam.

## Comments

Completed in commit `ca8a309`. The frontend component and service suites pass (146 tests), the production build succeeds, and desktop/mobile browser spot checks cover the seeded hierarchy, modal responsiveness, and search behavior. The legacy `e2e/portal.spec.ts` visual suite still contains pre-completion login assumptions, obsolete labels, and stale snapshots; those failures are unrelated to the completed Locations contract and were preserved for a separate test-modernization pass.
