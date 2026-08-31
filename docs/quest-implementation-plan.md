# Genshin Quest Data Implementation Plan

## Goal

Build quest data as a first-class MCP dataset. Web remains the browser, preview,
and correction UI for the same immutable Revision data.

Pipeline:

```text
AnimeGameData fixed commit
-> TypeScript quest converter
-> bilingual normalized records
-> Candidate / Build / Manifest
-> Web preview and issue review
-> published Revision
-> MCP quest search/read tools and Web reader
```

## First Release Scope

- Quest types: archon, story, world, and event quests.
- Content: quest metadata, subquests, full dialogue, speakers, player choices,
  and dialogue branches.
- Languages: `zh-CN` and `en`.
- Out of scope: camera, action, audio, stage performance, and client runtime
  logic.
- Use: private local knowledge base. Do not publicly redistribute full story
  text until rights review is complete.
- One main quest becomes one document per locale.
- Preserve the raw dialogue graph and materialize a deterministic reading order.
- MCP defaults to Chinese and may request English. If the requested locale is
  missing, return a fallback warning.
- MCP can read only the published current Revision. Candidate and Build payloads
  are Web/admin-only.
- AnimeGameData game version and commit are locked manually. Do not follow the
  latest upstream commit automatically.

## Source Policy

- Primary source: AnimeGameData fixed commit for Genshin 7.0 data.
- Reference algorithm: `hoyo-story-extractor`, MIT licensed. Port the required
  extraction ideas to TypeScript and keep attribution in NOTICE when code or
  algorithmic structure is used.
- Do not copy code from sources without a clear license.
- Field mappings must be versioned. Unknown or mismatched fields fail the
  conversion instead of guessing.

## Data Model

Stable keys:

- Quest entity: `quest/{mainId}`
- Locale document: `quest/{mainId}/locale/{locale}`
- Subquest: `quest/{mainId}/subquest/{subId}`
- Dialogue node: `quest/{mainId}/dialog/{nodeId}`
- NPC: `npc/{npcId}`
- Playable character: `character/{avatarId}`

Normalized quest records carry:

- `locale`
- explicit structured document segments
- quest payload with subquests, dialogue nodes, dialogue edges, completeness,
  prerequisites, and source metadata
- full provenance, source file hashes, TextMap hashes, converter version, and
  rights status

Completeness values:

- `complete`
- `partial`
- `metadata_only`

Publish blockers:

- unexplained missing quest data
- dangling dialogue graph edges
- duplicate stable keys
- TextMap hash resolution failures
- unresolved blocking review issues
- unresolved real content conflicts

## Database And Contracts

Contracts:

- `DocumentType` includes `event_quest`.
- `EntityType` includes `npc`.
- `RelationshipPredicate` includes `prerequisite_for` and `part_of`.
- search requests accept `locales`.
- citations can point to `locale`, `questKey`, `subquestKey`, and
  `dialogueNodeKey`.

Database:

- `documents.locale`
- `document_segments.segment_key`
- `document_segments.metadata`
- `quest_subquests`
- `quest_dialogue_nodes`
- `quest_dialogue_edges`

Old Revisions remain readable. Historical documents without a known language use
`und`.

## MCP

Keep existing generic tools. Add:

- `search_quests`: search published current quest documents by game, query,
  quest type, locale, version, and limit.
- `get_quest`: read quest summary, subquests, paginated dialogue nodes, branch
  edges, participants, prerequisites, citations, and next cursor.

Rules:

- default locale is `zh-CN`
- page size defaults to 100 nodes and is capped at 300
- cursors are bound to Revision, quest, and locale
- Candidate and Build data are never exposed to MCP

## Web

Add a dedicated quest reader:

- quest catalog filters by type, chapter, series, version, and completeness
- reading page shows summary, subquests, objectives, dialogue, and branches
- stable reading order is default; alternative branches are expandable
- language switch keeps the same quest/subquest/node when possible
- every line supports anchor, citation copy, and issue reporting
- provenance panel shows commit, version, locale, source files, hashes, TextMap
  references, and transform steps
- mobile layout is single-column

Web must use Repository/API data. It must not maintain a separate quest JSON
index.

## Implementation Order

1. Freeze baseline: fix current CI, tag a clean baseline, keep AnimeGameData
   commit fixed.
2. Contracts and migration: add locale, structured segments, and quest graph
   tables without breaking old Revisions.
3. Converter: start with bilingual fixtures, then dry-run the locked 7.0
   AnimeGameData snapshot.
4. Import and preview: create ImportBatch, Candidate, Build, Manifest, and
   preview records atomically for both locales.
5. MCP and Web: add quest tools and the dedicated reader.
6. Acceptance: run typecheck, lint, unit, integration, E2E, build, and database
   release-flow tests.

## Acceptance Checklist

- field mapping version mismatch fails
- bilingual document keys do not collide
- branches, joins, loops, and dangling edges are handled deterministically
- dynamic text variants are preserved
- metadata-only quests are marked explicitly
- unexplained missing data blocks release
- MCP locale default, English query, and fallback warnings work
- MCP citations identify Revision, quest, subquest, dialogue node, and locale
- Candidate data is inaccessible to MCP
- patches generate Build N+1 and old Builds remain immutable
- publish, index, current switch, and rollback remain atomic
- Web desktop/mobile quest catalog, reader, branch view, language switch, and
  issue feedback work
