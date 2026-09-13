# 01: Streamline User Directory UI to Read-Only Presentation

**What to build:** An administrative user visiting the Users module sees a clean, focused, read-only directory of App Users displaying their username and registration date. Non-functional and out-of-boundary controls (Add User, Edit User, Reset Password, and Delete User modals and action menus) are completely removed. The user can filter the list using text search for username and a registration date range dropdown. Last-sign-in display and filtering are deferred because the current source schema has no authoritative timestamp.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

- [ ] "Add User", "Edit User", "Reset Password", and "Remove User" dialogs and their associated modal states are removed from the Users view.
- [ ] Row action menu (3-dots button) is removed from the table rows.
- [ ] Table headers display "Username" and "Registered On".
- [ ] Text search input filters the user list by username query.
- [ ] Date-range select dropdown for registration date (`createdAt`) provides intervals: "All time", "Last 7 days", "Last 30 days", and "Last 90 days".
- [ ] Clear empty state message is rendered when search or date filters match zero users.
- [ ] Component unit tests verify rendering, filtering interactions, and absence of mutation controls.
