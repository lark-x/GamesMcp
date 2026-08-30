import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { strict as assert } from "node:assert";
import { createDatabase, createPool } from "../packages/database/src/client.ts";
import { SqlKnowledgeRepository } from "../packages/database/src/repository.ts";
import { gameCapabilities, games } from "../packages/database/src/schema.ts";
import type { NormalizedRecord } from "../packages/domain/src/index.ts";

const databaseUrl = process.env.GIP_DB_TEST_URL;
if (!databaseUrl)
  throw new Error(
    "GIP_DB_TEST_URL is required and must point at a disposable PostgreSQL + pgvector database",
  );

const { applyMigrations } = await import("../packages/database/src/migration-runner.ts");

const upstreamCommit = "backup-gate-fixture-commit";
const gameVersion = "7.0.0";
const locale = "zh-CN";

function hash(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function makeRecord(index: number): NormalizedRecord {
  const sourceKey = `book/backup-gate-${index}`;
  const title = `备份门禁测试书 ${index}`;
  const body = `${title} 正文`;
  const rawContentHash = hash(Buffer.from(`${sourceKey}:${body}`));
  const normalized = {
    sourceKey,
    recordType: "document" as const,
    title,
    body,
    documentType: "book" as const,
    gameVersion,
    metadata: {
      provenance: {
        upstreamSource: "backup-gate-fixture",
        upstreamCommit,
        locale,
        canonicalKey: sourceKey,
        rawContentHash,
        normalizedContentHash: rawContentHash,
        lineage: {
          title: {
            relativeFile: "fixture.json",
            upstreamId: index,
            hash: "fixture-file-hash",
            valueHash: hash(Buffer.from(title)),
          },
          body: {
            relativeFile: "fixture.json",
            upstreamId: index,
            hash: "fixture-file-hash",
            valueHash: hash(Buffer.from(body)),
          },
        },
      },
    },
    parserVersion: "backup-gate-test",
  };
  return {
    ...normalized,
    contentHash: hash(Buffer.from(JSON.stringify(normalized))),
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

async function markExact(repository: SqlKnowledgeRepository, batchId: string): Promise<void> {
  const run = await repository.getVerificationRun(batchId);
  assert.ok(run);
  for (const item of run.items) {
    await repository.updateVerificationItem({
      itemId: item.id,
      status: "exact_match",
      channel: "game_client",
      checkedGameVersion: gameVersion,
      checkedLocale: locale,
    });
  }
}

async function writeBackup(
  dataDir: string,
  manifestBytes: Buffer,
  createdAt: string,
): Promise<void> {
  const backupDir = resolve(dataDir, "backups", "20990101T000000Z");
  await mkdir(backupDir, { recursive: true });
  const dump = Buffer.from("fixture PostgreSQL dump");
  await writeFile(resolve(backupDir, "gip.dump"), dump);
  await writeFile(resolve(backupDir, "manifest.json"), manifestBytes);
  await writeFile(
    resolve(backupDir, "backup-manifest.json"),
    `${JSON.stringify(
      {
        createdAt,
        databaseUrl: "postgres://gip:[redacted]@127.0.0.1:5432/gip_disposable_test",
        dumpPath: relative(dataDir, resolve(backupDir, "gip.dump")),
        dumpSha256: hash(dump),
        dumpBytes: dump.length,
        sourceManifestPath: "fixture/manifest.json",
        sourceManifestSha256: hash(manifestBytes),
        sourceManifestBytes: manifestBytes.length,
        files: [
          {
            path: relative(dataDir, resolve(backupDir, "gip.dump")),
            sha256: hash(dump),
            bytes: dump.length,
          },
          {
            path: relative(dataDir, resolve(backupDir, "manifest.json")),
            sha256: hash(manifestBytes),
            bytes: manifestBytes.length,
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
}

async function main(): Promise<void> {
  const pool = createPool(databaseUrl);
  const db = createDatabase(pool);
  const dataDir = await mkdtemp(resolve(process.cwd(), ".backup-gate-test-"));
  try {
    await applyMigrations(pool);
    await pool.query("TRUNCATE platform.games, platform.jobs, platform.audit_log CASCADE");

    const [game] = await db
      .insert(games)
      .values({
        id: randomUUID(),
        slug: `backup-gate-${randomUUID().slice(0, 8)}`,
        name: "备份门禁测试",
      })
      .returning();
    assert.ok(game);
    await db.insert(gameCapabilities).values([
      { gameId: game.id, capability: "entity_search", enabled: true },
      { gameId: game.id, capability: "lore_search", enabled: true },
      { gameId: game.id, capability: "relationships", enabled: true },
      { gameId: game.id, capability: "evidence_qa", enabled: true },
    ]);

    const repository = new SqlKnowledgeRepository(db, dataDir);
    const source = await repository.createSource({
      gameId: game.id,
      name: "备份门禁测试来源",
      type: "local_json",
      pathLabel: "fixture.json",
      licenseNote: "test",
      enabled: true,
      parserType: "anime-game-data:book",
    });
    const records = Array.from({ length: 10 }, (_, index) => makeRecord(index));
    const recordsRoot = resolve(dataDir, "imports", "records");
    const manifestPath = resolve(dataDir, "imports", "manifest.json");
    const manifestBytes = Buffer.from(
      JSON.stringify({
        schemaVersion: 2,
        upstream: { commit: upstreamCommit },
        gameVersion,
        locale,
        outputRecordsPath: relative(process.cwd(), recordsRoot),
        accounting: {
          books: {
            discovered: records.length,
            converted: records.length,
            excluded: 0,
            failures: 0,
            accounted: records.length,
            coverage: 1,
          },
          characterStories: {
            discovered: 0,
            converted: 0,
            excluded: 0,
            failures: 0,
            accounted: 0,
            coverage: 1,
          },
          itemDescriptions: {
            discovered: 0,
            converted: 0,
            excluded: 0,
            failures: 0,
            accounted: 0,
            coverage: 1,
          },
        },
        accountedCoverage: { books: 1, characterStories: 1, itemDescriptions: 1 },
        unexplainedMissing: [],
        marker: "current",
      }),
    );
    await mkdir(recordsRoot, { recursive: true });
    await writeFile(resolve(recordsRoot, "books.json"), JSON.stringify(records));
    await writeFile(resolve(recordsRoot, "character-stories.json"), "[]");
    await writeFile(resolve(recordsRoot, "items.json"), "[]");
    await writeFile(manifestPath, manifestBytes);
    const snapshot = await repository.createSnapshot({
      sourceId: source.id,
      contentHash: `snapshot-${randomUUID()}`,
      storagePath: "snapshots/backup-gate.json",
      metadata: {
        manifestPath: relative(process.cwd(), manifestPath),
        upstream: { commit: upstreamCommit },
        gameVersion,
        locale,
        category: "book",
      },
    });
    const batch = await repository.createImport({
      gameId: game.id,
      sourceId: source.id,
      sourceSnapshotId: snapshot.id,
      parserVersion: "backup-gate-test",
      stagedRecords: records,
      errors: [],
      warnings: [],
      diff: diffFor(records),
    });
    await repository.reviewImport(batch.id, true, "备份门禁测试审核", []);
    await markExact(repository, batch.id);

    const incompleteManifestValue = JSON.parse(manifestBytes.toString("utf8")) as Record<
      string,
      unknown
    >;
    const incompleteAccounting = incompleteManifestValue.accounting as Record<string, unknown>;
    const incompleteBooks = incompleteAccounting.books as Record<string, unknown>;
    incompleteManifestValue.accounting = {
      ...incompleteAccounting,
      books: { ...incompleteBooks, accounted: records.length - 1 },
    };
    const incompleteManifest = Buffer.from(JSON.stringify(incompleteManifestValue));
    await writeFile(manifestPath, incompleteManifest);
    await writeBackup(dataDir, incompleteManifest, new Date(Date.now() + 30_000).toISOString());
    await assert.rejects(() => repository.publishImport(batch.id, "不完整 Manifest 应拒绝"), {
      code: "acquisition_manifest_incomplete",
    });

    const missingCoverageValue = JSON.parse(manifestBytes.toString("utf8")) as Record<
      string,
      unknown
    >;
    const missingCoverage = {
      ...((missingCoverageValue.accountedCoverage as Record<string, unknown>) ?? {}),
    };
    delete missingCoverage.itemDescriptions;
    missingCoverageValue.accountedCoverage = missingCoverage;
    const missingCoverageManifest = Buffer.from(JSON.stringify(missingCoverageValue));
    await writeFile(manifestPath, missingCoverageManifest);
    await writeBackup(
      dataDir,
      missingCoverageManifest,
      new Date(Date.now() + 45_000).toISOString(),
    );
    await assert.rejects(() => repository.publishImport(batch.id, "缺少 coverage 应拒绝"), {
      code: "acquisition_manifest_incomplete",
    });

    await writeFile(manifestPath, manifestBytes);
    const staleManifest = Buffer.from(
      JSON.stringify({
        ...JSON.parse(manifestBytes.toString("utf8")),
        marker: "stale",
      }),
    );
    await writeBackup(dataDir, staleManifest, new Date(Date.now() + 60_000).toISOString());
    await assert.rejects(() => repository.publishImport(batch.id, "旧 Manifest 应拒绝"), {
      code: "release_backup_required",
    });

    await writeBackup(dataDir, manifestBytes, new Date(Date.now() + 120_000).toISOString());
    const revision = await repository.publishImport(batch.id, "当前 Manifest 应通过");
    assert.equal(revision.gameId, game.id);
    console.log("Backup Manifest gate integration checks passed.");
  } finally {
    await pool
      .query("TRUNCATE platform.games, platform.jobs, platform.audit_log CASCADE")
      .catch(() => undefined);
    await pool.end();
    await rm(dataDir, { recursive: true, force: true });
  }
}

await main();
