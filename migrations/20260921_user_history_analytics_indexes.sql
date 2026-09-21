-- Index the companion User App's existing search-history table for the Admin
-- Dashboard's rolling-window and destination-ranking queries. This migration
-- deliberately does not create or otherwise take ownership of UserHistory.

BEGIN;

DO $$
BEGIN
  IF to_regclass('public."UserHistory"') IS NULL THEN
    RAISE EXCEPTION 'public."UserHistory" is required for dashboard search analytics';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ix_user_history_created_at
  ON public."UserHistory" (created_at DESC);

CREATE INDEX IF NOT EXISTS ix_user_history_location_created_at
  ON public."UserHistory" ("Location_id", created_at DESC)
  WHERE "Location_id" IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_user_history_building_created_at
  ON public."UserHistory" ("Building_id", created_at DESC)
  WHERE "Location_id" IS NULL AND "Building_id" IS NOT NULL;

COMMIT;
