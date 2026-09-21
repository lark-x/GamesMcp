-- Keep the public-catalogue partial index aligned with the Star Rail mission
-- taxonomy.  The document type column is intentionally text so new game
-- specific quest kinds do not require a destructive enum migration.
DROP INDEX IF EXISTS knowledge.documents_quest_visibility_index;
CREATE INDEX documents_quest_visibility_index
  ON knowledge.documents(revision_id, locale, type)
  WHERE deleted = false
    AND type IN (
      'archon_quest',
      'story_quest',
      'world_quest',
      'event_quest',
      'commission',
      'hangout',
      'companion_mission',
      'daily_mission',
      'trailblaze_continuation',
      'trailblaze_mission',
      'adventure_quest',
      'other'
    );
