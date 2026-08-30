CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE SCHEMA IF NOT EXISTS platform;
CREATE SCHEMA IF NOT EXISTS knowledge;

CREATE TABLE IF NOT EXISTS platform.games (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS platform.game_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id) ON DELETE CASCADE,
  capability text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  UNIQUE (game_id, capability)
);

CREATE TABLE IF NOT EXISTS platform.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL UNIQUE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  lease_owner text,
  leased_until timestamptz,
  heartbeat_at timestamptz,
  cancel_requested boolean NOT NULL DEFAULT false,
  error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS jobs_status_index ON platform.jobs(status);

CREATE TABLE IF NOT EXISTS platform.worker_heartbeats (
  worker_id text PRIMARY KEY,
  heartbeat_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS worker_heartbeats_time_index ON platform.worker_heartbeats(heartbeat_at);

CREATE TABLE IF NOT EXISTS knowledge.sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id),
  name text NOT NULL,
  type text NOT NULL,
  path_label text NOT NULL,
  license_note text,
  enabled boolean NOT NULL DEFAULT true,
  parser_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sources_game_index ON knowledge.sources(game_id);

CREATE TABLE IF NOT EXISTS knowledge.source_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id uuid NOT NULL REFERENCES knowledge.sources(id),
  content_hash text NOT NULL,
  storage_path text NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (source_id, content_hash)
);

CREATE TABLE IF NOT EXISTS knowledge.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id),
  source_id uuid NOT NULL REFERENCES knowledge.sources(id),
  source_snapshot_id uuid REFERENCES knowledge.source_snapshots(id),
  status text NOT NULL DEFAULT 'pending',
  parser_version text NOT NULL,
  success_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  errors jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  diff jsonb,
  staged_records jsonb,
  review_note text,
  confirmed_deletion_keys jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS import_batches_game_index ON knowledge.import_batches(game_id);
CREATE INDEX IF NOT EXISTS import_batches_status_index ON knowledge.import_batches(status);
ALTER TABLE knowledge.import_batches ALTER COLUMN source_snapshot_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS knowledge.dataset_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id),
  revision_number integer NOT NULL,
  source_batch_id uuid NOT NULL REFERENCES knowledge.import_batches(id),
  release_note text,
  published_at timestamptz NOT NULL DEFAULT now(),
  is_current boolean NOT NULL DEFAULT false,
  index_status text NOT NULL DEFAULT 'pending',
  normalized_records jsonb,
  UNIQUE (game_id, revision_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS dataset_revisions_one_current ON knowledge.dataset_revisions(game_id) WHERE is_current;
ALTER TABLE knowledge.dataset_revisions ADD COLUMN IF NOT EXISTS normalized_records jsonb;

CREATE TABLE IF NOT EXISTS knowledge.entities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id),
  source_key text,
  type text NOT NULL,
  canonical_name text NOT NULL,
  normalized_name text NOT NULL,
  summary text,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  first_revision_id uuid REFERENCES knowledge.dataset_revisions(id),
  last_revision_id uuid REFERENCES knowledge.dataset_revisions(id),
  deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, source_key)
);
CREATE INDEX IF NOT EXISTS entities_game_name_index ON knowledge.entities(game_id, normalized_name);
CREATE INDEX IF NOT EXISTS entities_game_type_index ON knowledge.entities(game_id, type);
CREATE INDEX IF NOT EXISTS entities_name_trgm_index ON knowledge.entities USING gin(normalized_name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS knowledge.entity_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES knowledge.entities(id) ON DELETE CASCADE,
  value text NOT NULL,
  normalized_value text NOT NULL,
  language text NOT NULL DEFAULT 'und',
  source_id uuid REFERENCES knowledge.sources(id),
  is_primary boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS entity_aliases_normalized_index ON knowledge.entity_aliases(normalized_value);
CREATE INDEX IF NOT EXISTS entity_aliases_trgm_index ON knowledge.entity_aliases USING gin(normalized_value gin_trgm_ops);

CREATE TABLE IF NOT EXISTS knowledge.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id),
  source_key text NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  normalized_title text NOT NULL,
  game_version text,
  source_snapshot_id uuid NOT NULL REFERENCES knowledge.source_snapshots(id),
  body text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  revision_id uuid NOT NULL REFERENCES knowledge.dataset_revisions(id),
  deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, source_key, revision_id)
);
CREATE INDEX IF NOT EXISTS documents_game_title_index ON knowledge.documents(game_id, normalized_title);
CREATE INDEX IF NOT EXISTS documents_title_trgm_index ON knowledge.documents USING gin(normalized_title gin_trgm_ops);

