# 02: Document Authentication and password recovery

**What to build:** Create the current desktop Authentication screens from sign-in through successful password recovery, including the essential validation and service feedback an administrator needs to understand the flow.

**Visual source of truth:** Follow the running Admin App UI as the authoritative visual basis. Reproduce its layout, hierarchy, content, states, terminology, and interaction affordances faithfully; do not redesign or invent alternatives unless the implementation provides no reference.

**Blocked by:** 01: Establish Figma foundations and shared Admin App shell.

**Status:** complete

- [x] The login screen uses empty username and password fields with the current production placeholders.
- [x] Password visibility and the link to password recovery are visibly understandable.
- [x] A representative invalid-credentials state is included.
- [x] A representative rate-limit state communicates when another login attempt is allowed.
- [x] Password recovery includes username request, segmented six-digit verification, new password, and success screens.
- [x] Verification shows resend timing and a representative invalid or expired-code state.
- [x] New-password copy states the implemented minimum of eight characters and shows confirmation mismatch validation.
- [x] Success provides a clear return-to-login action.
- [x] Legacy demonstration credentials and unimplemented password-complexity requirements are absent.
