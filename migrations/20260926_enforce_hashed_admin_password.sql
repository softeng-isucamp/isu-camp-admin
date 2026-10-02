-- Reject any admin password that is not a hash.
--
-- A hash cannot be produced by a Postgres trigger here: the application uses
-- PBKDF2-SHA256 at 600,000 iterations, and looping that many HMAC rounds in
-- plpgsql would take minutes per insert. Just as importantly, a plaintext
-- password typed into the Supabase table editor is already written to the query
-- log and the WAL before any trigger could rewrite it, so hashing it after the
-- fact does not undo the exposure.
--
-- This constraint therefore refuses plaintext instead of hashing it, which
-- turns "I forgot to hash it" from a silent security hole into an immediate
-- error. Create accounts with `manage_admins.py create`, which writes the hash
-- directly and never sends the password to the database.
--
-- ORDER MATTERS. Hash the rows that already exist first, or this fails:
--
--     venv/Scripts/python.exe app/services/manage_admins.py backfill
--
-- To see which rows would block it before running this:
--
--     SELECT id, username FROM public.admin
--     WHERE password NOT LIKE 'pbkdf2:%$%$%'
--       AND password NOT LIKE 'scrypt:%$%$%';

ALTER TABLE public.admin
    DROP CONSTRAINT IF EXISTS admin_password_must_be_hashed;

ALTER TABLE public.admin
    ADD CONSTRAINT admin_password_must_be_hashed
    CHECK (
        password LIKE 'pbkdf2:%$%$%'
        OR password LIKE 'scrypt:%$%$%'
    );
