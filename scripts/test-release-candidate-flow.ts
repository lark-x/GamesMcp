import { strict as assert } from "node:assert";
import { createHash, randomUUID } from "node:crypto";
import { createDatabase, createPool } from "../packages/database/src/client.ts";
import { applyMigrations } from "../packages/database/src/migration-runner.ts";
import { SqlKnowledgeRepository } from "../packages/database/src/repository.ts";
import { gameCapabilities, games } from "../packages/database/src/schema.ts";
import type { NormalizedRecord } from "../packages/domain/src/index.ts";

const databaseUrl = process.env.GIP_DB_TEST_URL;
if (!databaseUrl)
  throw new Error(
    "GIP_DB_TEST_URL is required and must point at a disposable PostgreSQL + pgvector database",
  );

function entityRecord(sourceKey: string, title: string): NormalizedRecord {
  const value = {
    sourceKey,
    recordType: "entity" as const,
    title,
    entityType: "character" as const,
    metadata: { version: "test-1", locale: "zh-CN" },
    parserVersion: "candidate-flow-test",
    entities: [
      {
        sourceKey,
        name: title,
        type: "character" as const,
        summary: `${title} 的候选版本测试记录`,
        properties: { fixture: true },
      },
    ],
  };
  return {
    ...value,
    contentHash: createHash("sha256").update(JSON.stringify(value)).digest("hex"),
  };
}

function diffFor(records: NormalizedRecord[]) {
  return {
    added: records.map((record) => record.sourceKey),
    modified: [],
    deletionCandidates: [],
    unchanged: [],
    conflicts: [],
    unparsed: [],
  };
}

async function activatePendingRevision(repository: SqlKnowledgeRepository, workerId: string) {
  const job = await repository.claimNextJob(workerId);
  assert.ok(job, "promotion must enqueue an activation job");
  assert.equal(job.type, "activate_revision");
  const payload = job.payload as {
    revisionId: string;
    candidateId: string;
    buildId: string;
    contentChecksum: string;
    expectedCurrentRevisionId?: string | null;
  };
  await repository.materializeRevision(payload.revisionId);
  await repository.setRevisionIndexStatus(payload.revisionId, "ready");
  const revision = await repository.finalizeActivation(payload);
  await repository.completeJob(String(job.id), "completed");
  return revision;
}

