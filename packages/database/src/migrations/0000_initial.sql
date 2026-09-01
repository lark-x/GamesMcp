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
  structured_records jsonb,
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
  structured_records jsonb,
  UNIQUE (game_id, revision_number)
);
CREATE UNIQUE INDEX IF NOT EXISTS dataset_revisions_one_current ON knowledge.dataset_revisions(game_id) WHERE is_current;
ALTER TABLE knowledge.dataset_revisions ADD COLUMN IF NOT EXISTS normalized_records jsonb;
ALTER TABLE knowledge.dataset_revisions ADD COLUMN IF NOT EXISTS structured_records jsonb;

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
CREATE INDEX IF NOT EXISTS documents_body_trgm_index ON knowledge.documents USING gin(body gin_trgm_ops);

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
CREATE INDEX IF NOT EXISTS document_segments_body_trgm_index ON knowledge.document_segments USING gin(body gin_trgm_ops);

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

CREATE TABLE IF NOT EXISTS knowledge.game_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id) ON DELETE CASCADE,
  version text NOT NULL,
  released_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (game_id, version)
);

CREATE TABLE IF NOT EXISTS knowledge.provenance_refs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES knowledge.dataset_revisions(id) ON DELETE CASCADE,
  source_id uuid REFERENCES knowledge.sources(id),
  source_snapshot_id uuid REFERENCES knowledge.source_snapshots(id),
  source_key text NOT NULL,
  upstream_path text,
  upstream_id text,
  upstream_hash text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (revision_id, source_key)
);
CREATE INDEX IF NOT EXISTS provenance_refs_game_revision_index
  ON knowledge.provenance_refs(game_id, revision_id);

CREATE TABLE IF NOT EXISTS knowledge.structured_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES knowledge.dataset_revisions(id) ON DELETE CASCADE,
  stable_id text NOT NULL,
  structured_type text NOT NULL,
  source_key text,
  document_id uuid REFERENCES knowledge.documents(id) ON DELETE CASCADE,
  segment_id uuid REFERENCES knowledge.document_segments(id) ON DELETE CASCADE,
  relation text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (revision_id, structured_type, source_key, relation)
);
CREATE INDEX IF NOT EXISTS structured_bindings_revision_stable_index
  ON knowledge.structured_bindings(revision_id, stable_id);
CREATE INDEX IF NOT EXISTS structured_bindings_document_index
  ON knowledge.structured_bindings(document_id);

CREATE TABLE IF NOT EXISTS knowledge.genshin_characters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES knowledge.dataset_revisions(id) ON DELETE CASCADE,
  stable_id text NOT NULL,
  source_key text NOT NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  locale text NOT NULL DEFAULT 'und',
  game_version text,
  source_id uuid REFERENCES knowledge.sources(id),
  source_snapshot_id uuid REFERENCES knowledge.source_snapshots(id),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  title text,
  rarity integer,
  element text,
  weapon_type text,
  region text,
  affiliation text,
  birthday text,
  constellation text,
  description text,
  profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (revision_id, stable_id),
  UNIQUE (revision_id, source_key)
);
CREATE INDEX IF NOT EXISTS genshin_characters_game_revision_index
  ON knowledge.genshin_characters(game_id, revision_id);
CREATE INDEX IF NOT EXISTS genshin_characters_name_index
  ON knowledge.genshin_characters(revision_id, normalized_name);

CREATE TABLE IF NOT EXISTS knowledge.genshin_weapons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES knowledge.dataset_revisions(id) ON DELETE CASCADE,
  stable_id text NOT NULL,
  source_key text NOT NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  locale text NOT NULL DEFAULT 'und',
  game_version text,
  source_id uuid REFERENCES knowledge.sources(id),
  source_snapshot_id uuid REFERENCES knowledge.source_snapshots(id),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  weapon_type text NOT NULL,
  rarity integer NOT NULL,
  base_attack real,
  sub_stat text,
  passive_name text,
  passive_description text,
  ascension_materials jsonb NOT NULL DEFAULT '[]'::jsonb,
  description text,
  UNIQUE (revision_id, stable_id),
  UNIQUE (revision_id, source_key)
);
CREATE INDEX IF NOT EXISTS genshin_weapons_game_revision_index
  ON knowledge.genshin_weapons(game_id, revision_id);
