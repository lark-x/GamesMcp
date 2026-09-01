import { and, desc, eq, inArray } from "drizzle-orm";
import { DomainError, type ConflictCase, type ConflictDetail } from "@gip/domain";
import type { Database } from "./client.js";
import { conflictCases, sourceObservations } from "./schema.js";
import { safeProvenance } from "./repository-utils.js";

interface ConflictContext {
  db: Database;
}

function mapConflictCase(row: typeof conflictCases.$inferSelect): ConflictCase {
  return {
    ...row,
    kind: row.kind as ConflictCase["kind"],
    status: row.status as ConflictCase["status"],
    selectedObservationId: row.selectedObservationId,
  };
}

export async function listConflicts(
  ctx: ConflictContext,
  gameId: string,
  status?: "open" | "resolved",
): Promise<ConflictCase[]> {
  const rows = await ctx.db
    .select()
    .from(conflictCases)
    .where(
      status
        ? and(eq(conflictCases.gameId, gameId), eq(conflictCases.status, status))
        : eq(conflictCases.gameId, gameId),
    )
    .orderBy(desc(conflictCases.createdAt));
  return rows.map(mapConflictCase);
}

export async function getConflict(
  ctx: ConflictContext,
  conflictId: string,
): Promise<ConflictDetail | null> {
  const [row] = await ctx.db
    .select()
    .from(conflictCases)
    .where(eq(conflictCases.id, conflictId))
    .limit(1);
  if (!row) return null;
  const observationIds = row.observationIds;
  const observations = observationIds.length
    ? await ctx.db
        .select()
        .from(sourceObservations)
        .where(inArray(sourceObservations.id, observationIds))
    : [];
  const byId = new Map(observations.map((observation) => [observation.id, observation]));
  return {
    id: row.id,
    gameId: row.gameId,
    canonicalKey: row.canonicalKey,
    gameVersion: row.gameVersion,
    locale: row.locale,
    kind: row.kind as ConflictCase["kind"],
    status: row.status as ConflictCase["status"],
    selectedObservationId: row.selectedObservationId,
    observationIds,
    resolution: row.resolution,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
    observations: observationIds.flatMap((id) => {
      const observation = byId.get(id);
      if (!observation) return [];
      return [
        {
          id: observation.id,
          sourceId: observation.sourceId,
          sourceSnapshotId: observation.sourceSnapshotId,
          canonicalKey: observation.canonicalKey,
          category: observation.category,
          gameVersion: observation.gameVersion,
          locale: observation.locale,
          title: observation.title,
          body: observation.body,
          rawContentHash: observation.rawContentHash,
          normalizedContentHash: observation.normalizedContentHash,
          provenance: safeProvenance(observation.provenance, observation.canonicalKey),
        },
      ];
    }),
  };
}

export async function resolveConflict(
  ctx: ConflictContext,
  conflictId: string,
  resolution: string,
  selectedObservationId?: string,
): Promise<ConflictCase> {
  const [existing] = await ctx.db
    .select()
    .from(conflictCases)
    .where(eq(conflictCases.id, conflictId))
    .limit(1);
  if (!existing)
    throw new DomainError("conflict_not_found", "Conflict case was not found", undefined, 404);
  if (selectedObservationId && !existing.observationIds.includes(selectedObservationId))
    throw new DomainError(
      "conflict_observation_invalid",
      "Selected observation does not belong to this conflict case",
    );
  if (
    (existing.kind === "content_conflict" || existing.kind === "missing_field") &&
    !selectedObservationId
  )
    throw new DomainError(
      "conflict_observation_required",
      "A real content conflict requires selecting the adopted source observation",
    );
  const [row] = await ctx.db
    .update(conflictCases)
    .set({
      status: "resolved",
      resolution,
      selectedObservationId: selectedObservationId ?? existing.selectedObservationId,
      resolvedAt: new Date(),
    })
    .where(eq(conflictCases.id, conflictId))
    .returning();
  if (!row)
    throw new DomainError("conflict_not_found", "Conflict case was not found", undefined, 404);
  return mapConflictCase(row);
}
