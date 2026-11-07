-- 2026-11-07  The fixed set of four superadministrators.
--
-- Until now "the four superadmins" was a convention. public.admin.role was an
-- ordinary column, and PUT /api/admins/:id/role let anybody holding the role
-- grant it to anybody else, so one promotion - by accident, by a stolen
-- session, or by a direct UPDATE - made it five. This migration makes the set
-- a fact the database keeps:
--
--   * public.superadmin_designation names the designated accounts, one row
--     each, and is the only place the set is written down. No username and no
--     id is hardcoded here or anywhere in the source; the four are supplied by
--     the operator running this file.
--   * A deferred constraint trigger holds both halves of the rule on every
--     write to either table: a designated account holds the superadmin role,
--     and an account without a designation cannot acquire it. Deferred, so a
--     transfer can designate and promote in either order inside one
--     transaction, and checked at COMMIT, so no statement order leaves an
--     undesignated superadmin behind.
--   * At most four designations, ever. A fifth cannot be inserted.
--   * A designated row cannot be deleted, and the designation table cannot be
--     written at all, outside a transaction that has declared itself a
--     transfer.
--
-- WHAT THIS DOES NOT DO. It does not choose the four accounts, demote an extra
-- superadmin, or create anything. Every one of those is a decision for the
-- people running the transfer process, and a migration that made it silently
-- would be the accident this exists to prevent. If any precondition fails,
-- nothing is written: the whole file is one transaction.
--
-- RUNNING IT. The four ids are operator inputs, verified against the live
-- directory with an authorized read-only check *before* this is run:
--
--     select id, username, role, status from public.admin
--      where coalesce(role, 'admin') = 'superadmin' order by id;
--
--     psql "$DATABASE_URL" \
--       -v ON_ERROR_STOP=1 \
--       -v super1=<id> -v super2=<id> -v super3=<id> -v super4=<id> \
--       -f migrations/20261107_fixed_superadmins.sql
--
-- ON_ERROR_STOP=1 is required, not advisory: without it psql would carry on
-- past a failed precondition and reach the COMMIT.
--
-- Safe to re-run with the same four ids: the schema statements are guarded and
-- the designation insert is a no-op. Re-running with a *different* id is
-- refused and told to use the transfer procedure instead, because silently
-- redesignating is exactly the uncontrolled change this file removes.
--
-- Apply this before deploying the application build that depends on it; that
-- build reads public.superadmin_designation on every administrator listing.
-- See the "Fixed superadministrators" section of README.md for the backup,
-- deployment, rollback, transfer and containment procedures.

begin;


-- ==========================================
-- The designated set
-- ==========================================

create table if not exists public.superadmin_designation (
    -- No surrogate key: the account *is* the row, and a primary key on the id
    -- is what stops one account being designated twice - which would make
    -- four supplied ids look like four accounts while designating three.
    admin_id smallint primary key
        references public.admin(id) on delete restrict,

    designated_at timestamptz not null default now()
);

comment on table public.superadmin_designation is
    'The fixed set of superadministrator accounts, at most four. A designated account holds public.admin.role = ''superadmin'' and an account without a row here cannot acquire it; both halves are enforced by the deferred constraint trigger assert_superadmin_designation on this table and on public.admin, so the set holds against direct database writes as well as against the API. Rows cannot be inserted, changed or deleted, and a designated public.admin row cannot be deleted, outside a transaction that has set isu.superadmin_transfer to ''on'' - the restricted transfer procedure in README.md. Written only by that procedure and by migrations/20261107_fixed_superadmins.sql; read by the application on every administrator listing to mark the protected accounts.';

comment on column public.superadmin_designation.designated_at is
    'When this designation was recorded. Not who recorded it: a transfer is an operator action taken with database access, and the actor belongs in public.audit_log with every other account change.';


-- ==========================================
-- The approved-transfer gate
-- ==========================================

-- A transaction declares itself part of the transfer process by setting a
-- session variable:
--
--     set local isu.superadmin_transfer = 'on';
--
-- This is a deliberate-action gate, in the same spirit as the portal's
-- password confirmation, and not a boundary against somebody who already has
-- SQL - they could set it too. What it buys is that no ordinary statement, no
-- application bug and no half-remembered maintenance script can drop or move a
-- designation by accident: it has to say so first. The boundary against the
-- application is a GRANT, which the README's deployment notes name.
create or replace function public.superadmin_transfer_authorized()
returns boolean
language plpgsql
stable
as $fn$
begin
    -- The second argument makes an unset variable NULL rather than an error,
    -- which is what it is in every transaction that is not a transfer.
    return coalesce(current_setting('isu.superadmin_transfer', true), 'off') = 'on';
end;
$fn$;

comment on function public.superadmin_transfer_authorized() is
    'Whether the current transaction has declared itself part of the approved superadmin transfer process, by "set local isu.superadmin_transfer = ''on''". Read by the triggers that protect public.superadmin_designation and designated public.admin rows.';


