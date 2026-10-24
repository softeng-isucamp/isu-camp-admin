-- 2026-10-24  Per-administrator permissions in public.admin.permissions.
--
-- Requirement 5: a superadmin switches four general actions on or off for each
-- regular administrator. Until now every active administrator could do all
-- four, and the portal's only distinction was superadmin or not.
--
-- One jsonb column rather than four booleans. The four switches are always
-- read and written together, the API carries them as a single object, and a
-- fifth would otherwise be a fifth migration. The shape is checked below, so
-- this buys the flexibility without the usual cost of a JSON column - a row
-- that holds something other than the four booleans cannot be written.
--
-- NULL means "every permission". That is what makes this column safe to add to
-- a running deployment: the API reads NULL as unrestricted, so a row nobody
-- has configured keeps exactly the access it had before the column existed.
-- Superadmins are left NULL permanently - the role already carries everything,
-- and restricting one means demoting it first.
--
-- There is deliberately no "view" switch. Viewing is the least-privilege
-- minimum every active account keeps; an administrator who should see nothing
-- is deactivated (public.admin.status), not given four off switches.
--
-- Safe to re-run: every statement is guarded, and the backfill only writes
-- rows it has not already written, so a second run cannot reset switches a
-- superadmin has since configured.

alter table public.admin
    add column if not exists permissions jsonb;

-- All four keys, each a boolean, or nothing at all. Without this a typo in a
-- client could store {"add": "yes"}, which is neither on nor off, and the
-- server would have to decide what a string means on every request.
--
-- `?&` is what checks the keys are *there*. Checking only the types would not:
-- `permissions -> 'delete'` on an object without that key is SQL NULL, so
-- `jsonb_typeof(...) = 'boolean'` is NULL too, and a CHECK constraint accepts
-- a row whose condition is unknown. A three-key object would pass.
do $$
begin
    if not exists (
        select 1 from pg_constraint where conname = 'admin_permissions_shape'
    ) then
        alter table public.admin
            add constraint admin_permissions_shape check (
                permissions is null or (
                    jsonb_typeof(permissions) = 'object'
                    and permissions ?& array['add', 'edit', 'delete', 'changeUserStatus']
                    and jsonb_typeof(permissions -> 'add') = 'boolean'
                    and jsonb_typeof(permissions -> 'edit') = 'boolean'
                    and jsonb_typeof(permissions -> 'delete') = 'boolean'
                    and jsonb_typeof(permissions -> 'changeUserStatus') = 'boolean'
                )
            );
    end if;
end
$$;

-- Existing administrators keep what they can do today. Anything else would be
-- a migration that quietly took access away from everyone at once, and the
-- first anybody would hear of it is a refused save.
--
-- New accounts are the other way round - POST /api/admins starts them with all
-- four off unless the request says otherwise - because an account being set up
-- has not been given anything yet.
update public.admin
   set permissions = '{"add": true, "edit": true, "delete": true, "changeUserStatus": true}'::jsonb
 where coalesce(role, 'admin') <> 'superadmin'
   and permissions is null;

-- A superadmin's switches are meaningless, so they are stored as nothing
-- rather than as four trues that would read as a configuration somebody could
-- change. Unconditional, so a row that was configured before a promotion is
-- cleaned up by re-running this.
update public.admin
   set permissions = null
 where role = 'superadmin'
   and permissions is not null;

comment on column public.admin.permissions is
    'Which of the four general actions this administrator may take, as {"add": bool, "edit": bool, "delete": bool, "changeUserStatus": bool}. NULL means every one of them, which is how rows predating the column and all superadmins are stored; the API reads a NULL or absent value as full access. Read from this row on every request by auth.permission_required, so withdrawing a permission takes effect on the administrator''s next request rather than at their next sign-in. Returned by POST /api/login, GET /api/me and GET /api/admins, and written by PUT /api/admins/:id/permissions. There is no "view" switch: viewing is the minimum every active account keeps, and an account that should see nothing is deactivated instead.';
