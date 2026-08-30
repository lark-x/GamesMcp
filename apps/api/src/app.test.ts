import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, type RuntimeConfig } from "@gip/config";
import type { GameSummary, SearchResult } from "@gip/contracts";
import type { DocumentDetail, ImportBatch, KnowledgeRepository } from "@gip/domain";
import { createApp } from "./app.js";

const gameId = "00000000-0000-0000-0000-000000000001";
const entityId = "00000000-0000-0000-0000-000000000002";
const revisionId = "00000000-0000-0000-0000-000000000003";
const game: GameSummary = {
  id: gameId,
  slug: "genshin-impact",
  name: "原神",
  status: "active",
  currentRevision: "r1",
};
const searchResult: SearchResult = {
  entities: [],
  documents: [],
  segments: [],
  revision: "r1",
  revisionId,
  indexStatus: "ready",
};

const repository = {
  health: async () => ({ database: "up", currentRevision: "available", searchIndex: "ready" }),
  listGames: async () => [game],
  getGame: async (id: string) => (id === gameId ? game : null),
  getGameBySlug: async () => game,
  getCapabilities: async () => [
    { capability: "entity_search" as const, enabled: true },
    { capability: "lore_search" as const, enabled: true },
    { capability: "relationships" as const, enabled: true },
    { capability: "evidence_qa" as const, enabled: true },
  ],
  listEntities: async () => [],
  getEntity: async () => null,
  getRelationships: async () => [],
  getEntityDocuments: async () => [],
  listDocuments: async () => [],
  getDocument: async () => null,
  search: async () => searchResult,
  vectorSearch: async () => [],
  createSource: async (input) => ({ id: "00000000-0000-0000-0000-000000000004", ...input }),
  listSources: async () => [],
  getSource: async () => null,
  createSnapshot: async () => ({
    id: "00000000-0000-0000-0000-000000000005",
    sourceId: "00000000-0000-0000-0000-000000000006",
    contentHash: "hash",
    storagePath: "internal",
    capturedAt: new Date(),
    metadata: {},
  }),
  getSourceRecordHashes: async () => new Map(),
  listEmbeddingInputs: async () => [],
  storeEmbeddings: async () => undefined,
  createImport: async () => {
    throw new Error("not used");
  },
  getImport: async () => null,
  reviewImport: async () => {
    throw new Error("not used");
  },
  publishImport: async () => {
    throw new Error("not used");
  },
  listRevisions: async () => [],
  rollbackRevision: async () => {
    throw new Error("not used");
  },
  listJobs: async () => [],
  claimNextJob: async () => null,
  heartbeatJob: async () => true,
  completeJob: async () => undefined,
} satisfies KnowledgeRepository;

const testConfig = loadConfig({ NODE_ENV: "test" });

function appWith(overrides: Partial<KnowledgeRepository> = {}, config: RuntimeConfig = testConfig) {
  return createApp({ repository: { ...repository, ...overrides }, config });
}

