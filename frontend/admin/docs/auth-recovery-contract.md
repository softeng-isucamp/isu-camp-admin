# Admin login and account recovery: backend contract

This is the contract the admin frontend implements. The backend does not implement it yet. Everything below was checked against the frontend service layer (`src/services/api.ts`, `recovery.ts`, `errors.ts`, `passwordRules.ts`) and the fixture backend (`src/services/localAdapter.ts`), which implements the whole contract and can be used as a reference.

You do not need to read the UI code. Anything the frontend does with a response is stated here.

## Status and compatibility

- Login keeps working against the current backend. The only change is optional (`attemptsRemaining`), and the frontend works without it.
- The recovery flows (forgot password, forgot username) do **not** work against the current backend until the three `/api/recovery/*` endpoints ship. The frontend no longer calls the old username-based `/api/reset/request`, `/api/reset/verify` and `/api/reset-password`. They can stay in place until the new endpoints are live, then be removed.
- The admin-triggered "send password reset" action in User Management is unchanged and unrelated.

## Conventions

- All requests are `POST` with `Content-Type: application/json` and `credentials: include` (session cookie). CORS must keep allowing credentials for the frontend origin.
- Success (`2xx`) responses must have a JSON object body. A success whose body is empty or not JSON (empty `204`, HTML page) is reported as "Unable to connect to the backend."
- Error responses may have any body. A `429` is recognised from the status and `Retry-After` alone; an empty or HTML body is fine. Any other non-2xx without a JSON object body is also reported as "Unable to connect to the backend." (the admin does not see the body), so send JSON with `message` and `code` where this contract asks for them.
- Error bodies use `message` (shown to the admin in some cases, see below) and an optional machine-readable `code`. This follows the existing `password_confirmation_required` convention.

### Error response shape the frontend parses

```json
{ "message": "Incorrect verification code", "code": "invalid_code", "attemptsRemaining": 3 }
```

| Field | Type | Frontend treatment |
| --- | --- | --- |
| `message` | string | Falls back to a generic text when missing. Shown to the admin only where noted per endpoint. |
| `code` | string | Branched on when it is one of `invalid_code`, `code_exhausted`, `code_expired`, `weak_password`. Any other value, or a missing `code`, is a generic failure: the admin sees `message`. |
| `attemptsRemaining` | integer >= 0 | Optional. Kept only if it is a non-negative integer. A string (`"3"`), negative number, float, `null` or missing value is **dropped**, and the frontend behaves as if you sent none (no count shown, `message` shown instead). It never guesses a number. |

The frontend branches on `code`, not on the HTTP status, for recovery errors. Use `400` for them anyway.

### Rate limits (`429`)

Any `429` from login or a recovery endpoint is treated as a rate limit, whatever the body.

- Send `Retry-After: <seconds>` as a positive integer. The frontend parses it with `parseInt`. It does not parse HTTP-date values. A missing, non-numeric or zero/negative header becomes **60 seconds**.
- `message` in a JSON body is optional. It is shown to the admin; if absent (or the body is not JSON) the frontend writes "Too many requests. Please wait N seconds."
- The UI disables the triggering button and counts down: login (inputs locked), "Send code", "Verify", "Resend code", and the new-password submit. The typed code is kept after a `429` on verify.
- Whether a rejected (`429`) request still counts as an attempt is the backend's choice.

## Endpoints

| Method and path | Status | Purpose |
| --- | --- | --- |
| `POST /api/login` | existing, extended | Adds `attemptsRemaining` on `401` |
| `POST /api/recovery/request` | new | Email a 6-digit code |
| `POST /api/recovery/verify` | new | Check a code, return the username |
| `POST /api/recovery/reset-password` | new | Set a new password with a code |

### `POST /api/login`

Request: `{ "username": string, "password": string }` (unchanged).

Success `200` (unchanged): `{ "admin": { "id", "username", "email"?, "role"? } }`. A `200` with `success: false` or no `admin` is shown as a failure.

Failure `401` (extended):

```json
{ "message": "Invalid username or password", "attemptsRemaining": 3 }
```

