import { createHash } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RuntimeConfig } from "@gip/config";
import { DomainError, type KnowledgeRepository } from "@gip/domain";
import { parseIdParams } from "./route-utils.js";

export type AdminReviewRoutesDependencies = {
  repository: KnowledgeRepository;
  config: RuntimeConfig;
};

export function registerAdminReviewRoutes(
  app: FastifyInstance,
  { repository, config }: AdminReviewRoutesDependencies,
): void {
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
    const query = z
      .object({
        gameId: z.string().uuid().optional(),
        include: z.string().optional(),
      })
      .parse(request.query);
    const candidates = await repository.listReleaseCandidates(query.gameId);
    if (query.include !== "detail") return { candidates };
    const details = await Promise.all(
      candidates.map(async (candidate) => {
        const [detail, readiness, checks] = await Promise.allSettled([
          repository.getReleaseCandidate?.(candidate.id),
          repository.getReleaseCandidateReadiness?.(candidate.id),
          repository.listReleaseCandidateChecks?.(candidate.id),
        ]);
        return {
          ...(detail.status === "fulfilled" && detail.value ? detail.value : candidate),
          readiness: readiness.status === "fulfilled" ? readiness.value : undefined,
          checks: checks.status === "fulfilled" ? (checks.value ?? []) : [],
        };
      }),
    );
    return { candidates: details };
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
    if (!repository.createCandidatePatch || !repository.buildReleaseCandidate)
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
    const patch = await repository.createCandidatePatch({
      candidateId: candidateId ?? "",
      ...body,
    });
    const build = await repository.buildReleaseCandidate(candidateId ?? "");
    return { patch, build };
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
        note: z.string().trim().min(1),
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
}
