import { desc, eq, sql } from "drizzle-orm";
import { DomainError, type DatasetRevision } from "@gip/domain";
import type { Database } from "./client.js";
import {
  auditLog,
  datasetRevisions,
  entities,
  entityAliases,
  importBatches,
  sources,
} from "./schema.js";
import { mapDatasetRevision } from "./repository-mappers.js";
import { normalize, stableEntityId } from "./repository-utils.js";

interface RevisionOperationContext {
  db: Database;
}

export async function listRevisions(
  ctx: RevisionOperationContext,
  gameId?: string,
): Promise<DatasetRevision[]> {
  const rows = await ctx.db
    .select()
    .from(datasetRevisions)
    .where(gameId ? eq(datasetRevisions.gameId, gameId) : undefined)
    .orderBy(desc(datasetRevisions.revisionNumber));
  return rows.map(mapDatasetRevision);
}

export async function rollbackRevision(
  ctx: RevisionOperationContext,
  revisionId: string,
  reason: string,
): Promise<DatasetRevision> {
  return ctx.db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(datasetRevisions)
      .where(eq(datasetRevisions.id, revisionId))
      .limit(1);
    const target = rows[0];
    if (!target)
      throw new DomainError("revision_not_found", "Dataset revision was not found", undefined, 404);

    // Pre-Candidate revisions may not have a dataset_manifests row, but their
    // immutable normalized payload is still sufficient for historical rollback.
    const legacyPayloadAvailable = Boolean(target.normalizedRecords);
    if (
      target.lifecycleStatus !== "published" ||
      target.indexStatus !== "ready" ||
      (!target.manifestId && !legacyPayloadAvailable)
    )
      throw new DomainError(
        "revision_not_ready",
        "Only a published, indexed revision with a manifest can be activated by rollback",
        undefined,
        409,
      );

    await tx.execute(
      sql`select id from platform.games where id = ${target.gameId}::uuid for update`,
    );

    // The legacy import path materializes entities once per newly published
    // revision. Reconcile the materialized entity table before switching current.
    const targetRecords =
      target.normalizedRecords ??
      (
        await tx
          .select({ stagedRecords: importBatches.stagedRecords })
          .from(importBatches)
          .where(eq(importBatches.id, target.sourceBatchId))
          .limit(1)
      )[0]?.stagedRecords ??
      [];
    const targetCandidates = new Map(
      targetRecords.flatMap((record) =>
        (record.entities ?? []).map((candidate) => [candidate.sourceKey, candidate]),
      ),
    );
    const targetRows = await tx.select().from(entities).where(eq(entities.gameId, target.gameId));
    const [targetBatch] = await tx
      .select({ sourceId: importBatches.sourceId })
      .from(importBatches)
      .where(eq(importBatches.id, target.sourceBatchId))
      .limit(1);
    const [targetSource] = targetBatch?.sourceId
      ? await tx.select().from(sources).where(eq(sources.id, targetBatch.sourceId)).limit(1)
      : [];

    for (const row of targetRows) {
      const candidate = row.sourceKey ? targetCandidates.get(row.sourceKey) : undefined;
      if (!candidate) {
        await tx
          .update(entities)
          .set({ deleted: true, lastRevisionId: target.id, updatedAt: new Date() })
          .where(eq(entities.id, row.id));
        continue;
      }
      await tx
        .update(entities)
        .set({
          type: candidate.type,
          canonicalName: candidate.name,
          normalizedName: normalize(candidate.name),
          summary: candidate.summary,
          properties: candidate.properties ?? {},
          lastRevisionId: target.id,
          deleted: false,
          updatedAt: new Date(),
        })
        .where(eq(entities.id, row.id));
      await tx.delete(entityAliases).where(eq(entityAliases.entityId, row.id));
      if (candidate.aliases?.length && targetSource)
        await tx.insert(entityAliases).values(
          candidate.aliases.map((alias) => ({
            entityId: row.id,
            value: alias.value,
            normalizedValue: normalize(alias.value),
            language: alias.language ?? "und",
            sourceId: targetSource.id,
            isPrimary: alias.primary ?? false,
          })),
        );
    }

    for (const candidate of targetCandidates.values()) {
      if (targetRows.some((row) => row.sourceKey === candidate.sourceKey)) continue;
      const id = stableEntityId(target.gameId, candidate.sourceKey);
      await tx
        .insert(entities)
        .values({
          id,
          gameId: target.gameId,
          sourceKey: candidate.sourceKey,
          type: candidate.type,
          canonicalName: candidate.name,
          normalizedName: normalize(candidate.name),
          summary: candidate.summary,
          properties: candidate.properties ?? {},
          firstRevisionId: target.id,
          lastRevisionId: target.id,
          deleted: false,
        })
        .onConflictDoNothing();
      if (candidate.aliases?.length && targetSource)
        await tx.insert(entityAliases).values(
          candidate.aliases.map((alias) => ({
            entityId: id,
            value: alias.value,
            normalizedValue: normalize(alias.value),
            language: alias.language ?? "und",
            sourceId: targetSource.id,
            isPrimary: alias.primary ?? false,
          })),
        );
    }

    await tx
      .update(datasetRevisions)
      .set({ isCurrent: false })
      .where(eq(datasetRevisions.gameId, target.gameId));
    const [updated] = await tx
      .update(datasetRevisions)
      .set({ isCurrent: true })
      .where(eq(datasetRevisions.id, target.id))
      .returning();
    if (!updated)
      throw new DomainError(
        "rollback_failed",
        "Dataset revision could not be activated",
        undefined,
        500,
      );

    await tx.insert(auditLog).values({
      action: "rollback_revision",
      targetType: "dataset_revision",
      targetId: target.id,
      reason,
      metadata: { gameId: target.gameId },
    });
    return mapDatasetRevision(updated);
  });
}
