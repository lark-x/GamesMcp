import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import cors from "@fastify/cors";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import { loadConfig, type RuntimeConfig } from "@gip/config";
import {
  documentIdSchema,
  documentTypeSchema,
  entityIdSchema,
  entityTypeSchema,
  gameIdSchema,
  revisionIdSchema,
  relationshipPredicateSchema,
  qaRequestSchema,
  reviewRequestSchema,
  resolveConflictSchema,
  rollbackRequestSchema,
  searchRequestSchema,
  screenshotUploadSchema,
  updateVerificationItemSchema,
} from "@gip/contracts";
import {
  DomainError,
  KnowledgeService,
  type KnowledgeRepository,
  type ImportBatch,
  type Source,
} from "@gip/domain";
import {
  PARSER_VERSION,
  adapterFor,
  computeDiff,
  normalizeSnapshot,
  validateImport,
  type SourceType,
} from "@gip/ingestion";
import { EvidenceQaService } from "@gip/qa";
import { OpenAICompatibleEmbeddingProvider, RetrievalService } from "@gip/retrieval";

export type AppDependencies = {
  repository: KnowledgeRepository;
  config?: RuntimeConfig;
};

function parseIdParams(request: FastifyRequest): {
  gameId: string;
  entityId?: string;
  documentId?: string;
  batchId?: string;
  revisionId?: string;
  itemId?: string;
  screenshotId?: string;
  issueId?: string;
  evidenceId?: string;
  conflictId?: string;
  candidateId?: string;
  buildId?: string;
} {
  const params = request.params as {
    gameId?: unknown;
    entityId?: unknown;
    documentId?: unknown;
    batchId?: unknown;
    revisionId?: unknown;
    itemId?: unknown;
    screenshotId?: unknown;
    issueId?: unknown;
    evidenceId?: unknown;
    conflictId?: unknown;
    candidateId?: unknown;
    buildId?: unknown;
  };
  return {
    gameId: params.gameId === undefined ? "" : gameIdSchema.parse(params.gameId),
    entityId: params.entityId === undefined ? undefined : entityIdSchema.parse(params.entityId),
    documentId:
      params.documentId === undefined ? undefined : documentIdSchema.parse(params.documentId),
    batchId: params.batchId === undefined ? undefined : z.string().uuid().parse(params.batchId),
    revisionId:
      params.revisionId === undefined ? undefined : revisionIdSchema.parse(params.revisionId),
    itemId: params.itemId === undefined ? undefined : z.string().uuid().parse(params.itemId),
    screenshotId:
      params.screenshotId === undefined ? undefined : z.string().uuid().parse(params.screenshotId),
    issueId: params.issueId === undefined ? undefined : z.string().uuid().parse(params.issueId),
    evidenceId:
      params.evidenceId === undefined ? undefined : z.string().uuid().parse(params.evidenceId),
    conflictId:
      params.conflictId === undefined ? undefined : z.string().uuid().parse(params.conflictId),
    candidateId:
      params.candidateId === undefined ? undefined : z.string().uuid().parse(params.candidateId),
    buildId: params.buildId === undefined ? undefined : z.string().uuid().parse(params.buildId),
  };
}

function parseQuery(request: FastifyRequest): Record<string, unknown> {
  return request.query as Record<string, unknown>;
}

function safeBatch(batch: ImportBatch) {
  return {
    id: batch.id,
    gameId: batch.gameId,
    sourceId: batch.sourceId,
    sourceSnapshotId: batch.sourceSnapshotId,
    status: batch.status,
    parserVersion: batch.parserVersion,
    successCount: batch.successCount,
    failureCount: batch.failureCount,
    errors: batch.errors,
    warnings: batch.warnings,
    diff: batch.diff,
    reviewNote: batch.reviewNote,
    createdAt: batch.createdAt,
    completedAt: batch.completedAt,
  };
}

function safeSource(source: Source) {
  return {
    id: source.id,
    gameId: source.gameId,
    name: source.name,
    type: source.type,
    pathLabel: safePathLabel(source.pathLabel),
    licenseNote: source.licenseNote,
    enabled: source.enabled,
    parserType: source.parserType,
  };
}

function safePathLabel(value: string): string {
  return basename(value.replaceAll("\\", "/"));
}

function safeReportPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((part) => part === "..")
  )
    return undefined;
  return normalized;
}

function safeAcquisitionStatus(value: Record<string, unknown>): Record<string, unknown> {
  const result = { ...value };
  const conversion = value.conversion;
  if (conversion && typeof conversion === "object" && !Array.isArray(conversion)) {
    const conversionRecord = conversion as Record<string, unknown>;
    result.conversion = {
      ...conversionRecord,
      manifestPath: safeReportPath(conversionRecord.manifestPath),
    };
  }
  const latestBackup = value.latestBackup;
  if (latestBackup && typeof latestBackup === "object" && !Array.isArray(latestBackup)) {
    const backupRecord = latestBackup as Record<string, unknown>;
    result.latestBackup = {
      ...backupRecord,
      dumpPath: safeReportPath(backupRecord.dumpPath),
    };
  }
  return result;
}

function parsePositive(value: unknown, fallback: number, maximum: number): number {
  const number = Number(value ?? fallback);
  return Number.isInteger(number) && number > 0 ? Math.min(number, maximum) : fallback;
}