CREATE INDEX IF NOT EXISTS genshin_weapons_type_index
  ON knowledge.genshin_weapons(revision_id, weapon_type);

CREATE TABLE IF NOT EXISTS knowledge.genshin_artifact_sets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES knowledge.dataset_revisions(id) ON DELETE CASCADE,
  stable_id text NOT NULL,
  source_key text NOT NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  locale text NOT NULL DEFAULT 'und',
  game_version text,
  source_id uuid REFERENCES knowledge.sources(id),
  source_snapshot_id uuid REFERENCES knowledge.source_snapshots(id),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  max_rarity integer,
  two_piece_bonus text,
  four_piece_bonus text,
  pieces jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (revision_id, stable_id),
  UNIQUE (revision_id, source_key)
);
CREATE INDEX IF NOT EXISTS genshin_artifact_sets_game_revision_index
  ON knowledge.genshin_artifact_sets(game_id, revision_id);

CREATE TABLE IF NOT EXISTS knowledge.genshin_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES knowledge.dataset_revisions(id) ON DELETE CASCADE,
  stable_id text NOT NULL,
  source_key text NOT NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  locale text NOT NULL DEFAULT 'und',
  game_version text,
  source_id uuid REFERENCES knowledge.sources(id),
  source_snapshot_id uuid REFERENCES knowledge.source_snapshots(id),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  set_stable_id text,
  slot text,
  rarity integer,
  description text,
  UNIQUE (revision_id, stable_id),
  UNIQUE (revision_id, source_key)
);
CREATE INDEX IF NOT EXISTS genshin_artifacts_game_revision_index
  ON knowledge.genshin_artifacts(game_id, revision_id);
CREATE INDEX IF NOT EXISTS genshin_artifacts_set_index
  ON knowledge.genshin_artifacts(revision_id, set_stable_id);

CREATE TABLE IF NOT EXISTS knowledge.genshin_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES knowledge.dataset_revisions(id) ON DELETE CASCADE,
  stable_id text NOT NULL,
  source_key text NOT NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  locale text NOT NULL DEFAULT 'und',
  game_version text,
  source_id uuid REFERENCES knowledge.sources(id),
  source_snapshot_id uuid REFERENCES knowledge.source_snapshots(id),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  category text NOT NULL,
  rarity integer,
  description text,
  sources jsonb NOT NULL DEFAULT '[]'::jsonb,
  used_by jsonb NOT NULL DEFAULT '[]'::jsonb,
  UNIQUE (revision_id, stable_id),
  UNIQUE (revision_id, source_key)
);
CREATE INDEX IF NOT EXISTS genshin_materials_game_revision_index
  ON knowledge.genshin_materials(game_id, revision_id);
CREATE INDEX IF NOT EXISTS genshin_materials_category_index
  ON knowledge.genshin_materials(revision_id, category);

CREATE TABLE IF NOT EXISTS knowledge.genshin_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES knowledge.dataset_revisions(id) ON DELETE CASCADE,
  stable_id text NOT NULL,
  source_key text NOT NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  locale text NOT NULL DEFAULT 'und',
  game_version text,
  source_id uuid REFERENCES knowledge.sources(id),
  source_snapshot_id uuid REFERENCES knowledge.source_snapshots(id),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  category text NOT NULL,
  requirement text,
  reward_primogems integer,
  hidden boolean NOT NULL DEFAULT false,
  UNIQUE (revision_id, stable_id),
  UNIQUE (revision_id, source_key)
);
CREATE INDEX IF NOT EXISTS genshin_achievements_game_revision_index
  ON knowledge.genshin_achievements(game_id, revision_id);
CREATE INDEX IF NOT EXISTS genshin_achievements_category_index
  ON knowledge.genshin_achievements(revision_id, category);
CREATE INDEX IF NOT EXISTS genshin_achievements_name_trgm_index
  ON knowledge.genshin_achievements USING gin(normalized_name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS knowledge.genshin_enemies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES knowledge.dataset_revisions(id) ON DELETE CASCADE,
  stable_id text NOT NULL,
  source_key text NOT NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  locale text NOT NULL DEFAULT 'und',
  game_version text,
  source_id uuid REFERENCES knowledge.sources(id),
  source_snapshot_id uuid REFERENCES knowledge.source_snapshots(id),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  category text NOT NULL,
  family text,
  description text,
  drops jsonb NOT NULL DEFAULT '[]'::jsonb,
  resistances jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (revision_id, stable_id),
  UNIQUE (revision_id, source_key)
);
CREATE INDEX IF NOT EXISTS genshin_enemies_game_revision_index
  ON knowledge.genshin_enemies(game_id, revision_id);
