import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { documentIdSchema, entityIdSchema, gameIdSchema, revisionIdSchema } from "@gip/contracts";

export const questTypeSchema = z.enum([
  "archon_quest",
  "story_quest",
  "world_quest",
  "event_quest",
]);

export function parseIdParams(request: FastifyRequest): {
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

export function parseQuery(request: FastifyRequest): Record<string, unknown> {
  return request.query as Record<string, unknown>;
}

export function parsePositive(value: unknown, fallback: number, maximum: number): number {
  const number = Number(value ?? fallback);
  return Number.isInteger(number) && number > 0 ? Math.min(number, maximum) : fallback;
}