async function main() {
  const pool = createPool(databaseUrl!);
  const db = createDatabase(pool);
  const repository = new SqlKnowledgeRepository(db);
  try {
    await applyMigrations(pool);
    await pool.query("TRUNCATE platform.games, platform.jobs, platform.audit_log CASCADE");

    const gameId = randomUUID();
    const [game] = await db
      .insert(games)
      .values({ id: gameId, slug: `candidate-flow-${gameId.slice(0, 8)}`, name: "候选流程测试" })
      .returning();
    assert.ok(game);
    await db.insert(gameCapabilities).values([
      { gameId, capability: "entity_search", enabled: true },
      { gameId, capability: "lore_search", enabled: true },
    ]);
    const source = await repository.createSource({
      gameId,
      name: "固定测试来源",
      type: "local_json",
      pathLabel: "candidate-flow.json",
      licenseNote: "test-only",
      enabled: true,
      parserType: "candidate-flow-test",
    });

    const amber = entityRecord("characters/amber", "安柏");
    const snapshot1 = await repository.createSnapshot({
      sourceId: source.id,
      contentHash: createHash("sha256").update("snapshot-1").digest("hex"),
      storagePath: "snapshots/candidate-flow-1.json",
      metadata: { commit: "fixture-1", locale: "zh-CN" },
    });
    const batch1 = await repository.createImport({
      gameId,
      sourceId: source.id,
      sourceSnapshotId: snapshot1.id,
      parserVersion: "candidate-flow-test",
      stagedRecords: [amber],
      errors: [],
      warnings: [],
      diff: diffFor([amber]),
    });
    const candidate1 = await repository.createReleaseCandidate({
      gameId,
      name: "RC 1",
      importBatchIds: [batch1.id],
    });
    const build1 = await repository.buildReleaseCandidate(candidate1.id);
    assert.equal(build1.buildNumber, 1);
    assert.equal(build1.recordCount, 1);
    assert.ok(build1.manifestId, "Build 1 must bind an immutable manifest");
    assert.equal(build1.indexStatus, "ready");

    const issue = await repository.reportReviewIssue({
      candidateId: candidate1.id,
      buildId: build1.id,
      canonicalKey: amber.sourceKey,
      summary: "角色名称需要按客户端截图修正",
      details: { title: amber.title },
    });
    assert.equal((await repository.getReleaseCandidateReadiness(candidate1.id)).ready, false);
    await assert.rejects(
      repository.createCandidatePatch({
        candidateId: candidate1.id,
        issueId: issue.id,
        canonicalKey: amber.sourceKey,
        fieldPath: "title",
        action: "manual",
        manualValue: "侦察骑士安柏",
      }),
      (error: { code?: string }) => error.code === "review_evidence_required",
    );

    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    await repository.addReviewEvidence({
      issueId: issue.id,
      relativePath: `review-evidence/${issue.id}/fixture.png`,
      sha256: createHash("sha256").update(png).digest("hex"),
      bytes: png.length,
      mimeType: "image/png",
      checkedGameVersion: "test-1",
      checkedLocale: "zh-CN",
      note: "测试截图证明角色名称",
    });
    await repository.createCandidatePatch({
      candidateId: candidate1.id,
      issueId: issue.id,
      canonicalKey: amber.sourceKey,
      fieldPath: "title",
      action: "manual",
      manualValue: "侦察骑士安柏",
    });
    const build2 = await repository.buildReleaseCandidate(candidate1.id);
    assert.equal(build2.buildNumber, 2);
    const immutableBuild1 = await repository.getReleaseCandidateBuild(build1.id);
    const patchedBuild2 = await repository.getReleaseCandidateBuild(build2.id);
    assert.equal(immutableBuild1?.normalizedRecords[0]?.title, "安柏");
    assert.equal(patchedBuild2?.normalizedRecords[0]?.title, "侦察骑士安柏");
    assert.equal((await repository.getReviewIssue(issue.id))?.status, "resolved");
    const readiness1 = await repository.getReleaseCandidateReadiness(candidate1.id);
    assert.equal(readiness1.ready, true, JSON.stringify(readiness1.blockingReasons));

    const preparing1 = await repository.promoteReleaseCandidate({
      candidateId: candidate1.id,
      buildId: build2.id,
      contentChecksum: build2.contentChecksum,
      expectedCurrentRevisionId: null,
      releaseNote: "候选流程测试第一版",
      idempotencyKey: `candidate-flow-${candidate1.id}-${build2.id}`,
    });
    assert.equal(preparing1.lifecycleStatus, "preparing");
    const repeatedPromotion = await repository.promoteReleaseCandidate({
      candidateId: candidate1.id,
      buildId: build2.id,
      contentChecksum: build2.contentChecksum,
      expectedCurrentRevisionId: null,
      releaseNote: "重复请求不会创建第二个 Revision",
      idempotencyKey: `candidate-flow-${candidate1.id}-${build2.id}`,
    });
    assert.equal(repeatedPromotion.id, preparing1.id);
    const revision1 = await activatePendingRevision(repository, "candidate-flow-worker-1");
    assert.equal(revision1.lifecycleStatus, "published");
    assert.equal(revision1.isCurrent, true);
    assert.equal(revision1.indexStatus, "ready");
    assert.equal((await repository.getCurrentRevision(gameId))?.id, revision1.id);

    const lisa = entityRecord("characters/lisa", "丽莎");
    const snapshot2 = await repository.createSnapshot({
      sourceId: source.id,
      contentHash: createHash("sha256").update("snapshot-2").digest("hex"),
      storagePath: "snapshots/candidate-flow-2.json",
      metadata: { commit: "fixture-2", locale: "zh-CN" },
    });
    const batch2 = await repository.createImport({
      gameId,
      sourceId: source.id,
      sourceSnapshotId: snapshot2.id,
      parserVersion: "candidate-flow-test",
      stagedRecords: [lisa],
      errors: [],
      warnings: [],
      diff: diffFor([lisa]),
    });
    const candidate2 = await repository.createReleaseCandidate({
      gameId,
      name: "RC 2",
      importBatchIds: [batch2.id],
    });
    const build3 = await repository.buildReleaseCandidate(candidate2.id);
    const readiness2 = await repository.getReleaseCandidateReadiness(candidate2.id);
    assert.equal(readiness2.ready, true, JSON.stringify(readiness2.blockingReasons));
    await repository.promoteReleaseCandidate({
      candidateId: candidate2.id,
      buildId: build3.id,
      contentChecksum: build3.contentChecksum,
      expectedCurrentRevisionId: revision1.id,
      releaseNote: "候选流程测试第二版",
      idempotencyKey: `candidate-flow-${candidate2.id}-${build3.id}`,
    });
    const revision2 = await activatePendingRevision(repository, "candidate-flow-worker-2");
    assert.equal(revision2.revisionNumber, revision1.revisionNumber + 1);
    assert.equal((await repository.getCurrentRevision(gameId))?.id, revision2.id);

    const rolledBack = await repository.rollbackRevision(revision1.id, "隔离测试回滚");
    assert.equal(rolledBack.id, revision1.id);
    assert.equal(rolledBack.isCurrent, true);
    assert.equal((await repository.getCurrentRevision(gameId))?.id, revision1.id);
    const search = await repository.search(gameId, {
      query: "侦察骑士安柏",
      types: ["entity"],
      revisionId: revision1.id,
      limit: 10,
    });
    assert.equal(search.revision, `r${revision1.revisionNumber}`);
    assert.equal(
      search.entities.some((entity) => entity.name.includes("安柏")),
      true,
    );
    console.log(
      JSON.stringify({
        candidateBuilds: [build1.buildNumber, build2.buildNumber],
        evidenceRequired: true,
        publishedRevisions: [revision1.revisionNumber, revision2.revisionNumber],
        rolledBackTo: revision1.revisionNumber,
        currentRevisionId: (await repository.getCurrentRevision(gameId))?.id,
      }),
    );
  } finally {
    await pool
      .query("TRUNCATE platform.games, platform.jobs, platform.audit_log CASCADE")
      .catch(() => undefined);
    await pool.end();
  }
}

await main();
