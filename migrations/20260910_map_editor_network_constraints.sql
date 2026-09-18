-- Constraints required by Map Editor Pathway/Path Point persistence.
-- Apply after confirming existing Path Point sequences are unique per Pathway.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'uq_path_point_pathway_sequence'
      AND conrelid = 'public.path_point'::regclass
  ) THEN
    ALTER TABLE public.path_point
      ADD CONSTRAINT uq_path_point_pathway_sequence
      UNIQUE (pathway_id, sequence_no);
  END IF;
END $$;

COMMIT;
