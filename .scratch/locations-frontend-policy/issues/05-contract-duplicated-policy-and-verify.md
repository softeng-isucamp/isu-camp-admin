# 05: Contract duplicated Location policy and verify compatibility

**What to build:** Complete the migration by removing obsolete caller-specific Location rules and normalizing incompatible test or fixture data. Administrators retain the behavior delivered by the three migrated workflows, while contributors have one authoritative policy seam instead of several implementations that can drift again.

**Blocked by:** 02: Migrate the Location directory form; 03: Migrate save and bulk-import validation; 04: Migrate Map Editor readiness validation.

**Status:** complete

- [x] Caller-specific copies of indoor-child classification, parent eligibility, coordinate consistency, and placement derivation are removed from the directory, validation/import, and Map Editor adapters.
- [x] Each migrated caller delegates Location policy decisions through the shared interface and retains only workflow translation or presentation behavior.
- [x] No shallow constants-only or pass-through module remains solely to preserve the old policy implementation.
- [x] The existing positioned Floor test record and any other incompatible fixture data are normalized to the canonical unpositioned Building-child rule.
- [x] Representative curated and generated Location data passes the intended record-validity policy or is deliberately migrated with regression coverage.
- [x] Search, hierarchy projection, query caching, bulk-import session state, routing, and visual layout remain unchanged.
- [x] The deletion test confirms that removing the shared policy module would spread meaningful rule implementation back across all three adapters.
- [x] Shared policy tests remain the primary test surface; adapter suites retain only user-visible integration coverage.
- [x] The complete frontend test suite passes.
- [x] The production frontend build passes.
- [x] No unrelated existing working-tree changes are overwritten or incorporated into the policy refactor.
