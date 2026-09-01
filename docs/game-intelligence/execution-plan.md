# Game Intelligence Platform Execution Plan

> Authoritative plan: `docs/game-intelligence/refactor-plan.md`.
>
> This file is the staged execution view. If there is any conflict, the authoritative plan wins, with the covering rules at the top of that file taking highest priority.

## Execution Rules

1. No parallel version track.
   - Do not create version-prefixed replacement API routes.
   - Do not create second-track feature flags.
   - Do not keep old and new contracts in parallel.
   - Do not preserve old MCP tools as compatibility surfaces.

2. Full rebuild boundary.
   - Keep `.git`, upstream raw data, source/license notes, local secret/config references, and planning/progress documents.
   - Rebuild source code, database schema, migrations, generated data, indexes, manifests, candidates, and release artifacts around the new Game Intelligence Platform.
   - Before any destructive cleanup, enumerate exact targets and record the cleanup in `progress.md`.

3. Product shape.
   - Project name: Game Intelligence Platform.
   - Shared data layer: Game Data Core.
   - Human product: Game Codex.
   - Agent product: Game MCP.
   - First fully supported game: `genshin-impact`.

4. Stage registration is mandatory.
   - Set a phase to `进行中` before implementation starts.
   - Set a phase to `阻塞` only with a concrete blocker and recovery point.
   - Set a phase to `已完成` only after deliverables and verification evidence are recorded.
   - Use `未开始`, `进行中`, `阻塞`, `已完成` only.

## Global Verification Gates

Run these at the end of every implementation phase unless the phase explicitly has no executable code changes:

