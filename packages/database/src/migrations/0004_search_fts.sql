-- Sprint 16 / FIX-009: use PostgreSQL full-text search for narrative and
-- structured text. The simple configuration is intentionally dependency-free;
-- CJK segmentation is benchmarked separately before choosing an extension.

-- The current Drizzle schema already exposes locale on documents. Keep fresh
-- databases and databases created from older migrations compatible with it.
-- pg_trgm similarity thresholds: align the % operator with the previous
-- similarity() >= 0.15 / 0.05 WHERE semantics so trgm GIN indexes can be used.
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET pg_trgm.similarity_threshold = ''0.15''', current_database());
END
$$;

ALTER TABLE knowledge.documents
  ADD COLUMN IF NOT EXISTS locale text NOT NULL DEFAULT 'und';

ALTER TABLE knowledge.documents
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'simple'::regconfig,
      coalesce(title, '') || ' ' || coalesce(body, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS documents_search_vector_gin_index
  ON knowledge.documents USING gin(search_vector);
CREATE INDEX IF NOT EXISTS documents_normalized_title_trgm_index
  ON knowledge.documents USING gin(normalized_title gin_trgm_ops);

ALTER TABLE knowledge.document_segments
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'simple'::regconfig,
      coalesce(search_text, '') || ' ' || coalesce(body, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS document_segments_search_vector_gin_index
  ON knowledge.document_segments USING gin(search_vector);
CREATE INDEX IF NOT EXISTS document_segments_search_text_trgm_index
  ON knowledge.document_segments USING gin(search_text gin_trgm_ops);

-- Dialogue is a first-class text surface too. Including speaker and quest keys
-- makes the SQL fallback useful even when a caller searches by those fields.
ALTER TABLE knowledge.quest_dialogue_nodes
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'simple'::regconfig,
      coalesce(quest_key, '') || ' ' ||
      coalesce(subquest_key, '') || ' ' ||
      coalesce(speaker_name, '') || ' ' ||
      coalesce(body, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS quest_dialogue_nodes_search_vector_gin_index
  ON knowledge.quest_dialogue_nodes USING gin(search_vector);

ALTER TABLE knowledge.genshin_characters
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'simple'::regconfig,
      coalesce(name, '') || ' ' ||
      coalesce(title, '') || ' ' ||
      coalesce(description, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS genshin_characters_search_vector_gin_index
  ON knowledge.genshin_characters USING gin(search_vector);
CREATE INDEX IF NOT EXISTS genshin_characters_normalized_name_trgm_index
  ON knowledge.genshin_characters USING gin(normalized_name gin_trgm_ops);

ALTER TABLE knowledge.genshin_weapons
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'simple'::regconfig,
      coalesce(name, '') || ' ' ||
      coalesce(passive_name, '') || ' ' ||
      coalesce(passive_description, '') || ' ' ||
      coalesce(description, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS genshin_weapons_search_vector_gin_index
  ON knowledge.genshin_weapons USING gin(search_vector);
CREATE INDEX IF NOT EXISTS genshin_weapons_normalized_name_trgm_index
  ON knowledge.genshin_weapons USING gin(normalized_name gin_trgm_ops);

ALTER TABLE knowledge.genshin_artifact_sets
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'simple'::regconfig,
      coalesce(name, '') || ' ' ||
      coalesce(two_piece_bonus, '') || ' ' ||
      coalesce(four_piece_bonus, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS genshin_artifact_sets_search_vector_gin_index
  ON knowledge.genshin_artifact_sets USING gin(search_vector);
CREATE INDEX IF NOT EXISTS genshin_artifact_sets_normalized_name_trgm_index
  ON knowledge.genshin_artifact_sets USING gin(normalized_name gin_trgm_ops);

ALTER TABLE knowledge.genshin_artifacts
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'simple'::regconfig,
      coalesce(name, '') || ' ' || coalesce(description, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS genshin_artifacts_search_vector_gin_index
  ON knowledge.genshin_artifacts USING gin(search_vector);
CREATE INDEX IF NOT EXISTS genshin_artifacts_normalized_name_trgm_index
  ON knowledge.genshin_artifacts USING gin(normalized_name gin_trgm_ops);

ALTER TABLE knowledge.genshin_materials
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'simple'::regconfig,
      coalesce(name, '') || ' ' || coalesce(description, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS genshin_materials_search_vector_gin_index
  ON knowledge.genshin_materials USING gin(search_vector);
CREATE INDEX IF NOT EXISTS genshin_materials_normalized_name_trgm_index
  ON knowledge.genshin_materials USING gin(normalized_name gin_trgm_ops);

ALTER TABLE knowledge.genshin_achievements
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'simple'::regconfig,
      coalesce(name, '') || ' ' || coalesce(requirement, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS genshin_achievements_search_vector_gin_index
  ON knowledge.genshin_achievements USING gin(search_vector);

ALTER TABLE knowledge.genshin_enemies
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'simple'::regconfig,
      coalesce(name, '') || ' ' ||
      coalesce(family, '') || ' ' ||
      coalesce(description, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS genshin_enemies_search_vector_gin_index
  ON knowledge.genshin_enemies USING gin(search_vector);
CREATE INDEX IF NOT EXISTS genshin_enemies_normalized_name_trgm_index
  ON knowledge.genshin_enemies USING gin(normalized_name gin_trgm_ops);

ALTER TABLE knowledge.genshin_voice_lines
  ADD COLUMN IF NOT EXISTS search_vector tsvector
  GENERATED ALWAYS AS (
    to_tsvector(
      'simple'::regconfig,
      coalesce(name, '') || ' ' ||
      coalesce(title, '') || ' ' ||
      coalesce(body, '')
    )
  ) STORED;

CREATE INDEX IF NOT EXISTS genshin_voice_lines_search_vector_gin_index
  ON knowledge.genshin_voice_lines USING gin(search_vector);
CREATE INDEX IF NOT EXISTS genshin_voice_lines_normalized_name_trgm_index
  ON knowledge.genshin_voice_lines USING gin(normalized_name gin_trgm_ops);
