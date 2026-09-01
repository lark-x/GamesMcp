import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, type RuntimeConfig } from "@gip/config";
import type { GameSummary, SearchResult } from "@gip/contracts";
import type {
  DocumentDetail,
  GenshinStructuredRepository,
  ImportBatch,
  KnowledgeRepository,
} from "@gip/domain";
import { createApp } from "./app.js";

const gameId = "00000000-0000-0000-0000-000000000001";
const sourceId = "00000000-0000-0000-0000-000000000030";
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

const unusedGenshinWrite = async () => {
  throw new Error("not used");
};

const genshinRepository = {
  upsertCharacter: unusedGenshinWrite,
  getCharacter: async () => null,
  listCharacters: async () => [],
  upsertWeapon: unusedGenshinWrite,
  getWeapon: async () => null,
  listWeapons: async () => [],
  upsertArtifactSet: unusedGenshinWrite,
  getArtifactSet: async () => null,
  listArtifactSets: async () => [],
  upsertArtifact: unusedGenshinWrite,
  getArtifact: async () => null,
  listArtifacts: async () => [],
  upsertMaterial: unusedGenshinWrite,
  getMaterial: async () => null,
  listMaterials: async () => [],
  upsertAchievement: unusedGenshinWrite,
  getAchievement: async () => null,
  listAchievements: async () => [],
  upsertEnemy: unusedGenshinWrite,
  getEnemy: async () => null,
  listEnemies: async () => [],
} satisfies GenshinStructuredRepository;

const repository = {
  genshin: genshinRepository,
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
  getArchiveHome: async () => ({
    gameId,
    revision: "r1",
    locale: "zh-CN",
    categories: [
      {
        id: "quests",
        label: "任务剧情",
        description: "任务文本",
        count: 1,
        entries: [
          {
            id: "doc-1",
            name: "捕风的异乡人",
            kind: "document" as const,
            type: "archon_quest",
            locale: "zh-CN",
          },
        ],
      },
    ],
  }),
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
  return createApp({
    repository: { ...repository, ...overrides, genshin: overrides.genshin ?? repository.genshin },
    config,
  });
}