create or replace function public.guard_superadmin_designation_write()
returns trigger
language plpgsql
as $fn$
begin
    if not public.superadmin_transfer_authorized() then
        raise exception
            'superadmin_designation_protected: the designated superadmin set is changed only by the approved transfer procedure'
            using errcode = 'insufficient_privilege',
                  hint = 'See "Replacing a designated account" in README.md.';
    end if;
    return coalesce(new, old);
end;
$fn$;


create or replace function public.guard_designated_admin_delete()
returns trigger
language plpgsql
as $fn$
begin
    if exists (
        select 1 from public.superadmin_designation d where d.admin_id = old.id
    ) and not public.superadmin_transfer_authorized() then
        raise exception
            'designated_superadmin_protected: administrator % is a designated superadmin and cannot be deleted', old.id
            using errcode = 'insufficient_privilege',
                  hint = 'See "Replacing a designated account" in README.md.';
    end if;
    return old;
end;
$fn$;


-- ==========================================
-- The invariant
-- ==========================================

-- Both halves of the rule plus the cap, re-read from the tables rather than
-- from the row that fired. Checking the whole set is what makes it correct
-- under a multi-row statement and under a transfer that touches both tables:
-- there are a handful of administrators, so reading them all is cheaper than
-- reasoning about which row arrived first.
create or replace function public.assert_superadmin_designation()
returns trigger
language plpgsql
as $fn$
declare
    offending text;
    designations integer;
begin
    select string_agg(a.id::text, ', ' order by a.id)
      into offending
      from public.admin a
     where coalesce(a.role, 'admin') = 'superadmin'
       and not exists (
           select 1 from public.superadmin_designation d where d.admin_id = a.id
       );
    if offending is not null then
        raise exception
            'superadmin_not_designated: administrator(s) % hold the superadmin role without a designation', offending
            using errcode = 'integrity_constraint_violation',
                  hint = 'The superadmin role is granted only by the approved transfer procedure.';
    end if;

    select string_agg(d.admin_id::text, ', ' order by d.admin_id)
      into offending
      from public.superadmin_designation d
      join public.admin a on a.id = d.admin_id
     where coalesce(a.role, 'admin') <> 'superadmin';
    if offending is not null then
        raise exception
            'designated_not_superadmin: designated account(s) % do not hold the superadmin role', offending
            using errcode = 'integrity_constraint_violation',
                  hint = 'Withdraw the designation in the same transaction as the demotion.';
    end if;

    -- The cap is on designations, not on active accounts. Urgent containment
    -- deactivates a compromised account and leaves the portal with three
    -- active superadmins for as long as it takes to replace it; a rule that
    -- demanded four *active* accounts would make containment impossible,
    -- which is the opposite of what it would be for.
    select count(*) into designations from public.superadmin_designation;
    if designations > 4 then
        raise exception
            'too_many_superadmins: % designations, and the policy allows 4', designations
            using errcode = 'integrity_constraint_violation';
    end if;

    return null;
end;
$fn$;

comment on function public.assert_superadmin_designation() is
    'Holds the fixed-superadmin invariant: every public.admin row with role ''superadmin'' is designated, every designated account holds that role, and there are at most four designations. Installed as a DEFERRABLE INITIALLY DEFERRED constraint trigger on public.admin and public.superadmin_designation, so it is checked at COMMIT and a transfer may designate and promote in either order.';


do $guards$
begin
    -- DEFERRABLE INITIALLY DEFERRED is the whole point of a constraint trigger
    -- here. An immediate check could not be satisfied at all: the first
    -- statement of a transfer leaves the two tables disagreeing whichever one
    -- it writes first.
    if not exists (
        select 1 from pg_trigger
        where tgname = 'assert_superadmin_designation_on_admin'
          and tgrelid = 'public.admin'::regclass
    ) then
        create constraint trigger assert_superadmin_designation_on_admin
            after insert or update on public.admin
            deferrable initially deferred
            for each row execute function public.assert_superadmin_designation();
    end if;

    if not exists (
        select 1 from pg_trigger
        where tgname = 'assert_superadmin_designation_on_designation'
          and tgrelid = 'public.superadmin_designation'::regclass
    ) then
        create constraint trigger assert_superadmin_designation_on_designation
            after insert or update or delete on public.superadmin_designation
            deferrable initially deferred
            for each row execute function public.assert_superadmin_designation();
    end if;

    -- Immediate, unlike the invariant above: a protected row is protected from
    -- the statement, and there is nothing a later statement in the same
    -- transaction could do to make the write acceptable.
    if not exists (
        select 1 from pg_trigger
        where tgname = 'guard_superadmin_designation_write'
          and tgrelid = 'public.superadmin_designation'::regclass
    ) then
        create trigger guard_superadmin_designation_write
            before insert or update or delete on public.superadmin_designation
            for each row execute function public.guard_superadmin_designation_write();
    end if;

    -- The foreign key's ON DELETE RESTRICT already refuses this. The trigger is
    -- here for the message: "violates foreign key constraint" does not tell
    -- the reader that the row is a designated superadmin, or where the
    -- procedure for replacing one is written down.
    if not exists (
        select 1 from pg_trigger
        where tgname = 'guard_designated_admin_delete'
          and tgrelid = 'public.admin'::regclass
    ) then
        create trigger guard_designated_admin_delete
            before delete on public.admin
            for each row execute function public.guard_designated_admin_delete();
    end if;
