import { strict as assert } from "node:assert";
import { createHash, randomUUID } from "node:crypto";
import { createDatabase, createPool } from "../packages/database/src/client.ts";
import { applyMigrations } from "../packages/database/src/migration-runner.ts";
import { SqlKnowledgeRepository } from "../packages/database/src/repository.ts";
import { gameCapabilities, games } from "../packages/database/src/schema.ts";
import type { NormalizedRecord, StructuredImportRecords } from "../packages/domain/src/index.ts";

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

function questRecord(locale: "zh-CN" | "en"): NormalizedRecord {
  const title = locale === "zh-CN" ? "捕风的异乡人" : "The Outlander Who Caught the Wind";
  const body = locale === "zh-CN" ? "派蒙：我们到了。" : "Paimon: We made it.";
  const value: Omit<NormalizedRecord, "contentHash"> = {
    sourceKey: `quest/1001/locale/${locale}`,
    recordType: "document",
    title,
    body,
    documentType: "archon_quest",
    gameVersion: "test-1",
    locale,
    metadata: { version: "test-1", locale },
    segments: [
      {
        segmentKey: "quest/1001/dialog/100101",
        ordinal: 0,
        body,
        startOffset: 0,
        endOffset: body.length,
        headingPath: [title],
        metadata: { fixture: true },
      },
    ],
    quest: {
      questKey: "quest/1001",
      mainQuestId: 1001,
      questType: "archon_quest",
      locale,
      chapter: locale === "zh-CN" ? "序章" : "Prologue",
      series: locale === "zh-CN" ? "捕风的异乡人" : "The Outlander Who Caught the Wind",
      completeness: "complete",
      subquests: [
        {
          subquestKey: "quest/1001/subquest/100101",
          subquestId: 100101,
          order: 1,
          title,
          objective: locale === "zh-CN" ? "跟随派蒙" : "Follow Paimon",
          completeness: "complete",
          metadata: { fixture: true },
        },
      ],
      dialogueNodes: [
        {
          nodeKey: "quest/1001/dialog/100101",
          nodeId: 100101,
          type: "dialogue",
          subquestKey: "quest/1001/subquest/100101",
          speakerKey: "npc/1001",
          speakerName: locale === "zh-CN" ? "派蒙" : "Paimon",
          body,
          segmentKey: "quest/1001/dialog/100101",
          order: 1,
          metadata: { fixture: true },
        },
      ],
      dialogueEdges: [
        {
          fromNodeKey: "quest/1001/dialog/100101",
          toNodeKey: "quest/1001/dialog/100101",
          type: "fallback",
          metadata: { fixture: true },
        },
        {
          fromNodeKey: "quest/1001/dialog/100101",
          toNodeKey: "quest/1001/dialog/100101",
          type: "fallback",
          metadata: { fixture: true, duplicate: true },
        },
      ],
      metadata: { fixture: true },
    },
    parserVersion: "candidate-flow-test",
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

function structuredDiffFor(records: StructuredImportRecords) {
  const keys = Object.values(records).flatMap((items) =>
    (items ?? []).map((record) => record.sourceKey),
  );
  return {
    added: keys,
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

    const structured: StructuredImportRecords = {
      characters: [
        {
          stableId: "genshin:character:10000001",
          sourceKey: "anime-game-data/character/10000001",
          name: "结构化测试角色",
          locale: "zh-CN",
          gameId,
          revisionId: revision1.id,
          provenance: {},
          profile: {},
          rarity: 5,
          element: "pyro",
          weaponType: "sword",
          description: "只来自结构化记录的测试角色。",
        },
      ],
    };
    const structuredSnapshot = await repository.createSnapshot({
      sourceId: source.id,
      contentHash: createHash("sha256").update("structured-snapshot").digest("hex"),
      storagePath: "snapshots/candidate-flow-structured.json",
      metadata: { commit: "structured-fixture", locale: "zh-CN" },
    });
    const structuredBatch = await repository.createImport({
      gameId,
      sourceId: source.id,
      sourceSnapshotId: structuredSnapshot.id,
      parserVersion: "candidate-flow-structured-test",
      stagedRecords: [],
      structuredRecords: structured,
      errors: [],
      warnings: [],
      diff: structuredDiffFor(structured),
    });
    const structuredCandidate = await repository.createReleaseCandidate({
      gameId,
      name: "RC Structured",
      importBatchIds: [structuredBatch.id],
    });
    const structuredBuild = await repository.buildReleaseCandidate(structuredCandidate.id);
    assert.equal(structuredBuild.recordCount, 2);
    assert.equal(structuredBuild.structuredRecordCount, 1);
    const immutableStructuredBuild = await repository.getReleaseCandidateBuild(structuredBuild.id);
    assert.equal(
      immutableStructuredBuild?.structuredRecords?.characters?.[0]?.name,
      "结构化测试角色",
    );
    const structuredReadiness = await repository.getReleaseCandidateReadiness(
      structuredCandidate.id,
    );
    assert.equal(
      structuredReadiness.ready,
      true,
      JSON.stringify(structuredReadiness.blockingReasons),
    );
    await repository.promoteReleaseCandidate({
      candidateId: structuredCandidate.id,
      buildId: structuredBuild.id,
      contentChecksum: structuredBuild.contentChecksum,
      expectedCurrentRevisionId: revision1.id,
      releaseNote: "候选流程测试结构化记录",
      idempotencyKey: `candidate-flow-${structuredCandidate.id}-${structuredBuild.id}`,
    });
    const structuredRevision = await activatePendingRevision(
      repository,
      "candidate-flow-structured-worker",
    );
    assert.equal(structuredRevision.structuredRecords?.characters?.[0]?.name, "结构化测试角色");
    const structuredCharacter = await repository.genshin.getCharacter(
      structuredRevision.id,
      "genshin:character:10000001",
    );
    assert.equal(structuredCharacter?.name, "结构化测试角色");

    const lisa = entityRecord("characters/lisa", "丽莎");
    const snapshot2 = await repository.createSnapshot({
      sourceId: source.id,
      contentHash: createHash("sha256").update("snapshot-2").digest("hex"),
      storagePath: "snapshots/candidate-flow-2.json",
      metadata: { commit: "fixture-2", locale: "zh-CN" },
    });
    const questZh = questRecord("zh-CN");
    const questEn = questRecord("en");
    const batch2Records = [lisa, questZh, questEn];
    const batch2 = await repository.createImport({
      gameId,
      sourceId: source.id,
      sourceSnapshotId: snapshot2.id,
      parserVersion: "candidate-flow-test",
      stagedRecords: batch2Records,
      errors: [],
      warnings: [],
      diff: diffFor(batch2Records),
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
      expectedCurrentRevisionId: structuredRevision.id,
      releaseNote: "候选流程测试第二版",
      idempotencyKey: `candidate-flow-${candidate2.id}-${build3.id}`,
    });
    const revision2 = await activatePendingRevision(repository, "candidate-flow-worker-2");
    assert.equal(revision2.revisionNumber, structuredRevision.revisionNumber + 1);
    assert.equal((await repository.getCurrentRevision(gameId))?.id, revision2.id);
    const [questMaterialized] = (
      await pool.query(
        `select
          (select count(*)::int from knowledge.quest_subquests where revision_id = $1) as subquests,
          (select count(*)::int from knowledge.quest_dialogue_nodes where revision_id = $1) as nodes,
          (select count(*)::int from knowledge.quest_dialogue_edges where revision_id = $1) as edges`,
        [revision2.id],
      )
    ).rows;
    assert.deepEqual(questMaterialized, { subquests: 2, nodes: 2, edges: 2 });

    // Sprint 15 Phase 15.3: a failed materialization must leave the previous
    // current revision unchanged and the new revision in a non-published state.
    {
      const currentBeforeFailure = await repository.getCurrentRevision(gameId);
      assert.equal(currentBeforeFailure?.id, revision2.id);
      const candidateFail = await repository.createReleaseCandidate({
        gameId,
        name: "RC Fail Inject",
        importBatchIds: [batch2.id],
      });
      const build4 = await repository.buildReleaseCandidate(candidateFail.id);
      assert.ok(build4, "failure-injection build must exist");
      const failingPreparation = await repository.promoteReleaseCandidate({
        candidateId: candidateFail.id,
        buildId: build4.id,
        contentChecksum: build4.contentChecksum,
        expectedCurrentRevisionId: revision2.id,
        releaseNote: "候选流程测试失败注入",
        idempotencyKey: `candidate-flow-fail-${build4.id}`,
      });
      const failingRevision = failingPreparation;
      await pool.query(
        "update knowledge.dataset_revisions set normalized_records = '{}'::jsonb where id = $1",
        [failingRevision.id],
      );
      await assert.rejects(
        () => repository.materializeRevision(failingRevision.id),
        /records.flatMap|materialization|payload/i,
      );
      const currentAfterFailure = await repository.getCurrentRevision(gameId);
      assert.equal(currentAfterFailure?.id, revision2.id);
    }

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
        publishedRevisions: [
          revision1.revisionNumber,
          structuredRevision.revisionNumber,
          revision2.revisionNumber,
        ],
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
