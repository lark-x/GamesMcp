# Search CJK Benchmark Notes

> Sprint 16 / Phase 16.3. This note records the dependency-free PostgreSQL
> FTS baseline and the decision gate for a future Chinese tokenizer benchmark.

## Baseline: `simple`

The `0004_search_fts.sql` migration uses the built-in `simple` text-search
configuration for generated `tsvector` columns. `simple` is a dictionary, not
a Chinese word segmenter: it lowercases the token emitted by PostgreSQL's
parser and does not provide linguistic stemming or synonym expansion. See the
[PostgreSQL parser documentation](https://www.postgresql.org/docs/current/textsearch-parsers.html)
and [simple dictionary documentation](https://www.postgresql.org/docs/current/textsearch-dictionaries.html).

For this project, the baseline is described as a **逐字 fallback**: short CJK
queries are expected to remain useful through the `simple` FTS path plus the
`pg_trgm` fallback, including single-character queries. This is not a claim
that the built-in parser performs semantic Chinese segmentation. The target
PostgreSQL image must record `ts_parse('default', sample)` and
`to_tsvector('simple', sample)` for representative strings, because the parser
decides token boundaries while the simple dictionary only normalizes those
tokens.

Minimum baseline samples:

- `胡桃` searched as `胡桃`, `胡`, and `桃`;
- continuous text with and without punctuation, for example `胡桃喜欢吃梅花`;
- mixed CJK/Latin/digits, for example `雷电将军 Raiden 2`;
- exact and prefix entity names, where exact/prefix must remain above FTS and
  trigram results.

If a single-character query is not represented as an individual lexeme by the
target parser, the expected baseline behavior is supplied by `pg_trgm`, not
by pretending that a substring scan is FTS. The benchmark should record both
the FTS match and fallback match type.

## `zhparser` trade-off

`zhparser` provides Chinese-oriented segmentation and can improve recall for
multi-character words and phrase-like queries. The costs are an external
server extension, image/package maintenance, version compatibility, corpus
and dictionary configuration, and a migration/rollout path for rebuilding
generated vectors and indexes. It should only be introduced if the measured
recall gain justifies that operational surface.

## PGroonga trade-off

PGroonga is a PostgreSQL extension backed by Groonga and is designed for
multilingual/CJK search. It may provide stronger CJK tokenization, matching,
and language-aware behavior than the built-in configuration, but adds a
larger native dependency, a different index/operator model, image support
requirements, and additional upgrade/backup observability concerns. It also
needs a benchmark against the existing `tsvector`/GIN plus `pg_trgm` path
rather than being adopted by assumption.

Neither extension is enabled in Phase 16.3. The current SQL keeps the
`tsvector @@ plainto_tsquery/websearch_to_tsquery` path explicit and uses
`pg_trgm` only as a measured similarity fallback.

## Follow-up benchmark proposal

Run the same revision-scoped corpus and query set against these candidates:

1. `simple` generated vectors + existing/new `pg_trgm` indexes;
2. `zhparser` vectors with the same exact/prefix/FTS/trigram ranking contract;
3. PGroonga search/indexes with an adapter that returns the same contract.

Report recall@1/5/10, MRR, exact/prefix ordering violations, single-character
and multi-character CJK recall, English/mixed-language recall, p50/p95
latency, index size, migration/rebuild duration, and write amplification.
Use separate fixtures for character names, item/weapon descriptions,
quest/dialogue lines, document segments, aliases, and negative near-matches.
The decision gate is a material recall or latency improvement without
violating revision isolation or making the production database extension a
new mandatory dependency.
