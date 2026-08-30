import { readFile } from "node:fs/promises";
import { loadConfig } from "../packages/config/src/index.ts";
import {
  createDatabase,
  createPool,
  SqlKnowledgeRepository,
} from "../packages/database/src/index.ts";
import {
  assertRetrievalTargets,
  evaluateGoldenSet,
  type GoldenQuery,
} from "../packages/retrieval/src/index.ts";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const repository = new SqlKnowledgeRepository(createDatabase(pool));
const goldenPath = process.env.GOLDEN_FILE ?? "data/fixtures/search-golden.json";
const gameSlug = process.env.GAME_SLUG ?? "genshin-impact";

try {
  const game = await repository.getGameBySlug(gameSlug);
  if (!game) throw new Error(`Game was not found: ${gameSlug}`);
  const queries = JSON.parse(await readFile(goldenPath, "utf8")) as GoldenQuery[];
  if (queries.length < 100)
    throw new Error(`Golden set must contain at least 100 queries; got ${queries.length}`);
  const result = await evaluateGoldenSet(queries, (golden) =>
    repository.search(game.id, {
      query: golden.query,
      types: ["entity", "document"],
      limit: 100,
      debug: false,
    }),
  );
  console.log(JSON.stringify({ game: game.slug, goldenFile: goldenPath, ...result }, null, 2));
  if (process.env.ENFORCE_RETRIEVAL_TARGETS === "1")
    assertRetrievalTargets(result, {
      entityTop5Recall: 0.95,
      documentTop10Recall: 0.9,
      exactNameTop1: 0.98,
    });
} finally {
  await pool.end();
}
