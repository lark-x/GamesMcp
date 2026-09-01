import { strict as assert } from "node:assert";
import { createHash, randomUUID } from "node:crypto";
import { createDatabase, createPool } from "../packages/database/src/client.ts";
import { SqlKnowledgeRepository } from "../packages/database/src/repository.ts";
import { gameCapabilities, games } from "../packages/database/src/schema.ts";
import type { NormalizedRecord, StructuredImportRecords } from "../packages/domain/src/index.ts";
import { applyMigrations } from "../packages/database/src/migration-runner.ts";

const databaseUrl = process.env.GIP_DB_TEST_URL;
if (!databaseUrl)
  throw new Error("GIP_DB_TEST_URL is required (run through with-disposable-test-db.ts)");

const pool = createPool(databaseUrl);
const db = createDatabase(pool);
await applyMigrations(pool);
const repository = new SqlKnowledgeRepository(db);
const gameId = randomUUID();

async function publishFixtureRevision() {
  await db
    .insert(games)
    .values({ id: gameId, slug: "genshin-impact", name: "原神", status: "active" });
  await db.insert(gameCapabilities).values([
    { gameId, capability: "entity_search", enabled: true },
    { gameId, capability: "lore_search", enabled: true },
  ]);

  const source = await repository.createSource({
    gameId,
    name: "搜索核心测试来源",
    type: "local_json",
    pathLabel: "fixture.json",
    licenseNote: "test",
    enabled: true,
    parserType: "search-core-test",
  });
  const snapshot = await repository.createSnapshot({
    sourceId: source.id,
    contentHash: `snapshot-${randomUUID()}`,
    storagePath: "snapshots/search-core-test.json",
    metadata: { fixture: true },
  });

  const normalized: NormalizedRecord[] = [
    {
      sourceKey: "entities/hutao",
      recordType: "entity",
      title: "胡桃",
      entityType: "character",
      contentHash: createHash("sha256").update("entity-hutao").digest("hex"),
      parserVersion: "search-core-test",
      metadata: {},
      entities: [
        {
          sourceKey: "entities/hutao",
          name: "胡桃",
          type: "character",
          summary: "往生堂七十七代堂主",
          aliases: [{ value: "堂主", language: "zh", primary: false }],
          properties: {},
        },
      ],
    },
    {
      sourceKey: "lore/hutao-story",
      recordType: "document",
      title: "胡桃的故事",
      documentType: "character_story",
      contentHash: createHash("sha256").update("doc-hutao").digest("hex"),
      parserVersion: "search-core-test",
      metadata: { questKey: "quest/story-hutao" },
      documents: [
        {
          sourceKey: "lore/hutao-story",
          documentType: "character_story",
          title: "胡桃的故事",
          body: "胡桃是往生堂七十七代堂主，喜欢写诗与开玩笑。",
          locale: "zh-CN",
          gameVersion: "7.0.0",
          segments: [
            {
              ordinal: 0,
              headingPath: [],
              body: "胡桃是往生堂七十七代堂主。",
              metadata: {},
            },
          ],
        },
      ],
    },
  ];

  const structured: StructuredImportRecords = {
    characters: [
      {
        stableId: "char/hutao",
        sourceKey: "structured/char/hutao",
        name: "胡桃",
        locale: "zh-CN",
        provenance: {},
        profile: {},
        title: "往生堂堂主",
        rarity: 5,
        element: "Pyro",
        weaponType: "Polearm",
        description: "胡桃，璃月往生堂第七十七代堂主。",
      },
    ],
    materials: [
      {
        stableId: "material/nichang-flower",
        sourceKey: "structured/material/nichang-flower",
        name: "霓裳花",
        locale: "zh-CN",
        provenance: {},
        category: "local_specialty",
        description: "璃月特产，胡桃突破需要。",
        sources: [],
        usedBy: [],
      },
    ],
  };

  const batch = await repository.createImport({
    gameId,
    sourceId: source.id,
    sourceSnapshotId: snapshot.id,
    parserVersion: "search-core-test",
    stagedRecords: normalized,
    structuredRecords: structured,
    errors: [],
    warnings: [],
    diff: {
      added: normalized.map((record) => record.sourceKey),
      modified: [],
      deletionCandidates: [],
      unchanged: [],
      conflicts: [],
      unparsed: [],
    },
  });
  await repository.reviewImport(batch.id, true, "搜索核心测试审核", []);
  const revision = await repository.publishImport(batch.id, "搜索核心测试发布");
  assert.ok(revision, "publishImport must return a revision");
  for (;;) {
    const job = await repository.claimNextJob("search-core-test-worker");
    if (!job) break;
    await repository.completeJob(String(job.id), "completed");
  }
}

await publishFixtureRevision();

const health = await repository.health();
assert.equal(health.database, "up");
const game = await repository.getGameBySlug("genshin-impact");
assert.ok(game);

const result = await repository.search(game.id, {
  query: "胡桃",
  types: ["entity", "document", "segment"],
  limit: 10,
  debug: true,
});
const core = (result as { coreHits?: { structured: Array<{ name: string; score: number }> } })
  .coreHits;
assert.ok(core, "coreHits must be present");
assert.ok(core.structured.length >= 1, "structured hits must include character");
assert.equal(core.structured[0]?.name, "胡桃");
assert.equal(core.structured[0]?.stableId, "char/hutao");
assert.ok((core.structured[0]?.score ?? 0) >= 10, "exact name tier must rank first");

const resolved = await repository.search(game.id, { query: "堂主", types: ["entity"], limit: 5 });
assert.ok(resolved.entities.length >= 1, "alias search must resolve entity");

const coreService = new (await import("../packages/search/src/index.ts")).SearchService(
  new (await import("../packages/database/src/search-port.ts")).SqlSearchRepositoryPort(db),
);
assert.ok(result.revisionId, "revisionId must be present");
const dialogueResult = await coreService.searchText(game.id, result.revisionId, "胡桃");
assert.ok(dialogueResult.documents.length >= 1, "document hits must exist");
assert.ok(dialogueResult.structured.length >= 1, "structured hits must exist");
assert.equal(dialogueResult.structured[0]?.stableId, "char/hutao");

await pool.end();
console.log("search core integration smoke passed");
