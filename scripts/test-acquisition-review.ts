import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { strict as assert } from "node:assert";
import { createDatabase, createPool } from "../packages/database/src/client.ts";
import { SqlKnowledgeRepository } from "../packages/database/src/repository.ts";
import { gameCapabilities, games } from "../packages/database/src/schema.ts";
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

const upstreamCommit = "26df1dfbdf05a82bbb1d97506859f3e1c40718d8";
const expectedVersion = "7.0.0";
const expectedLocale = "zh-CN";

function record(
  category: "book" | "character_story" | "item_description",
  index: number,
  options: { gameVersion?: string; bodySuffix?: string } = {},
): NormalizedRecord {
  const canonicalKey =
    category === "book"
      ? `book/${index}`
      : category === "character_story"
        ? `character/100/story/${index}`
        : `item-codex/${index}`;
  const title = `${category}-${index}`;
  const body = `${title} 正文${options.bodySuffix ?? ""}`;
  const gameVersion = options.gameVersion ?? expectedVersion;
  const normalized = {
    sourceKey: canonicalKey,
    recordType: "document" as const,
    title,
    body,
    documentType: category,
    gameVersion,
    metadata: {
      provenance: {
        upstreamSource: "fixture",
        upstreamCommit,
        locale: expectedLocale,
        canonicalKey,
        rawContentHash: createHash("sha256").update(`${canonicalKey}:${body}`).digest("hex"),
        normalizedContentHash: createHash("sha256").update(`${canonicalKey}:${body}`).digest("hex"),
        lineage: {
          title: {
            relativeFile: "fixture.json",
            upstreamId: index,
            hash: "fixture-file-hash",
            valueHash: createHash("sha256").update(title).digest("hex"),
          },
          body: {
            relativeFile: "fixture.json",
            upstreamId: index,
            hash: "fixture-file-hash",
            valueHash: createHash("sha256").update(body).digest("hex"),
          },
        },
      },
    },
    parserVersion: "acquisition-test",
  };
  return {
    ...normalized,
    contentHash: createHash("sha256").update(JSON.stringify(normalized)).digest("hex"),
  };
}

function diffFor(records: NormalizedRecord[]) {
  return {
    added: records.map((item) => item.sourceKey),
    modified: [],
    deletionCandidates: [],
    unchanged: [],
    conflicts: [],
    unparsed: [],
  };
}

async function markExact(
  repository: SqlKnowledgeRepository,
  batchId: string,
): Promise<Awaited<ReturnType<SqlKnowledgeRepository["getVerificationRun"]>>> {
  const run = await repository.getVerificationRun(batchId);
  assert.ok(run);
  for (const item of run.items) {
    await repository.updateVerificationItem({
      itemId: item.id,
      status: "exact_match",
      channel: "game_client",
      checkedGameVersion: run.expectedGameVersion,
      checkedLocale: run.expectedLocale,
    });
  }
  return repository.getVerificationRun(batchId);
}

async function observationIdForText(
  repository: SqlKnowledgeRepository,
  conflictId: string,
  recordValue: NormalizedRecord,
): Promise<string> {
  const detail = await repository.getConflict(conflictId);
  assert.ok(detail);
  const observation = detail.observations.find(
    (candidate) => candidate.title === recordValue.title && candidate.body === recordValue.body,
  );
  assert.ok(observation);
  return observation.id;
}