end
$guards$;


-- ==========================================
-- Operator inputs
-- ==========================================

-- The four ids, as supplied on the command line. A temporary table rather than
-- psql variables read further down, because psql does not substitute inside
-- the dollar-quoted body of a DO block - the preconditions have to read them
-- from somewhere the server can see.
--
-- The primary key is the duplicate check: four ids where two are the same is
-- refused here, before anything else has looked at them.
create temporary table designated_input (
    admin_id smallint primary key
) on commit drop;

insert into designated_input (admin_id) values
    (:super1), (:super2), (:super3), (:super4);


-- ==========================================
-- Preconditions
-- ==========================================

do $checks$
declare
    supplied integer;
    offending text;
    existing integer;
begin
    select count(*) into supplied from designated_input;
    if supplied <> 4 then
        raise exception 'expected 4 distinct administrator ids, got %', supplied;
    end if;

    select string_agg(i.admin_id::text, ', ' order by i.admin_id)
      into offending
      from designated_input i
     where not exists (select 1 from public.admin a where a.id = i.admin_id);
    if offending is not null then
        raise exception 'no administrator account exists with id(s) %', offending;
    end if;

    select string_agg(a.id::text, ', ' order by a.id)
      into offending
      from designated_input i
      join public.admin a on a.id = i.admin_id
     where coalesce(a.role, 'admin') <> 'superadmin'
        or coalesce(a.status, 'active') <> 'active';
    if offending is not null then
        raise exception
            'administrator(s) % are not active superadmins; verify the four live accounts before designating them', offending;
    end if;

    -- No extras, and this file will not demote one. An extra superadmin is a
    -- live account somebody is signing in with, and whether it loses that
    -- access is not a question a migration gets to answer.
    select string_agg(a.id::text, ', ' order by a.id)
      into offending
      from public.admin a
     where coalesce(a.role, 'admin') = 'superadmin'
       and not exists (select 1 from designated_input i where i.admin_id = a.id);
    if offending is not null then
        raise exception
            'administrator(s) % hold the superadmin role and are not among the four supplied ids; demote them deliberately first', offending
            using hint = 'This migration does not demote anybody.';
    end if;

    -- Already designated. The same four is a re-run and writes nothing; any
    -- other set is a replacement, and replacements go through the transfer
    -- procedure so they are reviewed and audited.
    select count(*) into existing from public.superadmin_designation;
    if existing > 0 and (
        exists (select admin_id from public.superadmin_designation
                except select admin_id from designated_input)
        or exists (select admin_id from designated_input
                   except select admin_id from public.superadmin_designation)
    ) then
        raise exception 'a different set of superadmins is already designated'
            using hint = 'Use the transfer procedure in README.md, not this migration.';
    end if;
end
$checks$;


-- ==========================================
-- Designate
-- ==========================================

-- The first approved transfer: the gate is declared for this transaction only,
-- and ends with it.
set local isu.superadmin_transfer = 'on';

create temporary table designated_new (
    admin_id smallint primary key
) on commit drop;

with inserted as (
    insert into public.superadmin_designation (admin_id)
    select admin_id from designated_input
    on conflict (admin_id) do nothing
    returning admin_id
)
insert into designated_new (admin_id) select admin_id from inserted;

-- Audited against each affected account, in the vocabulary the Logs page
-- already reads, and only for designations this run actually wrote - so a
-- re-run does not add a second history of the same event. Guarded because
-- public.audit_log belongs to the logs contract rather than to this directory,
-- and a deployment without it must still be able to designate.
--
-- Ids and usernames only. Nothing here records a password, an address or a
-- session: a transfer is a change of who, not of any credential.
do $audit$
begin
    if to_regclass('public.audit_log') is not null then
        -- created_at is spelled out. The column is NOT NULL and its default
        -- lives in the model rather than in the schema, so the application
        -- fills it in on every write and a plain SQL insert that leaves it out
        -- is rejected.
        execute $ins$
            insert into public.audit_log
                   (created_at, category, actor, action, target, target_id, detail)
            select now(), 'Admin', 'operator', 'designate superadmin', 'Administrator',
                   a.id::text, a.username
              from designated_new n
              join public.admin a on a.id = n.admin_id
             order by a.id
        $ins$;
    end if;
end
$audit$;


-- ==========================================
-- Verify before committing
-- ==========================================

-- The invariant is deferred to COMMIT, so this is the last chance to say
-- something readable about a set that came out wrong. A failure here rolls the
-- whole file back, schema included.
do $verify$
declare
    designations integer;
begin
    select count(*) into designations from public.superadmin_designation;
    if designations <> 4 then
        raise exception 'ended with % designations, expected 4', designations;
    end if;
end
$verify$;

commit;
