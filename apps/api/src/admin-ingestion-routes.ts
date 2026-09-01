import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RuntimeConfig } from "@gip/config";
import { createImportRequestSchema, gameIdSchema, reviewRequestSchema } from "@gip/contracts";
import { DomainError, type KnowledgeRepository, type KnowledgeService } from "@gip/domain";
import {
  PARSER_VERSION,
  adapterFor,
  assertPathInsideImportRoot,
  computeDiff,
  normalizeSnapshot,
  resolveImportRoot,
  validateImport,
  type SourceType,
} from "@gip/ingestion";
import { safeAcquisitionStatus, safeBatch, safePathLabel, safeSource } from "./response-mappers.js";
import { parseIdParams } from "./route-utils.js";

export type AdminIngestionRoutesDependencies = {
  repository: KnowledgeRepository;
  config: RuntimeConfig;
  domain: KnowledgeService;
};

export function registerAdminIngestionRoutes(
  app: FastifyInstance,
  { repository, config, domain }: AdminIngestionRoutesDependencies,
): void {
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

  app.post("/api/admin/imports", { bodyLimit: 40_000_000 }, async (request) => {
    const body = createImportRequestSchema.parse(request.body);
    const source = await repository.getSource(body.sourceId);
    if (!source || source.gameId !== body.gameId)
      throw new DomainError("source_not_found", "Source was not found", undefined, 404);
    let importPath = body.path ?? "";
    if (body.files?.length) {
      const uploadDir = resolveImportRoot(config.dataDir);
      const batchDir = join(uploadDir, "uploads", randomUUID());
      await mkdir(batchDir, { recursive: true });
      const single = body.files.length === 1;
      for (const file of body.files) {
        if (Buffer.from(file.contentBase64, "base64").length > 20_000_000)
          throw new DomainError(
            "import_file_too_large",
            `Import file \`${file.name}\` exceeds the 20MB limit`,
            undefined,
            413,
          );
        await writeFile(join(batchDir, file.name), Buffer.from(file.contentBase64, "base64"));
      }
      importPath = single ? join(batchDir, body.files[0]!.name) : batchDir;
    }
    const absoluteImportPath = assertPathInsideImportRoot(importPath, config.dataDir);
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
          path: absoluteImportPath,
        },
      });
      return safeBatch(batch);
    }
    const adapter = adapterFor(source.type as SourceType);
    const input = {
      sourceId: source.id,
      type: source.type as SourceType,
      path: absoluteImportPath,
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
}
