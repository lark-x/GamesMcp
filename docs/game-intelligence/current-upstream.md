# Current Upstream

> Upstream snapshot used by this branch. Update this file whenever the pinned snapshot changes.

## AnimeGameData

- Repo: `https://github.com/DimbreathBot/AnimeGameData`
- Commit: `26df1dfbdf05a82bbb1d97506859f3e1c40718d8`
- Commit date: `2026-08-16 17:59:21 -0300` (repo local git log)
- Game version: discovered from upstream data at conversion time (not fabricated; recorded in conversion manifest)
- Locale: `zh-CN` primary, `en-US` secondary (TextMapCHS / TextMapEN)
- TextMap source: upstream `TextMap/` directory (TextMapCHS.json, TextMapEN.json + medium maps)
- Local checkout: `data/upstream/AnimeGameData` (read-only source for converters)
- Converter: `scripts/anime-game-data-converter.ts` (structured: `anime-game-data-structured-v1`)
- Pinned by: docs/game-intelligence/story-scope.md milestone baseline `ce5d2a3`

## Notes

- The upstream checkout is an external read-only data source; it is never committed to this repo.
- Game version above is intentionally recorded as discovered-at-runtime. The conversion manifest is the authoritative record; this file pins the commit and locale.
- Baseline snapshot used by Sprint 1 story-baseline.json generation.
