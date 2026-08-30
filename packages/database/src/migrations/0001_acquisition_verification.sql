CREATE TABLE IF NOT EXISTS knowledge.source_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id),
  source_id uuid NOT NULL REFERENCES knowledge.sources(id),
  source_snapshot_id uuid NOT NULL REFERENCES knowledge.source_snapshots(id),
  canonical_key text NOT NULL,
  category text NOT NULL,
  game_version text NOT NULL,
  locale text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  raw_content_hash text NOT NULL,
  normalized_content_hash text NOT NULL,
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_snapshot_id, canonical_key)
);
ALTER TABLE knowledge.source_observations
  ADD COLUMN IF NOT EXISTS body text NOT NULL DEFAULT '';
UPDATE knowledge.source_observations AS observation
SET body = source_record.value->>'body'
FROM knowledge.import_batches AS batch
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(batch.staged_records, '[]'::jsonb)) AS source_record(value)
WHERE observation.source_snapshot_id = batch.source_snapshot_id
  AND observation.canonical_key = COALESCE(
    source_record.value->>'sourceKey',
    source_record.value->'metadata'->'provenance'->>'canonicalKey'
  )
  AND observation.body = ''
  AND COALESCE(source_record.value->>'body', '') <> '';
CREATE INDEX IF NOT EXISTS source_observations_compare_index
  ON knowledge.source_observations(game_id, canonical_key, game_version, locale);

CREATE TABLE IF NOT EXISTS knowledge.conflict_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id),
  canonical_key text NOT NULL,
  game_version text NOT NULL,
  locale text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  observation_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolution text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (game_id, canonical_key, game_version, locale)
);
CREATE INDEX IF NOT EXISTS conflict_cases_status_index
  ON knowledge.conflict_cases(game_id, status);

CREATE TABLE IF NOT EXISTS knowledge.verification_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL UNIQUE REFERENCES knowledge.import_batches(id),
  upstream_commit text NOT NULL,
  expected_game_version text NOT NULL,
  expected_locale text NOT NULL,
  seed text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge.verification_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES knowledge.verification_runs(id) ON DELETE CASCADE,
  category text NOT NULL,
  canonical_key text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'not_checked',
  channel text,
  checked_game_version text,
  checked_locale text,
  note text,
  required boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, canonical_key)
);
CREATE INDEX IF NOT EXISTS verification_items_status_index
  ON knowledge.verification_items(run_id, status);

CREATE TABLE IF NOT EXISTS knowledge.verification_screenshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES knowledge.verification_items(id) ON DELETE CASCADE,
  relative_path text NOT NULL,
  sha256 text NOT NULL,
  bytes integer NOT NULL,
  mime_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, sha256)
);