describe("API", () => {
  it("serves the lightweight game-like archive home", async () => {
    const app = appWith();
    const response = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/home?locale=zh-CN`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().categories[0].entries[0].name).toBe("捕风的异乡人");
    expect(JSON.stringify(response.json())).not.toContain("sourceKey");
    await app.close();
  });

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

  it("serves quest search and paginated quest details", async () => {
    const app = appWith({
      searchQuests: async () => [
        {
          questKey: "quest/1001",
          mainQuestId: "1001",
          title: "捕风的异乡人",
          type: "archon_quest",
          chapter: "序章",
          series: "Prologue",
          completeness: "complete",
          locale: "zh-CN",
          documentId: "00000000-0000-0000-0000-000000000020",
          revision: "r1",
        },
      ],
      getQuest: async () => ({
        questKey: "quest/1001",
        title: "捕风的异乡人",
        type: "archon_quest",
        locale: "zh-CN",
        gameVersion: "7.0.0",
        documentId: "00000000-0000-0000-0000-000000000020",
        revision: "r1",
        completeness: "complete",
        subquests: [
          {
            subquestKey: "quest/1001/subquest/100101",
            subquestId: "100101",
            title: "与派蒙同行",
            order: 0,
            completeness: "complete",
          },
        ],
        dialogueNodes: [
          {
            nodeKey: "quest/1001/dialog/1",
            nodeId: "1",
            type: "dialogue",
            subquestKey: "quest/1001/subquest/100101",
            speakerName: "派蒙",
            body: "旅行者，我们出发吧。",
          },
        ],
        dialogueEdges: [],
        participants: [],
        prerequisites: [],
        citations: [
          {
            documentId: "00000000-0000-0000-0000-000000000020",
            locale: "zh-CN",
            questKey: "quest/1001",
            dialogueNodeKey: "quest/1001/dialog/1",
            revision: "r1",
          },
        ],
        warnings: [],
        nextCursor: null,
      }),
    });
    const search = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/quests?q=%E6%8D%95%E9%A3%8E&locale=zh-CN`,
    });
    const detail = await app.inject({
      method: "GET",
      url: `/api/games/${gameId}/quests/1001?locale=zh-CN&limit=1`,
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().quests[0].questKey).toBe("quest/1001");
    expect(detail.statusCode).toBe(200);
    expect(detail.json().quest.dialogueNodes[0].nodeKey).toBe("quest/1001/dialog/1");
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
      payload: { gameId, sourceId, path: join(testConfig.dataDir, "imports", "fixture.json") },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("pending");
    expect(queued).toMatchObject({
      type: "parse_import",
      idempotencyKey: `parse_import:${batchId}`,
      payload: {
        batchId,
        gameId,
        sourceId,
        path: join(testConfig.dataDir, "imports", "fixture.json"),
      },
    });
    await app.close();
  });

  it("rejects import paths outside the import root", async () => {
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
    });
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/imports",
      payload: { gameId, sourceId, path: "/etc/passwd" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("path_outside_import_root");
    await app.close();
  });

  it("accepts uploaded import files and stages them under the import root", async () => {
    const pendingBatch: ImportBatch = {
      id: "00000000-0000-0000-0000-000000000041",
      gameId,
      sourceId: "00000000-0000-0000-0000-000000000030",
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
    const content = Buffer.from(JSON.stringify([{ id: "a" }])).toString("base64");
    const response = await app.inject({
      method: "POST",
      url: "/api/admin/imports",
      payload: {
        gameId,
        sourceId,
        files: [{ name: "fixture.json", contentBase64: content }],
      },
    });
    expect(response.statusCode).toBe(200);
    const payloadPath = (queued?.payload as { path?: string } | undefined)?.path;
    expect(payloadPath).toContain(join(testConfig.dataDir, "imports", "uploads"));
    expect(payloadPath?.endsWith("fixture.json")).toBe(true);
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
    expect(run.statusCode).toBe(410);
    expect(response.statusCode).toBe(410);
    expect(update).toBeUndefined();
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

  it("creates a patch and immediately returns the immutable successor Build", async () => {
    const candidateId = "00000000-0000-0000-0000-000000000040";
    const issueId = "00000000-0000-0000-0000-000000000042";
    const buildId = "00000000-0000-0000-0000-000000000043";
    const now = new Date("2026-08-31T00:00:00Z");
    let built = false;
    const app = appWith({
      createCandidatePatch: async (input) => ({
        id: "00000000-0000-0000-0000-000000000044",
        candidateId,
        issueId: input.issueId,
        canonicalKey: input.canonicalKey,
        action: input.action,
        createdAt: now,
      }),
      buildReleaseCandidate: async () => {
        built = true;
        return {
          id: buildId,
          candidateId,
          buildNumber: 2,
          status: "ready",
          contentChecksum: "a".repeat(64),
          recordCount: 1,
          createdAt: now,
        };
      },
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/admin/release-candidates/${candidateId}/patches`,
      payload: {
        issueId,
        canonicalKey: "character/amber",
        action: "use_incoming",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().patch.issueId).toBe(issueId);
    expect(response.json().build).toMatchObject({ id: buildId, buildNumber: 2 });
    expect(built).toBe(true);
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
            sourceKey: "genshin-db/characters/traveler",
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
    const filteredRes = await app.inject({
      method: "GET",
      url: `/api/admin/previews/${buildId}/records?category=characters&q=traveler&limit=50`,
    });
    expect(filteredRes.statusCode).toBe(200);
    expect(filteredRes.json().total).toBe(1);
    expect(filteredRes.json().records[0].sourceKey).toBe("genshin-db/characters/traveler");
    await app.close();
  });

  it("serves isolated preview quest search and paginated quest reads", async () => {
    const buildId = "00000000-0000-0000-0000-000000000041";
    const candidateId = "00000000-0000-0000-0000-000000000040";
    const app = appWith({
      getReleaseCandidateBuild: async () => ({
        id: buildId,
        candidateId,
        buildNumber: 7,
        status: "ready",
        contentChecksum: "a".repeat(64),
        recordCount: 1,
        createdAt: new Date("2026-08-30T00:00:00Z"),
        gameId,
        normalizedRecords: [
          {
            sourceKey: "quest/1001/locale/zh-CN",
            recordType: "document",
            documentType: "archon_quest",
            title: "捕风的异乡人",
            body: "派蒙：我们到了。\n旅行者：出发。",
            gameVersion: "7.0.0",
            locale: "zh-CN",
            segments: [
              {
                segmentKey: "quest/1001/dialog/1",
                ordinal: 0,
                body: "派蒙：我们到了。",
                startOffset: 0,
                endOffset: 8,
              },
              {
                segmentKey: "quest/1001/dialog/2",
                ordinal: 1,
                body: "旅行者：出发。",
                startOffset: 9,
                endOffset: 16,
              },
            ],
            quest: {
              questKey: "quest/1001",
              mainQuestId: "1001",
              questType: "archon_quest",
              locale: "zh-CN",
              chapter: "序章",
              series: "捕风的异乡人",
              completeness: "complete",
              subquests: [
                {
                  subquestKey: "quest/1001/subquest/100101",
                  subquestId: "100101",
                  order: 1,
                  title: "鸟瞰风物",
                  completeness: "complete",
                },
              ],
              dialogueNodes: [
                {
                  nodeKey: "quest/1001/dialog/1",
                  nodeId: "1",
                  type: "dialogue",
                  speakerKey: "npc/1",
                  speakerName: "派蒙",
                  body: "派蒙：我们到了。",
                  subquestKey: "quest/1001/subquest/100101",
                  segmentKey: "quest/1001/dialog/1",
                  order: 0,
                },
                {
                  nodeKey: "quest/1001/dialog/2",
                  nodeId: "2",
                  type: "player_choice",
                  body: "旅行者：出发。",
                  subquestKey: "quest/1001/subquest/100101",
                  segmentKey: "quest/1001/dialog/2",
                  order: 1,
                },
              ],
              dialogueEdges: [
                {
                  fromNodeKey: "quest/1001/dialog/1",
                  toNodeKey: "quest/1001/dialog/2",
                  type: "next",
                },
              ],
            },
            entities: [{ sourceKey: "npc/1", type: "npc", name: "派蒙", aliases: [] }],
            metadata: { provenance: { upstreamCommit: "commit" } },
            contentHash: "hash-quest",
            parserVersion: "anime-game-data-quests-v0",
          },
        ],
      }),
    });
    const search = await app.inject({
      method: "GET",
      url: `/api/admin/previews/${buildId}/quests?q=捕风&locale=zh-CN`,
    });
    expect(search.statusCode).toBe(200);
    expect(search.json().preview).toBe(true);
    expect(search.json().quests[0]).toMatchObject({
      questKey: "quest/1001",
      revision: "preview:7",
      locale: "zh-CN",
    });

    const page1 = await app.inject({
      method: "GET",
      url: `/api/admin/previews/${buildId}/quests/1001?locale=zh-CN&limit=1`,
    });
    expect(page1.statusCode).toBe(200);
    expect(page1.json().quest.dialogueNodes).toHaveLength(1);
    expect(page1.json().quest.citations[0].dialogueNodeKey).toBe("quest/1001/dialog/1");
    expect(page1.json().quest.nextCursor).toBeTruthy();

    const page2 = await app.inject({
      method: "GET",
      url: `/api/admin/previews/${buildId}/quests/1001?locale=zh-CN&cursor=${encodeURIComponent(
        page1.json().quest.nextCursor,
      )}`,
    });
    expect(page2.statusCode).toBe(200);
    expect(page2.json().quest.dialogueNodes[0].nodeKey).toBe("quest/1001/dialog/2");
    await app.close();
  });

  it("lists review issues across release candidates for the issue workbench", async () => {
    const candidateId = "00000000-0000-0000-0000-000000000040";
    const issueId = "00000000-0000-0000-0000-000000000042";
    const now = new Date("2026-08-31T00:00:00Z");
    const app = appWith({
      listReleaseCandidates: async () => [
        {
          id: candidateId,
          gameId,
          name: "RC 1",
          importBatchIds: [],
          status: "preview_ready",
          createdAt: now,
          updatedAt: now,
        },
      ],
      listReviewIssues: async (requestedCandidateId) =>
        requestedCandidateId === candidateId
          ? [
              {
                id: issueId,
                gameId,
                candidateId,
                canonicalKey: "character/amber",
                kind: "content_error",
                status: "open",
                blocking: true,
                fingerprint: "fingerprint",
                summary: "文本错误",
                details: {},
                createdAt: now,
                updatedAt: now,
              },
            ]
          : [],
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/admin/review-issues?status=open",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().issues).toHaveLength(1);
    expect(response.json().issues[0]).toMatchObject({ id: issueId, candidateId });
    await app.close();
  });

  it("accepts review screenshots only with provenance metadata and matching image bytes", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gip-review-evidence-"));
    const issueId = "00000000-0000-0000-0000-000000000042";
    let stored: Record<string, unknown> | undefined;
    const app = appWith(
      {
        addReviewEvidence: async (input) => {
          stored = input;
          return {
            id: "00000000-0000-0000-0000-000000000045",
            ...input,
            createdAt: new Date("2026-08-31T00:00:00Z"),
          };
        },
      },
      { ...testConfig, dataDir },
    );
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    const missingNote = await app.inject({
      method: "POST",
      url: `/api/admin/review-issues/${issueId}/evidence`,
      payload: {
        mimeType: "image/png",
        dataBase64: png,
        checkedGameVersion: "7.0",
        checkedLocale: "zh-CN",
        note: "",
      },
    });
    expect(missingNote.statusCode).toBe(400);
    const mismatchedBytes = await app.inject({
      method: "POST",
      url: `/api/admin/review-issues/${issueId}/evidence`,
      payload: {
        mimeType: "image/jpeg",
        dataBase64: png,
        checkedGameVersion: "7.0",
        checkedLocale: "zh-CN",
        note: "客户端角色详情截图",
      },
    });
    expect(mismatchedBytes.statusCode).toBe(400);
    const accepted = await app.inject({
      method: "POST",
      url: `/api/admin/review-issues/${issueId}/evidence`,
      payload: {
        mimeType: "image/png",
        dataBase64: png,
        checkedGameVersion: "7.0",
        checkedLocale: "zh-CN",
        note: "客户端角色详情截图",
      },
    });
    expect(accepted.statusCode).toBe(200);
    expect(stored).toMatchObject({
      issueId,
      mimeType: "image/png",
      checkedGameVersion: "7.0",
      checkedLocale: "zh-CN",
      note: "客户端角色详情截图",
    });
    expect(String(stored?.sha256)).toMatch(/^[a-f0-9]{64}$/);
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
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
    expect(response.statusCode).toBe(410);
    expect(screenshot).toBeUndefined();
    expect(response.json().error.code).toBe("legacy_verification_retired");
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
    const response = await app.inject({
      method: "POST",
      url: `/api/admin/verification/items/${itemId}/screenshots`,
      payload: { mimeType: "image/png", dataBase64: png },
    });
    expect(response.statusCode).toBe(410);
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });
});
