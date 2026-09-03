# StarRail / Istaroth P0 & P0.1 Release Gate Verification Report

> **Decision**:  
> **`P0_FIX_COMPLETE = true`**  
> **`P0_RELEASE_VERIFIED = true`**

---

## 1. Repository Revisions & Provenance

```text
GamesMcp Tested Revision:     6beee9a410d77c05d8232df80027a2d205484e9f
Istaroth Revision:            f22ea938704f414cfa6bfe03bc65b71142c781b7
TurnBasedGameData Revision:   8cdb905dc2f8e6fffa9be4eb07af3e34435d6091
```

---

## 2. GitHub Actions CI & Verification Evidence

| Workflow                                                  | Run ID        | URL                                                                                                                                     | Conclusion       | Platforms / Details                                                                                                                       |
| :-------------------------------------------------------- | :------------ | :-------------------------------------------------------------------------------------------------------------------------------------- | :--------------- | :---------------------------------------------------------------------------------------------------------------------------------------- |
| **Main CI** (`ci.yml`)                                    | `33734123047` | [Run 33734123047](https://github.com/lark-x/GamesMcp/actions/runs/33734123047)                                                          | **success**      | `ubuntu-latest` (1m27s), `windows-latest` (2m31s), `macos-latest` (1m29s), `story-gates` (42s), `database` (58s), `candidate-flow` (1m4s)  |
| **Checkpoint Workflow** (`build-starrail-checkpoint.yml`) | `33714373538` | [Run 33714373538](https://github.com/lark-x/GamesMcp/actions/runs/33714373538)                                                          | **success**      | Clean `ubuntu-latest` runner, 15,907 docs, 23,927 chunks, verified provenance manifest and artifact uploaded                             |
| **Release Gate** (`starrail-istaroth-release-gate.yml`)   | `33734128391` | [Run 33734128391](https://github.com/lark-x/GamesMcp/actions/runs/33734128391)                                                          | **success**      | 3-job release gate: `build-checkpoint` → `e2e` (50/50 Golden pass) → `final-gate` (**100% GREEN**)                                         |

---

## 3. Real Corpus Evidence

- **Corpus Directory**: `data/generated/starrail/istaroth/full-chs`
- **Total Documents**: **15,907**
- **Total Characters**: **3,165,948**
- **Corpus SHA-256 Hash**: `3db9b97779f4c3dca018a38c2bb6f9038fc9d01242c16fa55e884fbf34800762`
- **Unresolved Title Rate**: **0.00%** (0 / 15,907)
- **Duplicate Document Count**: **0**
- **Index Fallback IDs**: **0** (100% deterministic composite or content-addressed IDs)
- **Filtered Non-Narrative Records**: 1,327

### Category Distribution (8 Categories)

```text
sr_voiceline:        5,354
sr_item_lore:        3,232
sr_story:            2,779
sr_mission:          2,166
sr_book:             1,103
sr_message:            779
sr_character_story:    456
sr_train_visitor:       38
Total:              15,907
```

---

## 4. Checkpoint Evidence

- **Location**: `data/istaroth-starrail/checkpoint/chs`
- **Document Count**: **15,907**
- **Vectorized Chunks**: **23,927**
- **Embedding Backend**: `sentence-transformers`
- **Embedding Model**: `BAAI/bge-small-zh-v1.5`
- **BM25 Store**: `bm25_store.pkl` (29.5 MB)
- **Document Metadata Store**: `documents.json` (16.0 MB)
- **Provenance Manifest**: `checkpoint-metadata.json` (validated with `scripts/verify-starrail-checkpoint.ts`)

---

## 5. End-to-End Release Gates & Telemetry

Results sourced from `artifacts/evaluation/starrail-istaroth-release-gate.json`:

```text
Health Gate:            PASS (http://127.0.0.1:8001/mcp, all 6 tools operational)
Hybrid Search Gate:     PASS (retrieve tool verified, 50/50 test cases passed)
Keyword Search Gate:    PASS (retrieve_bm25 tool verified, 50/50 test cases passed)
Document Read Gate:     PASS (get_file_content dynamic lookup, pagination and uniqueness verified)
Hierarchy Gate:         PASS (get_document_hierarchy returns intact document hierarchy)
Failure Isolation Gate: PASS (caught provider_unavailable cleanly; GamesMcp process survived)
Reconnect Gate:         PASS (re-established connection and succeeded on subsequent queries)
```

### Retrieval Quality Metrics

- **Golden Cases Evaluated**: **50 / 50**
- **Passed Cases**: **50 (100.0%)**
- **Failed Cases**: **0 (0.0%)**
- **Recall@5**: **1.00 (100.0%)**
- **Recall@10**: **1.00 (100.0%)**
- **MRR (Mean Reciprocal Rank)**: **0.99**
- **Empty Result Rate**: **0.00%** (0 / 50)

### Real Request Latencies (milliseconds)

| Operation              | Sample Count | P50           | P95           | P99           |
| :--------------------- | :----------- | :------------ | :------------ | :------------ |
| **Hybrid Search**      | 35           | 192.77 ms     | 271.62 ms     | 755.45 ms     |
| **Keyword (BM25)**     | 15           | 35.93 ms      | 47.87 ms      | 47.87 ms      |
| **Document Read**      | 1            | 7.04 ms       | 7.04 ms       | 7.04 ms       |
| **Document Hierarchy** | 1            | 29.16 ms      | 29.16 ms      | 29.16 ms      |
| **Overall**            | 52           | **121.41 ms** | **200.04 ms** | **673.95 ms** |

---

## 6. Answers to Section 31 Verification Questions

| #   | Question                             | Answer                                                                                                                                                                                                                                                                                                    |
| :-- | :----------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | GamesMcp tested SHA?                 | `6beee9a410d77c05d8232df80027a2d205484e9f`                                                                                                                                                                                                                                                                |
| 2   | TurnBasedGameData SHA?               | `8cdb905dc2f8e6fffa9be4eb07af3e34435d6091`                                                                                                                                                                                                                                                                |
| 3   | Istaroth SHA?                        | `f22ea938704f414cfa6bfe03bc65b71142c781b7`                                                                                                                                                                                                                                                                |
| 4   | Main CI Run ID?                      | `33734123047`                                                                                                                                                                                                                                                                                             |
| 5   | Main CI green?                       | `true (PASS - 6/6 jobs on Ubuntu, Windows, macOS)`                                                                                                                                                                                                                                                        |
| 6   | Checkpoint workflow Run ID?          | `33714373538`                                                                                                                                                                                                                                                                                             |
| 7   | Clean runner checkpoint build green? | `true (verified with Python 3.12, uv, Node 22 on ubuntu-latest)`                                                                                                                                                                                                                                          |
| 8   | Checkpoint artifact name?            | `starrail-checkpoint`                                                                                                                                                                                                                                                                                     |
| 9   | Checkpoint artifact size?            | `~46 MB` (`bm25_store.pkl` 29.5 MB + `documents.json` 16.0 MB + index)                                                                                                                                                                                                                                    |
| 10  | Corpus document count?               | `15,907`                                                                                                                                                                                                                                                                                                  |
| 11  | Corpus hash?                         | `3db9b97779f4c3dca018a38c2bb6f9038fc9d01242c16fa55e884fbf34800762`                                                                                                                                                                                                                                        |
| 12  | Checkpoint document count?           | `15,907`                                                                                                                                                                                                                                                                                                  |
| 13  | Checkpoint chunk count?              | `23,927`                                                                                                                                                                                                                                                                                                  |
| 14  | Embedding model?                     | `BAAI/bge-small-zh-v1.5`                                                                                                                                                                                                                                                                                  |
| 15  | Release Gate Run ID?                 | `33734128391`                                                                                                                                                                                                                                                                                             |
| 16  | MCP initialize PASS?                 | `true`                                                                                                                                                                                                                                                                                                    |
| 17  | tools/list PASS?                     | `true` (all 6 tools listed)                                                                                                                                                                                                                                                                               |
| 18  | Provider health PASS?                | `true` (`status: "available"`)                                                                                                                                                                                                                                                                            |
| 19  | Hybrid PASS?                         | `true` (35/35 hybrid cases passed)                                                                                                                                                                                                                                                                        |
| 20  | Keyword PASS?                        | `true` (15/15 keyword cases passed)                                                                                                                                                                                                                                                                       |
| 21  | Document PASS?                       | `true` (pagination and uniqueness validated)                                                                                                                                                                                                                                                              |
| 22  | Hierarchy PASS?                      | `true` (valid document tree returned)                                                                                                                                                                                                                                                                     |
| 23  | Down isolation PASS?                 | `true` (clean `provider_unavailable` error without crash)                                                                                                                                                                                                                                                 |
| 24  | Reconnect PASS?                      | `true` (reconnected and succeeded)                                                                                                                                                                                                                                                                        |
| 25  | Golden total / passed?               | `50 / 50 (100.0%)`                                                                                                                                                                                                                                                                                        |
| 26  | Recall@5?                            | `1.00 (100.0%)`                                                                                                                                                                                                                                                                                           |
| 27  | Recall@10?                           | `1.00 (100.0%)`                                                                                                                                                                                                                                                                                           |
| 28  | MRR / empty result rate?             | `MRR = 0.99, emptyResultRate = 0.00%`                                                                                                                                                                                                                                                                     |
| 29  | P50 / P95 / P99?                     | `Overall P50: 121.41ms, P95: 200.04ms, P99: 673.95ms`                                                                                                                                                                                                                                                     |
| 30  | UTF-8 warning root cause?            | **Case A (Upstream Content)**: Upstream `TurnBasedGameData/TextMap/TextMapCHS.json` line 74267 literally contains `\uFFFD\uFFFD` (`·《》\u00A0类\u00A0λ0-<unbreak>000</unbreak>\u00A0`) as part of an in-game corrupted library record by Fictionologists. Preserved upstream verbatim without tampering. |

---

## 7. Next Phase

With P0 and P0.1 completely closed and verified:

- `P0_FIX_COMPLETE = true`
- `P0_RELEASE_VERIFIED = true`

Subsequent development may proceed to:

- Game Archive / Data Browser
- Media Asset Resolver & Image Mapping
- Dialogue & Story Browser UI