CREATE TABLE IF NOT EXISTS knowledge.document_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES knowledge.documents(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES knowledge.dataset_revisions(id),
  ordinal integer NOT NULL,
  heading_path jsonb NOT NULL DEFAULT '[]'::jsonb,
  body text NOT NULL,
  start_offset integer NOT NULL,
  end_offset integer NOT NULL,
  token_estimate integer NOT NULL DEFAULT 0,
  content_hash text NOT NULL,
  search_text text NOT NULL,
  UNIQUE (document_id, ordinal)
);
CREATE INDEX IF NOT EXISTS document_segments_search_index ON knowledge.document_segments USING gin(search_text gin_trgm_ops);

CREATE TABLE IF NOT EXISTS knowledge.entity_mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_id uuid NOT NULL REFERENCES knowledge.entities(id) ON DELETE CASCADE,
  segment_id uuid NOT NULL REFERENCES knowledge.document_segments(id) ON DELETE CASCADE,
  raw_text text NOT NULL,
  start_offset integer NOT NULL,
  end_offset integer NOT NULL,
  match_method text NOT NULL,
  confidence real NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS entity_mentions_entity_index ON knowledge.entity_mentions(entity_id);
CREATE INDEX IF NOT EXISTS entity_mentions_segment_index ON knowledge.entity_mentions(segment_id);

CREATE TABLE IF NOT EXISTS knowledge.relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id),
  subject_id uuid NOT NULL REFERENCES knowledge.entities(id),
  predicate text NOT NULL,
  object_id uuid NOT NULL REFERENCES knowledge.entities(id),
  source_key text,
  source_id uuid REFERENCES knowledge.sources(id),
  revision_id uuid NOT NULL REFERENCES knowledge.dataset_revisions(id),
  status text NOT NULL DEFAULT 'active',
  valid_from text,
  valid_to text,
  confidence real
);
CREATE INDEX IF NOT EXISTS relationships_subject_index ON knowledge.relationships(subject_id);
CREATE INDEX IF NOT EXISTS relationships_object_index ON knowledge.relationships(object_id);
ALTER TABLE knowledge.relationships ADD COLUMN IF NOT EXISTS source_key text;

CREATE TABLE IF NOT EXISTS knowledge.claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id),
  source_key text,
  record_source_key text,
  normalized_statement text NOT NULL,
  status text NOT NULL,
  confidence real,
  created_by text NOT NULL,
  revision_id uuid NOT NULL REFERENCES knowledge.dataset_revisions(id)
);
CREATE INDEX IF NOT EXISTS claims_game_revision_index ON knowledge.claims(game_id, revision_id);
ALTER TABLE knowledge.claims ADD COLUMN IF NOT EXISTS record_source_key text;

CREATE TABLE IF NOT EXISTS knowledge.evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid NOT NULL REFERENCES knowledge.claims(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES knowledge.documents(id),
  segment_id uuid NOT NULL REFERENCES knowledge.document_segments(id),
  quote_start integer NOT NULL DEFAULT 0,
  quote_end integer NOT NULL DEFAULT 0,
  quote text NOT NULL DEFAULT '',
  strength real,
  note text,
  valid boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS evidence_claim_index ON knowledge.evidence(claim_id);
CREATE INDEX IF NOT EXISTS evidence_segment_index ON knowledge.evidence(segment_id);

CREATE TABLE IF NOT EXISTS knowledge.claim_entities (
  claim_id uuid NOT NULL REFERENCES knowledge.claims(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES knowledge.entities(id) ON DELETE CASCADE,
  PRIMARY KEY (claim_id, entity_id)
);
CREATE INDEX IF NOT EXISTS claim_entities_entity_index ON knowledge.claim_entities(entity_id);

CREATE TABLE IF NOT EXISTS knowledge.embeddings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  target_type text NOT NULL,
  target_id uuid NOT NULL,
  space_id text NOT NULL,
  model text NOT NULL,
  model_version text NOT NULL,
  dimension integer NOT NULL,
  content_hash text NOT NULL,
  vector vector(1536) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (target_type, target_id, space_id)
);
CREATE INDEX IF NOT EXISTS embeddings_segment_vector_hnsw_index
  ON knowledge.embeddings USING hnsw (vector vector_cosine_ops)
  WHERE target_type = 'segment';

CREATE TABLE IF NOT EXISTS platform.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
