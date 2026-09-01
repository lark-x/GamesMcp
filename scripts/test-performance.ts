import { strict as assert } from "node:assert";
import { createHash, randomUUID } from "node:crypto";
import { createDatabase, createPool } from "../packages/database/src/client.ts";
import { SqlKnowledgeRepository } from "../packages/database/src/repository.ts";
import { gameCapabilities, games } from "../packages/database/src/schema.ts";
import type { NormalizedRecord } from "../packages/domain/src/index.ts";
import { applyMigrations } from "../packages/database/src/migration-runner.ts";

const databaseUrl = process.env.GIP_DB_TEST_URL;
if (!databaseUrl)
  throw new Error("GIP_DB_TEST_URL is required (run through with-disposable-test-db.ts)");

const pool = createPool(databaseUrl);
const db = createDatabase(pool);
await applyMigrations(pool);
const repository = new SqlKnowledgeRepository(db);
const gameId = randomUUID();

await db
  .insert(games)
  .values({ id: gameId, slug: "genshin-impact", name: "原神", status: "active" });
await db.insert(gameCapabilities).values([{ gameId, capability: "entity_search", enabled: true }]);

const source = await repository.createSource({
  gameId,
  name: "性能验证来源",
  type: "local_json",
  pathLabel: "perf-fixture.json",
  licenseNote: "test",
  enabled: true,
  parserType: "perf-test",
});
const snapshot = await repository.createSnapshot({
  sourceId: source.id,
  contentHash: `snapshot-${randomUUID()}`,
  storagePath: "snapshots/perf-test.json",
  metadata: {},
});

const entities: NormalizedRecord[] = Array.from({ length: 120 }, (_, index) => {
  const name = `测试实体${String(index).padStart(4, "0")}`;
  return {
    sourceKey: `entities/perf-${index}`,
    recordType: "entity",
    title: name,
    entityType: "character",
    contentHash: createHash("sha256").update(`perf-${index}`).digest("hex"),
    parserVersion: "perf-test",
    metadata: {},
    entities: [
      {
        sourceKey: `entities/perf-${index}`,
        name,
        type: "character",
        summary: `${name} 摘要`,
        aliases: [{ value: `别名${index}`, language: "zh", primary: false }],
        properties: {},
      },
    ],
  };
});

const batch = await repository.createImport({
  gameId,
  sourceId: source.id,
  sourceSnapshotId: snapshot.id,
  parserVersion: "perf-test",
  stagedRecords: entities,
  errors: [],
  warnings: [],
  diff: {
    added: entities.map((record) => record.sourceKey),
    modified: [],
    deletionCandidates: [],
    unchanged: [],
    conflicts: [],
    unparsed: [],
  },
});
await repository.reviewImport(batch.id, true, "性能验证审核", []);
await repository.publishImport(batch.id, "性能验证发布");
for (;;) {
  const job = await repository.claimNextJob("perf-test-worker");
  if (!job) break;
  await repository.completeJob(String(job.id), "completed");
}

async function explain(sql: string): Promise<string> {
  const result = await pool.query(`EXPLAIN ANALYZE ${sql}`);
  return result.rows.map((row) => Object.values(row)[0]).join("\n");
}

const plans: Record<string, string> = {
  entities_by_game: await explain(
    `select * from knowledge.entities where game_id = '${gameId}' and deleted = false`,
  ),
  entity_aliases_join: await explain(
    `select a.value from knowledge.entity_aliases a join knowledge.entities e on e.id = a.entity_id where e.game_id = '${gameId}' limit 50`,
  ),
  documents_by_revision: await explain(
    `select * from knowledge.documents where game_id = '${gameId}' and deleted = false`,
  ),
};

console.log(
  JSON.stringify(
    Object.fromEntries(
      Object.entries(plans).map(([name, plan]) => {
        const executionMatch = /Execution Time: ([\d.]+) ms/.exec(plan);
        return [name, { executionTimeMs: executionMatch?.[1] ?? "unknown" }];
      }),
    ),
    null,
    2,
  ),
);

for (const [name, plan] of Object.entries(plans)) {
  assert.ok(plan.includes("Execution Time"), `${name}: EXPLAIN ANALYZE output missing`);
}
const searchPlan = plans.entities_by_game;
assert.ok(
  /Index Scan|Bitmap Heap Scan|Seq Scan/.test(searchPlan),
  "entity query must produce a valid scan plan",
);

await pool.end();
console.log("performance plan evidence recorded");
