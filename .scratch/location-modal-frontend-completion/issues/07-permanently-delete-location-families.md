# 07: Permanently delete Location families

**What to build:** Replace mock deactivation with the accepted permanent deletion contract. Individual Campus Locations must disappear after successful deletion, and deleting a Building must atomically delete its associated Indoor Locations after an explicit irreversible-action confirmation. The same service boundary must be ready for a future backend to provide matching behavior.

**Blocked by:** 01: Establish representative Building families and Floor Level contract.

**Status:** done

- [ ] Deletion remains named Delete throughout menus, dialogs, success messages, service semantics, and audit wording.
- [ ] Successfully deleting an individual Indoor Location or outdoor Facility physically removes it from local/mock query results.
- [ ] Deleting a Building identifies every associated Indoor Location using the agreed Building relationship.
- [ ] The Building confirmation names the Building, reports the affected Indoor Location count, and states that the action cannot be undone.
- [ ] Confirming Building deletion removes the Building and all associated Indoor Locations as one observable operation.
- [ ] A configured or transport deletion failure removes nothing and leaves the administrator with a useful retryable error.
- [ ] Pending deletion prevents duplicate confirmation and does not dismiss the dialog prematurely.
- [ ] Audit history may retain deletion entries with names and identifiers without requiring deleted Campus Location records to remain queryable.
- [ ] The frontend component depends on the location service deletion contract rather than a particular HTTP method or backend implementation.
- [ ] HTTP mode retains a backend-ready deletion request whose expected visible outcome matches local/mock cascade deletion.
- [ ] Service-boundary tests prove individual deletion, Building cascade, atomic failure, post-delete queries, and retained audit references.
- [ ] Rendered-page tests prove warning content, pending state, success removal, failure preservation, hierarchy refresh, and page clamping.
- [ ] Tests and fixtures that assert soft deactivation are updated to the permanent deletion contract.
