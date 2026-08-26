# 04: Preview and retain mock Location photos

**What to build:** Turn the existing photo field into an honest, functional frontend preview workflow. Administrators must be able to validate, preview, replace, remove, save, and reopen a Location photo during the current mock session without implying that a production upload occurred.

**Blocked by:** 02: Complete Indoor Location add, edit, and contextual quick-add.

**Status:** done

- [ ] Selecting a valid PNG, JPEG, or WebP image immediately renders a thumbnail in the Add/Edit Location modal.
- [ ] Helper text states the accepted formats, client-side size limit, and mock-session persistence limitation.
- [ ] Unsupported formats and oversized files are rejected with a field-associated error while preserving the rest of the draft.
- [ ] Administrators can replace a selected photo before saving.
- [ ] Administrators can remove a selected or previously mock-saved photo.
- [ ] A saved photo reappears when the same Location is reopened during the current mock session.
- [ ] Canceling an unsaved photo change leaves the previously saved mock photo unchanged.
- [ ] Immediate success feedback may show the selected thumbnail while directory rows retain their compact type icons.
- [ ] Photo preview lifecycle does not leak browser object URLs or retain abandoned file state between unrelated Locations.
- [ ] The implementation does not claim server upload or persistence across a full browser reload.
- [ ] User-level tests cover preview, validation, replacement, removal, save/reopen, cancel isolation, and cleanup behavior without asserting the underlying URL-storage strategy.
