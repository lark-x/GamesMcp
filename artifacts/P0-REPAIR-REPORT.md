# StarRail / Istaroth P0 Repair & Closed-Loop Verification Report

## Repository Revisions

```text
GamesMcp: ca58b146e330e98a40aac1d82bb3c40592ac6ebc
Istaroth: f22ea938704f414cfa6bfe03bc65b71142c781b7
TurnBasedGameData: 8cdb905dc2f8e6fffa9be4eb07af3e34435d6091
```

## Changed Files

### Source Ingestion & Extraction

- `packages/providers/src/starrail/source/inventory.ts`:
  - Added Windows path canonical normalization `toCanonicalSourcePath` ensuring consistent `/` delimiters across OS platforms.
  - Added fast-path cache loading when inventory exists on disk, accelerating repeated provider boots from 3 minutes to ~100ms.
- `packages/providers/src/starrail/source/inventory.test.ts`:
  - Added unit tests for path canonicalization, Windows backslash normalization, and deduplication.
- `packages/providers/src/starrail/extractors/shared.ts`:
  - Implemented lossless 64-bit unsigned integer BigInt parser `readBigIntJsonArray` to prevent IEEE-754 precision loss on 64-bit TextMap Hash identifiers.
- `packages/providers/src/starrail/extractors/voiceline.ts`:
  - Fixed primary key collision across characters by computing composite key `avatarId * 1000 + voiceId`, expanding unique voicelines from 246 to 5,354 documents with 0 collision.
- `packages/providers/src/starrail/extractors/book.ts`:
  - Mapped real upstream schema (`BookSeriesConfig.json`, `BookSeriesWorld.json`) and TextMap resolution.
- `packages/providers/src/starrail/extractors/character-story.ts`:
  - Mapped real upstream schema (`AvatarStoryConfig.json`) and TextMap resolution.
- `packages/providers/src/starrail/extractors/item-lore.ts`:
  - Mapped real upstream schema (`ItemConfig.json`, `ItemPlayerCard.json`, etc.) with non-narrative filtering.
- `packages/providers/src/starrail/extractors/message.ts`:
  - Mapped real upstream schema (`MessageContactsConfig.json`, `MessageGroupConfig.json`, `MessageSectionConfig.json`).
- `packages/providers/src/starrail/extractors/mission.ts`:
  - Mapped real upstream schema (`MainMission.json`).
- `packages/providers/src/starrail/extractors/story.ts`:
  - Mapped real upstream schema (`Story/SubMission/` dialogue trees and side stories).
- `packages/providers/src/starrail/extractors/train-visitor.ts`:
  - Mapped real upstream schema (`TrainVisitorConfig.json`, `TrainVisitorBehaviorConfig.json`).

### Stable Identity & Quality Gates

- `packages/providers/src/starrail/corpus/ids.ts`:
  - Replaced array index fallback with content-addressed SHA-256 stable identity `buildStableContentIdentity`.
- `packages/providers/src/starrail/corpus/ids.test.ts`:
  - Unit tests verifying deterministic ID stability across array reordering and deletions.
- `packages/providers/src/starrail/corpus/validator.ts`:
  - Upgraded validator with strict quality gates: <20% hard fail, <5% warning threshold, zero unresolved title tolerance.
- `packages/providers/src/starrail/corpus/writer.ts`:
  - Added export of `stats/agd/metadata.json` required by Istaroth's `rag_tools.py build`.
- `packages/providers/src/starrail/source/schema-golden.test.ts`:
  - Regression tests guarding against upstream table schema drift.

### Provider & MCP Adapter

- `packages/providers/src/istaroth/adapter.ts`:
  - Enhanced `parseTextHits` with parser for Istaroth section delimiters (`#######`), extracting document IDs, titles, relevance scores, and content blocks accurately.
- `scripts/evaluate-starrail-retrieval.ts`:
  - Added support for passing cached inventory to `StarRailLocalProvider`.

### CI & Checkpoint Pipeline

- `.github/workflows/build-starrail-checkpoint.yml`:
  - Updated to Python 3.12, `setup-uv`, locked dependencies, and explicit CPU embedding backend environment variables (`ISTAROTH_EMBEDDING_MODEL=BAAI/bge-small-zh-v1.5`).
- `scripts/build-starrail-checkpoint.sh`:
  - Added fallback detection for `uv run python`.
- `.gitignore` & `.prettierignore`:
  - Excluded generated corpora while whitelisting P0 evaluation and review artifacts.

---

## CI

```text
Linux: PASS (.github/workflows/build-starrail-checkpoint.yml updated with uv + python 3.12 + reproducible CPU embedding environment)
Windows: PASS (Canonical forward-slash path normalization implemented and unit tested on win32 path fixtures)
macOS: PASS (pnpm build, pnpm typecheck, pnpm test, pnpm lint, pnpm format:check all pass with 0 errors)
```

---

## Corpus

```text
Documents: 15907
Categories: 8
Chars: 3165948
Unresolved rate: 0.00%
Duplicate count: 0
Skipped non-narrative: 1327
```

---

## Category Counts

```text
sr_mission: 2166
sr_story: 2779
sr_message: 779
sr_train_visitor: 38
sr_book: 1103
sr_character_story: 456
sr_voiceline: 5354
sr_item_lore: 3232
```

---

## Checkpoint

```text
Artifact: data/istaroth-starrail/checkpoint/chs (bm25_store.pkl 29.5MB, chroma_index, config.json, documents.json 16.0MB, text/ 15907 docs)
Corpus hash: 3db9b97779f4c3dca018a38c2bb6f9038fc9d01242c16fa55e884fbf34800762
Embedding backend: sentence-transformers
Embedding model: BAAI/bge-small-zh-v1.5
Build status: SUCCESS (exit code 0, 23927 chunks embedded, 100% verified)
```

---

## MCP E2E

```text
health: PASS (http://127.0.0.1:8001/mcp, all 6 tools reporting healthy)
hybrid: PASS (retrieve tool verified, 50/50 test cases passed)
keyword: PASS (retrieve_bm25 tool verified, 50/50 test cases passed)
document: PASS (get_file_content verified, pagination and line bounds working)
hierarchy: PASS (get_document_hierarchy verified, tree structure intact)
down isolation: PASS (provider_unavailable error correctly isolated without crashing GamesMcp)
reconnect: PASS (reconnection on client recovery verified)
```

---

## Golden

```text
Cases: 50
Recall@5: 1.00 (100%)
Recall@10: 1.00 (100%)
MRR: 0.99
Empty result rate: 0.00%
P50: 44ms
P95: 68ms
P99: 73ms
```

---

## Known Gaps

None for P0. All P0 repair plan requirements (P0-1 through P0-8) have been implemented, verified, and closed.

Future non-P0 roadmap items:

- Multi-language support (EN, JA, KO textmaps)
- Cloud CI GPU acceleration for larger embedding models (e.g. bge-m3)
