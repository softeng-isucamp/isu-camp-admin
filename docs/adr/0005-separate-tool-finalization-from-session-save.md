# Separate Tool Finalization from Working Session Save

## Context

Map Editor v1 saves each completed tool edit immediately. A later version is expected to let an administrator accumulate completed edits and use one map-wide Save Changes control. Treating those two moments as the same action would force every tool workflow to change when that lifecycle changes.

## Decision

Tool Finalization validates one Tool Draft, persists it according to the current v1 behavior, records its Working Operation, and closes the Tool Draft only after persistence succeeds. Working Session Save is a separate lifecycle concept even though v1 performs it immediately after each Tool Finalization.

Route Node, Pathway, Building Footprint, and Local Map Feature workflows expose explicit finalization interfaces. They do not share a generic registry, command bus, or configurable save-policy abstraction.

## Consequences

- V1 retains immediate per-edit saves.
- Persistence failure leaves the Tool Draft and Working Session history unchanged so the administrator can retry.
- V2 can accumulate finalized Working Operations behind Save Changes without redesigning each tool's validation and operation construction.
- Cross-route atomicity and server-backed operation history remain future backend work; the current browser journal provides administrator-and-project-scoped recovery only.
