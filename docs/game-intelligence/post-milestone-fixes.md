# Post-Milestone Fixes

## Remaining items after Sprint 0-31 completion

1. Performance optimization (deferred by user decision):
   - alias_resolve ~1.58s warmP95 (target <100ms)
   - book/item_search ~1.2s (target <400ms)
   - get_quest_page ~357ms / read_segment ~707ms (target <150ms)
   - Root causes identified: 60MB normalizedRecords transfer per read-model call;
   - trgm recheck cost on large bodies. Narrow-column getRevisionMeta landed for
   - metadata-only paths; entity-name resolution restricted to mentioned entities.

2. FIX-025 (CI gate): CI workflow includes candidate-flow + story-gates jobs;
   Windows/macOS path-guard platform-awareness fixed in e3792b4.

3. Sparse upstream coverage: weapon/enemy tables absent from partial clone;
   mechanism/voice sources absent from pinned snapshot. Requires full upstream
   clone to materialize.

4. Golden pairing: entity-scoped tools now use deterministic entity UUIDs;
   title-based tools use character-story titles.

All items are recorded with measured baselines in
docs/game-intelligence/story-progress.md and data/evaluation/genshin/.
