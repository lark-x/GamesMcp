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
