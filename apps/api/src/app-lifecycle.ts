import { randomUUID } from "node:crypto";
import cors from "@fastify/cors";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { RuntimeConfig } from "@gip/config";
import { DomainError } from "@gip/domain";

export function registerAppLifecycle(app: FastifyInstance, config: RuntimeConfig): void {
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
}
