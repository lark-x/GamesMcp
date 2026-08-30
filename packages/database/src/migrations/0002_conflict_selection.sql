ALTER TABLE knowledge.conflict_cases
  ADD COLUMN IF NOT EXISTS selected_observation_id uuid
  REFERENCES knowledge.source_observations(id);

-- Equivalent observations do not need a human choice, but retaining one
-- deterministic observation as the adopted standard keeps the lineage
-- explicit for historical rows created before this column existed.
UPDATE knowledge.conflict_cases
SET selected_observation_id = (observation_ids ->> 0)::uuid
WHERE selected_observation_id IS NULL
  AND kind IN ('exact_match', 'formatting_only')
  AND jsonb_typeof(observation_ids) = 'array'
  AND jsonb_array_length(observation_ids) > 0
  AND observation_ids ->> 0 ~ '^[0-9a-fA-F-]{36}$';
