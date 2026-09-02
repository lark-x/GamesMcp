CREATE TABLE IF NOT EXISTS knowledge.entity_revision_materializations (
  revision_id uuid NOT NULL REFERENCES knowledge.dataset_revisions(id) ON DELETE CASCADE,
  entity_id uuid NOT NULL REFERENCES knowledge.entities(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  canonical_name text NOT NULL,
  normalized_name text NOT NULL,
  summary text,
  PRIMARY KEY (revision_id, entity_id)
);
CREATE INDEX IF NOT EXISTS entity_revision_materializations_entity_index
  ON knowledge.entity_revision_materializations(entity_id);
CREATE INDEX IF NOT EXISTS entity_revision_materializations_search_index
  ON knowledge.entity_revision_materializations(revision_id, normalized_name);
CREATE INDEX IF NOT EXISTS entity_revision_materializations_trgm_index
  ON knowledge.entity_revision_materializations USING gin(normalized_name gin_trgm_ops);

ALTER TABLE knowledge.entity_aliases
  ADD COLUMN IF NOT EXISTS revision_id uuid REFERENCES knowledge.dataset_revisions(id) ON DELETE CASCADE;

UPDATE knowledge.entity_aliases AS a
SET revision_id = COALESCE(e.last_revision_id, e.first_revision_id)
FROM knowledge.entities AS e
WHERE e.id = a.entity_id
  AND a.revision_id IS NULL;

ALTER TABLE knowledge.entity_aliases
  ALTER COLUMN revision_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS entity_aliases_revision_normalized_index
  ON knowledge.entity_aliases(revision_id, normalized_value);
CREATE INDEX IF NOT EXISTS entity_aliases_trgm_index
  ON knowledge.entity_aliases USING gin(normalized_value gin_trgm_ops);
CREATE INDEX IF NOT EXISTS entity_aliases_entity_revision_index
  ON knowledge.entity_aliases(entity_id, revision_id);

INSERT INTO knowledge.entity_revision_materializations (
  revision_id,
  entity_id,
  entity_type,
  canonical_name,
  normalized_name,
  summary
)
SELECT e.last_revision_id, e.id, e.type, e.canonical_name, e.normalized_name, e.summary
FROM knowledge.entities AS e
WHERE e.last_revision_id IS NOT NULL
ON CONFLICT (revision_id, entity_id) DO NOTHING;
