ALTER TABLE knowledge.dataset_revisions DROP CONSTRAINT IF EXISTS dataset_revisions_lifecycle_valid;
ALTER TABLE knowledge.dataset_revisions ADD CONSTRAINT dataset_revisions_lifecycle_valid
  CHECK (lifecycle_status IN ('preparing','preview','published','retired','failed'));
ALTER TABLE knowledge.dataset_revisions ADD COLUMN IF NOT EXISTS activation_build_id uuid REFERENCES knowledge.release_candidate_builds(id);
ALTER TABLE knowledge.dataset_revisions ADD COLUMN IF NOT EXISTS activation_error jsonb;
CREATE INDEX IF NOT EXISTS dataset_revisions_public_ready_index
  ON knowledge.dataset_revisions(game_id, is_current, lifecycle_status, index_status);
CREATE OR REPLACE FUNCTION knowledge.prevent_build_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'release candidate builds are immutable'; END; $$;
DROP TRIGGER IF EXISTS release_candidate_builds_immutable ON knowledge.release_candidate_builds;
CREATE TRIGGER release_candidate_builds_immutable BEFORE UPDATE OR DELETE ON knowledge.release_candidate_builds
FOR EACH ROW EXECUTE FUNCTION knowledge.prevent_build_mutation();
