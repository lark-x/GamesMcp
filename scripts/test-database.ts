import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { createDatabase, createPool } from "../packages/database/src/client.ts";
import { SqlKnowledgeRepository, stableEntityId } from "../packages/database/src/repository.ts";
import { gameCapabilities, games, jobs } from "../packages/database/src/schema.ts";
import type { NormalizedRecord } from "../packages/domain/src/index.ts";

const databaseUrl = process.env.GIP_DB_TEST_URL;
if (!databaseUrl) {
  throw new Error(
    "GIP_DB_TEST_URL is required and must point at a disposable PostgreSQL + pgvector database",
  );
}

const migrationPaths = [
  new URL("../packages/database/src/migrations/0000_initial.sql", import.meta.url),
  new URL("../packages/database/src/migrations/0001_acquisition_verification.sql", import.meta.url),
  new URL("../packages/database/src/migrations/0002_conflict_selection.sql", import.meta.url),
];

function makeRecord(
  value: Omit<NormalizedRecord, "contentHash" | "parserVersion" | "metadata"> & {
    metadata?: Record<string, unknown>;
  },
): NormalizedRecord {
  const normalized = {
    ...value,
    metadata: value.metadata ?? {},
    parserVersion: "db-test",
  };
  return {
    ...normalized,
    contentHash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex"),
  };
}

function entityRecord(
  sourceKey: string,
  name: string,
  type: "character" | "concept" = "character",
): NormalizedRecord {
  return makeRecord({
    sourceKey,
    recordType: "entity",
    title: name,
    entityType: type,
    entities: [
      {
        sourceKey,
        name,
        type,
        summary: `${name} 的测试摘要`,
        aliases: [{ value: `${name}别名`, language: "zh", primary: false }],
        properties: { fixture: true },
      },
    ],
  });
}

async function completePendingJobs(repository: SqlKnowledgeRepository, workerId: string) {
  for (;;) {
    const job = await repository.claimNextJob(workerId);
    if (!job) return;
    assert.equal(await repository.heartbeatJob(String(job.id), workerId), true);
    await repository.completeJob(String(job.id), "completed");
  }
}