CREATE INDEX IF NOT EXISTS genshin_enemies_category_index
  ON knowledge.genshin_enemies(revision_id, category);

CREATE TABLE IF NOT EXISTS knowledge.genshin_books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES knowledge.dataset_revisions(id) ON DELETE CASCADE,
  stable_id text NOT NULL,
  source_key text NOT NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  locale text NOT NULL DEFAULT 'und',
  game_version text,
  source_id uuid REFERENCES knowledge.sources(id),
  source_snapshot_id uuid REFERENCES knowledge.source_snapshots(id),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  volume integer,
  series text,
  body text NOT NULL DEFAULT '',
  UNIQUE (revision_id, stable_id),
  UNIQUE (revision_id, source_key)
);
CREATE INDEX IF NOT EXISTS genshin_books_game_revision_index
  ON knowledge.genshin_books(game_id, revision_id);

CREATE TABLE IF NOT EXISTS knowledge.genshin_character_stories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES knowledge.dataset_revisions(id) ON DELETE CASCADE,
  stable_id text NOT NULL,
  source_key text NOT NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  locale text NOT NULL DEFAULT 'und',
  game_version text,
  source_id uuid REFERENCES knowledge.sources(id),
  source_snapshot_id uuid REFERENCES knowledge.source_snapshots(id),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  character_stable_id text NOT NULL,
  story_key text NOT NULL,
  unlock_condition text,
  body text NOT NULL DEFAULT '',
  UNIQUE (revision_id, character_stable_id, story_key),
  UNIQUE (revision_id, source_key)
);
CREATE INDEX IF NOT EXISTS genshin_character_stories_character_index
  ON knowledge.genshin_character_stories(revision_id, character_stable_id);

CREATE TABLE IF NOT EXISTS knowledge.genshin_item_descriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES knowledge.dataset_revisions(id) ON DELETE CASCADE,
  stable_id text NOT NULL,
  source_key text NOT NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  locale text NOT NULL DEFAULT 'und',
  game_version text,
  source_id uuid REFERENCES knowledge.sources(id),
  source_snapshot_id uuid REFERENCES knowledge.source_snapshots(id),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  item_stable_id text,
  body text NOT NULL DEFAULT '',
  UNIQUE (revision_id, stable_id),
  UNIQUE (revision_id, source_key)
);
CREATE INDEX IF NOT EXISTS genshin_item_descriptions_item_index
  ON knowledge.genshin_item_descriptions(revision_id, item_stable_id);

CREATE TABLE IF NOT EXISTS knowledge.genshin_voice_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES knowledge.dataset_revisions(id) ON DELETE CASCADE,
  stable_id text NOT NULL,
  source_key text NOT NULL,
  name text NOT NULL,
  normalized_name text NOT NULL,
  locale text NOT NULL DEFAULT 'und',
  game_version text,
  source_id uuid REFERENCES knowledge.sources(id),
  source_snapshot_id uuid REFERENCES knowledge.source_snapshots(id),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  character_stable_id text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  content_hash text NOT NULL,
  UNIQUE (revision_id, stable_id),
  UNIQUE (revision_id, source_key)
);
CREATE INDEX IF NOT EXISTS genshin_voice_lines_character_index
  ON knowledge.genshin_voice_lines(revision_id, character_stable_id);

CREATE TABLE IF NOT EXISTS knowledge.search_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES knowledge.dataset_revisions(id) ON DELETE CASCADE,
  stable_id text NOT NULL,
  target_type text NOT NULL,
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  locale text NOT NULL DEFAULT 'und',
  content_hash text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (revision_id, target_type, stable_id, locale)
);
CREATE INDEX IF NOT EXISTS search_documents_game_revision_index
  ON knowledge.search_documents(game_id, revision_id);
