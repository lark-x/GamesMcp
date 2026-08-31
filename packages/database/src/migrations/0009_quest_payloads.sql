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