async function main() {
  const pool = createPool(databaseUrl);
  const db = createDatabase(pool);
  try {
    for (const migrationPath of migrationPaths) {
      const migration = await readFile(migrationPath, "utf8");
      await pool.query(migration);
    }
    await pool.query("TRUNCATE platform.games, platform.jobs, platform.audit_log CASCADE");
    const gameId = randomUUID();
    const [game] = await db
      .insert(games)
      .values({ id: gameId, slug: `acquisition-test-${gameId.slice(0, 8)}`, name: "采集核验测试" })
      .returning();
    assert.ok(game);
    await db.insert(gameCapabilities).values([
      { gameId: game.id, capability: "entity_search", enabled: true },
      { gameId: game.id, capability: "lore_search", enabled: true },
      { gameId: game.id, capability: "relationships", enabled: true },
      { gameId: game.id, capability: "evidence_qa", enabled: true },
    ]);
    const repository = new SqlKnowledgeRepository(db);
    const source = await repository.createSource({
      gameId: game.id,
      name: "采集核验测试来源",
      type: "local_json",
      pathLabel: "fixture.json",
      licenseNote: "test",
      enabled: true,
      parserType: "acquisition-test",
    });
    // A partially failed acquisition must retain observations for the rows
    // that parsed successfully; otherwise the audit trail would silently
    // lose usable data whenever one sibling row has a validation error.
    const partialRecord = record("book", 9_999);
    const partialSnapshot = await repository.createSnapshot({
      sourceId: source.id,
      contentHash: `snapshot-partial-${randomUUID()}`,
      storagePath: "snapshots/acquisition-partial.json",
      metadata: { fixture: true },
    });
    const partialBatch = await repository.createImport({
      gameId: game.id,
      sourceId: source.id,
      sourceSnapshotId: partialSnapshot.id,
      parserVersion: "acquisition-test",
      stagedRecords: [partialRecord],
      errors: [
        {
          severity: "error",
          code: "missing_readable",
          message: "fixture validation failure",
          sourceKey: "book/failed-row",
        },
      ],
      warnings: [],
      diff: diffFor([partialRecord]),
    });
    assert.equal(partialBatch.status, "failed");
    const partialRun = await repository.getVerificationRun(partialBatch.id);
    assert.ok(partialRun);
    assert.equal(partialRun.items.length, 2);
    const failedVerificationItem = partialRun.items.find(
      (item) => item.canonicalKey === "book/failed-row",
    );
    assert.ok(failedVerificationItem);
    assert.equal(failedVerificationItem.title, "转换失败 · book/failed-row");
    assert.match(failedVerificationItem.note ?? "", /missing_readable/);
    const partialObservation = await pool.query<{ count: number }>(
      "select count(*)::int as count from knowledge.source_observations where source_snapshot_id = $1",
      [partialSnapshot.id],
    );
    assert.equal(partialObservation.rows[0]?.count, 1);

    // Even when every row fails conversion, the snapshot Manifest still
    // provides enough scope to create a verification run for the explicit
    // failed items. This keeps the audit trail complete instead of silently
    // dropping an all-failed category.
    const allFailedSnapshot = await repository.createSnapshot({
      sourceId: source.id,
      contentHash: `snapshot-all-failed-${randomUUID()}`,
      storagePath: "snapshots/acquisition-all-failed.json",
      metadata: {
        fixture: true,
        upstream: { commit: upstreamCommit },
        gameVersion: expectedVersion,
        locale: expectedLocale,
      },
    });
    const allFailedBatch = await repository.createImport({
      gameId: game.id,
      sourceId: source.id,
      sourceSnapshotId: allFailedSnapshot.id,
      parserVersion: "acquisition-test",
      stagedRecords: [],
      errors: [
        {
          severity: "error",
          code: "conversion_failed",
          message: "all rows failed in fixture",
          sourceKey: "book/all-failed-row",
        },
      ],
      warnings: [],
      diff: diffFor([]),
    });
    assert.equal(allFailedBatch.status, "failed");
    const allFailedRun = await repository.getVerificationRun(allFailedBatch.id);
    assert.ok(allFailedRun);
    assert.equal(allFailedRun.expectedGameVersion, expectedVersion);
    assert.equal(allFailedRun.expectedLocale, expectedLocale);
    assert.equal(allFailedRun.items.length, 1);
    assert.equal(allFailedRun.items[0]?.canonicalKey, "book/all-failed-row");
    assert.equal(allFailedRun.items[0]?.title, "转换失败 · book/all-failed-row");

    const replacementRecords = Array.from({ length: 31 }, (_, index) =>
      record("book", 100 + index),
    );
    const replacementSnapshot = await repository.createSnapshot({
      sourceId: source.id,
      contentHash: `snapshot-replacement-${randomUUID()}`,
      storagePath: "snapshots/acquisition-replacement.json",
      metadata: { fixture: true },
    });
    const replacementBatch = await repository.createImport({
      gameId: game.id,
      sourceId: source.id,
      sourceSnapshotId: replacementSnapshot.id,
      parserVersion: "acquisition-test",
      stagedRecords: replacementRecords,
      errors: [],
      warnings: [],
      diff: diffFor(replacementRecords),
    });
    const replacementRun = await repository.getVerificationRun(replacementBatch.id);
    assert.ok(replacementRun);
    assert.equal(replacementRun.items.length, 30);
    assert.equal(replacementRun.datasetRevision, null);
    assert.equal(replacementRun.items[0]?.sourceSnapshotId, replacementSnapshot.id);
    assert.ok(replacementRun.items[0]?.body?.includes("正文"));
    assert.equal(
      replacementRun.items[0]?.provenance?.canonicalKey,
      replacementRun.items[0]?.canonicalKey,
    );
    const initiallySelected = new Set(replacementRun.items.map((item) => item.canonicalKey));
    const unavailableItem = replacementRun.items[0];
    assert.ok(unavailableItem);
    await repository.updateVerificationItem({
      itemId: unavailableItem.id,
      status: "unavailable_due_unlock",
      channel: "game_client",
      checkedGameVersion: expectedVersion,
      checkedLocale: expectedLocale,
    });
    const replacementRunAfterUnlock = await repository.getVerificationRun(replacementBatch.id);
    assert.ok(replacementRunAfterUnlock);
    assert.equal(replacementRunAfterUnlock.items.length, 31);
    assert.ok(
      replacementRunAfterUnlock.items.some((item) => !initiallySelected.has(item.canonicalKey)),
    );
    const replacementKey = replacementRunAfterUnlock.items.find(
      (item) => !initiallySelected.has(item.canonicalKey),
    )?.canonicalKey;
    assert.ok(replacementKey);
    const replacementIndex = Number(replacementKey.split("/")[1]);
    const conflictRecords = replacementRecords.map((item) =>
      item.sourceKey === replacementKey
        ? record("book", replacementIndex, { bodySuffix: "（冲突来源修订）" })
        : item,
    );
    const conflictSnapshot = await repository.createSnapshot({
      sourceId: source.id,
      contentHash: `snapshot-conflict-${randomUUID()}`,
      storagePath: "snapshots/acquisition-conflict.json",
      metadata: { fixture: true },
    });
    const conflictBatch = await repository.createImport({
      gameId: game.id,
      sourceId: source.id,
      sourceSnapshotId: conflictSnapshot.id,
      parserVersion: "acquisition-test",
      stagedRecords: conflictRecords,
      errors: [],
      warnings: [],
      diff: { ...diffFor(conflictRecords), conflicts: [replacementKey, "book/deleted-conflict"] },
    });
    const conflictRun = await repository.getVerificationRun(conflictBatch.id);
    assert.ok(conflictRun);
    assert.equal(conflictRun.items.length, 32);
    assert.ok(conflictRun.items.some((item) => item.canonicalKey === replacementKey));
    const deletedConflictItem = conflictRun.items.find(
      (item) => item.canonicalKey === "book/deleted-conflict",
    );
    assert.ok(deletedConflictItem);
    assert.equal(deletedConflictItem.title, "冲突待裁决 · book/deleted-conflict");
    const replacementConflict = (await repository.listConflicts(game.id, "open")).find(
      (conflict) => conflict.canonicalKey === replacementKey,
    );
    assert.ok(replacementConflict);
    const replacementRecord = conflictRecords.find(
      (recordValue) => recordValue.sourceKey === replacementKey,
    );
    assert.ok(replacementRecord);
    await repository.resolveConflict(
      replacementConflict.id,
      "测试裁决：冲突抽样已处理",
      await observationIdForText(repository, replacementConflict.id, replacementRecord),
    );
    const recordsA = [
      ...Array.from({ length: 10 }, (_, index) => record("book", index + 1)),
      ...Array.from({ length: 10 }, (_, index) => record("character_story", index + 1)),
      ...Array.from({ length: 9 }, (_, index) => record("item_description", index + 1)),
      record("item_description", 10),
    ];
    const snapshotA = await repository.createSnapshot({
      sourceId: source.id,
      contentHash: `snapshot-a-${randomUUID()}`,
      storagePath: "snapshots/acquisition-a.json",
      metadata: { fixture: true },
    });
    const batchA = await repository.createImport({
      gameId: game.id,
      sourceId: source.id,
      sourceSnapshotId: snapshotA.id,
      parserVersion: "acquisition-test",
      stagedRecords: recordsA,
      errors: [],
      warnings: [],
      diff: diffFor(recordsA),
    });
    const initialRun = await repository.getVerificationRun(batchA.id);
    assert.ok(initialRun);
    assert.equal(initialRun.items.length, 30);
    const screenshotGateItem = initialRun.items[0];
    assert.ok(screenshotGateItem);
    await repository.updateVerificationItem({
      itemId: screenshotGateItem.id,
      status: "mismatch",
      channel: "game_client",
      checkedGameVersion: expectedVersion,
      checkedLocale: expectedLocale,
    });
    await assert.rejects(
      () => repository.ensureAcquisitionReview(batchA.id),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "verification_gate_failed");
        assert.equal(
          (error as { details?: { missingScreenshots?: number } }).details?.missingScreenshots ?? 0,
          1,
        );
        return true;
      },
    );
    await repository.addVerificationScreenshot({
      itemId: screenshotGateItem.id,
      relativePath: `verification/${screenshotGateItem.id}/fixture.png`,
      sha256: createHash("sha256").update("fixture").digest("hex"),
      bytes: 128,
      mimeType: "image/png",
    });
    await assert.rejects(
      () => repository.ensureAcquisitionReview(batchA.id),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "verification_gate_failed");
        assert.equal((error as { details?: { mismatches?: number } }).details?.mismatches ?? 0, 1);
        return true;
      },
    );
    const runA = await markExact(repository, batchA.id);
    assert.ok(runA);
    const firstItem = runA.items[0];
    assert.ok(firstItem);
    const evidenceBytes = 128;
    await repository.addVerificationScreenshot({
      itemId: firstItem.id,
      relativePath: `verification/${firstItem.id}/fixture.png`,
      sha256: createHash("sha256").update("fixture").digest("hex"),
      bytes: evidenceBytes,
      mimeType: "image/png",
    });
    assert.equal((await repository.getVerificationRun(batchA.id))?.items[0]?.screenshotCount, 1);
    await repository.ensureAcquisitionReview(batchA.id);
    assert.equal((await repository.getVerificationRun(batchA.id))?.status, "ready");

    const recordsB = recordsA.map((item) => {
      if (item.sourceKey === "book/1") return record("book", 1, { bodySuffix: "（来源 B 修订）" });
      if (item.sourceKey === "item-codex/10")
        return record("item_description", 10, { gameVersion: "7.0.1" });
      if (item.sourceKey === "book/2") {
        const equivalent = record("book", 2);
        const normalized = { ...equivalent, contentHash: undefined };
        equivalent.metadata = { ...equivalent.metadata, observationOnly: "mirror-source" };
        equivalent.contentHash = createHash("sha256")
          .update(JSON.stringify(normalized))
          .digest("hex");
        return equivalent;
      }
      return item;
    });
    const snapshotB = await repository.createSnapshot({
      sourceId: source.id,
      contentHash: `snapshot-b-${randomUUID()}`,
      storagePath: "snapshots/acquisition-b.json",
      metadata: { fixture: true },
    });
    const batchB = await repository.createImport({
      gameId: game.id,
      sourceId: source.id,
      sourceSnapshotId: snapshotB.id,
      parserVersion: "acquisition-test",
      stagedRecords: recordsB,
      errors: [],
      warnings: [],
      diff: diffFor(recordsB),
    });
    const runB = await markExact(repository, batchB.id);
    assert.ok(runB);
    await assert.rejects(() => repository.ensureAcquisitionReview(batchB.id), {
      code: "verification_gate_failed",
    });
    const openConflicts = await repository.listConflicts(game.id, "open");
    assert.equal(openConflicts.length, 1);
    assert.equal(openConflicts[0]?.canonicalKey, "book/1");
    assert.equal(openConflicts[0]?.kind, "content_conflict");
    await assert.rejects(() => repository.resolveConflict(openConflicts[0]!.id, "缺少采用来源"), {
      code: "conflict_observation_required",
    });
    const resolvedConflicts = await repository.listConflicts(game.id, "resolved");
    assert.ok(
      resolvedConflicts.some(
        (conflict) =>
          conflict.canonicalKey === "item-codex/10" && conflict.kind === "version_difference",
      ),
    );
    assert.ok(
      resolvedConflicts.some(
        (conflict) => conflict.canonicalKey === "book/2" && conflict.kind === "exact_match",
      ),
    );
    const currentBookOne = recordsB.find((recordValue) => recordValue.sourceKey === "book/1");
    assert.ok(currentBookOne);
    const oldBookOneObservation = (
      await repository.getConflict(openConflicts[0]!.id)
    )?.observations.find(
      (observation) =>
        observation.title !== currentBookOne.title || observation.body !== currentBookOne.body,
    );
    assert.ok(oldBookOneObservation);
    await repository.resolveConflict(
      openConflicts[0]!.id,
      "测试错误裁决：故意选择未待发布正文",
      oldBookOneObservation.id,
    );
    await assert.rejects(() => repository.ensureAcquisitionReview(batchB.id), {
      code: "verification_gate_failed",
    });
    await repository.resolveConflict(
      openConflicts[0]!.id,
      "测试裁决：保留正式来源观察并人工复核",
      await observationIdForText(repository, openConflicts[0]!.id, currentBookOne),
    );
    await repository.ensureAcquisitionReview(batchB.id);
    assert.equal((await repository.getVerificationRun(batchB.id))?.status, "ready");
    assert.equal((await repository.listConflicts(game.id, "open")).length, 0);
    await repository.reviewImport(batchB.id, true, "核验完成", []);
    const revision = await repository.publishImport(batchB.id, "采集核验集成测试发布");
    assert.equal(revision.gameId, game.id);
    const publishedRun = await repository.getVerificationRun(batchB.id);
    assert.equal(publishedRun?.datasetRevision, "r1");
    const publishedBook = (
      await repository.listDocuments(game.id, { type: "book", limit: 1, offset: 0 })
    )[0];
    assert.ok(publishedBook);
    const publishedDetail = await repository.getDocument(game.id, publishedBook.id);
    assert.equal(publishedDetail?.provenance?.canonicalKey, publishedBook.sourceKey);
    assert.equal(publishedDetail?.provenance?.lineage?.title?.relativeFile, "fixture.json");

    const observationsBeforeConflictGateTest = await pool.query<{ count: number }>(
      "select count(*)::int as count from knowledge.source_observations where game_id = $1",
      [game.id],
    );

    // A conflict from an older snapshot must still block a clean-looking
    // batch for the same game.  This guards the release API against drifting
    // from the status report, which treats any open game-scoped conflict as a
    // publication blocker.
    const staleConflictSnapshot = await repository.createSnapshot({
      sourceId: source.id,
      contentHash: `snapshot-stale-conflict-${randomUUID()}`,
      storagePath: "snapshots/acquisition-stale-conflict.json",
      metadata: { fixture: true },
    });
    const staleConflictBatch = await repository.createImport({
      gameId: game.id,
      sourceId: source.id,
      sourceSnapshotId: staleConflictSnapshot.id,
      parserVersion: "acquisition-test",
      stagedRecords: recordsA.map((item) =>
        item.sourceKey === "book/1"
          ? record("book", 1, { bodySuffix: "（旧快照再次修订）" })
          : item,
      ),
      errors: [],
      warnings: [],
      diff: diffFor(recordsA),
    });
    assert.ok(staleConflictBatch.sourceSnapshotId);
    const staleOpenConflict = (await repository.listConflicts(game.id, "open")).find(
      (conflict) => conflict.canonicalKey === "book/1",
    );
    assert.ok(staleOpenConflict);

    const cleanSnapshot = await repository.createSnapshot({
      sourceId: source.id,
      contentHash: `snapshot-clean-${randomUUID()}`,
      storagePath: "snapshots/acquisition-clean.json",
      metadata: { fixture: true },
    });
    const cleanRecords = Array.from({ length: 31 }, (_, index) => record("book", 1000 + index));
    const cleanBatch = await repository.createImport({
      gameId: game.id,
      sourceId: source.id,
      sourceSnapshotId: cleanSnapshot.id,
      parserVersion: "acquisition-test",
      stagedRecords: cleanRecords,
      errors: [],
      warnings: [],
      diff: diffFor(cleanRecords),
    });
    await markExact(repository, cleanBatch.id);
    await assert.rejects(() => repository.ensureAcquisitionReview(cleanBatch.id), {
      code: "verification_gate_failed",
    });
    await repository.resolveConflict(
      staleOpenConflict.id,
      "测试清理：旧快照冲突已裁决",
      staleOpenConflict.observationIds[0],
    );

    const observationCount = await pool.query(
      "select count(*)::int as count from knowledge.source_observations where game_id = $1",
      [game.id],
    );
    const reconciliation = await repository.reconcileSourceObservationConflicts(game.id);
    assert.ok(reconciliation.scopes > 0);
    assert.equal(reconciliation.open, 0);
    assert.equal(
      observationCount.rows[0]?.count,
      Number(observationsBeforeConflictGateTest.rows[0]?.count ?? 0) +
        recordsA.length +
        cleanRecords.length,
    );
    console.log("Acquisition review integration checks passed.");
  } finally {
    await pool
      .query("TRUNCATE platform.games, platform.jobs, platform.audit_log CASCADE")
      .catch(() => undefined);
    await pool.end();
  }
}

await main();
