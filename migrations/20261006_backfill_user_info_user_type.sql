-- 2026-10-06  Give every public."userInfo" row an account type.
--
-- The admin Registered Users directory (GET /api/users) and the dashboard
-- account-type split (GET /api/dashboard -> usersByType) read user_type as the
-- account type. Every live row was null, so the admin had nothing to show.
--
-- Existing accounts predate the User App's signup account-type step, so they
-- become visitors - the least-privileged of the three - rather than staying
-- null.
--
-- The column is deliberately left unconstrained. The User App stores the label
-- its signup picker shows ("Student", "Staff", "Visitor"; see
-- isu-camp-app server/app/routes/auth.py), which is neither the admin's
-- spelling nor this backfill's, so a check constraint here would reject every
-- new signup until that app ships and deploys a matching change. The admin
-- normalizes on read instead - see USER_TYPE_ALIASES in app/model/app_user.py -
-- which costs nothing and couples no deploys together. Pin the vocabulary once
-- both writers agree on it.
--
-- An earlier revision of this migration did add a check constraint and a
-- 'visitor' default, and both reached the Supabase project before the User
-- App's existing vocabulary came to light. The drops below undo that; they are
-- no-ops on any database that never saw it.
--
-- Applied to the Supabase project on 2026-10-06, the backfill as migration
-- "pin_user_info_user_type" and the drops as "unpin_user_info_user_type_
-- vocabulary". All nine accounts read back as visitor. Safe to re-run: every
-- statement is guarded or idempotent.

update public."userInfo"
    set user_type = 'visitor'
    where user_type is null;

alter table public."userInfo"
    drop constraint if exists "userInfo_user_type_check";

alter table public."userInfo"
    alter column user_type drop default;

comment on column public."userInfo".user_type is
    'Account type chosen at signup. The User App writes its picker labels (Student/Staff/Visitor); the admin normalizes them on read. Accounts created before the signup step existed were backfilled to visitor.';
