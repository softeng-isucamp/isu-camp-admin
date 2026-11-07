# ISU-CAMP Admin

This repository contains the ISU-CAMP administration backend scaffold and the admin frontend.

## Repository layout

- `app/` contains the Python backend modules.
- `frontend/admin/` contains the Vite, React, and TypeScript admin portal.
- `static/` is reserved for Flask-managed assets.

## Running Backend & Frontend

### Unified Runner (Recommended)

Choose a runtime from the project root. The default is **real mode**: Flask plus the frontend, backed by the configured database.

**Linux / macOS (Bash):**
```bash
./dev.sh --real
```

**Windows (Command Prompt):**
```cmd
dev.bat --real
```

**Windows (PowerShell):**
```powershell
.\dev.ps1 --real
```

---

### Comparison: Unified Script vs Separate Commands

| Execution Method | Pros | Cons |
| :--- | :--- | :--- |
| **Unified Script (`dev.sh` / `dev.bat`)** *(Recommended)* | • Starts backend & frontend together in one command<br>• Fast and simple day-to-day workflow<br>• Cleans up both processes on `CTRL+C` | • Combined output streams in a single terminal |
| **Separate Commands** | • Separate log windows per service<br>• Restart backend or frontend independently without stopping both | • Requires opening two terminal windows and navigating to subdirectories |

---

### Running Separately

If you prefer isolated logs or independent control:

1. **Flask Backend** (Terminal 1):
   ```bash
   venv/bin/python app/services/database.py
   ```

2. **Admin Frontend** (Terminal 2):
   ```bash
   cd frontend/admin
   npm run dev
   ```

