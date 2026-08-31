CREATE UNIQUE INDEX IF NOT EXISTS dataset_revisions_activation_candidate_unique
  ON knowledge.dataset_revisions(activation_candidate_id)
  WHERE activation_candidate_id IS NOT NULL;
