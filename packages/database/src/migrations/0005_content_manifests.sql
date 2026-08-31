CREATE TABLE IF NOT EXISTS knowledge.content_objects (
  content_hash text PRIMARY KEY,
  record_type text NOT NULL,
  schema_version text NOT NULL,
  payload jsonb NOT NULL,
  byte_length integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT content_objects_payload_object CHECK (jsonb_typeof(payload) = 'object')
);

CREATE TABLE IF NOT EXISTS knowledge.dataset_manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id),
  kind text NOT NULL,
  base_revision_id uuid REFERENCES knowledge.dataset_revisions(id),
  root_hash text NOT NULL,
  record_count integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dataset_manifests_kind_check CHECK (kind IN ('preview', 'published')),
  CONSTRAINT dataset_manifests_count_check CHECK (record_count >= 0)
);

CREATE INDEX IF NOT EXISTS dataset_manifests_game_index
  ON knowledge.dataset_manifests(game_id, created_at DESC);

CREATE TABLE IF NOT EXISTS knowledge.dataset_manifest_entries (
  manifest_id uuid NOT NULL REFERENCES knowledge.dataset_manifests(id) ON DELETE CASCADE,
  canonical_key text NOT NULL,
  content_hash text NOT NULL REFERENCES knowledge.content_objects(content_hash),
  PRIMARY KEY (manifest_id, canonical_key)
);

CREATE INDEX IF NOT EXISTS dataset_manifest_entries_content_index
  ON knowledge.dataset_manifest_entries(content_hash);

ALTER TABLE knowledge.dataset_revisions
  ADD COLUMN IF NOT EXISTS manifest_id uuid REFERENCES knowledge.dataset_manifests(id);
ALTER TABLE knowledge.dataset_revisions
  ADD COLUMN IF NOT EXISTS activated_at timestamptz;
ALTER TABLE knowledge.dataset_revisions ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES knowledge.sources(id);
ALTER TABLE knowledge.dataset_revisions ADD COLUMN IF NOT EXISTS game_version text;
ALTER TABLE knowledge.dataset_revisions ADD COLUMN IF NOT EXISTS locale text;
ALTER TABLE knowledge.dataset_revisions ADD COLUMN IF NOT EXISTS archived_reason text;
ALTER TABLE knowledge.dataset_revisions ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE knowledge.release_candidate_builds
  ADD COLUMN IF NOT EXISTS import_batch_id uuid REFERENCES knowledge.import_batches(id);
ALTER TABLE knowledge.release_candidate_builds
  ADD COLUMN IF NOT EXISTS base_revision_id uuid REFERENCES knowledge.dataset_revisions(id);
ALTER TABLE knowledge.release_candidate_builds
  ADD COLUMN IF NOT EXISTS manifest_id uuid REFERENCES knowledge.dataset_manifests(id);
ALTER TABLE knowledge.release_candidate_builds
  ADD COLUMN IF NOT EXISTS build_kind text NOT NULL DEFAULT 'import';
ALTER TABLE knowledge.release_candidate_builds
  ADD COLUMN IF NOT EXISTS index_status text NOT NULL DEFAULT 'pending';
ALTER TABLE knowledge.release_candidate_builds
  ADD COLUMN IF NOT EXISTS failure_details jsonb;
ALTER TABLE knowledge.release_candidate_builds ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES knowledge.sources(id);
ALTER TABLE knowledge.release_candidate_builds ADD COLUMN IF NOT EXISTS target_game_version text;
ALTER TABLE knowledge.release_candidate_builds ADD COLUMN IF NOT EXISTS locale text;
ALTER TABLE knowledge.release_candidate_builds ADD COLUMN IF NOT EXISTS archived_reason text;
ALTER TABLE knowledge.release_candidate_builds ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE knowledge.release_candidates
  ADD COLUMN IF NOT EXISTS source_id uuid REFERENCES knowledge.sources(id);
ALTER TABLE knowledge.release_candidates
  ADD COLUMN IF NOT EXISTS target_game_version text;
ALTER TABLE knowledge.release_candidates
  ADD COLUMN IF NOT EXISTS archived_reason text;
ALTER TABLE knowledge.release_candidates
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

CREATE TABLE IF NOT EXISTS knowledge.review_issues (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id),
  candidate_id uuid NOT NULL REFERENCES knowledge.release_candidates(id) ON DELETE CASCADE,
  detected_build_id uuid REFERENCES knowledge.release_candidate_builds(id),
  canonical_key text NOT NULL,
  field_path text,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  blocking boolean NOT NULL DEFAULT true,
  fingerprint text NOT NULL,
  base_content_hash text,
  main_content_hash text,
  incoming_content_hash text,
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  resolution_action text,
  resolution_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  CONSTRAINT review_issues_kind_check CHECK (kind IN ('field_conflict','suspected_duplicate','deletion','overwrite','import_error','version_mismatch','locale_mismatch','reported')),
  CONSTRAINT review_issues_status_check CHECK (status IN ('open','resolved','reopened'))
);

CREATE UNIQUE INDEX IF NOT EXISTS review_issues_candidate_fingerprint_unique
  ON knowledge.review_issues(candidate_id, fingerprint);
CREATE INDEX IF NOT EXISTS review_issues_queue_index
  ON knowledge.review_issues(game_id, candidate_id, status, blocking);

CREATE TABLE IF NOT EXISTS knowledge.candidate_patches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES knowledge.release_candidates(id) ON DELETE CASCADE,
  issue_id uuid REFERENCES knowledge.review_issues(id) ON DELETE SET NULL,
  canonical_key text NOT NULL,
  field_path text,
  action text NOT NULL,
  manual_value jsonb,
  expected_base_hash text,
  expected_incoming_hash text,
  applied_build_id uuid REFERENCES knowledge.release_candidate_builds(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT candidate_patches_action_check CHECK (action IN ('keep_main','use_incoming','manual','not_duplicate','confirm_delete','exclude_record'))
);

CREATE INDEX IF NOT EXISTS candidate_patches_candidate_index
  ON knowledge.candidate_patches(candidate_id, created_at);

CREATE TABLE IF NOT EXISTS knowledge.review_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id uuid NOT NULL REFERENCES knowledge.review_issues(id) ON DELETE CASCADE,
  relative_path text NOT NULL,
  sha256 text NOT NULL,
  bytes integer NOT NULL,
  mime_type text NOT NULL,
  checked_game_version text NOT NULL,
  checked_locale text NOT NULL,
  note text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(issue_id, sha256)
);

CREATE TABLE IF NOT EXISTS knowledge.release_candidate_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  candidate_id uuid NOT NULL REFERENCES knowledge.release_candidates(id) ON DELETE CASCADE,
  build_id uuid REFERENCES knowledge.release_candidate_builds(id) ON DELETE CASCADE,
  check_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  message text,
  details jsonb NOT NULL DEFAULT '{}',
  retryable boolean NOT NULL DEFAULT true,
  checked_at timestamptz,
  UNIQUE(candidate_id, build_id, check_type),
  CONSTRAINT release_candidate_checks_status_check CHECK (status IN ('pending','passed','blocked','failed'))
);