CREATE INDEX IF NOT EXISTS search_documents_title_body_trgm_index
  ON knowledge.search_documents USING gin((coalesce(title, '') || ' ' || coalesce(body, '')) gin_trgm_ops);

CREATE TABLE IF NOT EXISTS platform.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);


-- Consolidated from 0001_acquisition_verification.sql
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


-- Consolidated from 0002_conflict_selection.sql
ALTER TABLE knowledge.conflict_cases
  ADD COLUMN IF NOT EXISTS selected_observation_id uuid
  REFERENCES knowledge.source_observations(id);

-- Equivalent observations do not need a human choice, but retaining one
-- deterministic observation as the adopted standard keeps the lineage
-- explicit for historical rows created before this column existed.
UPDATE knowledge.conflict_cases
SET selected_observation_id = (observation_ids ->> 0)::uuid
WHERE selected_observation_id IS NULL
  AND kind IN ('exact_match', 'formatting_only')
  AND jsonb_typeof(observation_ids) = 'array'
  AND jsonb_array_length(observation_ids) > 0
  AND observation_ids ->> 0 ~ '^[0-9a-fA-F-]{36}$';


-- Consolidated from 0003_revision_lifecycle.sql
ALTER TABLE knowledge.dataset_revisions
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'published';

UPDATE knowledge.dataset_revisions
SET lifecycle_status = 'published'
WHERE lifecycle_status IS NULL;

ALTER TABLE knowledge.dataset_revisions
  DROP CONSTRAINT IF EXISTS dataset_revisions_lifecycle_valid;
ALTER TABLE knowledge.dataset_revisions
  ADD CONSTRAINT dataset_revisions_lifecycle_valid
  CHECK (lifecycle_status IN ('preview', 'published', 'retired'));

ALTER TABLE knowledge.dataset_revisions
  DROP CONSTRAINT IF EXISTS dataset_revisions_current_must_be_published;
ALTER TABLE knowledge.dataset_revisions
  ADD CONSTRAINT dataset_revisions_current_must_be_published
  CHECK (NOT is_current OR lifecycle_status = 'published');

CREATE INDEX IF NOT EXISTS dataset_revisions_lifecycle_index
  ON knowledge.dataset_revisions(game_id, lifecycle_status);

-- Rebuild the partial unique index with the lifecycle condition documented in
-- the database itself. The CHECK above remains the hard safety boundary.
DROP INDEX IF EXISTS knowledge.dataset_revisions_one_current;
CREATE UNIQUE INDEX dataset_revisions_one_current
  ON knowledge.dataset_revisions(game_id)
  WHERE is_current AND lifecycle_status = 'published';

-- Entity ids are stable across revisions. Embeddings therefore need an
-- explicit revision key; otherwise generating a preview embedding overwrites
-- the vector used by the published MCP revision.
ALTER TABLE knowledge.embeddings
  ADD COLUMN IF NOT EXISTS revision_id uuid;

UPDATE knowledge.embeddings AS embedding
SET revision_id = segment.revision_id
FROM knowledge.document_segments AS segment
WHERE embedding.target_type = 'segment'
  AND embedding.target_id = segment.id
  AND embedding.revision_id IS NULL;

UPDATE knowledge.embeddings AS embedding
SET revision_id = current_revision.id
FROM knowledge.entities AS entity
JOIN knowledge.dataset_revisions AS current_revision
  ON current_revision.game_id = entity.game_id
 AND current_revision.is_current
 AND current_revision.lifecycle_status = 'published'
WHERE embedding.target_type = 'entity'
  AND embedding.target_id = entity.id
  AND embedding.revision_id IS NULL;

-- Orphaned cached vectors are safe to discard and will be rebuilt by the
-- normal indexing job. Keeping an unscoped vector would violate isolation.
DELETE FROM knowledge.embeddings WHERE revision_id IS NULL;

ALTER TABLE knowledge.embeddings
  ALTER COLUMN revision_id SET NOT NULL;
ALTER TABLE knowledge.embeddings
  DROP CONSTRAINT IF EXISTS embeddings_revision_id_fkey;
ALTER TABLE knowledge.embeddings
  ADD CONSTRAINT embeddings_revision_id_fkey
  FOREIGN KEY (revision_id) REFERENCES knowledge.dataset_revisions(id) ON DELETE CASCADE;

