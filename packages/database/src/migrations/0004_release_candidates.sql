CREATE TABLE IF NOT EXISTS knowledge.release_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id),
  name text NOT NULL,
  base_revision_id uuid REFERENCES knowledge.dataset_revisions(id),
  import_batch_ids jsonb NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  current_build_id uuid,
  promoted_revision_id uuid REFERENCES knowledge.dataset_revisions(id),
  promotion_idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT release_candidates_import_batches_array
    CHECK (jsonb_typeof(import_batch_ids) = 'array' AND jsonb_array_length(import_batch_ids) > 0),
  CONSTRAINT release_candidates_status_check
    CHECK (status IN ('draft', 'preview_ready', 'ready_to_promote', 'promoted', 'withdrawn', 'failed'))
);

CREATE INDEX IF NOT EXISTS release_candidates_game_status_index
  ON knowledge.release_candidates(game_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS release_candidates_promotion_key_unique
  ON knowledge.release_candidates(promotion_idempotency_key)
  WHERE promotion_idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS knowledge.release_candidate_builds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES knowledge.release_candidates(id) ON DELETE CASCADE,
  build_number integer NOT NULL,
  status text NOT NULL DEFAULT 'ready',
  content_checksum text NOT NULL,
  normalized_records jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT release_candidate_builds_status_check CHECK (status IN ('ready', 'failed')),
  CONSTRAINT release_candidate_builds_number_positive CHECK (build_number > 0),
  CONSTRAINT release_candidate_builds_records_array CHECK (jsonb_typeof(normalized_records) = 'array'),
  CONSTRAINT release_candidate_builds_number_unique UNIQUE (candidate_id, build_number)
);

CREATE INDEX IF NOT EXISTS release_candidate_builds_candidate_index
  ON knowledge.release_candidate_builds(candidate_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'release_candidates_current_build_fk'
  ) THEN
    ALTER TABLE knowledge.release_candidates
      ADD CONSTRAINT release_candidates_current_build_fk
      FOREIGN KEY (current_build_id) REFERENCES knowledge.release_candidate_builds(id);
  END IF;
END $$;

COMMENT ON TABLE knowledge.release_candidate_builds IS
  'Immutable preview snapshots. Rows in this table are never queried by MCP/public repository methods.';
