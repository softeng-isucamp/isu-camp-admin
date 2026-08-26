# 08: Complete responsive, accessible Locations overlays and request states

**What to build:** Finish the Locations workflows as accessible modal experiences across desktop and narrow screens. Add/edit, photo, import, success, history, and deletion behavior must share predictable focus, dismissal, labelling, scrolling, and request-state treatment without changing the accepted feature semantics.

**Blocked by:** 02: Complete Indoor Location add, edit, and contextual quick-add; 04: Preview and retain mock Location photos; 05: Complete type-aware actions and Building map handoff; 06: Align Bulk Import with metadata-driven Floor Levels; 07: Permanently delete Location families.

**Status:** completed

- [x] Every Locations overlay exposes a labelled modal-dialog role and an appropriate accessible description.
- [x] Opening an overlay moves focus to a meaningful initial control or heading.
- [x] Keyboard focus remains within the active modal until it closes.
- [x] Escape safely closes dismissible overlays and does not bypass a pending or intentionally guarded destructive operation.
- [x] Closing an overlay restores focus to the action that opened it when that action still exists.
- [x] Background content cannot be interacted with while a modal is active.
- [x] Field errors are programmatically associated with their inputs and request-level errors are announced appropriately.
- [x] Loading, validating, saving, importing, deleting, failure, empty, and success states are visually and semantically distinct.
- [x] Pending actions prevent duplicate submissions while preserving understandable button labels and progress.
- [x] At narrow viewport widths, multi-column form sections stack without clipping or horizontal page scrolling.
- [x] Modal content remains within the viewport, scrolls internally when needed, and keeps primary actions reachable.
- [x] History and success content remains readable for long names, custom Floor Levels, and retained audit references.
- [x] Existing desktop presentation remains consistent with the ISU-CAMP visual language.
- [x] Accessibility tests cover roles, names, descriptions, focus entry, focus containment, Escape behavior, error association, and focus restoration through user interactions.
- [ ] Browser verification at desktop and mobile-sized viewports confirms stacking, scrolling, action reachability, and absence of visual clipping.

Browser verification remains pending because the existing Playwright sign-in flow redirected to `/login` before reaching the Locations page.
