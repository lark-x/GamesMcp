CREATE TABLE IF NOT EXISTS knowledge.text_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id uuid NOT NULL REFERENCES platform.games(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES knowledge.dataset_revisions(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_stable_id text NOT NULL,
  document_id uuid NOT NULL REFERENCES knowledge.documents(id) ON DELETE CASCADE,
  segment_id uuid REFERENCES knowledge.document_segments(id) ON DELETE CASCADE,
  binding_type text NOT NULL CHECK (
    binding_type IN (
      'primary_description',
      'character_story',
      'voice',
      'speaker',
      'quest_participant',
      'item_description',
      'book_reference',
      'achievement_reference',
      'tutorial_reference',
      'mechanism_reference',
      'mention',
      'related_text'
    )
  ),
  confidence numeric,
  binding_source text NOT NULL CHECK (
    binding_source IN (
      'direct_upstream',
      'speaker_resolution',
      'participant_resolution',
      'canonical_exact',
      'alias_exact',
      'manual_curated'
    )
  ),
  CHECK (
    binding_type <> 'mention'
    OR binding_source IN ('canonical_exact', 'alias_exact')
  ),
  CHECK (
    binding_type <> 'mention'
    OR (
      confidence IS NOT NULL
      AND (
        (binding_source = 'canonical_exact' AND confidence = 1.0)
        OR (binding_source = 'alias_exact' AND confidence = 0.9)
      )
    )
  ),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- First-pass mention materialization accepts only canonical-exact and alias-exact matches.
-- Their confidence values are canonical_exact = 1.0 and alias_exact = 0.9.
CREATE INDEX IF NOT EXISTS text_bindings_revision_stable_index
  ON knowledge.text_bindings(revision_id, entity_stable_id);
CREATE INDEX IF NOT EXISTS text_bindings_revision_document_index
  ON knowledge.text_bindings(revision_id, document_id);