- `attemptsRemaining` is optional. When present, the login page shows "Incorrect username or password. N attempts left." (urgent style at 2 or fewer; "No attempts left." at 0). When absent, it shows `message`.
- Only `401` produces this behaviour. Other non-2xx statuses show `message` with no count. Send `401` for wrong credentials.
- When attempts run out, send `429` + `Retry-After` (existing behaviour). The fixture returns the `429` on the failing attempt that uses the last try, so the admin never sees "0 left". A `401` with `attemptsRemaining: 0` followed by `429` on the next try is also handled.
- Per-IP or per-account counting is the backend's choice. The UI only displays the number. Count unknown usernames too, so the number does not reveal which usernames exist (the fixture does this).

### `POST /api/recovery/request`

Request:

```json
{ "email": "admin@isu.edu.ph", "purpose": "password" }
```

| Field | Type | Notes |
| --- | --- | --- |
| `email` | string | Trimmed by the client; case is **not** normalised. Match case-insensitively. The client checks email format first, but validate on the server too. |
| `purpose` | `"password"` or `"username"` | Which flow asked for the code. |

Success `200`:

```json
{ "message": "If an account exists for this email, a code has been sent.", "expiresInSeconds": 600, "resendAfterSeconds": 60 }
```

- **Return the same `200` whether or not the email has an account.** The frontend moves to the code step on any `200`, and the response must not let anyone tell whether the account exists (same body shape, same timing fields, similar latency).
- `message` is not displayed. Any JSON object body works.
- `expiresInSeconds`: optional, lifetime of the issued code. Used only if it is a positive integer (`0`, negatives, floats and strings are ignored). When present the code step shows a "Code expires in m:ss" timer and, at zero, switches to the expired state without asking the server. When absent there is no timer and the frontend never decides locally that the code expired.
- `resendAfterSeconds`: optional resend cooldown, same positive-integer rule. When present the Resend button is disabled that long. When absent Resend is enabled immediately, so enforce the cooldown with `429` as well.
- Issue the real code only when the email belongs to an admin account. Send no email otherwise.
- A new request replaces the previous code for that `(email, purpose)` and restores the full attempt budget. The frontend calls this same endpoint for "Resend code".
- Failures: `429` as above. Any other non-2xx shows `message` in the email step (fall back text: "Account recovery failed."). Do not return an error that reveals account existence.

### `POST /api/recovery/verify`

Request:

```json
{ "email": "admin@isu.edu.ph", "purpose": "username", "code": "123456" }
```

`code` is a string of exactly 6 digits (the client does not send anything else). Send it as a string; do not assume it is numeric (leading zeros).

Success `200`:

```json
{ "username": "admin_justine" }
```

`username` is required and must be a non-empty string. Otherwise the frontend shows "The server did not return a username." For `purpose: "username"` it is displayed to the admin. For `purpose: "password"` it is kept only to prefill the login page later.

Verify must **not consume the code**: for the password flow the frontend sends the same code again to `/api/recovery/reset-password`.

Failures, all `400`:

| `code` | When | `attemptsRemaining` | What the admin sees |
| --- | --- | --- | --- |
| `invalid_code` | Wrong code, attempts left | Optional, integer >= 1 | With a count: "Incorrect code. N attempts left." Without: `message`. The boxes are cleared. |
| `code_exhausted` | The attempt limit has just been reached, or the code was already invalidated | Send `0` (ignored by the UI) | Fixed UI text: "You have used all your attempts. Request a new code to continue." Server `message` is not shown. |
| `code_expired` | Code lifetime passed | Not used | Fixed UI text: "This code has expired. Request a new code to continue." Server `message` is not shown. |

Rules:

