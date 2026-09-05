CREATE INDEX IF NOT EXISTS quest_dialogue_nodes_segment_index
  ON knowledge.quest_dialogue_nodes(segment_id);

CREATE INDEX IF NOT EXISTS structured_bindings_segment_index
  ON knowledge.structured_bindings(segment_id);

CREATE INDEX IF NOT EXISTS text_bindings_segment_index
  ON knowledge.text_bindings(segment_id);

CREATE INDEX IF NOT EXISTS document_segments_revision_index
  ON knowledge.document_segments(revision_id);