ALTER TABLE knowledge.embeddings
  DROP CONSTRAINT IF EXISTS embeddings_target_type_target_id_space_id_key;
DROP INDEX IF EXISTS knowledge.embeddings_target_space_unique;
CREATE UNIQUE INDEX IF NOT EXISTS embeddings_target_revision_space_unique
  ON knowledge.embeddings(revision_id, target_type, target_id, space_id);
CREATE INDEX IF NOT EXISTS embeddings_revision_index
  ON knowledge.embeddings(revision_id);


-- Consolidated from 0004_release_candidates.sql
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


-- Consolidated from 0005_content_manifests.sql
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


-- Consolidated from 0006_legacy_provenance.sql
-- Legacy rows created before immutable content manifests are deliberately
-- quarantined. They remain available for audit but cannot become public data.
UPDATE knowledge.dataset_revisions
SET is_current = false
WHERE manifest_id IS NULL AND is_current;

UPDATE knowledge.dataset_revisions
SET lifecycle_status = 'retired',
    archived_reason = COALESCE(archived_reason, 'legacy revision has no immutable content manifest'),
    archived_at = COALESCE(archived_at, now())
WHERE manifest_id IS NULL
  AND lifecycle_status <> 'retired';

UPDATE knowledge.release_candidate_builds
SET status = 'failed',
    archived_reason = COALESCE(archived_reason, 'legacy build has no immutable content manifest'),
    archived_at = COALESCE(archived_at, now()),
    failure_details = COALESCE(failure_details, '{}'::jsonb) || jsonb_build_object('code', 'legacy_manifest_missing')
WHERE manifest_id IS NULL
  AND status <> 'failed';


-- Consolidated from 0007_revision_preparing.sql
ALTER TABLE knowledge.dataset_revisions DROP CONSTRAINT IF EXISTS dataset_revisions_lifecycle_valid;
ALTER TABLE knowledge.dataset_revisions ADD CONSTRAINT dataset_revisions_lifecycle_valid
  CHECK (lifecycle_status IN ('preparing','preview','published','retired','failed'));
ALTER TABLE knowledge.dataset_revisions ADD COLUMN IF NOT EXISTS activation_build_id uuid REFERENCES knowledge.release_candidate_builds(id);
ALTER TABLE knowledge.dataset_revisions ADD COLUMN IF NOT EXISTS activation_error jsonb;
ALTER TABLE knowledge.dataset_revisions ADD COLUMN IF NOT EXISTS activation_candidate_id uuid REFERENCES knowledge.release_candidates(id);
ALTER TABLE knowledge.dataset_revisions ADD COLUMN IF NOT EXISTS provenance jsonb;
CREATE INDEX IF NOT EXISTS dataset_revisions_public_ready_index
  ON knowledge.dataset_revisions(game_id, is_current, lifecycle_status, index_status);
CREATE OR REPLACE FUNCTION knowledge.prevent_build_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'release candidate builds are immutable'; END; $$;
DROP TRIGGER IF EXISTS release_candidate_builds_immutable ON knowledge.release_candidate_builds;
CREATE TRIGGER release_candidate_builds_immutable BEFORE UPDATE OR DELETE ON knowledge.release_candidate_builds
FOR EACH ROW EXECUTE FUNCTION knowledge.prevent_build_mutation();


-- Consolidated from 0008_candidate_promotion_idempotency.sql
CREATE UNIQUE INDEX IF NOT EXISTS dataset_revisions_activation_candidate_unique
  ON knowledge.dataset_revisions(activation_candidate_id)
  WHERE activation_candidate_id IS NOT NULL;


-- Consolidated from 0009_quest_payloads.sql
ALTER TABLE knowledge.documents
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'und';

CREATE INDEX IF NOT EXISTS documents_revision_type_locale_index
  ON knowledge.documents(revision_id, type, locale);