- The attempt that uses the last try returns `code_exhausted` (with `attemptsRemaining: 0`), not `invalid_code` with `0`. After that the code is **dead on the server**, so the correct code must also be rejected until a new one is requested.
- An expired code returns `code_expired` even when the digits are right. Check expiry before exhaustion before correctness (the fixture does).
- A wrong code for an email with no account must behave exactly like a wrong code for a real account: same `invalid_code`, same decreasing count, same exhaustion. Likewise when no code was ever requested.
- The attempt limit is 5 per issued code in the fixture. The number is the backend's choice. The frontend reads it only through `attemptsRemaining`.
- `429` applies as above.
- Codes are separate per `(email, purpose)`: a password code and a username code for the same email do not interfere (fixture behaviour).

### `POST /api/recovery/reset-password`

Request (no `purpose`; this is always the password flow):

```json
{ "email": "admin@isu.edu.ph", "code": "123456", "password": "Passw0rd!x" }
```

Success `200`: `{ "username": "admin_justine" }` (same rule as verify). The frontend then sends the admin to login with that username prefilled. The new password must work on the next `POST /api/login`. Invalidate the code after a successful reset.

Failures, `400`:

- `invalid_code`, `code_exhausted`, `code_expired`: the code is checked again with the same rules and the same attempt budget as `/verify`. `code_exhausted` and `code_expired` mean the code is dead on the server, so the frontend sends the admin back to the code step in its exhausted or expired state (the same fixed texts as under `/verify`; the server `message` is not shown), with the email kept and "Resend code" available at once. The admin requests a new code and verifies it again before choosing a password. `invalid_code` here (a code that passed `/verify` and then went wrong) is a generic failure: the server `message` is shown under the form and the admin stays on the step.
- `weak_password`: `{ "code": "weak_password", "message": "Password must include a number." }`. `message` is shown verbatim. `attemptsRemaining` is ignored. A weak password should **not** spend the code (the fixture does not count it), so the admin can fix it and resubmit.
- The code check should run before the password check, as the fixture does.

## Backend expectations

1. **One email per admin account.** Enforce uniqueness in the database. The flows map an email to exactly one username; with duplicates, "forgot username" would be ambiguous.
2. **Server-side invalidation.** After the attempt limit, the code is invalidated on the server. The frontend's attempt display and exhausted screen are only a view of this; do not rely on the client.
3. **Code expiry.** 10 minutes today. If you change it, report it through `expiresInSeconds`.
4. **Password rules match the frontend.** Enforce in `/reset-password` and answer `weak_password`:
   - at least 8 characters, counted as **Unicode code points** like Python's `len(password)`. The client counts code points too (`[...p].length`), so an emoji is 1 character. Do not count UTF-16 units or bytes;
   - an uppercase letter (Unicode category `Lu`);
   - a lowercase letter (`Ll`);
   - a number (ASCII `0-9`);
   - a symbol: any character that is not a letter (`L*`), not a number (`N*`) and not whitespace.

   Python sketch:

   ```python
   import unicodedata

   def password_issue(pw: str) -> str | None:
       cats = [unicodedata.category(c) for c in pw]
       if len(pw) < 8: return "Password must be at least 8 characters."
       if "Lu" not in cats: return "Password must include an uppercase letter."
       if "Ll" not in cats: return "Password must include a lowercase letter."
       if not any("0" <= c <= "9" for c in pw): return "Password must include a number."
       if not any(k[0] not in "LN" and not c.isspace() for c, k in zip(pw, cats)):
           return "Password must include a symbol."
       return None
   ```

   The client checks the same rules before sending, so a `weak_password` response is a safety net. Edge-case differences (for example exotic whitespace) only mean the server's message is shown.
5. **Generic responses.** `/request` answers identically for known and unknown emails, and `/verify` and `/reset-password` count attempts identically for unknown emails.
6. **Rate limiting.** Return `429` + `Retry-After` on all three recovery endpoints (per IP and/or email) and on login. Enforce the resend cooldown on `/request`, since the frontend only disables a button.

## Fixture reference values

The fixture backend (`localAdapter.ts`) uses: admin email `admin@isu.edu.ph`; test code `000000`; 5 attempts per code and 600 seconds of lifetime; `resendAfterSeconds` 60; login locks after 5 failures for 60 seconds. These are fixture choices, not requirements. The fixture does not enforce the resend cooldown.
