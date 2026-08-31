DROP INDEX IF EXISTS knowledge.quest_dialogue_edges_revision_scope_unique;
CREATE UNIQUE INDEX quest_dialogue_edges_revision_scope_unique
  ON knowledge.quest_dialogue_edges(revision_id, document_id, from_node_key, to_node_key, edge_type, option_text);
