ALTER TABLE knowledge.release_candidate_builds
  ADD COLUMN IF NOT EXISTS structured_records jsonb;