ALTER TABLE knowledge.document_segments
  ADD COLUMN IF NOT EXISTS segment_key text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS document_segments_document_key_unique
  ON knowledge.document_segments(document_id, segment_key)
  WHERE segment_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS knowledge.quest_subquests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES knowledge.documents(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES knowledge.dataset_revisions(id) ON DELETE CASCADE,
  quest_key text NOT NULL,
  subquest_key text NOT NULL,
  subquest_id text NOT NULL,
  ordinal integer NOT NULL,
  title text NOT NULL,
  objective text,
  completeness text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS quest_subquests_revision_key_unique
  ON knowledge.quest_subquests(revision_id, subquest_key);

CREATE INDEX IF NOT EXISTS quest_subquests_document_index
  ON knowledge.quest_subquests(document_id, ordinal);

CREATE TABLE IF NOT EXISTS knowledge.quest_dialogue_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES knowledge.documents(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES knowledge.dataset_revisions(id) ON DELETE CASCADE,
  quest_key text NOT NULL,
  subquest_key text,
  node_key text NOT NULL,
  node_id text NOT NULL,
  node_type text NOT NULL,
  speaker_key text,
  speaker_name text,
  body text NOT NULL,
  segment_id uuid REFERENCES knowledge.document_segments(id) ON DELETE SET NULL,
  ordinal integer NOT NULL,
  variants jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS quest_dialogue_nodes_revision_key_unique
  ON knowledge.quest_dialogue_nodes(revision_id, node_key);

CREATE INDEX IF NOT EXISTS quest_dialogue_nodes_document_index
  ON knowledge.quest_dialogue_nodes(document_id, ordinal);

CREATE INDEX IF NOT EXISTS quest_dialogue_nodes_speaker_index
  ON knowledge.quest_dialogue_nodes(revision_id, speaker_key);
CREATE INDEX IF NOT EXISTS quest_dialogue_nodes_body_trgm_index
  ON knowledge.quest_dialogue_nodes USING gin(body gin_trgm_ops);

CREATE TABLE IF NOT EXISTS knowledge.quest_dialogue_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES knowledge.documents(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES knowledge.dataset_revisions(id) ON DELETE CASCADE,
  quest_key text NOT NULL,
  from_node_key text NOT NULL,
  to_node_key text NOT NULL,
  edge_type text NOT NULL,
  option_text text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS quest_dialogue_edges_revision_scope_unique
  ON knowledge.quest_dialogue_edges(revision_id, from_node_key, to_node_key, edge_type);

CREATE INDEX IF NOT EXISTS quest_dialogue_edges_document_index
  ON knowledge.quest_dialogue_edges(document_id);


-- Consolidated from 0010_quest_locale_scoped_keys.sql
DROP INDEX IF EXISTS knowledge.quest_subquests_revision_key_unique;
CREATE UNIQUE INDEX quest_subquests_revision_key_unique
  ON knowledge.quest_subquests(revision_id, document_id, subquest_key);

DROP INDEX IF EXISTS knowledge.quest_dialogue_nodes_revision_key_unique;
CREATE UNIQUE INDEX quest_dialogue_nodes_revision_key_unique
  ON knowledge.quest_dialogue_nodes(revision_id, document_id, node_key);

DROP INDEX IF EXISTS knowledge.quest_dialogue_edges_revision_scope_unique;
CREATE UNIQUE INDEX quest_dialogue_edges_revision_scope_unique
  ON knowledge.quest_dialogue_edges(revision_id, document_id, from_node_key, to_node_key, edge_type);


-- Consolidated from 0011_quest_edge_option_scope.sql
DROP INDEX IF EXISTS knowledge.quest_dialogue_edges_revision_scope_unique;
CREATE UNIQUE INDEX quest_dialogue_edges_revision_scope_unique
  ON knowledge.quest_dialogue_edges(revision_id, document_id, from_node_key, to_node_key, edge_type, option_text);


-- Consolidated from 0012_public_catalog_indexes.sql
CREATE INDEX IF NOT EXISTS documents_public_catalog_index
  ON knowledge.documents(revision_id, locale, type, normalized_title)
  WHERE deleted = false;

CREATE INDEX IF NOT EXISTS documents_quest_visibility_index
  ON knowledge.documents(revision_id, locale, type)
  WHERE deleted = false
    AND type IN ('archon_quest', 'story_quest', 'world_quest', 'event_quest');

CREATE INDEX IF NOT EXISTS quest_dialogue_nodes_document_subquest_ordinal_index
  ON knowledge.quest_dialogue_nodes(document_id, subquest_key, ordinal);

CREATE INDEX IF NOT EXISTS entities_game_type_name_index
  ON knowledge.entities(game_id, type, canonical_name)
  WHERE deleted = false;
