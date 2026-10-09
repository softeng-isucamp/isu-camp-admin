-- 2026-10-08  Add status to public.admin and public.user (account access).
--
-- User Management grew an Activate/Deactivate row action, which needs somewhere
-- to record that an account exists but may not sign in. Neither account table
-- had such a column: public.admin held only credentials, and public.user held
-- only a username and its info row.
--
-- Same shape and vocabulary as public.building.status and
-- public.location.status, so the whole schema spells the two states one way and
-- model.record_status keeps translating for every table. Existing rows become
-- active, which is what both tables already behaved as.
--
-- Enforcement differs per table, and that is deliberate:
--   * public.admin.status is enforced here. POST /api/login refuses an inactive
--     administrator and auth.admin_required() ends a session whose account was
--     deactivated mid-visit.
--   * public.user.status is written here but enforced by the User App, which
--     owns sign-in for those accounts. Until the User App reads this column, a
--     deactivated app user keeps its existing session and can still sign in.
--
-- Applied to the Supabase project on 2026-10-08 as migration
-- "add_account_status". Safe to re-run: every statement is guarded.

alter table public.admin
    add column if not exists status varchar(20) not null default 'active';

alter table public."user"
    add column if not exists status varchar(20) not null default 'active';

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conname = 'admin_status_check'
          and conrelid = 'public.admin'::regclass
    ) then
        alter table public.admin
            add constraint admin_status_check
            check (status in ('active', 'inactive'));
    end if;

    if not exists (
        select 1
        from pg_constraint
        where conname = 'user_status_check'
          and conrelid = 'public."user"'::regclass
    ) then
        alter table public."user"
            add constraint user_status_check
            check (status in ('active', 'inactive'));
    end if;
end $$;

comment on column public.admin.status is
    'Whether this administrator may sign in to the admin portal: active or inactive. Enforced by POST /api/login and auth.admin_required(). Mirrors the vocabulary of public.building.status and public.location.status; the admin API presents it as Active/Inactive. Rows that predate the column were defaulted to active.';

comment on column public."user".status is
    'Whether this app account may sign in to the User App: active or inactive. Set from the admin portal''s User Management; enforcement belongs to the User App, which owns sign-in for these accounts. Mirrors the vocabulary of public.building.status and public.location.status. Rows that predate the column were defaulted to active.';