Open the frontend at `http://127.0.0.1:5173`, which is where the runners serve it. Use the same spelling as the backend address, not `localhost`: see [why the frontend and backend hosts must match](#why-the-frontend-and-backend-hosts-must-match). The unified runner fixes port 5173 and fails if it is occupied; stop your own previous server or choose a separately configured origin.

### Fixture versus real backend

| Mode | Linux/macOS | Windows CMD | PowerShell | Data and login |
| --- | --- | --- | --- | --- |
| Real (default) | `./dev.sh --real` | `dev.bat --real` | `.\dev.ps1 --real` | Starts Flask and the frontend. Requires backend/database configuration and a real backend account. |
| Fixture | `./dev.sh --fixture` | `dev.bat --fixture` | `.\dev.ps1 --fixture` | Starts only the frontend with the local adapter and OSM fixture. No Flask or database required. Logins, all with `password123`: `admin_justine` and `admin_dean` (superadmins), `admin_registrar` (administrator with every permission) and `admin_viewer` (administrator with view-only permissions). |

The runners print the selected mode and login guidance. Fixture credentials apply only to fixture mode. Fixture edits stay in the local adapter and do not update the backend database.

Real mode explicitly sets `VITE_TEST_LOCAL_ADAPTER=false`, `VITE_API_MODE=real`, and `VITE_MAP_FIXTURE=none`. Its API address defaults to `http://127.0.0.1:5000`; set `VITE_API_BASE_URL` in the shell before running the script to override it. Fixture mode explicitly sets `VITE_TEST_LOCAL_ADAPTER=true`, `VITE_API_MODE=local`, and `VITE_MAP_FIXTURE=osm`. These process variables override Vite's local `.env` settings. Setting only `VITE_API_MODE=local` does not enable the fixture adapter.

### Why the frontend and backend hosts must match

`localhost` and `127.0.0.1` are the same machine but two different hosts to a browser, and that distinction bites twice.

**CORS**, which is the easy half: `ALLOWED_ORIGINS` in [app/services/database.py](app/services/database.py) allows both spellings on ports 5173 and 5174, so a preflight succeeds either way. Any other host or port is refused, which the console reports as a CORS policy error. Covered by `app/tests/cors.py`.

**The session cookie**, which is the half that looks like something else entirely. Flask does not set `SameSite` on the session cookie, so browsers treat it as `SameSite=Lax` and never attach it to a cross-site request. With the page on `http://localhost:5173` and the API on `http://127.0.0.1:5000`, every API call is cross-site: sign-in appears to succeed, the cookie is dropped, and the next request comes back `401 Authentication required`. The dashboard then reads "Unable to load the dashboard. Authentication required", which looks like an auth bug and is really a cookie that was never sent. `credentials: "include"` cannot override it, and `SameSite=None` is not an option either, because browsers only accept it with `Secure`, which needs HTTPS.

So the two must agree on one spelling. The backend binds `127.0.0.1` (Flask listens on IPv4 only, and `localhost` resolves to `::1` first on some machines), so `127.0.0.1` is the one both sides use: the runners serve the frontend with `--host 127.0.0.1` and point `VITE_API_BASE_URL` at `http://127.0.0.1:5000`. If you start Vite yourself, pass the same flag - `npm run dev` alone binds `localhost` and the dashboard will report an authentication error.

For frontend-only commands and verification, see the [frontend README](frontend/admin/README.md#development). For feature ownership and identity relationships, see its [code navigation map](frontend/admin/README.md#code-navigation).

## Production builds

Use the tracked [production build and release recipe](deploy/README.md) for Dockerfiles, Nginx, locked dependencies, CI, and clean-commit image archives. The frontend's guarded command is `npm run build:production`; deployment uses the saved image IDs.

## Database prerequisites

The Map Editor's indoor-location markers require the `public.location` schema to support nullable latitude and longitude values. Coordinates must be stored as a complete pair and stay within the valid latitude and longitude ranges. Apply the database migration through the database team's deployment process before using indoor marker placement; the application does not alter the schema at startup.

Pathway distance and estimated time are no longer stored or returned by the application. Legacy `public.pathway.distance_m` and `public.pathway.estimated_minutes` columns are unused by the application and may remain in the database.

## Administrator email addresses

An administrator holds up to two addresses: `public.admin.gmail` and the optional `public.admin.alternative_email`. **Account recovery accepts either one**, which is the reason the second exists — the only way back into a locked-out account used to be the inbox it was created with.

`GET /api/profile` returns `alternativeEmail`, `null` when none is registered. The key's presence is what tells My Profile the server knows about the field; a build talking to an older API sees no key and hides the control.

`PATCH /api/profile` accepts `alternativeEmail` (a string, or `null`/`""` to clear) and `currentPassword`:

```json
{"username":"justine","email":"justine@example.com","alternativeEmail":"justine.home@gmail.com","currentPassword":"…"}
```

Leaving `alternativeEmail` out leaves it unchanged, so an older client that posts only `username` and `email` cannot clear it by accident.

### One shared pool

Every administrator's two addresses are **one pool**, compared trimmed and case-insensitively. An address is taken if any *other* administrator holds it as either of theirs, and an alternative cannot repeat its own primary. The database does not enforce this: accounts created before the rule already share primary addresses ([#108](https://github.com/softeng-isucamp/isu-camp-admin/issues/108)), so a unique index would fail to build. The check lives in the application (`auth.admins_holding_email`) and applies **only to the field a request is changing**, so an existing duplicate blocks nothing but a change to the duplicated field itself.

`POST /api/admins` applies the same pool. No `/api/admins` response ever carries anyone's alternative email: it is a recovery address, and that listing is readable by every active administrator.

### What the password is for

`currentPassword` is required **only when the primary or alternative email changes** — a rename alone does not ask. It is checked **before** the duplicate checks, so a session left open on a shared machine can neither move an address nor be used to probe which addresses exist.

| Field | Status | Message |
| --- | --- | --- |
| `username` | 409 | `That username is already taken` |
| `email` / `alternativeEmail` | 409 | `That email address is already in use` |
| `email` / `alternativeEmail` | 400 | `Enter a valid email address` |
| `alternativeEmail` | 400 | `Use a different address from your primary email` |
| `currentPassword` | 401 | `Your current password is incorrect`, or `Enter your current password to change an email address` when it is missing |

A conflict never names the account that holds the address. Several fields can be refused in one response: `fields` carries each of them and `message` is the first, in the order the form reads.

### Recovery

Forgot password and forgot username accept either address. The code is sent **only to the address that was typed** — mailing the primary instead would tell whoever typed the alternative that the two belong together. Codes are keyed per purpose and typed address, so a code requested for one address does not verify through the other.

**A submitted address must already be on record, and is refused if it is not.** `POST /api/recovery/request` looks the address up against `gmail` and `alternative_email` across all accounts, and answers `400` `email_not_found` — *"That email is not registered to an administrator account. Check the address and try again."* — unless it resolves to exactly one **active** account. One code and one message cover all three refusals: no account holds the address, the account holding it is deactivated, or two accounts hold it between them. The differences are about an account the sender may have no business knowing exists.

Refused before anything is counted or stored: a mistyped address spends none of the account's three-per-window request budget and leaves no code entry behind.

> **This answer confirms which addresses are administrator accounts.** Anyone can submit addresses one at a time and learn which ones exist. That is a deliberate trade for telling an administrator that they mistyped their own address, instead of leaving them waiting for a code that was never sent. What remains of the brake is the per-client cap — 10 requests a minute per IP — and the 60-second resend cooldown per client and address. An earlier design answered every well-formed address with an identical *"if an account exists"* reply precisely to prevent this; if that property is wanted back, this refusal is the thing to remove.

Verification is unchanged and does not depend on this: `verify` and `reset-password` still require the account the code was issued for, so a code never reaches an account the address does not belong to.

User Management's password-reset send issues through this same flow: the colleague receives a code keyed to their own address, redeems it on the forgot-password page, and it comes out of that account's own request budget. It is refused when the account's address is one recovery could not resolve — shared with another account, or absent — because a code for such an address could not be redeemed there.

The colleague redeems it with **I already have a code** on the email step, which goes straight to code entry and requests nothing. *Send code* would replace the code they hold and spend one of their three requests; once the budget is spent it is the only way to reach code entry at all. The email they receive says so.

Unlike the pages, that send is **synchronous** — the caller is signed in and already knows the account exists, so waiting reveals nothing. When the mail server refuses, `POST /api/admins/:id/password-reset` answers `502` and records no audit entry, and the send leaves no trace: the request is withdrawn from the account's budget, the one-a-minute send limit is given back so the sender can retry at once, and the code is never stored, so a code the colleague already holds keeps working. A code is stored only after the mail server has taken it. The recovery pages still send in the background and answer `200` whatever the mail server does.

Apply `migrations/20261023_add_admin_alternative_email.sql` before using any of this.

## Recovery attempt limits

Two limits guard `/api/recovery/*`, both persistent and both measured over the same **15-minute sliding window**:

| Limit | Value | What happens past it |
| --- | --- | --- |
| Codes requested | 3 per window | 429 `recovery_restricted`, and **nothing is mailed** |
| Wrong codes guessed | 5 per window | 15-minute restriction, starting with the 5th guess itself |

Unchanged: a code still expires after **10 minutes** and a resend is still refused for **60 seconds**.

### The counts belong to an account, not to a code

A code used to carry its own budget of five guesses, which made asking for a new one the way to get five more — five guesses a minute, indefinitely, which is not a limit. The counts are now kept against a **subject**:

- an **account**, when the submitted address belongs to exactly one, so its primary and alternative addresses share a single budget and a single request cap; or
- the **address itself** otherwise — unknown, or shared by several accounts.

So the five guesses are cumulative **across resends, across both of an account's addresses, and across the password and username flows** (both verify the same inbox, so counting them apart would only double the guesses on offer). Two unrelated addresses keep their own budgets — otherwise guessing at an invented address would be a way to lock somebody else out.

### The restriction

The **5th wrong code is itself answered with the restriction**, not with `code_exhausted`. Being told "request a new one" was advice that led straight back to five more guesses.

While a subject is restricted, **every** recovery route answers 429 `recovery_restricted` with an integer `Retry-After` — including a request for a new code, so the restriction cannot be waited out by mailing yourself codes until it lifts, and **including a request carrying the correct code**. A restriction the right code could walk through would only ever hold up the people who had lost their code.

When it lifts, the whole budget comes back. Leaving the failures at the limit would restrict the account again on its very next mistake, and the next — a permanent lockout wearing a fifteen-minute label.

The failure count also **decays** once the window passes with no new failure. Five mistakes *in fifteen minutes*, not five in a lifetime: without that, an address that mistyped four codes last month would be one slip away from being locked out for good.

### What a success clears

A correct code **clears the failures** — it proves whoever is asking is reading the inbox, which is the only thing the attempt limit was there to establish, so holding four earlier typos against them afterwards protects nothing. This applies to a successful username recovery as much as to a password reset.

It deliberately **does not clear the request window**: that cap is about how much mail the form may send, and a success does not excuse it.

### Telling the two kinds of 429 apart

Both carry `Retry-After`; the frontend reads the `code`, not the message.

| `code` | Means | Scope | Typical wait |
| --- | --- | --- | --- |
| `recovery_restricted` | This account's recovery is closed for a while | the subject | minutes |
| `rate_limited` | This client is going too fast | per IP, or per IP and address | seconds |
| `email_not_found` | The address is on no active account, so nothing was sent | the submitted address | n/a — fix the address |

The 60-second resend cooldown and the per-IP flood limits are `rate_limited`. The 3-per-window request cap and the 5-failure restriction are `recovery_restricted`.

`invalid_code` still carries `attemptsRemaining`, and it is now the **cumulative** figure rather than what is left on one code.

### Unknown addresses

An address with no account is counted, capped and restricted exactly like one that has an account, and receives the same status codes, bodies and `Retry-After` values. Any difference would be the answer to "does this address have an account here", which is the question the whole flow is built not to answer.

### What is stored

`public.recovery_attempt`, one row per subject, holding only counters: the failures, when the newest one landed, what the restriction runs until, and the times of the last few requests.

**No code and no password hash is ever written there.** The codes stay in process memory, so a restart still invalidates outstanding codes and the admin asks for another — losing those costs an attacker nothing, which is exactly why they are the part that may be lost. What survives a restart is the part an attacker benefits from losing, which is why it moved into the database in the first place: a restart used to clear every counter, and a second worker ran a second set of budgets alongside the first.

An address with **no account** is stored as `email:` followed by an HMAC of it keyed with `SECRET_KEY`, never as the address. The table would otherwise become a list of every address anybody has ever typed into Forgot Password, sitting in the admin database — addresses that by definition belong to people with no account here. A plain hash would not do: an email address is guessable enough that an unkeyed digest is a dictionary away from the address. Rotating `SECRET_KEY` abandons those counters, which is acceptable because rotating it already signs every session out.

Rows untouched for longer than both windows remember nothing and are deleted, which is also what keeps a flood of invented addresses from growing the table past the addresses actually seen in the last few minutes.

Within one process a lock serializes the read-decide-write; across processes `SELECT … FOR UPDATE` on the subject's row does the same, so a deployment with several workers counts once per guess rather than once per worker.

Apply `migrations/20261024_add_recovery_attempt.sql` before using any of this.

## Fixed superadministrators

**There are four superadmins, and the portal cannot change which four.** They are named in `public.superadmin_designation`, and that table — not the role column — is where the set lives. Promotion and demotion are gone from the API, creating a superadmin is refused, and a designated account's status and permissions are not the portal's to set. Replacing one of the four is a restricted operator procedure run against the database, documented below.

The role column still says what an account may reach. What changed is that nothing reachable from a session decides who holds it: a stolen session, a mistaken click or a direct `update public.admin set role = 'superadmin'` can no longer make it five.

No live id or username appears anywhere in the source. The four are operator inputs to the migration, verified against the live directory with an authorized read-only check beforehand.

### What the database enforces

`migrations/20261107_fixed_superadmins.sql` installs the table and these rules. They hold against direct SQL, not only against the API:

| Rule | How |
| --- | --- |
| A designated account holds the superadmin role, and an account without a designation cannot acquire it | `assert_superadmin_designation`, a `DEFERRABLE INITIALLY DEFERRED` constraint trigger on **both** tables, checked at COMMIT |
| At most four designations, ever | the same trigger |
| A designated `public.admin` row cannot be deleted | `guard_designated_admin_delete`, plus the designation's `references public.admin(id) on delete restrict` |
| `public.superadmin_designation` cannot be inserted, changed or deleted at all | `guard_superadmin_designation_write` |

**Deferred is the point.** A transfer has to write both tables, and whichever one it writes first leaves them disagreeing for a statement. An immediate check could not be satisfied in any order; checking at COMMIT means no order leaves an undesignated superadmin behind.

**The cap counts designations, not active accounts.** Containing a compromised account deactivates it, and the portal then runs on three active superadmins until it is replaced. A rule that demanded four *active* accounts would make containment impossible, which is the opposite of what it would be for.

The last three rules read a session setting, `isu.superadmin_transfer`, and refuse unless the transaction has set it. That is a deliberate-action gate, in the same spirit as the portal's password confirmation — somebody who already has SQL could set it too. What it buys is that no ordinary statement, no application bug and no half-remembered maintenance script moves a designation by accident. The boundary against the *application* is a grant, and the application never needs one:

```sql
revoke insert, update, delete on public.superadmin_designation from <application role>;
```

### What the API does

| Route | Before | Now |
| --- | --- | --- |
| `PUT /api/admins/:id/role` | promoted and demoted | **405** `{"code":"superadmin_set_fixed"}`, for every caller, every target and every body. Reads nothing, locks nothing, asks for no password, and writes nothing |
| `POST /api/admins` with `"role":"superadmin"` | created a superadmin | **409** `{"code":"superadmin_set_fixed"}` with `fields.role`, before the password confirmation |
| `POST /api/admins` with `"role":"admin"`, `null` or omitted | created an administrator | unchanged |
| `POST /api/admins` with any other role | 400 `Role must be Administrator or Superadmin.` | **400** `Role must be Administrator.` with `fields.role` |
| `PUT /api/admins/:id/status` on one of the four | activated or deactivated | **409** `{"code":"superadmin_set_fixed"}`, both directions, before the body is read |
| `PUT /api/admins/:id/permissions` on one of the four | 409 for being a superadmin | **409** `{"code":"superadmin_set_fixed"}` |
| `DELETE /api/admins/:id` | already gone | unchanged — 405 for every account, which is the stronger protection: nothing can address a delete at one of the four |

The frontend reads the `code`, not the message, so a build left over from before this deployment can tell "the server no longer does this" from any other refusal and stop offering the control. **409 rather than 403** throughout: a 403 with an unrecognised code reads as "confirm your password" to an older client, and no password helps here.

`GET /api/admins`, `POST /api/admins` and `PUT /api/admins/:id` all carry **`isProtected`** on each account:

```json
{"id":"7","username":"registrar","email":"…","status":"Active","role":"superadmin",
 "isProtected":true,"isCurrent":false,"permissions":null}
```

A client that does not know the key reads it as absent and merely offers actions the server refuses — hiding a control was never the protection. Frontend work is tracked in #167.

**A designated superadmin's own account still works.** They edit their own username, email and password through `PUT /api/admins/:id` and `PATCH /api/profile` like anybody else, and a colleague can still send them a reset code. What is fixed is who holds the role, not the account's credentials; protecting the password would only be a reason to keep a stale one.

**Nothing is cached.** The role and the designation are read from the database on every request, so a transfer or a containment takes effect on the next request each session makes — no sign-out, no restart. `superadmin_required` re-reads the caller from the rows it locks, so a request that was in flight when the set changed is judged against the set as it is now.

Administrators who are *not* designated — which is every superadmin until the migration is applied — keep the rules that predate this: the last active superadmin cannot be deactivated, nobody deactivates or configures themselves, and a superadmin's permission switches are not configurable.

### Applying it

Four verified ids, supplied on the command line. Confirm them first with an authorized read-only check against the live database:

```sql
select id, username, role, status from public.admin
 where coalesce(role, 'admin') = 'superadmin' order by id;
```

Take a backup through Backup & Recovery, or `pg_dump`, and keep it off-host. Then, with the application build **not yet** serving:

```bash
psql "$DATABASE_URL" \
  -v ON_ERROR_STOP=1 \
  -v super1=<id> -v super2=<id> -v super3=<id> -v super4=<id> \
  -f migrations/20261107_fixed_superadmins.sql
```

`ON_ERROR_STOP=1` is required, not advisory: without it psql carries on past a failed precondition and reaches the COMMIT. The whole file is one transaction, so a precondition that fails leaves no table and no trigger behind.

It aborts, writing nothing, unless all of these hold: four ids, all distinct; every one an existing account; every one an **active superadmin**; no superadmin outside the four; and the designation table either empty or already holding exactly these four. It does not choose the accounts, demote an extra superadmin, or create anything — every one of those is a decision for the people running the transfer process, and a migration that made it silently would be the accident this exists to prevent.

Re-running it with the same four writes nothing and audits nothing twice. Re-running it with a different id is refused and points at the transfer procedure.

**Ordering.** Schema first, then the application. The build reads `public.superadmin_designation` on every administrator listing, so it needs the table; the *old* build, meanwhile, runs happily against the new schema except that a promotion or demotion fails at COMMIT — a safe failure, and the reason the schema goes first. Follow the [production recipe](deploy/README.md) for the release assets themselves.

**Rollback.** Rolling the application back to a build that still offers promotion is safe on its own: those requests fail with a 500 from the refused COMMIT rather than succeeding. If that build has to be able to change roles again, drop the enforcement first:

```sql
begin;
drop trigger if exists assert_superadmin_designation_on_admin on public.admin;
drop trigger if exists assert_superadmin_designation_on_designation on public.superadmin_designation;
drop trigger if exists guard_designated_admin_delete on public.admin;
drop trigger if exists guard_superadmin_designation_write on public.superadmin_designation;
drop table if exists public.superadmin_designation;
drop function if exists public.assert_superadmin_designation();
drop function if exists public.guard_superadmin_designation_write();
drop function if exists public.guard_designated_admin_delete();
drop function if exists public.superadmin_transfer_authorized();
commit;
```

Nothing else reads any of it, and `public.admin` is untouched, so this is reversible by applying the migration again with the same four ids.

### Replacing a designated account

Restricted, audited, atomic, and agreed in advance: **name the approvers before deployment**, and record who approved each transfer alongside the audit row. One transaction, both tables, in the row-lock order the application uses — administrators first, then designations — so a transfer and a portal request queue rather than deadlock.

```sql
begin;
set local isu.superadmin_transfer = 'on';

-- Same lock order as the application's writes.
select 1 from public.admin where id in (<outgoing>, <incoming>) for update;
select 1 from public.superadmin_designation order by admin_id for update;

-- Confirm what is about to change before changing it.
select id, username, role, status from public.admin where id in (<outgoing>, <incoming>);

delete from public.superadmin_designation where admin_id = <outgoing>;
update public.admin
   set role = 'admin',
       permissions = '{"add": false, "edit": false, "delete": false, "changeUserStatus": false}'::jsonb
 where id = <outgoing>;

insert into public.superadmin_designation (admin_id) values (<incoming>);
update public.admin set role = 'superadmin', permissions = null where id = <incoming>;

insert into public.audit_log
       (created_at, category, actor, action, target, target_id, detail)
select now(), 'Admin', '<operator>', 'transfer superadmin', 'Administrator',
       a.id::text, a.username
  from public.admin a where a.id in (<outgoing>, <incoming>) order by a.id;

commit;
```

The two halves can be written in either order — that is what the deferred invariant buys — but **both** must be there: withdrawing a designation and leaving the role behind is refused at COMMIT with `superadmin_not_designated`. `set local` ends with the transaction, so the gate does not stay open for whatever runs next on the connection.

`created_at` is spelled out: the column is `NOT NULL` and its default lives in the model rather than in the schema, so an insert that leaves it out is rejected. The audit row records ids and usernames only — a transfer is a change of who, not of any credential, and nothing here writes a password, an address or a token.

The incoming account must already exist as an active administrator, created through the portal in the ordinary way. Nothing in this procedure creates an account or sets a password.

**Urgent containment of a compromised account.** Deactivating comes first and does not need a replacement lined up:

```sql
begin;
update public.admin set status = 'inactive' where id = <compromised>;
insert into public.audit_log
       (created_at, category, actor, action, target, target_id, detail)
select now(), 'Admin', '<operator>', 'contain superadmin', 'Administrator',
       a.id::text, a.username
  from public.admin a where a.id = <compromised>;
commit;
```

No transfer gate, because this touches no designation: the account stays one of the four and simply cannot sign in. The portal is then running on three active superadmins, which is a state the cap allows on purpose, and **the portal cannot switch it back on** — that is why the status route refuses both directions for a designated account. Rotate the password through the ordinary recovery flow, reactivate with the mirror of the statement above, or run the transfer procedure to replace the account outright.

### Verification

| Coverage | Where |
| --- | --- |
| Every API refusal, the `isProtected` contract, the concurrency cases, and that ordinary administrator management is untouched | `app/tests/admins.py` |
| The database invariants, the migration's preconditions and failure modes, an authorized transfer, containment, and sessions after an access change — against the real migration file | `app/tests/fixed_superadmins_storage.py` |

The second file needs a disposable PostgreSQL and skips without one:

```bash
ISU_TEST_DATABASE_URL=postgresql://…/disposable python -m pytest app/tests/fixed_superadmins_storage.py
```

**PostgreSQL only, and deliberately not reproduced on SQLite.** A deferred constraint trigger and a session setting have no SQLite equivalent, and a SQLite rendering of these rules would be a different mechanism tested in place of the real one. Use staging or a disposable database for anything that writes; verify live identity and designation with authorized read-only checks only.

Apply `migrations/20261107_fixed_superadmins.sql` before using any of this.

## Administrator permissions

A superadmin switches four general actions on or off for each regular administrator. **Viewing is not one of them**: it is the least-privilege minimum every active account keeps, so an administrator who should see nothing is deactivated, not given four off switches.

| Key | Allows |
| --- | --- |
| `add` | Creating things: locations, rooms, buildings, route nodes, pathways, path points, entrances, indoor locations, converting a path point to a route node, placing an unpositioned indoor marker for the first time |
| `edit` | Changing existing things: location details, building footprints, moving or reshaping route nodes, pathways and path points, linking an existing entrance, repositioning or clearing an indoor marker already on the map |
| `delete` | Deleting locations, buildings, route nodes, pathways, path points |
| `changeUserStatus` | Activating and deactivating **app users** (`PUT /api/users/:id/status`) |

**Superadmins hold every permission and cannot be configured.** Their stored switches are SQL `NULL` — the column is declared `none_as_null` so that assigning nothing stores SQL NULL and not the JSON scalar `null`, which the migration's shape constraint rejects — and `PUT /api/admins/:id/permissions` refuses them with 409. There is no "demote them first": the superadmins are a [fixed set](#fixed-superadministrators), and a request against one of the four is refused with `superadmin_set_fixed`. Backup & Recovery and everything under `/api/admins` except `GET` and the password-reset send stay superadmin-only and are **not grantable** — no combination of the four reaches another administrator's account.

Nobody changes their own permissions.

### Reading them

`POST /api/login`, `GET /api/me` and `GET /api/admins` all carry the same object:

```json
{"id":"7","username":"registrar","email":"…","role":"admin",
 "permissions":{"add":true,"edit":false,"delete":false,"changeUserStatus":true}}
```

**`null` — or a missing key — means all four are on.** That is what makes the column safe to add to a running deployment: a row nobody has configured, and every row written before the migration, keeps the access it had. A superadmin reports `null` for the same reason the role does not need switches.

`GET /api/me` reads them **from the row on every call**, never from the session cookie, and so does every guard below. Withdrawing a permission therefore takes effect on the administrator's **next request** — there is no cached grant to outlive it, and nobody has to sign out and in again.

### Setting them

`PUT /api/admins/:id/permissions`, superadmin-only and behind a recent password confirmation (`/api/confirm-password`):

```json
{"permissions":{"add":true,"edit":true,"delete":false,"changeUserStatus":false}}
```

All four keys, every time, each a boolean — a body naming two leaves the other two to whatever the reader assumes. Anything else is a 400 with `fields.permissions`.

**Absent and null are different things.** Leaving `permissions` out of a create takes the default (all four off); sending it as `null` is a value the caller chose, and the only shape a supplied value may take is the four booleans, so it is refused like any other wrong shape. Reading the two the same way meant a client asking for "no permissions" silently got the view-only default instead of being told its request made no sense. A create that names `"role":"superadmin"` is refused by policy whatever it sends for `permissions`.

| Case | Status | Message |
| --- | --- | --- |
| The target is the caller | 409 | `You cannot change your own permissions.` |
| The target is one of the fixed four | 409 | `This is a designated superadmin account. Its role and its access are managed outside the portal.` with `code: superadmin_set_fixed` |
| The target is a superadmin that is not designated | 409 | `Superadmins always have every permission, so there is nothing to restrict.` |
| A partial or mistyped set | 400 | `Each of the four permissions must be given as true or false.` |
| Done | 200 | `Permissions updated for <username>.` plus the updated `admin` |

The audit row records what moved — `admin02: add: on -> off; delete: on -> off` — so the Logs page answers "who took that away" without anybody diffing two rows.

**Defaults.** The migration backfills existing administrators with all four **on**, because a migration must not quietly take away what everyone could do yesterday. New accounts start with all four **off** unless the request says otherwise: an account being set up has not been given anything yet. `POST /api/admins` accepts an optional `permissions` object. There is no longer a demotion to land on a set of switches, nor a promotion to discard one.

`POST /api/admins` now requires a password confirmation for **every** create, not only a superadmin's — each new account is a new way into the portal whatever its role.

**`DELETE /api/admins/:id` is gone** and answers 405. Removing the row orphaned everything the account had ever done, since the audit trail names an actor by username; `PUT /api/admins/:id/status` does the same job and keeps the history readable. **`PUT /api/admins/:id/role` is gone too** and answers 405 — see [Fixed superadministrators](#fixed-superadministrators).

### The server is the enforcement

The frontend hides what the signed-in administrator may not do, but hiding a button is not authorization. Every write route checks for itself, through `auth.permission_required` (or `auth.permission_error` where a route has already loaded its caller), and a refusal is:

```json
{"success":false,"code":"PERMISSION_DENIED","message":"You don't have permission to do that. Ask a superadmin."}
```

with status **403**. The frontend reads the `code`, not the message.

On a delete, the **permission is checked before the password confirmation** — as with `superadmin_required` — so an administrator who may not delete is refused outright rather than asked to confirm a password for an answer that was never going to be yes.

### Operations, not request verbs

Two routes are judged on what the operation *is* rather than on which records it happens to write:

- **`PATCH /api/map/buildings/:id/indoor-locations/:id`** needs `add` to give an indoor location its first marker and `edit` to move or clear one it already has. Which of the two it is comes from the marker's **stored coordinates**, so a client cannot pick the permission it is judged against.

- **`PUT /api/pathways/:id/points`** replaces a pathway's whole point sequence as one `edit`, in one transaction. Reshaping a pathway stores new vertex records and drops old ones; reconciled one vertex at a time it reached the server as an add, an edit and a delete, so an administrator who may edit the network could only drag a shape that kept its vertex count — and a refusal partway through left the pathway with half of its new shape. Creating a pathway carries its vertices in the same request (`POST /api/pathways`), so that stays one `add`, and Create Junction / Convert to Route Node (`POST /api/pathways/:id/convert-point`) is one `add` including the graph rewiring it requires.

`POST /api/map/save` is checked **per change in the payload**, before the first one is applied: one refused change refuses the whole save, and the message names it (`You don't have permission to change the Engineering Hall footprint. Ask a superadmin.`). Everything that route can apply is a change to a record that already exists, so every change in it is an `edit`; an empty draft asks for nothing and needs nothing.

`POST /api/map/publish` is open to every active administrator and none of the four gates it: publishing promotes work that is already saved, and the saving is what each permission was checked on.

Apply `migrations/20261024_add_admin_permissions.sql` before using any of this.

## Database backups

Backup & Recovery on My Profile takes real `pg_dump` archives. These routes back it, all superadmin-only:

| Route | Purpose |
| --- | --- |
| `GET /api/backups` | Stored archives, the running job if there is one, and which controls this server can serve |
| `POST /api/backups` | Start a dump; returns a job to poll |
| `POST /api/backups/<id>/restore` | Restore an archive; needs the caller's password |
| `POST /api/backups/<id>/download` | Issue a one-time download link; needs the caller's password |
| `DELETE /api/backups/<id>` | Delete one archive; needs a recent password confirmation |
| `PUT /api/backups/schedule` | Save the automatic backup schedule |
| `GET /api/jobs/<id>` | Poll one operation until it is terminal |
| `POST /api/jobs/<id>/cancel` | Ask a running backup or restore to stop |

`GET /api/backup-downloads/<token>` streams one archive and is the only route here with no session check: the browser's own downloader fetches it, so it is authorised by the token instead.

The archive is `pg_dump`'s custom format, so `pg_restore` can list it, pull one table out of it, or restore all of it with no code from this repository involved. That is the reason for preferring it to an application-level export. Measured against this project: **75 MB in about a minute**, covering all 17 tables of the `public` schema. It was 24 MB in 1 minute 45 seconds when this was written; the growth is `building_photo` and `location_photo`, which store image bytes in the database, so size retention against a fresh measurement rather than against this sentence.

These are jobs rather than plain responses because of that runtime. The API runs `gunicorn --timeout 120`, so a synchronous dump would be killed before finishing. `POST /api/backups` returns `202` with `{id, kind, status}` and the panel polls `GET /api/jobs/<id>` every 1.5 seconds.

### Every control is advertised, not assumed

`GET /api/backups` carries `canDownload`, `canDelete` and `schedule`, and a job carries `cancellable`. **A key that is missing hides its control**, which is what lets the frontend and the backend land separately: a build talking to a deployment that has only half of this offers only the half that works, rather than a button that 404s. An unreadable `schedule` — a deployment that has not applied `migrations/20261023_add_backup_schedule.sql` — is treated the same as a missing one.

### Cancelling

`POST /api/jobs/<id>/cancel` answers `202` with the job as it stands, usually still `running`: the tool has been asked to stop, not finished stopping, and the panel shows "Cancelling…" while it keeps polling. The terminal status is `cancelled`, alongside `succeeded` and `failed`.

- **A cancelled backup leaves nothing behind** — no archive, no history row, and the partial file is removed.
- **A cancelled restore leaves the database exactly as it was.** `pg_restore` runs with `--single-transaction`, so terminating it abandons the transaction rather than leaving the schema half replaced.
- **A lost race reports the real outcome.** A dump that had already written its last byte did succeed, and calling that `cancelled` would be a lie about an archive that now exists.
- **Any superadmin can cancel any job**, including one the schedule started: whoever is watching a dump compete with the thing they need the database for is the person who should be able to stop it.

Once an operation is past its point of no return it reports `cancellable: false` instead of accepting a cancel, so the button goes away rather than appearing to work.

### Downloading and deleting

`POST /api/backups/<id>/download` re-checks the password and returns `{url, expiresAt}`. The link is unguessable, **single-use**, expires in three minutes, and streams with `Content-Disposition: attachment`. Only a `ready` archive can be downloaded; anything else answers `404`, and so does an archive that is not there — the password is checked first, so a session left open cannot be used to ask which archives exist.

`DELETE /api/backups/<id>` answers `204` and uses the portal's existing re-authentication convention rather than a password in the body: a lapsed confirmation answers `403` with `{"code":"password_confirmation_required"}`, the same code every other delete uses. It works on `ready` and `failed` archives, refuses with `409` while any backup or restore is running, and will delete the last archive you have — the UI warns about that; the server does not pretend an archive nobody wants is made safe by being the only one.

### Automatic backups

One dump on a schedule, taken by a thread inside the API process (`app/services/backup_schedule.py`). It calls the same `start_backup` as the panel's button, so an automatic archive differs from a hand-made one only in its `createdBy`, lands in the same list, and is restored the same way. There is no scheduler library and no cron entry to keep in step with the code.

**The schedule is a database row** (`public.backup_schedule`, one row), saved from the panel and re-read by the thread every minute, so a change takes effect without restarting the API. These three environment variables seed that row the **first time it is read** and are ignored afterwards:

| Setting | Seeds | What it meant |
| --- | --- | --- |
| `BACKUP_SCHEDULE_ENABLED` | `enabled` (default off) | `true`, `1` or `yes` to start switched on |
| `BACKUP_SCHEDULE_AT` | `time` (default `02:30` Manila) | A **UTC** time of day, converted on the way in: 18:30 UTC is 02:30 Philippine time |
| `BACKUP_KEEP` | `keep` (default `14`) | Archives kept after each completed backup |

The saved schedule is `{enabled, frequency, day, time, timeZone, keep}`: `frequency` is `daily` or `weekly`, `day` is 0–6 with Sunday as 0 (required for weekly, `null` for daily), `time` is 24-hour `HH:MM`, and `timeZone` is always `Asia/Manila` — the time of day is **local**, and the server converts. A quiet hour is a local hour, so storing 18:30 UTC instead would make 02:30 a fact somebody has to recompute every time they read the row.

Switching it off keeps the other fields, so switching it back on restores the schedule somebody set rather than a default they have to re-enter. The timer therefore runs whether or not the schedule is currently on: being off is a value in the row, and a thread that only started when the row said "on" could never see it change to "on".

Things to know:

- **Retention deletes archives that people took by hand.** It keeps the newest `keep` files in the directory whoever made them, because the limit is about disk rather than about authorship. At today's ~75 MB a dump, the default is a little over 1 GB. It runs **after each completed backup**, so a button press is held to the same limit as a scheduled run — and **saving a schedule deletes nothing by itself**, so lowering `keep` is never a delete somebody did not expect.
- **A missed night is picked up at startup.** If the newest archive is more than a day old, a backup runs two minutes after the process starts instead of waiting for the next scheduled minute, because a development machine is rarely awake at 02:30. A restart an hour after a successful run does not take another.
- **Starting it in two processes is safe.** Each run is claimed by creating a `.claimed-<time>` marker in the backup directory with `O_EXCL`, so `flask --debug` (which runs the app twice) or a second gunicorn worker still produces one dump rather than two writing the same file. Because the marker outlives the process, a restart does not re-take a night that was already taken.
- **Every run reaches the audit log** as a `System` row with actor `scheduler` — `backup`, `backup failed`, or `backup skipped` when somebody's own job was already running. Download, delete, cancel and a schedule change are `System` rows too, naming the administrator who did it; a retention removal names the archive it took. No row ever carries a password or a download link. The Logs page shows these under All.

An unfinished dump is no longer mistaken for a backup. `pg_dump` creates its output file immediately and fills it as it reads, so a run that died part way through — a dropped pooler connection mid `building_photo` has happened here — used to leave a truncated file that the panel listed as ready to restore from. A dump now writes `<id>.dump.partial` and is renamed to `<id>.dump` only once the tool has exited cleanly, and leftovers are swept before each automatic run.

### What a deployment needs

Two things, both of which the production recipe in [`deploy/`](deploy/README.md) now provides:

1. **`pg_dump` and `pg_restore` must be on the server.** Without them a backup fails with a clear `503` rather than a crash. The client must be **17 or newer**: Supabase runs 17.6, and a 15 client refuses to dump a 17 server — which is what Debian bookworm's own `postgresql-client` would give you. `deploy/admin-api.Dockerfile` installs `postgresql-client-17` from the PostgreSQL APT repository for exactly that reason. `PG_DUMP_PATH` and `PG_RESTORE_PATH` point at specific binaries when the ones on `PATH` are the wrong version.
2. **The archive directory must outlive the container.** Archives are written to `BACKUP_DIR` (default `backups/`, gitignored), and a path inside a container disappears on the next deployment. `deploy/compose.yaml` sets `BACKUP_DIR=/srv/backups` and mounts the external volume `kumpas-admin-backups` there; the volume has to be created once before the first deployment that uses it.

Check both on any deployment that is not built from that recipe, because the schedule is seeded off and switching it on is now a decision somebody makes in the panel rather than in a deployment's environment. On a server missing either one, every night fails — visibly, in the audit log, rather than quietly.

Locally neither applies: `pg_dump` arrives with pgAdmin or any PostgreSQL install, and `backups/` persists.

### Restoring is off by default

`POST /api/backups/<id>/restore` answers `403` unless `BACKUP_RESTORE_ENABLED=true`. A restore runs `pg_restore --clean --if-exists --single-transaction` over the live `public` schema: it replaces every table, including `public.admin`, in a database the companion User App also reads. It undoes other people's work, not just the caller's. The flag exists so enabling it is a decision somebody makes on purpose rather than a button that happens to be present.

The caller's password is required and is checked **before** the flag, so a caller who cannot authenticate learns nothing about whether restoring is available.

**An archive is a complete copy of the database, including the `public.admin` password hashes.** Treat a `.dump` file as credential material: `backups/` is gitignored, a download link is a bearer token for exactly that, and a copy moved anywhere else needs the same care.
