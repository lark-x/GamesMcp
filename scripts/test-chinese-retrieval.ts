/**
 * Integration gate for CJK retrieval against a real PostgreSQL revision.
 *
 * PostgreSQL's `simple` text-search config does not segment Chinese, so
 * `to_tsvector` collapses a whole sentence into a single token and
 * `websearch_to_tsquery('第三降临者')` never matches. The search port therefore
 * proves a hit with a literal substring (`ILIKE`) before falling back to
 * trigram similarity, whose 0.15 rank floor used to drop genuine matches.
 *
 * This script asserts the behavioural outcome on real data: a Chinese phrase
 * that occurs verbatim in dialogue must surface in the top 10.
 *
 * Env:
 *   DATABASE_URL  PostgreSQL connection string (defaults to the dev database)
 *   CHINESE_RETRIEVAL_GAME_SLUG  game slug to probe (default genshin-impact)
 */
import {
  createDatabase,
  createPool,
  SqlKnowledgeRepository,
} from "../packages/database/src/index.ts";
import { SqlSearchRepositoryPort } from "../packages/database/src/search-port.ts";
import { SearchService } from "../packages/search/src/index.ts";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://gip:gip@127.0.0.1:5432/gip";
const gameSlug = process.env.CHINESE_RETRIEVAL_GAME_SLUG ?? "genshin-impact";

/** Query -> a phrase that must occur in at least one of the top-10 hits. */
const probes: Array<{ query: string; mustContain: string; surface: "dialogue" | "document" }> = [
  { query: "第三降临者", mustContain: "第三降临者", surface: "dialogue" },
  { query: "第三降临者", mustContain: "第三降临者", surface: "document" },
];

async function main(): Promise<void> {
  const pool = createPool(databaseUrl);
  const repository = new SqlKnowledgeRepository(createDatabase(pool));
  try {
    await pool.query("select 1");
    const game = await repository.getGameBySlug(gameSlug);
    if (!game) {
      console.log(JSON.stringify({ skipped: true, reason: `game ${gameSlug} is not seeded` }));
      return;
    }
    const revisions = await repository.listRevisions(game.id);
    const revision = revisions
      .filter(
        (candidate) =>
          candidate.lifecycleStatus === "published" && candidate.indexStatus === "ready",
      )
      .sort(
        (left, right) =>
          Number(right.isCurrent) - Number(left.isCurrent) ||
          right.revisionNumber - left.revisionNumber,
      )[0];
    if (!revision) {
      console.log(JSON.stringify({ skipped: true, reason: "no published, ready revision" }));
      return;
    }

    const service = new SearchService(new SqlSearchRepositoryPort(createDatabase(pool)));
    const failures: string[] = [];
    for (const probe of probes) {
      const hits: Array<{ title: string | null; text: string }> =
        probe.surface === "dialogue"
          ? (
              await service.searchCore({
                gameId: game.id,
                revisionId: revision.id,
                query: probe.query,
                surfaces: ["dialogue"],
                limit: 10,
              })
            ).dialogue.map((hit) => ({ text: hit.text, title: hit.quest }))
          : (
              await service.searchCore({
                gameId: game.id,
                revisionId: revision.id,
                query: probe.query,
                surfaces: ["document", "segment"],
                limit: 10,
              })
            ).documents.map((hit) => ({ text: hit.body, title: hit.document.title }));
      const matching = hits.filter((hit) =>
        `${hit.title ?? ""}${hit.text}`.includes(probe.mustContain),
      ).length;
      const ok = hits.length > 0 && matching > 0;
      console.log(
        `${ok ? "PASS" : "FAIL"}  ${probe.surface} "${probe.query}" hits=${hits.length} containing=${matching}`,
      );
      if (!ok) {
        failures.push(
          `${probe.surface} "${probe.query}": ${hits.length} hits, ${matching} contained the phrase`,
        );
      }
    }

    if (failures.length > 0) {
      throw new Error(`Chinese retrieval regressions: ${failures.join("; ")}`);
    }
    console.log(JSON.stringify({ gameSlug, revision: revision.id, probes: probes.length }));
  } finally {
    await pool.end();
  }
}

await main();
