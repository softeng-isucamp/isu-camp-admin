-- Keep the bytea photo and its representation together so retrieval is safe.
ALTER TABLE public.location
  ADD COLUMN IF NOT EXISTS photo_mime_type varchar(64);