async function main() {
  const pool = createPool(databaseUrl!);
  const db = createDatabase(pool);
  const repository = new SqlKnowledgeRepository(db);
  try {
    for (const migrationPath of migrationPaths) {
      const migration = await readFile(migrationPath, "utf8");
      await pool.query(migration);
      await pool.query(migration);
    }
    await pool.query("TRUNCATE platform.games, platform.jobs, platform.audit_log CASCADE");
    await repository.recordWorkerHeartbeat("db-test-heartbeat");
    assert.equal(await repository.workerHealth(), "up");
    await pool.query(
      "update platform.worker_heartbeats set heartbeat_at = now() - interval '1 minute' where worker_id = $1",
      ["db-test-heartbeat"],
    );
    assert.equal(await repository.workerHealth(), "not_ready");

    const gameAId = randomUUID();
    const [gameA] = await db
      .insert(games)
      .values({ id: gameAId, slug: `db-test-a-${gameAId.slice(0, 8)}`, name: "数据库测试 A" })
      .returning();
    assert.ok(gameA);
    await db.insert(gameCapabilities).values([
      { gameId: gameA.id, capability: "entity_search", enabled: true },
      { gameId: gameA.id, capability: "lore_search", enabled: true },
      { gameId: gameA.id, capability: "relationships", enabled: true },
      { gameId: gameA.id, capability: "evidence_qa", enabled: true },
    ]);

    const sourceA = await repository.createSource({
      gameId: gameA.id,
      name: "数据库测试来源 A",
      type: "local_json",
      pathLabel: "fixture.json",
      licenseNote: "test",
      enabled: true,
      parserType: "db-test",
    });
    const snapshotA1 = await repository.createSnapshot({
      sourceId: sourceA.id,
      contentHash: `snapshot-a1-${randomUUID()}`,
      storagePath: "snapshots/db-test-a1.json",
      metadata: { fixture: true },
    });
    const travelerV1 = entityRecord("entities/traveler", "旅行者");
    const companion = entityRecord("entities/companion", "派蒙");
    const obsolete = entityRecord("entities/obsolete", "旧实体", "concept");
    const heroV1 = makeRecord({
      sourceKey: "lore/hero",
      recordType: "document",
      title: "旅程记录",
      body: "旅行者与派蒙一起踏上旅程。",
      documentType: "lore",
      gameVersion: "test-1",
      relationships: [
        {
          subjectSourceKey: "entities/traveler",
          predicate: "related_to",
          objectSourceKey: "entities/companion",
          confidence: 0.9,
        },
      ],
    });
    const legacy = makeRecord({
      sourceKey: "lore/legacy",
      recordType: "document",
      title: "旧档案",
      body: "旧档案记载旅行者曾经经过蒙德。",
      documentType: "lore",
      gameVersion: "test-1",
      claims: [
        {
          sourceKey: "claims/legacy-travel",
          statement: "旅行者曾经经过蒙德。",
          status: "confirmed",
          confidence: 0.95,
          entitySourceKeys: ["entities/traveler"],
          evidence: [
            {
              documentSourceKey: "lore/legacy",
              quote: "旅行者曾经经过蒙德",
              strength: 0.9,
            },
          ],
        },
      ],
    });
    const recordsV1 = [travelerV1, companion, obsolete, heroV1, legacy];
    const pendingBatch = await repository.createPendingImport({
      gameId: gameA.id,
      sourceId: sourceA.id,
      parserVersion: "db-test-async",
    });
    assert.equal(pendingBatch.status, "pending");
    assert.equal(pendingBatch.sourceSnapshotId, null);
    const parseJobKey = `db-test-parse-${pendingBatch.id}`;
    await repository.enqueueJob({
      type: "parse_import",
      idempotencyKey: parseJobKey,
      payload: {
        batchId: pendingBatch.id,
        gameId: gameA.id,
        sourceId: sourceA.id,
        path: "fixture.json",
      },
    });
    const parseJob = await repository.claimNextJob("db-test-parse-worker");
    assert.equal(parseJob?.type, "parse_import");
    assert.ok(parseJob?.id);
    const runningPendingBatch = await repository.markImportRunning(pendingBatch.id);
    assert.equal(runningPendingBatch.status, "running");
    const stagedPendingBatch = await repository.updateImportStaged({
      batchId: pendingBatch.id,
      sourceSnapshotId: snapshotA1.id,
      stagedRecords: recordsV1,
      errors: [],
      warnings: [],
      diff: {
        added: recordsV1.map((record) => record.sourceKey),
        modified: [],
        deletionCandidates: [],
        unchanged: [],
        conflicts: [],
        unparsed: [],
      },
    });
    assert.equal(stagedPendingBatch.status, "review_required");
    assert.equal(stagedPendingBatch.sourceSnapshotId, snapshotA1.id);
    await repository.completeJob(String(parseJob.id), "completed");
    const batchA1 = await repository.createImport({
      gameId: gameA.id,
      sourceId: sourceA.id,
      sourceSnapshotId: snapshotA1.id,
      parserVersion: "db-test",
      stagedRecords: recordsV1,
      errors: [],
      warnings: [],
      diff: {
        added: recordsV1.map((record) => record.sourceKey),
        modified: [],
        deletionCandidates: [],
        unchanged: [],
        conflicts: [],
        unparsed: [],
      },
    });
    await repository.reviewImport(batchA1.id, true, "首次测试审核", []);
    const revisionA1 = await repository.publishImport(batchA1.id, "首次测试发布");
    await completePendingJobs(repository, "db-test-worker-a1");
    assert.equal((await repository.health()).searchIndex, "ready");

    const travelerId = stableEntityId(gameA.id, "entities/traveler");
    const obsoleteId = stableEntityId(gameA.id, "entities/obsolete");
    const firstEntity = await repository.getEntity(gameA.id, travelerId);
    assert.equal(firstEntity?.name, "旅行者");
    assert.equal(firstEntity?.relationships.length, 1);
    assert.equal(firstEntity?.claims.length, 1);
    assert.equal(firstEntity?.claims[0]?.evidence.length, 1);
    assert.equal((await repository.getEntity(gameA.id, obsoleteId))?.name, "旧实体");

    const snapshotA2 = await repository.createSnapshot({
      sourceId: sourceA.id,
      contentHash: `snapshot-a2-${randomUUID()}`,
      storagePath: "snapshots/db-test-a2.json",
      metadata: { fixture: true },
    });
    const travelerV2 = entityRecord("entities/traveler", "旅行者（新名）");
    const heroV2 = makeRecord({
      ...heroV1,
      body: "旅行者与派蒙一起踏上新的旅程。",
      gameVersion: "test-2",
    });
    const recordsV2 = [travelerV2, companion, heroV2];
    const batchA2 = await repository.createImport({
      gameId: gameA.id,
      sourceId: sourceA.id,
      sourceSnapshotId: snapshotA2.id,
      parserVersion: "db-test",
      stagedRecords: recordsV2,
      errors: [],
      warnings: [],
      diff: {
        added: [],
        modified: ["entities/traveler", "lore/hero"],
        deletionCandidates: ["entities/obsolete", "lore/legacy"],
        unchanged: ["entities/companion"],
        conflicts: [],
        unparsed: [],
      },
    });
    await repository.reviewImport(batchA2.id, true, "确认实体删除，保留旧档案候选", [
      "entities/obsolete",
    ]);
    const revisionA2 = await repository.publishImport(batchA2.id, "第二次测试发布");
    await completePendingJobs(repository, "db-test-worker-a2");
    assert.notEqual(revisionA1.id, revisionA2.id);
    assert.equal(revisionA2.revisionNumber, revisionA1.revisionNumber + 1);
    assert.equal((await repository.getEntity(gameA.id, travelerId))?.name, "旅行者（新名）");
    assert.equal(await repository.getEntity(gameA.id, obsoleteId), null);

    const retainedLegacy = (
      await repository.listDocuments(gameA.id, {
        query: "旧档案",
        limit: 10,
        offset: 0,
      })
    )[0];
    assert.ok(retainedLegacy, "unconfirmed deletion candidate must remain searchable");
    const retainedEntity = await repository.getEntity(gameA.id, travelerId);
    assert.equal(retainedEntity?.claims[0]?.statement, "旅行者曾经经过蒙德。");
    assert.equal(retainedEntity?.claims[0]?.evidence[0]?.documentId, retainedLegacy.id);
    assert.equal(
      (await repository.getRelationships(gameA.id, travelerId, { limit: 10 }))[0]?.predicate,
      "related_to",
    );

    const noOpSnapshot = await repository.createSnapshot({
      sourceId: sourceA.id,
      contentHash: `snapshot-noop-${randomUUID()}`,
      storagePath: "snapshots/db-test-noop.json",
      metadata: { fixture: true },
    });
    const noOpBatch = await repository.createImport({
      gameId: gameA.id,
      sourceId: sourceA.id,
      sourceSnapshotId: noOpSnapshot.id,
      parserVersion: "db-test",
      stagedRecords: recordsV2,
      errors: [],
      warnings: [],
      diff: {
        added: [],
        modified: [],
        deletionCandidates: [],
        unchanged: recordsV2.map((record) => record.sourceKey),
        conflicts: [],
        unparsed: [],
      },
    });
    await repository.reviewImport(noOpBatch.id, true, "幂等测试", []);
    const noOpRevision = await repository.publishImport(noOpBatch.id, "幂等发布");
    assert.equal(noOpRevision.id, revisionA2.id);

    const invalidSnapshot = await repository.createSnapshot({
      sourceId: sourceA.id,
      contentHash: `snapshot-invalid-${randomUUID()}`,
      storagePath: "snapshots/db-test-invalid.json",
      metadata: { fixture: true },
    });
    const invalidRecord = makeRecord({
      sourceKey: "lore/invalid",
      recordType: "document",
      title: "非法主张",
      body: "该段用于验证事务回滚。",
      documentType: "lore",
      claims: [
        {
          sourceKey: "claims/without-evidence",
          statement: "没有证据的确认主张",
          status: "confirmed",
        },
      ],
    });
    const invalidBatch = await repository.createImport({
      gameId: gameA.id,
      sourceId: sourceA.id,
      sourceSnapshotId: invalidSnapshot.id,
      parserVersion: "db-test",
      stagedRecords: [invalidRecord],
      errors: [],
      warnings: [],
      diff: {
        added: [invalidRecord.sourceKey],
        modified: [],
        deletionCandidates: [],
        unchanged: [],
        conflicts: [],
        unparsed: [],
      },
    });
    await repository.reviewImport(invalidBatch.id, true, "事务失败测试", []);
    const revisionCountBeforeFailure = (await repository.listRevisions(gameA.id)).length;
    await assert.rejects(() => repository.publishImport(invalidBatch.id), {
      code: "claim_evidence_required",
    });
    assert.equal((await repository.listRevisions(gameA.id)).length, revisionCountBeforeFailure);
    assert.equal((await repository.getGame(gameA.id))?.currentRevision, "r2");

    const sourceAExtra = await repository.createSource({
      gameId: gameA.id,
      name: "数据库测试来源 A-2",
      type: "local_json",
      pathLabel: "extra-fixture.json",
      licenseNote: "test",
      enabled: true,
      parserType: "db-test",
    });
    const snapshotAExtra = await repository.createSnapshot({
      sourceId: sourceAExtra.id,
      contentHash: `snapshot-a-extra-${randomUUID()}`,
      storagePath: "snapshots/db-test-a-extra.json",
      metadata: { fixture: true },
    });
    const extraEntity = entityRecord("entities/extra", "另一来源实体", "concept");
    const extraBatch = await repository.createImport({
      gameId: gameA.id,
      sourceId: sourceAExtra.id,
      sourceSnapshotId: snapshotAExtra.id,
      parserVersion: "db-test",
      stagedRecords: [extraEntity],
      errors: [],
      warnings: [],
      diff: {
        added: [extraEntity.sourceKey],
        modified: [],
        deletionCandidates: [],
        unchanged: [],
        conflicts: [],
        unparsed: [],
      },
    });
    await repository.reviewImport(extraBatch.id, true, "多来源快照测试", []);
    const revisionA3 = await repository.publishImport(extraBatch.id, "第三次测试发布");
    await completePendingJobs(repository, "db-test-worker-a3");
    assert.equal(revisionA3.revisionNumber, 3);
    assert.equal(
      (await repository.search(gameA.id, { query: "旅行者（新名）", types: ["entity"], limit: 10 }))
        .entities[0]?.name,
      "旅行者（新名）",
    );
    assert.equal(
      (await repository.search(gameA.id, { query: "另一来源实体", types: ["entity"], limit: 10 }))
        .entities[0]?.name,
      "另一来源实体",
    );
    assert.equal(
      (
        await repository.search(gameA.id, {
          query: "另一来源实体",
          types: ["entity"],
          limit: 10,
          revisionId: revisionA2.id,
        })
      ).entities.length,
      0,
    );

    const retryId = randomUUID();
    await db.insert(jobs).values({
      id: retryId,
      type: "rebuild_search",
      idempotencyKey: `db-test-retry-${retryId}`,
      payload: {},
      maxAttempts: 2,
    });
    const firstAttempt = await repository.claimNextJob("retry-worker-1");
    assert.equal(firstAttempt?.id, retryId);
    assert.equal(await repository.heartbeatJob(retryId, "wrong-worker"), false);
    assert.equal(await repository.heartbeatJob(retryId, "retry-worker-1"), true);
    await repository.completeJob(retryId, "failed", "transient");
    const secondAttempt = await repository.claimNextJob("retry-worker-2");
    assert.equal(secondAttempt?.id, retryId);
    await repository.completeJob(retryId, "failed", "permanent");
    const retryStatus = await pool.query(
      "select status, attempts from platform.jobs where id = $1",
      [retryId],
    );
    assert.equal(retryStatus.rows[0]?.status, "failed");
    assert.equal(retryStatus.rows[0]?.attempts, 2);

    const gameBId = randomUUID();
    const [gameB] = await db
      .insert(games)
      .values({ id: gameBId, slug: `db-test-b-${gameBId.slice(0, 8)}`, name: "数据库测试 B" })
      .returning();
    assert.ok(gameB);
    await db.insert(gameCapabilities).values([
      { gameId: gameB.id, capability: "entity_search", enabled: true },
      { gameId: gameB.id, capability: "lore_search", enabled: true },
      { gameId: gameB.id, capability: "relationships", enabled: true },
      { gameId: gameB.id, capability: "evidence_qa", enabled: true },
    ]);
    const sourceB = await repository.createSource({
      gameId: gameB.id,
      name: "数据库测试来源 B",
      type: "local_json",
      pathLabel: "fixture.json",
      licenseNote: "test",
      enabled: true,
      parserType: "db-test",
    });
    const snapshotB = await repository.createSnapshot({
      sourceId: sourceB.id,
      contentHash: `snapshot-b-${randomUUID()}`,
      storagePath: "snapshots/db-test-b.json",
      metadata: { fixture: true },
    });
    const travelerB = entityRecord("entities/traveler", "另一世界旅行者");
    const batchB = await repository.createImport({
      gameId: gameB.id,
      sourceId: sourceB.id,
      sourceSnapshotId: snapshotB.id,
      parserVersion: "db-test",
      stagedRecords: [travelerB],
      errors: [],
      warnings: [],
      diff: {
        added: [travelerB.sourceKey],
        modified: [],
        deletionCandidates: [],
        unchanged: [],
        conflicts: [],
        unparsed: [],
      },
    });
    await repository.reviewImport(batchB.id, true, "隔离测试", []);
    const revisionB = await repository.publishImport(batchB.id, "隔离发布");
    await completePendingJobs(repository, "db-test-worker-b");
    assert.notEqual(
      stableEntityId(gameA.id, travelerB.sourceKey),
      stableEntityId(gameB.id, travelerB.sourceKey),
    );
    const searchA = await repository.search(gameA.id, {
      query: "另一世界旅行者",
      types: ["entity"],
      limit: 10,
    });
    const searchB = await repository.search(gameB.id, {
      query: "另一世界旅行者",
      types: ["entity"],
      limit: 10,
    });
    assert.equal(
      searchA.entities.some((entity) => entity.name === "另一世界旅行者"),
      false,
    );
    assert.equal(searchB.entities[0]?.name, "另一世界旅行者");
    assert.equal(revisionB.gameId, gameB.id);

    const rolledBack = await repository.rollbackRevision(revisionA1.id, "验证历史版本恢复");
    await completePendingJobs(repository, "db-test-worker-rollback");
    assert.equal(rolledBack.isCurrent, true);
    assert.equal((await repository.getGame(gameA.id))?.currentRevision, "r1");
    assert.equal((await repository.getEntity(gameA.id, travelerId))?.name, "旅行者");
    assert.equal((await repository.getEntity(gameA.id, obsoleteId))?.name, "旧实体");
    const rolledBackSearch = await repository.search(gameA.id, {
      query: "旧实体",
      types: ["entity"],
      limit: 10,
    });
    assert.equal(rolledBackSearch.entities[0]?.name, "旧实体");
    console.log("Database integration checks passed.");
  } finally {
    await pool
      .query("TRUNCATE platform.games, platform.jobs, platform.audit_log CASCADE")
      .catch(() => undefined);
    await pool.end();
  }
}

await main();
