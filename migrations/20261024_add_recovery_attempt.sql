-- 2026-10-24  Persist account-recovery attempt limits in public.recovery_attempt.
--
-- The recovery OTP routes capped guesses per code, in process memory. Three
-- things were wrong with that, and all three are the same mistake: the limit
-- was not attached to the thing being protected.
--
--  * A resend handed back a full budget. With five guesses per code and a code
--    a minute, the real limit was about five guesses a minute, for ever.
--  * A restart cleared every counter, so the way past a limit was to wait for
--    a deploy - and a second gunicorn worker was a second budget running at
--    the same time, which is why the deployment had to stay single-worker.
--  * Nothing locked recovery itself. Each code died on its own and the next
--    one started clean.
--
-- One row per *subject*: the account when the submitted address belongs to
-- exactly one, so an account's primary and alternative addresses share one
-- budget, and the address itself otherwise. See auth.recovery_subject.
--
-- An address with no account is stored as 'email:' followed by an HMAC of it,
-- keyed with SECRET_KEY, never as the address. This table would otherwise
-- become a list of every address anybody has ever typed into Forgot Password,
-- sitting in the admin database - addresses that by definition belong to
-- people with no account here. A plain hash would not do it: an email address
-- is guessable, so an unkeyed digest is a lookup table away from the address.
-- Rotating SECRET_KEY abandons those counters, which is acceptable because
-- rotating it already signs every open session out.
--
-- No code or password hash is ever stored here. The codes stay in memory, so a
-- restart still invalidates outstanding codes and the admin asks for another;
-- what survives a restart is only the part an attacker gains by losing.
--
-- Safe to re-run: every statement is guarded.

create table if not exists public.recovery_attempt (
    subject varchar(128) primary key,

    -- Wrong codes inside the current failure window, counted across resends,
    -- purposes and both of an account's addresses.
    failures integer not null default 0 check (failures >= 0),

    -- When the newest failure landed; the window is measured from here. A
    -- fresh window rather than a lifetime total, so five mistakes spread over
    -- a year do not leave an address permanently unrecoverable.
    last_failure_at timestamptz,

    -- Set when the failures run out. The only thing in the system that refuses
    -- a correct code.
    restricted_until timestamptz,

    -- The most recent code requests, newest last, as ISO-8601 UTC strings.
    -- A list, not a count, because the cap is a sliding window: a count with a
    -- window start lets somebody send the cap twice in a moment by straddling
    -- the boundary. Trimmed to the cap on every write.
    requested_at jsonb not null default '[]'::jsonb
        check (jsonb_typeof(requested_at) = 'array'),

    updated_at timestamptz not null default now()
);

-- What the sweep reads: a row untouched for longer than both windows holds
-- nothing anybody can use, so it is deleted rather than kept. This is also
-- what stops a flood of invented addresses growing the table past the
-- addresses actually seen in the last few minutes.
create index if not exists recovery_attempt_updated_at_idx
    on public.recovery_attempt (updated_at);

comment on table public.recovery_attempt is
    'Account-recovery rate state, one row per subject: an account (''admin:<id>'') when the submitted address belongs to exactly one, otherwise the address as a SECRET_KEY-keyed HMAC (''email:<hex>''). Holds how many wrong codes have been guessed, when recovery is restricted until, and when codes were last requested. Written by the /api/recovery/* routes in services/auth.py and swept there; no credential is stored, and the codes themselves stay in memory. Rows untouched for longer than the windows are deleted.';

comment on column public.recovery_attempt.failures is
    'Wrong codes guessed inside the current failure window, cumulative across resends, purposes and both of an account''s addresses. Reset by a successful verification, and by the window passing with no new failure.';

comment on column public.recovery_attempt.restricted_until is
    'While this is in the future every recovery route answers 429 with code "recovery_restricted", including one carrying the correct code. NULL means nothing is holding this subject back.';
