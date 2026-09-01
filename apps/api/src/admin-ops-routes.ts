import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RuntimeConfig } from "@gip/config";
import {
  gameIdSchema,
  resolveConflictSchema,
  rollbackRequestSchema,
  screenshotUploadSchema,
  updateVerificationItemSchema,
} from "@gip/contracts";
import { DomainError, type KnowledgeRepository } from "@gip/domain";
import { parseIdParams } from "./route-utils.js";

export type AdminOpsRoutesDependencies = {
  repository: KnowledgeRepository;
  config: RuntimeConfig;
};

export function registerAdminOpsRoutes(
  app: FastifyInstance,
  { repository, config }: AdminOpsRoutesDependencies,
): void {
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
}
