DROP INDEX IF EXISTS knowledge.quest_subquests_revision_key_unique;
CREATE UNIQUE INDEX quest_subquests_revision_key_unique
  ON knowledge.quest_subquests(revision_id, document_id, subquest_key);

DROP INDEX IF EXISTS knowledge.quest_dialogue_nodes_revision_key_unique;
CREATE UNIQUE INDEX quest_dialogue_nodes_revision_key_unique
  ON knowledge.quest_dialogue_nodes(revision_id, document_id, node_key);

DROP INDEX IF EXISTS knowledge.quest_dialogue_edges_revision_scope_unique;
CREATE UNIQUE INDEX quest_dialogue_edges_revision_scope_unique
  ON knowledge.quest_dialogue_edges(revision_id, document_id, from_node_key, to_node_key, edge_type);