describe("API", () => {
  it("returns stable health and readiness responses", async () => {
    const app = appWith();
    const health = await app.inject({ method: "GET", url: "/api/health" });
    const ready = await app.inject({ method: "GET", url: "/api/ready" });
    const searchReady = await app.inject({ method: "GET", url: "/api/ready/search" });
    const workerReady = await app.inject({ method: "GET", url: "/api/ready/worker" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ status: "ok", service: "api" });
    expect(ready.statusCode).toBe(200);
    expect(searchReady.statusCode).toBe(200);
    expect(workerReady.statusCode).toBe(503);
    await app.close();
  });

  it("reports a live worker heartbeat", async () => {
    const app = appWith({ workerHealth: async () => "up" });
    const response = await app.inject({ method: "GET", url: "/api/ready/worker" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ready", worker: "up" });
    await app.close();
  });

  it("uses the shared API error shape for unknown games and entities", async () => {
    const app = appWith();
    const unknownGame = await app.inject({
      method: "GET",
      url: `/api/games/00000000-0000-0000-0000-000000000099/entities/${entityId}`,
    });
    const unknownEntity = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/entities/${entityId}`,
    });
    expect(unknownGame.statusCode).toBe(404);
    expect(unknownGame.json().error.code).toBe("game_not_found");
    expect(unknownGame.json().error.requestId).toBeTruthy();
    expect(unknownEntity.statusCode).toBe(404);
    expect(unknownEntity.json().error.code).toBe("entity_not_found");
    await app.close();
  });

  it("validates search input and returns the revision contract", async () => {
    const app = appWith();
    const invalid = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/search`,
      payload: { query: "" },
    });
    const valid = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/search`,
      payload: { query: "旅行者", types: ["entity"], limit: 5 },
    });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().error.code).toBe("invalid_request");
    expect(valid.statusCode).toBe(200);
    expect(valid.json().revision).toBe("r1");
    expect(valid.json().revisionId).toBe(revisionId);
    await app.close();
  });

  it("returns index_not_ready instead of a partial search response", async () => {
    const app = appWith({
      search: async () => ({
        ...searchResult,
        revision: "",
        revisionId: undefined,
        indexStatus: "not_ready",
      }),
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/search`,
      payload: { query: "旅行者" },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("index_not_ready");
    await app.close();
  });

  it("protects production admin routes with bearer authentication", async () => {
    const config = loadConfig({ NODE_ENV: "production", ADMIN_TOKEN: "test-admin-token" });
    const app = appWith({}, config);
    const missing = await app.inject({ method: "GET", url: "/api/admin/jobs" });
    const accepted = await app.inject({
      method: "GET",
      url: "/api/admin/jobs",
      headers: { authorization: "Bearer test-admin-token" },
    });
    expect(missing.statusCode).toBe(401);
    expect(missing.json().error.code).toBe("admin_auth_required");
    expect(accepted.statusCode).toBe(200);
    await app.close();
  });

  it("enforces the local QA rate limit", async () => {
    const config = loadConfig({ NODE_ENV: "test", LOCAL_RATE_LIMIT_PER_MINUTE: "1" });
    const app = appWith({}, config);
    const first = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/qa`,
      payload: { question: "没有资料的问题" },
    });
    const second = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/qa`,
      payload: { question: "没有资料的问题" },
    });
    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(429);
    expect(second.json().error.code).toBe("rate_limited");
    await app.close();
  });

  it("does not expose unexpected internal error details", async () => {
    const app = appWith({
      getGame: async () => {
        throw new Error("postgres password /private/secret.env");
      },
    });
    const response = await app.inject({ method: "GET", url: "/api/games" });
    expect(response.statusCode).toBe(200);
    const failed = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/capabilities`,
    });
    expect(failed.statusCode).toBe(500);
    expect(failed.json().error.message).toBe("Internal server error");
    expect(JSON.stringify(failed.json())).not.toContain("private/secret");
    await app.close();
  });

  it("returns a stable error for oversized request bodies", async () => {
    const app = appWith();
    const response = await app.inject({
      method: "POST",
      url: `/api/games/${gameId}/search`,
      payload: { query: "x".repeat(1_100_000) },
    });
    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe("request_too_large");
    await app.close();
  });

  it("validates revision list filters before querying the database", async () => {
    const app = appWith();
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/revisions?gameId=not-a-uuid",
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("invalid_request");
    await app.close();
  });

  it("does not echo absolute source paths from admin responses", async () => {
    const app = appWith({
      listSources: async () => [
        {
          id: "00000000-0000-0000-0000-000000000022",
          gameId,
          name: "Fixture",
          type: "local_json",
          pathLabel: "/private/secret/fixture.json",
          enabled: true,
          parserType: "builtin",
        },
      ],
    });
    const response = await app.inject({ method: "GET", url: "/api/admin/sources" });
    expect(response.statusCode).toBe(200);
    expect(response.json().sources[0].pathLabel).toBe("fixture.json");
    expect(JSON.stringify(response.json())).not.toContain("/private/secret");
    await app.close();
  });

  it("does not expose Windows-style absolute source paths", async () => {
    const app = appWith({
      listSources: async () => [
        {
          id: "00000000-0000-0000-0000-000000000023",
          gameId,
          name: "Fixture",
          type: "local_json",
          pathLabel: "C:\\Users\\private\\fixture.json",
          enabled: true,
          parserType: "builtin",
        },
      ],
    });
    const response = await app.inject({ method: "GET", url: "/api/admin/sources" });
    expect(response.statusCode).toBe(200);
    expect(response.json().sources[0].pathLabel).toBe("fixture.json");
    expect(JSON.stringify(response.json())).not.toContain("C:\\Users\\private");
    await app.close();
  });

  it("exposes the cached acquisition status without its storage path", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gip-api-status-"));
    try {
      await mkdir(join(dataDir, "verification", "reports"), { recursive: true });
      await writeFile(
        join(dataDir, "verification", "reports", "latest-anime-status.json"),
        JSON.stringify({
          generatedAt: "2026-08-30T00:00:00.000Z",
          game: { id: gameId, slug: "genshin-impact", name: "原神" },
          conversion: {
            gameVersion: "7.0.0",
            locale: "zh-CN",
            manifestPath: `${dataDir}/manifest.json`,
          },
          latestBackup: { dumpPath: `${dataDir}/backups/gip.dump` },
          releaseGate: {
            ready: false,
            manifestComplete: true,
            sourceCoverageComplete: true,
            observationIntegrity: true,
            allSamplesProcessed: false,
            exactMatchPerCategory: { book: 0 },
            openConflicts: 0,
            conflictSelectionComplete: true,
            backupAvailable: true,
            backupAfterCurrentBatches: true,
            manualVerificationReady: false,
            blockingReasons: ["book:pending_30"],
          },
        }),
        "utf8",
      );
      const app = appWith({}, loadConfig({ NODE_ENV: "test", DATA_DIR: dataDir }));
      const response = await app.inject({
        method: "GET",
        url: `/api/admin/acquisition/status?gameId=${gameId}`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().status.releaseGate.blockingReasons).toEqual(["book:pending_30"]);
      expect(JSON.stringify(response.json())).not.toContain(dataDir);
      const mismatched = await app.inject({
        method: "GET",
        url: "/api/admin/acquisition/status?gameId=00000000-0000-0000-0000-000000000099",
      });
      expect(mismatched.statusCode).toBe(404);
      expect(mismatched.json().error.code).toBe("acquisition_status_game_mismatch");
      await app.close();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("queues real imports for the worker instead of parsing in the API", async () => {
    const sourceId = "00000000-0000-0000-0000-000000000020";
    const batchId = "00000000-0000-0000-0000-000000000021";
    const pendingBatch: ImportBatch = {
      id: batchId,
      gameId,
      sourceId,
      sourceSnapshotId: null,
      status: "pending",
      parserVersion: "1.0.0",
      successCount: 0,
      failureCount: 0,
      errors: [],
      warnings: [],
      confirmedDeletionKeys: [],
      createdAt: new Date(),
      completedAt: null,
    };
    let queued: Record<string, unknown> | undefined;
    const app = appWith({
      getSource: async () => ({
        id: sourceId,
        gameId,
        name: "Fixture",
        type: "local_json",
        pathLabel: "fixture.json",
        enabled: true,
        parserType: "builtin",
      }),
      createPendingImport: async () => pendingBatch,
      enqueueJob: async (job) => {
        queued = job;
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/imports",
      payload: { gameId, sourceId, path: "/private/fixture.json" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("pending");
    expect(queued).toMatchObject({
      type: "parse_import",
      idempotencyKey: `parse_import:${batchId}`,
      payload: { batchId, gameId, sourceId, path: "/private/fixture.json" },
    });
    await app.close();
  });

  it("lists existing import batches for the admin review picker", async () => {
    const batch: ImportBatch = {
      id: "00000000-0000-0000-0000-000000000029",
      gameId,
      sourceId: "00000000-0000-0000-0000-000000000030",
      sourceSnapshotId: null,
      status: "review_required",
      parserVersion: "test",
      successCount: 3,
      failureCount: 0,
      errors: [],
      warnings: [],
      confirmedDeletionKeys: [],
      createdAt: new Date(),
      completedAt: null,
    };
    const app = appWith({ listImports: async () => [batch] });
    const response = await app.inject({
      method: "GET",
      url: `/api/admin/imports?gameId=${gameId}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().imports[0]).toMatchObject({ id: batch.id, status: batch.status });
    await app.close();
  });

  it("exposes verification runs and accepts scoped item updates", async () => {
    const batchId = "00000000-0000-0000-0000-000000000021";
    const itemId = "00000000-0000-0000-0000-000000000022";
    let update: Record<string, unknown> | undefined;
    const app = appWith({
      getVerificationRun: async () => ({
        id: "00000000-0000-0000-0000-000000000024",
        batchId,
        upstreamCommit: "26df1dfb",
        expectedGameVersion: "7.0.0",
        expectedLocale: "zh-CN",
        seed: "26df1dfb",
        status: "pending",
        createdAt: new Date(),
        items: [],
      }),
      updateVerificationItem: async (input) => {
        update = input;
        return {
          id: input.itemId,
          runId: "00000000-0000-0000-0000-000000000024",
          category: "book",
          canonicalKey: "book/1",
          title: "书籍",
          ...input,
          required: true,
          screenshotCount: 0,
        };
      },
    });
    const run = await app.inject({
      method: "GET",
      url: `/api/admin/imports/${batchId}/verification`,
    });
    const response = await app.inject({
      method: "PATCH",
      url: `/api/admin/verification/items/${itemId}`,
      payload: {
        status: "exact_match",
        channel: "game_client",
        checkedGameVersion: "7.0.0",
        checkedLocale: "zh-CN",
      },
    });
    expect(run.statusCode).toBe(200);
    expect(response.statusCode).toBe(200);
    expect(update).toMatchObject({ itemId, status: "exact_match", channel: "game_client" });
    await app.close();
  });

  it("lists and resolves conflict cases", async () => {
    const conflictId = "00000000-0000-0000-0000-000000000025";
    let resolution = "";
    let selectedObservationId = "";
    const conflict = {
      id: conflictId,
      gameId,
      canonicalKey: "book/1",
      gameVersion: "7.0.0",
      locale: "zh-CN",
      kind: "content_conflict" as const,
      status: "open" as const,
      observationIds: [],
      createdAt: new Date(),
    };
    const app = appWith({
      listConflicts: async () => [conflict],
      getConflict: async () => ({
        ...conflict,
        observations: [
          {
            id: "00000000-0000-0000-0000-000000000031",
            sourceId: "00000000-0000-0000-0000-000000000032",
            sourceSnapshotId: "00000000-0000-0000-0000-000000000033",
            canonicalKey: conflict.canonicalKey,
            category: "book",
            gameVersion: conflict.gameVersion,
            locale: conflict.locale,
            title: "测试卷册",
            body: "来源正文",
            rawContentHash: "raw",
            normalizedContentHash: "normalized",
          },
        ],
      }),
      resolveConflict: async (_id, reason, selected) => {
        resolution = reason;
        selectedObservationId = selected ?? "";
        return {
          ...conflict,
          status: "resolved",
          resolution: reason,
          selectedObservationId: selected,
          resolvedAt: new Date(),
        };
      },
    });
    const list = await app.inject({
      method: "GET",
      url: `/api/admin/conflicts?gameId=${gameId}&status=open`,
    });
    const resolved = await app.inject({
      method: "POST",
      url: `/api/admin/conflicts/${conflictId}/resolve`,
      payload: {
        resolution: "正式服原文优先",
        selectedObservationId: "00000000-0000-0000-0000-000000000031",
      },
    });
    const detail = await app.inject({
      method: "GET",
      url: `/api/admin/conflicts/${conflictId}`,
    });
    expect(list.statusCode).toBe(200);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().conflict.observations[0].body).toBe("来源正文");
    expect(resolved.statusCode).toBe(200);
    expect(resolution).toBe("正式服原文优先");
    expect(selectedObservationId).toBe("00000000-0000-0000-0000-000000000031");
    await app.close();
  });

  it("returns field-level provenance without absolute paths", async () => {
    const documentId = "00000000-0000-0000-0000-000000000026";
    const provenanceDocument: DocumentDetail = {
      id: documentId,
      sourceKey: "book/1",
      sourceVersion: "7.0.0",
      title: "测试卷册",
      type: "book",
      gameVersion: "7.0.0",
      body: "正文",
      sourceName: "AnimeGameData",
      sourceId: "00000000-0000-0000-0000-000000000027",
      provenance: {
        upstreamSource: "AnimeGameData",
        upstreamCommit: "26df1dfbdf05a82bbb1d97506859f3e1c40718d8",
        upstreamVersionLabel: "CNRELWin7.0.0",
        locale: "zh-CN",
        canonicalKey: "book/1",
        sourceFiles: ["ExcelBinOutput/BooksCodex.json"],
        lineage: {
          title: { relativeFile: "ExcelBinOutput/BooksCodex.json", upstreamId: 1 },
        },
        textMapHashes: { title: 123, body: [456, 789] },
        rawContentHash: "raw",
        normalizedContentHash: "normalized",
      },
      segments: [],
    };
    const app = appWith({ getDocument: async () => provenanceDocument });
    const response = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/documents/${documentId}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().document.provenance.canonicalKey).toBe("book/1");
    expect(response.json().document.provenance.lineage.title.relativeFile).toBe(
      "ExcelBinOutput/BooksCodex.json",
    );
    expect(response.json().document.provenance.textMapHashes.body).toEqual([456, 789]);
    expect(JSON.stringify(response.json())).not.toContain("/Volumes/Lark");
    await app.close();
  });

  it("exposes the release-candidate build and promotion contract", async () => {
    const candidateId = "00000000-0000-0000-0000-000000000040";
    const buildId = "00000000-0000-0000-0000-000000000041";
    const batchId = "00000000-0000-0000-0000-000000000042";
    const checksum = "a".repeat(64);
    const now = new Date("2026-08-30T00:00:00Z");
    const candidate = {
      id: candidateId,
      gameId,
      name: "RC 7.0",
      baseRevisionId: revisionId,
      importBatchIds: [batchId],
      status: "preview_ready" as const,
      currentBuildId: buildId,
      promotedRevisionId: null,
      createdAt: now,
      updatedAt: now,
    };
    let promotionInput: Record<string, unknown> | undefined;
    const app = appWith({
      createReleaseCandidate: async (input) => ({ ...candidate, ...input, status: "draft" }),
      listReleaseCandidates: async () => [candidate],
      getReleaseCandidate: async () => ({ ...candidate, builds: [] }),
      buildReleaseCandidate: async () => ({
        id: buildId,
        candidateId,
        buildNumber: 1,
        status: "ready",
        contentChecksum: checksum,
        recordCount: 12,
        createdAt: now,
      }),
      getReleaseCandidateReadiness: async () => ({
        candidateId,
        buildId,
        contentChecksum: checksum,
        ready: true,
        blockingReasons: [],
      }),
      promoteReleaseCandidate: async (input) => {
        promotionInput = input;
        return {
          id: revisionId,
          gameId,
          revisionNumber: 2,
          sourceBatchId: batchId,
          releaseNote: input.releaseNote,
          publishedAt: now,
          isCurrent: true,
          indexStatus: "pending",
          lifecycleStatus: "published",
        };
      },
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/admin/release-candidates",
      payload: { gameId, name: "RC 7.0", importBatchIds: [batchId] },
    });
    const built = await app.inject({
      method: "POST",
      url: `/api/admin/release-candidates/${candidateId}/builds`,
    });
    const readiness = await app.inject({
      method: "GET",
      url: `/api/admin/release-candidates/${candidateId}/readiness`,
    });
    const promoted = await app.inject({
      method: "POST",
      url: `/api/admin/release-candidates/${candidateId}/promote`,
      payload: {
        buildId,
        contentChecksum: checksum,
        expectedCurrentRevisionId: revisionId,
        releaseNote: "release 7.0",
        idempotencyKey: "promote-rc-7.0-build-1",
      },
    });
    expect(created.statusCode).toBe(201);
    expect(built.statusCode).toBe(201);
    expect(readiness.json().ready).toBe(true);
    expect(promoted.statusCode).toBe(200);
    expect(promotionInput).toMatchObject({ candidateId, buildId, contentChecksum: checksum });
    await app.close();
  });

  it("validates candidate checksums before invoking promotion", async () => {
    let called = false;
    const app = appWith({
      promoteReleaseCandidate: async () => {
        called = true;
        throw new Error("must not be called");
      },
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/release-candidates/00000000-0000-0000-0000-000000000040/promote",
      payload: {
        buildId: "00000000-0000-0000-0000-000000000041",
        contentChecksum: "not-a-checksum",
        idempotencyKey: "promote-invalid",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(called).toBe(false);
    await app.close();
  });

  it("serves isolated preview entities and documents for a candidate build", async () => {
    const buildId = "00000000-0000-0000-0000-000000000041";
    const candidateId = "00000000-0000-0000-0000-000000000040";
    const app = appWith({
      getReleaseCandidateBuild: async () => ({
        id: buildId,
        candidateId,
        buildNumber: 1,
        status: "ready",
        contentChecksum: "a".repeat(64),
        recordCount: 2,
        createdAt: new Date("2026-08-30T00:00:00Z"),
        gameId,
        normalizedRecords: [
          {
            sourceKey: "entities/traveler",
            recordType: "entity",
            entityType: "character",
            title: "旅行者",
            body: "从世界之外来到提瓦特的旅行者。",
            metadata: { element: "variable" },
            contentHash: "hash-traveler",
            parserVersion: "1.0.0",
          },
          {
            sourceKey: "lore/first-steps",
            recordType: "document",
            documentType: "lore",
            title: "踏入提瓦特",
            body: "旅行者在提瓦特寻找失散的血亲。",
            metadata: {},
            contentHash: "hash-lore",
            parserVersion: "1.0.0",
          },
        ],
      }),
    });
    const entityRes = await app.inject({
      method: "GET",
      url: `/api/admin/previews/${buildId}/entities`,
    });
    const docRes = await app.inject({
      method: "GET",
      url: `/api/admin/previews/${buildId}/documents`,
    });
    expect(entityRes.statusCode).toBe(200);
    expect(entityRes.json().entities).toHaveLength(1);
    expect(entityRes.json().entities[0].name).toBe("旅行者");
    expect(docRes.statusCode).toBe(200);
    expect(docRes.json().documents).toHaveLength(1);
    expect(docRes.json().documents[0].title).toBe("踏入提瓦特");
    await app.close();
  });

  it("stores and hashes PNG screenshot evidence under the data directory", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gip-api-verification-"));
    const itemId = "00000000-0000-0000-0000-000000000028";
    let screenshot: Record<string, unknown> | undefined;
    const app = appWith(
      {
        addVerificationScreenshot: async (input) => {
          screenshot = input;
        },
      },
      { ...testConfig, dataDir },
    );
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const response = await app.inject({
      method: "POST",
      url: `/api/admin/verification/items/${itemId}/screenshots`,
      payload: { mimeType: "image/png", dataBase64: png },
    });
    expect(response.statusCode).toBe(200);
    expect(screenshot).toMatchObject({ itemId, mimeType: "image/png" });
    const body = Buffer.from(png, "base64");
    const expectedHash = createHash("sha256").update(body).digest("hex");
    expect(response.json().sha256).toBe(expectedHash);
    const saved = await readFile(join(dataDir, response.json().relativePath));
    expect(saved.equals(body)).toBe(true);
    expect(response.json().relativePath).toBe(`verification/${itemId}/${expectedHash}.png`);
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it("removes a newly written screenshot when persistence fails", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gip-api-verification-cleanup-"));
    const itemId = "00000000-0000-0000-0000-000000000028";
    const app = appWith(
      {
        addVerificationScreenshot: async () => {
          throw new Error("database write failed");
        },
      },
      { ...testConfig, dataDir },
    );
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const body = Buffer.from(png, "base64");
    const expectedHash = createHash("sha256").update(body).digest("hex");
    const response = await app.inject({
      method: "POST",
      url: `/api/admin/verification/items/${itemId}/screenshots`,
      payload: { mimeType: "image/png", dataBase64: png },
    });
    expect(response.statusCode).toBe(500);
    await expect(
      readFile(join(dataDir, "verification", itemId, `${expectedHash}.png`)),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
});
