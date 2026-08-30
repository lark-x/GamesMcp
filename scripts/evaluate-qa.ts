import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadConfig } from "../packages/config/src/index.ts";
import { createDatabase, createPool } from "../packages/database/src/client.ts";
import { SqlKnowledgeRepository } from "../packages/database/src/repository.ts";
import {
  EvidenceQaService,
  assertQaTargets,
  evaluateQaSet,
  type QaGoldenCase,
} from "../packages/qa/src/index.ts";

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const database = createDatabase(pool);
const repository = new SqlKnowledgeRepository(database);

try {
  const game = await repository.getGameBySlug("genshin-impact");
  if (!game) throw new Error("The genshin-impact game is not seeded");
  const cases = JSON.parse(
    await readFile(resolve("data/fixtures/qa-golden.json"), "utf8"),
  ) as QaGoldenCase[];
  const service = new EvidenceQaService(repository, config);
  const evaluation = await evaluateQaSet(
    cases,
    (testCase) => service.answer(game.id, testCase.question, 8),
    async (citation) => {
      const document = await repository.getDocument(game.id, citation.documentId);
      return Boolean(document?.segments.some((segment) => segment.id === citation.segmentId));
    },
  );
  console.log(JSON.stringify(evaluation, null, 2));
  if (process.env.ENFORCE_QA_TARGETS === "1")
    assertQaTargets(evaluation, {
      citationPrecision: 0.95,
      citationResolvableRate: 1,
      refusalRate: 0.95,
      hallucinatedCitationCount: 0,
      contradictionCount: 0,
    });
} finally {
  await pool.end();
}
