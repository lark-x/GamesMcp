ALTER TABLE knowledge.document_segments
  ADD COLUMN IF NOT EXISTS heading_key text;

UPDATE knowledge.document_segments
SET heading_key = lower(array_to_string(array(select jsonb_array_elements_text(heading_path)), ' / '))
WHERE heading_key IS NULL
  AND jsonb_typeof(heading_path) = 'array';

CREATE INDEX IF NOT EXISTS document_segments_revision_document_heading_index
  ON knowledge.document_segments(revision_id, document_id, heading_key);

CREATE INDEX IF NOT EXISTS document_segments_revision_document_ordinal_index
  ON knowledge.document_segments(revision_id, document_id, ordinal);

CREATE INDEX IF NOT EXISTS quest_dialogue_nodes_revision_quest_ordinal_index
  ON knowledge.quest_dialogue_nodes(revision_id, quest_key, ordinal);

CREATE INDEX IF NOT EXISTS quest_dialogue_nodes_revision_document_ordinal_index
  ON knowledge.quest_dialogue_nodes(revision_id, document_id, ordinal);

CREATE INDEX IF NOT EXISTS quest_dialogue_nodes_revision_quest_node_index
  ON knowledge.quest_dialogue_nodes(revision_id, quest_key, node_key);

CREATE INDEX IF NOT EXISTS quest_dialogue_edges_revision_quest_from_index
  ON knowledge.quest_dialogue_edges(revision_id, quest_key, from_node_key);

CREATE INDEX IF NOT EXISTS quest_dialogue_edges_revision_document_from_index
  ON knowledge.quest_dialogue_edges(revision_id, document_id, from_node_key);

CREATE INDEX IF NOT EXISTS quest_subquests_revision_quest_ordinal_index
  ON knowledge.quest_subquests(revision_id, quest_key, ordinal);

CREATE INDEX IF NOT EXISTS entity_revision_materializations_revision_normalized_pattern_index
  ON knowledge.entity_revision_materializations(revision_id, normalized_name text_pattern_ops);

CREATE INDEX IF NOT EXISTS entity_aliases_revision_normalized_pattern_index
  ON knowledge.entity_aliases(revision_id, normalized_value text_pattern_ops);

CREATE INDEX IF NOT EXISTS text_bindings_revision_stable_type_index
  ON knowledge.text_bindings(revision_id, entity_stable_id, binding_type);

CREATE INDEX IF NOT EXISTS documents_revision_type_locale_title_index
  ON knowledge.documents(revision_id, type, locale, normalized_title);

CREATE INDEX IF NOT EXISTS documents_revision_source_index
  ON knowledge.documents(revision_id, source_key);
