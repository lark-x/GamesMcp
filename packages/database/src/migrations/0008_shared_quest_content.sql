-- Immutable story text is shared by content hash across dataset revisions.
-- Revision/document metadata remains revision-scoped in knowledge.documents.
CREATE TABLE knowledge.quest_content_objects (
  content_hash text PRIMARY KEY,
  semantics_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE knowledge.quest_content_segments (
  id uuid NOT NULL UNIQUE,
  content_hash text NOT NULL REFERENCES knowledge.quest_content_objects(content_hash) ON DELETE CASCADE,
  segment_key text NOT NULL,
  ordinal integer NOT NULL,
  heading_path jsonb NOT NULL DEFAULT '[]'::jsonb,
  heading_key text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  body text NOT NULL,
  start_offset integer NOT NULL,
  end_offset integer NOT NULL,
  token_estimate integer NOT NULL DEFAULT 0,
  body_content_hash text NOT NULL,
  search_text text NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple'::regconfig, coalesce(search_text, '') || ' ' || coalesce(body, ''))
  ) STORED,
  PRIMARY KEY (content_hash, segment_key),
  UNIQUE (content_hash, ordinal)
);

CREATE INDEX quest_content_segments_search_vector_gin_index
  ON knowledge.quest_content_segments USING gin(search_vector);
CREATE INDEX quest_content_segments_search_text_trgm_index
  ON knowledge.quest_content_segments USING gin(search_text gin_trgm_ops);
CREATE INDEX quest_content_segments_body_trgm_index
  ON knowledge.quest_content_segments USING gin(body gin_trgm_ops);

CREATE TABLE knowledge.revision_quest_content_bindings (
  revision_id uuid NOT NULL REFERENCES knowledge.dataset_revisions(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES knowledge.documents(id) ON DELETE CASCADE,
  content_hash text NOT NULL REFERENCES knowledge.quest_content_objects(content_hash),
  PRIMARY KEY (revision_id, document_id)
);
CREATE INDEX revision_quest_content_bindings_content_index
  ON knowledge.revision_quest_content_bindings(revision_id, content_hash);

CREATE TABLE knowledge.quest_content_subquests (
  content_hash text NOT NULL REFERENCES knowledge.quest_content_objects(content_hash) ON DELETE CASCADE,
  subquest_key text NOT NULL,
  subquest_id text NOT NULL,
  ordinal integer NOT NULL,
  title text NOT NULL,
  objective text,
  completeness text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (content_hash, subquest_key)
);
CREATE INDEX quest_content_subquests_order_index
  ON knowledge.quest_content_subquests(content_hash, ordinal);

CREATE TABLE knowledge.quest_content_dialogue_nodes (
  content_hash text NOT NULL REFERENCES knowledge.quest_content_objects(content_hash) ON DELETE CASCADE,
  quest_key text NOT NULL,
  subquest_key text,
  node_key text NOT NULL,
  node_id text NOT NULL,
  node_type text NOT NULL,
  speaker_key text,
  speaker_name text,
  body text NOT NULL,
  segment_id uuid REFERENCES knowledge.quest_content_segments(id) ON DELETE SET NULL,
  ordinal integer NOT NULL,
  variants jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  search_vector tsvector GENERATED ALWAYS AS (
    to_tsvector('simple'::regconfig,
      coalesce(quest_key, '') || ' ' || coalesce(subquest_key, '') || ' ' ||
      coalesce(speaker_name, '') || ' ' || coalesce(body, ''))
  ) STORED,
  PRIMARY KEY (content_hash, node_key)
);
CREATE INDEX quest_content_dialogue_nodes_order_index
  ON knowledge.quest_content_dialogue_nodes(content_hash, ordinal);
CREATE INDEX quest_content_dialogue_nodes_subquest_order_index
  ON knowledge.quest_content_dialogue_nodes(content_hash, subquest_key, ordinal);
CREATE INDEX quest_content_dialogue_nodes_speaker_index
  ON knowledge.quest_content_dialogue_nodes(content_hash, speaker_key);
CREATE INDEX quest_content_dialogue_nodes_search_vector_gin_index
  ON knowledge.quest_content_dialogue_nodes USING gin(search_vector);
CREATE INDEX quest_content_dialogue_nodes_body_trgm_index
  ON knowledge.quest_content_dialogue_nodes USING gin(body gin_trgm_ops);

CREATE TABLE knowledge.quest_content_dialogue_edges (
  content_hash text NOT NULL REFERENCES knowledge.quest_content_objects(content_hash) ON DELETE CASCADE,
  edge_key text NOT NULL,
  from_node_key text NOT NULL,
  to_node_key text NOT NULL,
  edge_type text NOT NULL,
  option_text text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (content_hash, edge_key)
);
CREATE INDEX quest_content_dialogue_edges_from_index
  ON knowledge.quest_content_dialogue_edges(content_hash, from_node_key);

CREATE TABLE knowledge.quest_content_mentions (
  content_segment_id uuid NOT NULL REFERENCES knowledge.quest_content_segments(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES knowledge.entities(id) ON DELETE CASCADE,
  raw_text text NOT NULL,
  start_offset integer NOT NULL,
  end_offset integer NOT NULL,
  match_method text NOT NULL,
  confidence real NOT NULL DEFAULT 1,
  PRIMARY KEY (content_segment_id, entity_id, start_offset, end_offset)
);
CREATE INDEX quest_content_mentions_entity_index
  ON knowledge.quest_content_mentions(entity_id);

ALTER TABLE knowledge.text_bindings
  ADD COLUMN content_segment_id uuid REFERENCES knowledge.quest_content_segments(id) ON DELETE CASCADE;
CREATE INDEX text_bindings_content_segment_index
  ON knowledge.text_bindings(revision_id, content_segment_id)
  WHERE content_segment_id IS NOT NULL;

CREATE TABLE knowledge.quest_content_backfill_checkpoints (
  revision_id uuid PRIMARY KEY REFERENCES knowledge.dataset_revisions(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  last_document_id uuid,
  documents_processed integer NOT NULL DEFAULT 0,
  documents_bound integer NOT NULL DEFAULT 0,
  content_objects_created integer NOT NULL DEFAULT 0,
  updated_text_bindings integer NOT NULL DEFAULT 0,
  counts jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ANALYZE knowledge.quest_content_objects;