```bash
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Additional gates:

- Database phase: disposable database migration test.
- Web phase: `pnpm test:e2e`.
- MCP phase: real MCP tool contract tests.
- Search phase: retrieval/evaluation fixtures and latency checks.
- ETL phase: parser fixtures, validation reports, provenance checks, and snapshot repeatability.
- Deployment phase: Docker Compose smoke test and operational runbook check.

## Phase 0: Baseline and Rebuild Boundary

Goal: make the overwrite scope explicit before touching implementation.

Deliverables:

- Confirm attached source plan checksum and preserve it in project docs.
- Create `docs/game-intelligence/refactor-plan.md`.
- Create `docs/game-intelligence/execution-plan.md`.
- Create `docs/game-intelligence/progress.md`.
- Inventory current code, generated files, DB files, raw upstream inputs, and configuration files.
- Record exact keep/remove/rebuild categories.

Verification:

- Confirm that no old second-track naming or version-prefixed route/document paths remain in
  `docs/game-intelligence`.
- `pnpm format:check`

## Phase 1: New Monorepo and Package Boundaries

Goal: reshape the codebase around Game Intelligence Platform package boundaries.

Deliverables:

- Keep pnpm workspace, Node.js, TypeScript, ESM, Fastify, React/Vite, PostgreSQL, Drizzle, MCP SDK, Vitest, Playwright, and Docker Compose as the default technical stack.
- Replace generic platform naming with Game Intelligence naming.
- Split oversized implementation files before adding new behavior.
- Establish package boundaries for config, database, domain, ingestion, search/retrieval, API, web, MCP, worker, QA/evaluation, and shared contracts.
- Remove compatibility surfaces that only exist for old routes or tools.

Verification:

- Global verification gates.

## Phase 2: New Game Data Core Schema

Goal: rebuild the database model from a new empty schema.

Deliverables:

- New Drizzle schema and migration baseline from `0000`.
- Tables for games, sources, snapshots, revisions, provenance, search indexes, aliases, bindings, and Genshin-specific structured data.
- Explicit models for characters, weapons, artifacts, materials, enemies, achievements, quests, dialogue, books, stories, item descriptions, and version/source metadata.
- Stable IDs and bindings between structured entities and text documents/segments.
- No migration compatibility with current database revisions.

Verification:

- Disposable database migration test.
- Repository contract tests.
- Global verification gates.

## Phase 3: AnimeGameData ETL Rebuild

Goal: ingest upstream AnimeGameData into the new canonical database from scratch.

Deliverables:

- Source snapshot capture and path guard.
- Parser/normalizer for structured Genshin domains.
- Quest/dialogue extraction with old converter behavior used only as a reference for expectations.
- Validation reports, warning/error taxonomy, diff summary, provenance, locale/version handling, and deterministic content hashes.
- No Web/MCP direct reads from raw AnimeGameData files.

Verification:

- Parser fixture tests.
- Snapshot repeatability checks.
- Import validation checks.
- Global verification gates.

## Phase 4: Revision and Publish Lifecycle

Goal: make every readable dataset revisioned, publishable, and recoverable.

Deliverables:

- Canonical revision model.
- Current revision pointer.
- Publish/build manifest.
- Rollback flow.
- Backup and recovery behavior.
- Import status and audit records.

Verification:

- Candidate/revision lifecycle tests adapted to the new schema.
- Backup gate tests.
- Global verification gates.

## Phase 5: Search Core

Goal: create a shared search layer for Web and MCP.

Deliverables:

- Text segmentation and section-aware retrieval.
- Lexical, structured filter, and embedding hooks.
- Search APIs for characters, weapons, materials, enemies, achievements, quests, dialogue, lore, books, and descriptions.
- Token-aware result shaping for MCP.
- Evaluation fixtures and baseline metrics.

Verification:

- Retrieval tests and evaluation scripts.
- Latency and ranking smoke tests.
- Global verification gates.

## Phase 6: Shared Domain Services and Read Models

Goal: make API and MCP consume the same domain services, not each other.

Deliverables:

- Domain service layer over repositories.
- Game Codex read model.
- Game MCP read model.
- Alias resolution.
- Provenance and citation shaping.
- Section-based text read service.

Verification:

- Domain service tests.
- API/MCP shared fixture tests.
- Global verification gates.

## Phase 7: REST API

Goal: expose Game Codex API without any versioned route prefix.

Deliverables:

- Routes under `/api/games/genshin-impact/...` or equivalent non-versioned Genshin routes.
- Endpoints for character, weapon, artifact, material, enemy, achievement, quest, dialogue, lore, source, version, and search use cases.
- Zod request/response contracts.
- OpenAPI-like contract tests.
- Remove old route contracts that contradict the new product model.

Verification:

- API route contract tests.
- Global verification gates.

## Phase 8: Game Codex Web

Goal: rebuild the web app as the human-facing Game Codex product.

Deliverables:

- App shell, routing, data providers, and error/loading states.
- Pages for characters, weapons, artifacts, materials, enemies, achievements, quests, dialogue reader, books/stories/descriptions, search, and source/version views.
- Replace oversized `App.tsx` and global CSS with maintainable components and styles.
- Admin screens only where they support import/revision operations.

Verification:

- Component/page tests where practical.
- `pnpm test:e2e`.
- Global verification gates.

## Phase 9: Game MCP

Goal: rebuild MCP as the agent-facing product over domain services.

Deliverables:

- New tool set only; no old compatibility tools.
- Tools for character, weapon, material, enemy, achievement, quest, dialogue, lore search, evidence text read, alias resolve, and section reads.
- Strong Zod schemas.
- Low-token outputs with citations and stable IDs.
- MCP calls domain services directly, not HTTP API round trips.

Verification:

- Real MCP tool contract tests.
- Token budget KPI tests.
- Global verification gates.

## Phase 10: QA and Evaluation

Goal: prove correctness for factual lookup, search, and evidence retrieval.

Deliverables:

- Golden datasets for structured lookup, text search, dialogue search, and lore/evidence tasks.
- Regression suite for parser output and public contracts.
- Metrics for accuracy, evidence coverage, token usage, latency, and failed lookup behavior.
- Human verification checklist exports where needed.

Verification:

- `pnpm eval:retrieval`
- `pnpm eval:qa`
- Global verification gates.

## Phase 11: Admin and Operations

Goal: make local operation and maintenance repeatable.

Deliverables:

- Import/revision operational screens or scripts.
- Backup/restore runbooks.
- Docker Compose alignment.
- Environment documentation.
- Worker jobs and heartbeat behavior where needed.
- Local/auth boundary for admin routes.

Verification:

- Operational script tests.
- Docker smoke test where available.
- Global verification gates.

## Phase 12: Performance, Cleanup, and Cutover

Goal: finish the overwrite, remove obsolete derived assets, and verify the full system.

Deliverables:

- Performance indexes and query tuning.
- Search and MCP token/latency KPI evidence.
- Exact cleanup list for old generated assets, old migration artifacts, old candidates/builds/manifests, and obsolete docs.
- Final README and operations docs aligned to Game Intelligence Platform.
- Full end-to-end verification record.

Verification:

- Full global gates.
- E2E, MCP, database, retrieval, QA, and Docker smoke gates.
- Final completion audit against `refactor-plan.md`.