export function createApp({ repository, config = loadConfig() }: AppDependencies): FastifyInstance {
  const app = Fastify({
    bodyLimit: 1_000_000,
    logger: { redact: ["req.headers.authorization", "*.apiKey", "*.prompt"] },
  });
  const domain = new KnowledgeService(repository);
  const embeddingProvider =
    config.embedding.modelId && config.embedding.modelVersion && config.llm.baseUrl
      ? new OpenAICompatibleEmbeddingProvider({
          baseUrl: config.llm.baseUrl,
          apiKey: config.llm.apiKey,
          model: config.embedding.modelId,
          modelVersion: config.embedding.modelVersion,
          dimension: config.embedding.dimension,
          timeoutMs: config.llm.timeoutMs,
        })
      : undefined;
  const retrieval = new RetrievalService(repository, embeddingProvider);
  const qa = new EvidenceQaService(repository, config);
  const rateBuckets = new Map<string, { windowStartedAt: number; count: number }>();

  app.register(cors, { origin: config.corsOrigins });

  app.addHook("onRequest", async (request, reply) => {
    request.headers["x-request-id"] ??= randomUUID();
    if (config.nodeEnv === "production" && request.url.startsWith("/api/admin")) {
      const authorization = request.headers.authorization;
      if (!config.adminToken || authorization !== `Bearer ${config.adminToken}`) {
        throw new DomainError(
          "admin_auth_required",
          "Administrator authentication is required",
          undefined,
          401,
        );
      }
    }
    const routePath = request.url.split("?", 1)[0] ?? request.url;
    if (
      /^\/api\/admin\/verification(?:\/|$)/.test(routePath) ||
      /^\/api\/admin\/imports\/[^/]+\/verification(?:\/|$)/.test(routePath)
    )
      throw new DomainError(
        "legacy_verification_retired",
        "Fixed-sample verification was replaced by issue-driven Candidate review",
        { replacement: "/api/admin/release-candidates/:candidateId/issues" },
        410,
      );
    if (request.method === "POST" && request.url.split("?", 1)[0]?.endsWith("/qa")) {
      const now = Date.now();
      const key = request.ip;
      const existing = rateBuckets.get(key);
      const bucket =
        !existing || now - existing.windowStartedAt >= 60_000
          ? { windowStartedAt: now, count: 0 }
          : existing;
      bucket.count += 1;
      rateBuckets.set(key, bucket);
      if (rateBuckets.size > 1_000) {
        for (const [bucketKey, value] of rateBuckets)
          if (now - value.windowStartedAt >= 60_000) rateBuckets.delete(bucketKey);
      }
      if (bucket.count > config.localRateLimitPerMinute) {
        reply.header("retry-after", "60");
        throw new DomainError("rate_limited", "Too many question requests", undefined, 429);
      }
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = String(request.headers["x-request-id"] ?? randomUUID());
    if (error instanceof DomainError) {
      reply.code(error.statusCode).send({
        error: {
          code: error.code,
          message: error.message,
          requestId,
          ...(error.details === undefined ? {} : { details: error.details }),
        },
      });
      return;
    }
    if (error instanceof z.ZodError) {
      reply.code(400).send({
        error: {
          code: "invalid_request",
          message: "Request validation failed",
          requestId,
          details: error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
        },
      });
      return;
    }
    if ((error as { code?: unknown }).code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      reply.code(413).send({
        error: {
          code: "request_too_large",
          message: "Request body is too large",
          requestId,
        },
      });
      return;
    }
    request.log.error({ requestId, code: "internal_error" }, "request failed");
    reply
      .code(500)
      .send({ error: { code: "internal_error", message: "Internal server error", requestId } });
  });

  app.get("/api/health", async () => ({ status: "ok", service: "api" }));
  app.get("/api/ready", async (_request, reply) => {
    const health = await repository.health();
    if (health.database === "down" || health.currentRevision === "missing")
      return reply.code(503).send({ status: "not_ready", ...health });
    return { status: "ready", ...health };
  });
  app.get("/api/ready/search", async (_request, reply) => {
    const health = await repository.health();
    if (health.searchIndex !== "ready")
      return reply.code(503).send({ status: "not_ready", search: health.searchIndex });
    return { status: "ready", search: "ready" };
  });
  app.get("/api/ready/worker", async (_request, reply) => {
    const worker = repository.workerHealth ? await repository.workerHealth() : "not_ready";
    if (worker !== "up") return reply.code(503).send({ status: "not_ready", worker });
    return { status: "ready", worker };
  });
  app.get("/api/ready/llm", async (_request, reply) => {
    const llmReady = Boolean(config.llm.baseUrl && config.llm.modelId);
    if (!llmReady) return reply.code(503).send({ status: "not_ready", llm: "not_configured" });
    return { status: "configured", llm: "configured" };
  });

  app.get("/api/games", async () => ({ games: await domain.listGames() }));
  app.get("/api/games/:gameId/sources", async (request) => {
    const { gameId } = parseIdParams(request);
    await domain.requireGame(gameId);
    const sources = await repository.listSources(gameId);
    return {
      sources: sources.map((source) => ({ id: source.id, name: source.name, type: source.type })),
    };
  });
  app.get("/api/games/:gameId/capabilities", async (request) => {
    const { gameId } = parseIdParams(request);
    await domain.requireGame(gameId);
    return { gameId, capabilities: await repository.getCapabilities(gameId) };
  });

  app.get("/api/games/:gameId/entities", async (request) => {
    const { gameId } = parseIdParams(request);
    await domain.requireGame(gameId);
    const query = parseQuery(request);
    const type = query.type ? entityTypeSchema.parse(String(query.type)) : undefined;
    const revisionId = query.revisionId
      ? revisionIdSchema.parse(String(query.revisionId))
      : undefined;
    return {
      entities: await repository.listEntities(gameId, {
        query: typeof query.q === "string" ? query.q : undefined,
        type,
        limit: parsePositive(query.limit, 20, 100),
        offset: Math.max(0, Number(query.offset ?? 0) || 0),
        revisionId,
      }),
    };
  });

  app.get("/api/games/:gameId/entities/:entityId", async (request) => {
    const { gameId, entityId } = parseIdParams(request);
    const query = parseQuery(request);
    const revisionId = query.revisionId
      ? revisionIdSchema.parse(String(query.revisionId))
      : undefined;
    return { entity: await domain.getEntity(gameId, entityId ?? "", revisionId) };
  });

  app.get("/api/games/:gameId/entities/:entityId/relationships", async (request) => {
    const { gameId, entityId } = parseIdParams(request);
    await domain.requireGame(gameId);
    const query = parseQuery(request);
    const predicate = query.predicate
      ? relationshipPredicateSchema.parse(String(query.predicate))
      : undefined;
    const revisionId = query.revisionId
      ? revisionIdSchema.parse(String(query.revisionId))
      : undefined;
    await domain.getEntity(gameId, entityId ?? "", revisionId);
    return {
      relationships: await repository.getRelationships(gameId, entityId ?? "", {
        predicate,
        limit: parsePositive(query.limit, 50, 200),
        revisionId,
      }),
    };
  });

  app.get("/api/games/:gameId/entities/:entityId/documents", async (request) => {
    const { gameId, entityId } = parseIdParams(request);
    await domain.requireGame(gameId);
    const query = parseQuery(request);
    const revisionId = query.revisionId
      ? revisionIdSchema.parse(String(query.revisionId))
      : undefined;
    await domain.getEntity(gameId, entityId ?? "", revisionId);
    return {
      documents: await repository.getEntityDocuments(
        gameId,
        entityId ?? "",
        parsePositive(query.limit, 20, 100),
        revisionId,
      ),
    };
  });

  app.get("/api/games/:gameId/documents", async (request) => {
    const { gameId } = parseIdParams(request);
    await domain.requireGame(gameId);
    const query = parseQuery(request);
    const type = query.type ? documentTypeSchema.parse(String(query.type)) : undefined;
    const revisionId = query.revisionId
      ? revisionIdSchema.parse(String(query.revisionId))
      : undefined;
    return {
      documents: await repository.listDocuments(gameId, {
        query: typeof query.q === "string" ? query.q : undefined,
        type,
        limit: parsePositive(query.limit, 20, 100),
        offset: Math.max(0, Number(query.offset ?? 0) || 0),
        revisionId,
      }),
    };
  });

  app.get("/api/games/:gameId/documents/:documentId", async (request) => {
    const { gameId, documentId } = parseIdParams(request);
    const query = parseQuery(request);
    const revisionId = query.revisionId
      ? revisionIdSchema.parse(String(query.revisionId))
      : undefined;
    return { document: await domain.getDocument(gameId, documentId ?? "", revisionId) };
  });

  app.post("/api/games/:gameId/search", async (request) => {
    const { gameId } = parseIdParams(request);
    await domain.requireGame(gameId);
    const parsed = searchRequestSchema.parse(request.body);
    const result = await retrieval.search(gameId, parsed);
    if (!result.revision)
      throw new DomainError(
        "index_not_ready",
        "No searchable Dataset Revision is ready",
        undefined,
        503,
      );
    return result;
  });

  app.post("/api/games/:gameId/qa", async (request) => {
    const { gameId } = parseIdParams(request);
    await domain.requireCapability(gameId, "evidence_qa");
    const parsed = qaRequestSchema.parse(request.body);
    try {
      return await qa.answer(gameId, parsed.question, parsed.maxEvidence, parsed.revisionId);
    } catch (error) {
      if (error instanceof Error && "code" in error)
        throw new DomainError(String(error.code), error.message, undefined, 502);
      throw error;
    }
  });

  app.get("/api/admin/sources", async (request) => {
    const query = request.query as { gameId?: unknown };
    const gameId = typeof query.gameId === "string" ? gameIdSchema.parse(query.gameId) : undefined;
    return { sources: (await repository.listSources(gameId)).map(safeSource) };
  });
  app.get("/api/admin/acquisition/status", async (request) => {
    const query = z.object({ gameId: gameIdSchema.optional() }).parse(request.query);
    const reportPath = resolve(config.dataDir, "verification/reports/latest-anime-status.json");
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(reportPath, "utf8"));
    } catch {
      throw new DomainError(
        "acquisition_status_unavailable",
        "The latest acquisition status report is unavailable; run the status report command first",
        undefined,
        404,
      );
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new DomainError(
        "acquisition_status_unavailable",
        "The latest acquisition status report is unavailable; run the status report command first",
        undefined,
        404,
      );
    if (query.gameId) {
      const reportGame = (parsed as { game?: unknown }).game;
      const reportGameId =
        reportGame && typeof reportGame === "object" && !Array.isArray(reportGame)
          ? (reportGame as { id?: unknown }).id
          : undefined;
      if (typeof reportGameId === "string" && reportGameId !== query.gameId)
        throw new DomainError(
          "acquisition_status_game_mismatch",
          "The latest acquisition status report belongs to another game",
          undefined,
          404,
        );
    }
    return { status: safeAcquisitionStatus(parsed as Record<string, unknown>) };
  });
  app.post("/api/admin/sources", async (request) => {
    const body = z
      .object({
        gameId: z.string().uuid(),
        name: z.string().trim().min(1).max(200),
        type: z.enum(["local_json", "local_markdown", "local_text", "local_directory"]),
        pathLabel: z.string().trim().min(1).max(500),
        licenseNote: z.string().trim().max(2_000).optional(),
        parserType: z.string().trim().min(1).max(100).default("builtin"),
        enabled: z.boolean().default(true),
      })
      .parse(request.body);
    await domain.requireGame(body.gameId);
    return safeSource(
      await repository.createSource({ ...body, pathLabel: safePathLabel(body.pathLabel) }),
    );
  });

  app.post("/api/admin/imports", async (request) => {
    const body = z
      .object({
        gameId: z.string().uuid(),
        sourceId: z.string().uuid(),
        path: z.string().trim().min(1).max(2_000),
      })
      .parse(request.body);
    const source = await repository.getSource(body.sourceId);
    if (!source || source.gameId !== body.gameId)
      throw new DomainError("source_not_found", "Source was not found", undefined, 404);
    if (repository.createPendingImport && repository.enqueueJob) {
      const batch = await repository.createPendingImport({
        gameId: body.gameId,
        sourceId: source.id,
        parserVersion: PARSER_VERSION,
      });
      await repository.enqueueJob({
        type: "parse_import",
        idempotencyKey: `parse_import:${batch.id}`,
        payload: {
          batchId: batch.id,
          gameId: body.gameId,
          sourceId: source.id,
          path: body.path,
        },
      });
      return safeBatch(batch);
    }
    const adapter = adapterFor(source.type as SourceType);
    const input = {
      sourceId: source.id,
      type: source.type as SourceType,
      path: body.path,
      storageDir: config.dataDir,
    };
    const inspection = await adapter.inspect(input);
    if (!inspection.supported)
      throw new DomainError("unsupported_source", "The source is not supported", {
        type: inspection.type,
      });
    const snapshot = await adapter.snapshot(input);
    const savedSnapshot = await repository.createSnapshot({
      sourceId: source.id,
      contentHash: snapshot.contentHash,
      storagePath: snapshot.storagePath,
      metadata: snapshot.metadata,
    });
    const normalized = await normalizeSnapshot(snapshot, adapter);
    const previousKeys = await repository.getSourceRecordHashes(source.id);
    const knownEntityKeys = new Set((await repository.listEntitySourceKeys?.(body.gameId)) ?? []);
    const validation = validateImport(
      normalized.records,
      normalized.parseIssues,
      previousKeys,
      knownEntityKeys,
    );
    const diff = computeDiff(normalized.records, previousKeys, [
      ...normalized.parseIssues,
      ...validation.errors,
      ...validation.warnings,
    ]);
    const batch = await repository.createImport({
      gameId: body.gameId,
      sourceId: source.id,
      sourceSnapshotId: savedSnapshot.id,
      parserVersion: PARSER_VERSION,
      stagedRecords: normalized.records,
      errors: validation.errors,
      warnings: [
        ...validation.warnings,
        ...inspection.warnings.map((message) => ({
          severity: "warning" as const,
          code: "inspection_warning",
          message,
        })),
      ],
      diff,
    });
    return safeBatch(batch);
  });

  app.get("/api/admin/imports/:batchId", async (request) => {
    const { batchId } = parseIdParams(request);
    const batch = await repository.getImport(batchId ?? "");
    if (!batch)
      throw new DomainError("import_not_found", "Import batch was not found", undefined, 404);
    return safeBatch(batch);
  });

  app.get("/api/admin/imports/:batchId/diff", async (request) => {
    const { batchId } = parseIdParams(request);
    const batch = await repository.getImport(batchId ?? "");
    if (!batch)
      throw new DomainError("import_not_found", "Import batch was not found", undefined, 404);
    const query = z
      .object({
        offset: z.coerce.number().int().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(500).default(500),
      })
      .parse(request.query);
    const diff = batch.diff ?? null;
    const summary = diff
      ? Object.fromEntries(
          Object.entries(diff).map(([key, values]) => [key, (values as string[]).length]),
        )
      : {};
    const pagedDiff = diff
      ? Object.fromEntries(
          Object.entries(diff).map(([key, values]) => [
            key,
            (values as string[]).slice(query.offset, query.offset + query.limit),
          ]),
        )
      : null;
    return {
      batchId: batch.id,
      status: batch.status,
      diff: pagedDiff,
      summary,
      offset: query.offset,
      limit: query.limit,
      errors: batch.errors,
      warnings: batch.warnings,
    };
  });

  app.get("/api/admin/imports/:batchId/publish-readiness", async (request) => {
    const { batchId } = parseIdParams(request);
    const batch = await repository.getImport(batchId ?? "");
    if (!batch)
      throw new DomainError("import_not_found", "Import batch was not found", undefined, 404);
    if (repository.getPublishReadiness)
      return { batchId: batch.id, ...(await repository.getPublishReadiness(batch.id)) };
    const reasons: string[] = [];
    if (batch.status !== "review_required") reasons.push(`invalid_status:${batch.status}`);
    if (batch.errors.length) reasons.push("import_has_errors");
    if (
      batch.diff?.deletionCandidates.length &&
      batch.confirmedDeletionKeys.length < batch.diff.deletionCandidates.length
    )
      reasons.push("deletions_unconfirmed");
    const run = repository.getVerificationRun
      ? await repository.getVerificationRun(batch.id)
      : null;
    if (run?.status === "blocked") reasons.push("verification_blocked");
    return {
      batchId: batch.id,
      ready: reasons.length === 0,
      blockingReasons: reasons,
      verification: run ? { status: run.status, itemCount: run.items.length } : null,
    };
  });

  app.get("/api/admin/imports", async (request) => {
    if (!repository.listImports)
      throw new DomainError(
        "imports_not_supported",
        "Import listing is not supported",
        undefined,
        501,
      );
    const query = z.object({ gameId: z.string().uuid().optional() }).parse(request.query);
    return { imports: (await repository.listImports(query.gameId)).map(safeBatch) };
  });

  app.post("/api/admin/imports/:batchId/review", async (request) => {
    const { batchId } = parseIdParams(request);
    const body = reviewRequestSchema.parse(request.body);
    return safeBatch(
      await repository.reviewImport(
        batchId ?? "",
        body.approved,
        body.note,
        body.confirmedDeletionKeys,
      ),
    );
  });

  app.post("/api/admin/imports/:batchId/publish", async () => {
    throw new DomainError(
      "legacy_publish_disabled",
      "批次直接发布已停用，请先打开预发布分支并通过审核后合入正式版本",
      undefined,
      410,
    );
  });

  app.post("/api/admin/release-candidates", async (request, reply) => {
    if (!repository.createReleaseCandidate)
      throw new DomainError(
        "release_candidates_not_supported",
        "Release candidates are not supported",
        undefined,
        501,
      );
    const body = z
      .object({
        gameId: z.string().uuid(),
        name: z.string().trim().min(1).max(120),
        importBatchIds: z.array(z.string().uuid()).min(1).max(20),
      })
      .parse(request.body);
    const candidate = await repository.createReleaseCandidate(body);
    return reply.code(201).send({ candidate });
  });

  app.get("/api/admin/release-candidates", async (request) => {
    if (!repository.listReleaseCandidates)
      throw new DomainError(
        "release_candidates_not_supported",
        "Release candidates are not supported",
        undefined,
        501,
      );
    const query = z.object({ gameId: z.string().uuid().optional() }).parse(request.query);
    return { candidates: await repository.listReleaseCandidates(query.gameId) };
  });

  app.get("/api/admin/release-candidates/:candidateId", async (request) => {
    if (!repository.getReleaseCandidate)
      throw new DomainError(
        "release_candidates_not_supported",
        "Release candidates are not supported",
        undefined,
        501,
      );
    const { candidateId } = parseIdParams(request);
    const candidate = await repository.getReleaseCandidate(candidateId ?? "");
    if (!candidate)
      throw new DomainError(
        "candidate_not_found",
        "Release candidate was not found",
        undefined,
        404,
      );
    return { candidate };
  });

  app.post("/api/admin/release-candidates/:candidateId/builds", async (request, reply) => {
    if (!repository.buildReleaseCandidate)
      throw new DomainError(
        "release_candidates_not_supported",
        "Release candidates are not supported",
        undefined,
        501,
      );
    const { candidateId } = parseIdParams(request);
    const build = await repository.buildReleaseCandidate(candidateId ?? "");
    // Build endpoints return the build resource directly (the web preview contract).
    return reply.code(201).send(build);
  });

  app.get("/api/admin/release-candidates/:candidateId/readiness", async (request) => {
    if (!repository.getReleaseCandidateReadiness)
      throw new DomainError(
        "release_candidates_not_supported",
        "Release candidates are not supported",
        undefined,
        501,
      );
    const { candidateId } = parseIdParams(request);
    return repository.getReleaseCandidateReadiness(candidateId ?? "");
  });

  app.get("/api/admin/review-issues", async (request) => {
    if (!repository.listReleaseCandidates || !repository.listReviewIssues)
      throw new DomainError("review_not_supported", "Review is not supported", undefined, 501);
    const query = z
      .object({
        gameId: z.string().uuid().optional(),
        candidateId: z.string().uuid().optional(),
        status: z.enum(["open", "resolved", "reopened"]).optional(),
      })
      .parse(request.query);
    const candidateIds = query.candidateId
      ? [query.candidateId]
      : (await repository.listReleaseCandidates(query.gameId)).map((candidate) => candidate.id);
    const issues = (await Promise.all(candidateIds.map((id) => repository.listReviewIssues!(id))))
      .flat()
      .filter((issue) => !query.status || issue.status === query.status)
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
    return { issues };
  });

  app.get("/api/admin/release-candidates/:candidateId/issues", async (request) => {
    if (!repository.listReviewIssues)
      throw new DomainError("review_not_supported", "Review is not supported", undefined, 501);
    const { candidateId } = parseIdParams(request);
    return { issues: await repository.listReviewIssues(candidateId ?? "") };
  });
  app.post("/api/admin/release-candidates/:candidateId/issues", async (request, reply) => {
    if (!repository.reportReviewIssue)
      throw new DomainError("review_not_supported", "Review is not supported", undefined, 501);
    const { candidateId } = parseIdParams(request);
    const body = z
      .object({
        buildId: z.string().uuid(),
        canonicalKey: z.string().min(1),
        fieldPath: z.string().optional(),
        summary: z.string().min(1),
        details: z.record(z.unknown()).optional(),
      })
      .parse(request.body);
    const issue = await repository.reportReviewIssue({ candidateId: candidateId ?? "", ...body });
    return reply.code(201).send({ issue });
  });
  app.get("/api/admin/review-issues/:issueId", async (request) => {
    if (!repository.getReviewIssue)
      throw new DomainError("review_not_supported", "Review is not supported", undefined, 501);
    const { issueId } = parseIdParams(request);
    const issue = await repository.getReviewIssue(issueId ?? "");
    if (!issue)
      throw new DomainError("issue_not_found", "Review issue was not found", undefined, 404);
    return { issue };
  });
  app.post("/api/admin/review-issues/:issueId/resolve", async (request) => {
    if (!repository.resolveReviewIssue)
      throw new DomainError("review_not_supported", "Review is not supported", undefined, 501);
    const { issueId } = parseIdParams(request);
    const body = z
      .object({ action: z.string().optional(), note: z.string().optional() })
      .parse(request.body);
    return repository.resolveReviewIssue(issueId ?? "", body.action, body.note);
  });
  app.post("/api/admin/review-issues/:issueId/reopen", async (request) => {
    if (!repository.reopenReviewIssue)
      throw new DomainError("review_not_supported", "Review is not supported", undefined, 501);
    const { issueId } = parseIdParams(request);
    return repository.reopenReviewIssue(issueId ?? "");
  });
  app.get("/api/admin/release-candidates/:candidateId/patches", async (request) => {
    if (!repository.listCandidatePatches)
      throw new DomainError("review_not_supported", "Review is not supported", undefined, 501);
    const { candidateId } = parseIdParams(request);
    return { patches: await repository.listCandidatePatches(candidateId ?? "") };
  });
  app.post("/api/admin/release-candidates/:candidateId/patches", async (request) => {
    if (!repository.createCandidatePatch)
      throw new DomainError("review_not_supported", "Review is not supported", undefined, 501);
    const { candidateId } = parseIdParams(request);
    const body = z
      .object({
        issueId: z.string().uuid().optional(),
        canonicalKey: z.string().min(1),
        fieldPath: z.string().optional(),
        action: z.enum([
          "keep_main",
          "use_incoming",
          "manual",
          "not_duplicate",
          "confirm_delete",
          "exclude_record",
        ]),
        manualValue: z.unknown().optional(),
        expectedBaseHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        expectedIncomingHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
      })
      .parse(request.body);
    if (body.action === "manual" && !body.fieldPath)
      throw new DomainError(
        "patch_field_required",
        "manual patches require fieldPath",
        undefined,
        400,
      );
    return repository.createCandidatePatch({ candidateId: candidateId ?? "", ...body });
  });
  app.get("/api/admin/review-issues/:issueId/evidence", async (request) => {
    if (!repository.listReviewEvidence)
      throw new DomainError("review_not_supported", "Review is not supported", undefined, 501);
    const { issueId } = parseIdParams(request);
    return { evidence: await repository.listReviewEvidence(issueId ?? "") };
  });
  app.post("/api/admin/review-issues/:issueId/evidence", async (request) => {
    if (!repository.addReviewEvidence)
      throw new DomainError("review_not_supported", "Review is not supported", undefined, 501);
    const { issueId } = parseIdParams(request);
    const body = z
      .object({
        dataBase64: z
          .string()
          .min(1)
          .max(7_000_000)
          .regex(/^[A-Za-z0-9+/]+={0,2}$/),
        mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
        checkedGameVersion: z.string().min(1),
        checkedLocale: z.string().min(1),
        note: z.string().default(""),
      })
      .parse(request.body);
    const bytes = Buffer.from(body.dataBase64, "base64");
    if (!bytes.length || bytes.length > 5_000_000)
      throw new DomainError("invalid_evidence", "Evidence must be between 1 byte and 5 MB");
    const signatures: Record<string, (buffer: Buffer) => boolean> = {
      "image/png": (buffer) => buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
      "image/jpeg": (buffer) => buffer.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")),
      "image/webp": (buffer) =>
        buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
        buffer.subarray(8, 12).toString("ascii") === "WEBP",
    };
    if (!signatures[body.mimeType]?.(bytes))
      throw new DomainError(
        "invalid_evidence",
        "Evidence bytes do not match the declared image type",
      );
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const extension =
      body.mimeType === "image/png" ? "png" : body.mimeType === "image/jpeg" ? "jpg" : "webp";
    const relativePath = `review-evidence/${issueId}/${sha256}.${extension}`;
    const absolutePath = join(config.dataDir, ...relativePath.split("/"));
    await mkdir(join(config.dataDir, "review-evidence", issueId ?? "unknown"), {
      recursive: true,
    });
    let createdFile = false;
    try {
      await writeFile(absolutePath, bytes, { flag: "wx" });
      createdFile = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    try {
      return await repository.addReviewEvidence({
        issueId: issueId ?? "",
        relativePath,
        sha256,
        bytes: bytes.length,
        mimeType: body.mimeType,
        checkedGameVersion: body.checkedGameVersion,
        checkedLocale: body.checkedLocale,
        note: body.note,
      });
    } catch (error) {
      if (createdFile) await unlink(absolutePath).catch(() => undefined);
      throw error;
    }
  });
  app.get("/api/admin/review-evidence/:evidenceId", async (request, reply) => {
    if (!repository.getReviewEvidence)
      throw new DomainError("review_not_supported", "Review is not supported", undefined, 501);
    const { evidenceId } = parseIdParams(request);
    const item = await repository.getReviewEvidence(evidenceId ?? "");
    if (!item)
      throw new DomainError(
        "review_evidence_not_found",
        "Review evidence was not found",
        undefined,
        404,
      );
    const root = resolve(config.dataDir);
    const filePath = resolve(root, item.relativePath);
    if (!filePath.startsWith(`${root}/`) && !filePath.startsWith(`${root}\\`))
      throw new DomainError("invalid_evidence_path", "Review evidence path is invalid");
    const file = await readFile(filePath).catch(() => undefined);
    if (!file)
      throw new DomainError(
        "review_evidence_file_missing",
        "Review evidence file was not found",
        undefined,
        404,
      );
    return reply.type(item.mimeType).send(file);
  });
  app.delete("/api/admin/review-evidence/:evidenceId", async (request) => {
    if (!repository.getReviewEvidence || !repository.deleteReviewEvidence)
      throw new DomainError("review_not_supported", "Review is not supported", undefined, 501);
    const { evidenceId } = parseIdParams(request);
    const item = await repository.getReviewEvidence(evidenceId ?? "");
    if (!item)
      throw new DomainError(
        "review_evidence_not_found",
        "Review evidence was not found",
        undefined,
        404,
      );
    const root = resolve(config.dataDir);
    const filePath = resolve(root, item.relativePath);
    if (!filePath.startsWith(`${root}/`) && !filePath.startsWith(`${root}\\`))
      throw new DomainError("invalid_evidence_path", "Review evidence path is invalid");
    await unlink(filePath).catch(() => undefined);
    await repository.deleteReviewEvidence(evidenceId ?? "");
    return { deleted: true, id: evidenceId };
  });
  app.get("/api/admin/release-candidates/:candidateId/checks", async (request) => {
    if (!repository.listReleaseCandidateChecks)
      throw new DomainError("review_not_supported", "Review is not supported", undefined, 501);
    const { candidateId } = parseIdParams(request);
    return { checks: await repository.listReleaseCandidateChecks(candidateId ?? "") };
  });

  app.post("/api/admin/release-candidates/:candidateId/promote", async (request) => {
    if (!repository.promoteReleaseCandidate)
      throw new DomainError(
        "release_candidates_not_supported",
        "Release candidates are not supported",
        undefined,
        501,
      );
    const { candidateId } = parseIdParams(request);
    const body = z
      .object({
        buildId: z.string().uuid(),
        contentChecksum: z.string().regex(/^[a-f0-9]{64}$/),
        expectedCurrentRevisionId: z.string().uuid().nullable().optional(),
        releaseNote: z.string().trim().max(2_000).optional(),
        idempotencyKey: z.string().trim().min(8).max(128),
      })
      .parse(request.body);
    return repository.promoteReleaseCandidate({ candidateId: candidateId ?? "", ...body });
  });

  app.get("/api/admin/previews/:buildId/entities", async (request) => {
    if (!repository.getReleaseCandidateBuild)
      throw new DomainError(
        "release_candidates_not_supported",
        "Release candidates are not supported",
        undefined,
        501,
      );
    const { buildId } = parseIdParams(request);
    const build = await repository.getReleaseCandidateBuild(buildId ?? "");
    if (!build)
      throw new DomainError("build_not_found", "Preview build was not found", undefined, 404);
    const query = z
      .object({
        limit: z.coerce.number().min(1).max(500).default(50),
        offset: z.coerce.number().min(0).default(0),
      })
      .parse(request.query);
    const entities = build.normalizedRecords.flatMap((record) => {
      if (record.entities?.length)
        return record.entities.map((candidate) => ({
          sourceKey: candidate.sourceKey,
          recordSourceKey: record.sourceKey,
          type: candidate.type,
          name: candidate.name,
          summary: candidate.summary ?? "",
          aliases: candidate.aliases ?? [],
          properties: candidate.properties ?? {},
          metadata: record.metadata ?? {},
          contentHash: record.contentHash,
          parserVersion: record.parserVersion,
        }));
      if (record.recordType !== "entity" && !record.entityType) return [];
      return [
        {
          sourceKey: record.sourceKey,
          recordSourceKey: record.sourceKey,
          type: (record.entityType ?? record.recordType) as
            | "character"
            | "faction"
            | "region"
            | "location"
            | "item"
            | "event"
            | "concept"
            | "quest"
            | "book",
          name: record.title ?? record.sourceKey,
          summary: record.body ?? "",
          aliases: [],
          properties: {},
          metadata: record.metadata ?? {},
          contentHash: record.contentHash,
          parserVersion: record.parserVersion,
        },
      ];
    }) as unknown as Array<Record<string, unknown>>;
    return {
      buildId: build.id,
      candidateId: build.candidateId,
      entities: entities.slice(query.offset, query.offset + query.limit),
      total: entities.length,
    };
  });

  app.get("/api/admin/previews/:buildId/records", async (request) => {
    if (!repository.getReleaseCandidateBuild)
      throw new DomainError(
        "release_candidates_not_supported",
        "Release candidates are not supported",
        undefined,
        501,
      );
    const { buildId } = parseIdParams(request);
    const build = await repository.getReleaseCandidateBuild(buildId ?? "");
    if (!build)
      throw new DomainError("build_not_found", "Preview build was not found", undefined, 404);
    const query = z
      .object({
        limit: z.coerce.number().int().min(1).max(100).default(50),
        offset: z.coerce.number().int().min(0).default(0),
        q: z.string().optional(),
        kind: z.enum(["all", "entity", "document"]).default("all"),
      })
      .parse(request.query);
    const needle = query.q?.trim().toLocaleLowerCase();
    const records = build.normalizedRecords.flatMap((record) => {
      const primaryEntity = record.entities?.[0];
      const isEntity =
        record.recordType === "entity" ||
        Boolean(record.entityType) ||
        Boolean(record.entities?.length);
      const displayKind = isEntity ? "entity" : "document";
      if (query.kind !== "all" && query.kind !== displayKind) return [];
      const haystack = `${record.sourceKey} ${record.title ?? ""} ${record.body ?? ""} ${
        primaryEntity?.name ?? ""
      } ${(primaryEntity?.aliases ?? []).map((alias) => alias.value).join(" ")} ${JSON.stringify(
        primaryEntity?.properties ?? {},
      )}`.toLocaleLowerCase();
      if (needle && !haystack.includes(needle)) return [];
      return [
        {
          sourceKey: primaryEntity?.sourceKey ?? record.sourceKey,
          recordSourceKey: record.sourceKey,
          displayKind,
          type:
            primaryEntity?.type ?? record.entityType ?? record.documentType ?? record.recordType,
          title: primaryEntity?.name ?? record.title ?? record.sourceKey,
          body: primaryEntity?.summary ?? record.body ?? "",
          aliases: primaryEntity?.aliases ?? [],
          properties: primaryEntity?.properties ?? {},
          metadata: record.metadata ?? {},
          contentHash: record.contentHash,
          parserVersion: record.parserVersion,
        },
      ];
    });
    return {
      buildId: build.id,
      candidateId: build.candidateId,
      records: records.slice(query.offset, query.offset + query.limit),
      total: records.length,
      offset: query.offset,
      limit: query.limit,
    };
  });

  app.get("/api/admin/previews/:buildId/documents", async (request) => {
    if (!repository.getReleaseCandidateBuild)
      throw new DomainError(
        "release_candidates_not_supported",
        "Release candidates are not supported",
        undefined,
        501,
      );
    const { buildId } = parseIdParams(request);
    const build = await repository.getReleaseCandidateBuild(buildId ?? "");
    if (!build)
      throw new DomainError("build_not_found", "Preview build was not found", undefined, 404);
    const query = z
      .object({
        limit: z.coerce.number().min(1).max(500).default(50),
        offset: z.coerce.number().min(0).default(0),
      })
      .parse(request.query);
    const documents = build.normalizedRecords
      .filter(
        (record) =>
          record.recordType === "document" ||
          Boolean(record.documentType) ||
          (record.recordType !== "entity" && !record.entityType && Boolean(record.body)),
      )
      .map((record) => ({
        sourceKey: record.sourceKey,
        type: record.documentType ?? record.recordType,
        title: record.title ?? record.sourceKey,
        body: record.body ?? "",
        metadata: record.metadata ?? {},
        contentHash: record.contentHash,
        parserVersion: record.parserVersion,
      }));
    return {
      buildId: build.id,
      candidateId: build.candidateId,
      documents: documents.slice(query.offset, query.offset + query.limit),
      total: documents.length,
    };
  });

  app.get("/api/admin/imports/:batchId/verification", async (request) => {
    throw new DomainError(
      "legacy_verification_removed",
      "Legacy verification endpoint has been removed",
      undefined,
      410,
    );
    const { batchId } = parseIdParams(request);
    if (!repository.getVerificationRun)
      throw new DomainError(
        "verification_not_supported",
        "Verification is not supported",
        undefined,
        501,
      );
    const run = await repository.getVerificationRun!(batchId ?? "");
    if (!run)
      throw new DomainError(
        "verification_run_not_found",
        "Verification run was not found",
        undefined,
        404,
      );
    return run;
  });

  app.patch("/api/admin/verification/items/:itemId", async (request) => {
    throw new DomainError(
      "legacy_verification_removed",
      "Legacy verification endpoint has been removed",
      undefined,
      410,
    );
    const { itemId } = parseIdParams(request);
    if (!repository.updateVerificationItem)
      throw new DomainError(
        "verification_not_supported",
        "Verification is not supported",
        undefined,
        501,
      );
    const body = updateVerificationItemSchema.parse(request.body);
    return repository.updateVerificationItem!({ itemId: itemId ?? "", ...body });
  });

  app.post(
    "/api/admin/verification/items/:itemId/screenshots",
    { bodyLimit: 8_000_000 },
    async (request) => {
      throw new DomainError(
        "legacy_verification_removed",
        "Legacy verification endpoint has been removed",
        undefined,
        410,
      );
      const { itemId } = parseIdParams(request);
      if (!repository.addVerificationScreenshot)
        throw new DomainError(
          "verification_not_supported",
          "Verification is not supported",
          undefined,
          501,
        );
      const body = screenshotUploadSchema.parse(request.body);
      const bytes = Buffer.from(body.dataBase64, "base64");
      if (!bytes.length || bytes.length > 5_000_000)
        throw new DomainError("invalid_screenshot", "Screenshot must be between 1 byte and 5 MB");
      const signatures: Record<string, (buffer: Buffer) => boolean> = {
        "image/png": (buffer) =>
          buffer.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")),
        "image/jpeg": (buffer) => buffer.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")),
        "image/webp": (buffer) =>
          buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
          buffer.subarray(8, 12).toString("ascii") === "WEBP",
      };
      if (!signatures[body.mimeType]?.(bytes))
        throw new DomainError("invalid_screenshot", "Screenshot bytes do not match the MIME type");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      const extension =
        body.mimeType === "image/png" ? "png" : body.mimeType === "image/jpeg" ? "jpg" : "webp";
      const relativeSegments = ["verification", itemId ?? "unknown", `${sha256}.${extension}`];
      // Persist provenance paths with POSIX separators so records and API
      // responses are portable across macOS, Linux, and Windows.  Use the
      // native path join only for filesystem access.
      const relativePath = relativeSegments.join("/");
      const absolutePath = join(config.dataDir, ...relativeSegments);
      await mkdir(join(config.dataDir, "verification", itemId ?? "unknown"), { recursive: true });
      let createdFile = false;
      try {
        await writeFile(absolutePath, bytes, { flag: "wx" });
        createdFile = true;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      }
      try {
        await repository.addVerificationScreenshot!({
          itemId: itemId ?? "",
          relativePath,
          sha256,
          bytes: bytes.length,
          mimeType: body.mimeType,
        });
      } catch (error) {
        if (createdFile) await unlink(absolutePath).catch(() => undefined);
        throw error;
      }
      return { relativePath, sha256, bytes: bytes.length, mimeType: body.mimeType };
    },
  );

  app.get("/api/admin/verification/items/:itemId/screenshots", async (request) => {
    const { itemId } = parseIdParams(request);
    if (!repository.listVerificationScreenshots)
      throw new DomainError(
        "verification_not_supported",
        "Verification is not supported",
        undefined,
        501,
      );
    return { screenshots: await repository.listVerificationScreenshots(itemId ?? "") };
  });

  app.get("/api/admin/verification/screenshots/:screenshotId", async (request, reply) => {
    const { screenshotId } = parseIdParams(request);
    if (!repository.getVerificationScreenshot)
      throw new DomainError(
        "verification_not_supported",
        "Verification is not supported",
        undefined,
        501,
      );
    const screenshot = await repository.getVerificationScreenshot(screenshotId ?? "");
    if (!screenshot)
      throw new DomainError("screenshot_not_found", "Screenshot was not found", undefined, 404);
    const root = resolve(config.dataDir);
    const filePath = resolve(root, screenshot.relativePath);
    if (!filePath.startsWith(`${root}/`) && !filePath.startsWith(`${root}\\`))
      throw new DomainError("invalid_screenshot_path", "Screenshot path is invalid");
    const bytes = await readFile(filePath).catch(() => undefined);
    if (!bytes)
      throw new DomainError(
        "screenshot_file_missing",
        "Screenshot file was not found",
        undefined,
        404,
      );
    return reply.type(screenshot.mimeType).send(bytes);
  });

  app.delete("/api/admin/verification/screenshots/:screenshotId", async (request) => {
    const { screenshotId } = parseIdParams(request);
    if (!repository.deleteVerificationScreenshot)
      throw new DomainError(
        "verification_not_supported",
        "Verification is not supported",
        undefined,
        501,
      );
    const screenshot = await repository.getVerificationScreenshot?.(screenshotId ?? "");
    if (!screenshot)
      throw new DomainError("screenshot_not_found", "Screenshot was not found", undefined, 404);
    const root = resolve(config.dataDir);
    const filePath = resolve(root, screenshot.relativePath);
    if (!filePath.startsWith(`${root}/`) && !filePath.startsWith(`${root}\\`))
      throw new DomainError("invalid_screenshot_path", "Screenshot path is invalid");
    await unlink(filePath).catch(() => undefined);
    await repository.deleteVerificationScreenshot!(screenshotId ?? "");
    return { deleted: true, id: screenshot.id };
  });

  app.get("/api/admin/conflicts", async (request) => {
    if (!repository.listConflicts)
      throw new DomainError(
        "conflicts_not_supported",
        "Conflict review is not supported",
        undefined,
        501,
      );
    const query = z
      .object({ gameId: z.string().uuid(), status: z.enum(["open", "resolved"]).optional() })
      .parse(request.query);
    return { conflicts: await repository.listConflicts(query.gameId, query.status) };
  });

  app.get("/api/admin/conflicts/:conflictId", async (request) => {
    const { conflictId } = parseIdParams(request);
    if (!repository.getConflict)
      throw new DomainError(
        "conflicts_not_supported",
        "Conflict detail is not supported",
        undefined,
        501,
      );
    const conflict = await repository.getConflict(conflictId ?? "");
    if (!conflict)
      throw new DomainError("conflict_not_found", "Conflict case was not found", undefined, 404);
    return { conflict };
  });

  app.post("/api/admin/conflicts/:conflictId/resolve", async (request) => {
    const { conflictId } = parseIdParams(request);
    if (!repository.resolveConflict)
      throw new DomainError(
        "conflicts_not_supported",
        "Conflict review is not supported",
        undefined,
        501,
      );
    const body = resolveConflictSchema.parse(request.body);
    return repository.resolveConflict(
      conflictId ?? "",
      body.resolution,
      body.selectedObservationId,
    );
  });

  app.get("/api/admin/revisions", async (request) => {
    const query = request.query as { gameId?: unknown };
    const gameId = typeof query.gameId === "string" ? gameIdSchema.parse(query.gameId) : undefined;
    return {
      revisions: await repository.listRevisions(gameId),
    };
  });

  app.post("/api/admin/revisions/:revisionId/rollback", async (request) => {
    const { revisionId } = parseIdParams(request);
    const body = rollbackRequestSchema.parse(request.body);
    return repository.rollbackRevision(revisionId ?? "", body.reason);
  });

  app.get("/api/admin/jobs", async () => ({ jobs: await repository.listJobs() }));
  return app;
}

export async function startApp(dependencies: AppDependencies): Promise<FastifyInstance> {
  const app = createApp(dependencies);
  const config = dependencies.config ?? loadConfig();
  await app.listen({ host: config.host, port: config.apiPort });
  return app;
}
