-- 2026-10-10  Add role to public.admin (portal authorization).
--
-- My Profile reads an account's role and the portal gates Backup & Recovery on
-- it: services/profile.ts requires 'admin' or 'superadmin', and the frontend
-- treats anything else - including a missing value - as not superadmin. There
-- was no column to answer from, so GET /api/profile could not be served at all.
--
-- Same shape and vocabulary habit as public.admin.status: a short varchar with
-- a check constraint, lowercase, so the whole schema spells its enumerations
-- one way.
--
-- Existing rows default to 'admin' rather than being promoted, because a
-- superadmin is an authorization decision and defaulting every current row to
-- the higher privilege would make that decision silently. The consequence is
-- that Backup & Recovery is unreachable until somebody is promoted on purpose:
--
--     update public.admin set role = 'superadmin' where username = '<name>';
--
-- Applied to the Supabase project on 2026-10-10 as migration "add_admin_role".
-- Safe to re-run: every statement is guarded. Both existing accounts were left
-- at 'admin', so Backup & Recovery is unreachable until someone is promoted.

alter table public.admin
    add column if not exists role varchar(20) not null default 'admin';

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'admin_role_check'
          and conrelid = 'public.admin'::regclass
    ) then
        alter table public.admin
            add constraint admin_role_check
            check (role in ('admin', 'superadmin'));
    end if;
end $$;

comment on column public.admin.role is
    'What this administrator may reach in the admin portal: admin or superadmin. Only Backup & Recovery is gated on it today; everything else is open to any active administrator. Presented by GET /api/profile and carried on the session by POST /api/login and GET /api/me. Rows that predate the column default to admin, so a superadmin is granted deliberately rather than inherited.';
