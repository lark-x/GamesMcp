import { createHash } from "node:crypto";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  DomainError,
  type EmbeddingInput,
  type NormalizedRecord,
  type Source,
  type SourceSnapshot,
  type StoredEmbedding,
} from "@gip/domain";
import type { Database } from "./client.js";
import {
  documentSegments,
  embeddings,
  entities,
  importBatches,
  datasetRevisions,
  sources,
  sourceSnapshots,
} from "./schema.js";

type RevisionRow = typeof datasetRevisions.$inferSelect;

export interface SourceOperationContext {
  db: Database;
  getCurrentRevision(gameId: string): Promise<RevisionRow | undefined>;
  getRevision(revisionId: string, gameId?: string): Promise<RevisionRow | undefined>;
  getRevisionRecords(revision: RevisionRow): Promise<NormalizedRecord[]>;
}

function mapSource(row: typeof sources.$inferSelect): Source {
  return {
    id: row.id,
    gameId: row.gameId,
    name: row.name,
    type: row.type as Source["type"],
    pathLabel: row.pathLabel,
    licenseNote: row.licenseNote,
    enabled: row.enabled,
    parserType: row.parserType,
  };
}

function mapSnapshot(row: typeof sourceSnapshots.$inferSelect): SourceSnapshot {
  return {
    id: row.id,
    sourceId: row.sourceId,
    contentHash: row.contentHash,
    storagePath: row.storagePath,
    capturedAt: row.capturedAt,
    metadata: row.metadata,
  };
}

export async function createSource(
  ctx: Pick<SourceOperationContext, "db">,
  input: Omit<Source, "id">,
): Promise<Source> {
  const [row] = await ctx.db
    .insert(sources)
    .values({ ...input })
    .returning();
  if (!row)
    throw new DomainError("source_create_failed", "Source could not be created", undefined, 500);
  return mapSource(row);
}

export async function listSources(
  ctx: Pick<SourceOperationContext, "db">,
  gameId?: string,
): Promise<Source[]> {
  const rows = await ctx.db
    .select()
    .from(sources)
    .where(gameId ? eq(sources.gameId, gameId) : undefined)
    .orderBy(asc(sources.name));
  return rows.map(mapSource);
}

export async function getSource(
  ctx: Pick<SourceOperationContext, "db">,
  sourceId: string,
): Promise<Source | null> {
  const rows = await ctx.db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
  const row = rows[0];
  return row ? mapSource(row) : null;
}

export async function createSnapshot(
  ctx: Pick<SourceOperationContext, "db">,
  input: Omit<SourceSnapshot, "id" | "capturedAt">,
): Promise<SourceSnapshot> {
  const [row] = await ctx.db
    .insert(sourceSnapshots)
    .values(input)
    .onConflictDoNothing()
    .returning();
  if (row) return mapSnapshot(row);
  const existing = await ctx.db
    .select()
    .from(sourceSnapshots)
    .where(
      and(
        eq(sourceSnapshots.sourceId, input.sourceId),
        eq(sourceSnapshots.contentHash, input.contentHash),
      ),
    )
    .limit(1);
  const found = existing[0];
  if (!found)
    throw new DomainError(
      "snapshot_create_failed",
      "Source snapshot could not be created",
      undefined,
      500,
    );
  return mapSnapshot(found);
}

export async function getSourceRecordHashes(
  ctx: Pick<SourceOperationContext, "db">,
  sourceId: string,
): Promise<Map<string, string>> {
  const rows = await ctx.db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.sourceId, sourceId), eq(importBatches.status, "published")))
    .orderBy(desc(importBatches.completedAt))
    .limit(1);
  const records = rows[0]?.stagedRecords ?? [];
  return new Map(records.map((record) => [record.sourceKey, record.contentHash]));
}

export async function listEntitySourceKeys(
  ctx: SourceOperationContext,
  gameId: string,
  revisionId?: string,
): Promise<string[]> {
  const revision = revisionId
    ? await ctx.getRevision(revisionId, gameId)
    : await ctx.getCurrentRevision(gameId);
  if (!revision) return [];
  return [
    ...new Set(
      (await ctx.getRevisionRecords(revision)).flatMap((record) =>
        (record.entities ?? []).map((entity) => entity.sourceKey),
      ),
    ),
  ];
}

export async function listEmbeddingInputs(
  ctx: Pick<SourceOperationContext, "db" | "getRevision" | "getRevisionRecords">,
  gameId: string,
  revisionId: string,
): Promise<EmbeddingInput[]> {
  const revision = await ctx.getRevision(revisionId, gameId);
  if (!revision) return [];
  const revisionCandidates = new Map(
    (await ctx.getRevisionRecords(revision)).flatMap((record) =>
      (record.entities ?? []).map((candidate) => [candidate.sourceKey, candidate]),
    ),
  );
  const entityRows = await ctx.db
    .select()
    .from(entities)
    .where(eq(entities.gameId, gameId))
    .limit(100_000);
  const segmentRows = await ctx.db
    .select()
    .from(documentSegments)
    .where(eq(documentSegments.revisionId, revisionId))
    .limit(100_000);
  return [
    ...entityRows.flatMap((row) => {
      const candidate = row.sourceKey ? revisionCandidates.get(row.sourceKey) : undefined;
      if (
        !candidate &&
        (revision.lifecycleStatus === "preview" ||
          revision.normalizedRecords !== null ||
          row.deleted)
      )
        return [];
      const name = candidate?.name ?? row.canonicalName;
      const summary = candidate?.summary ?? row.summary ?? "";
      const text = `${name}\n${summary}`;
      return [
        {
          revisionId,
          targetType: "entity" as const,
          targetId: row.id,
          text,
          contentHash: createHash("sha256").update(text).digest("hex"),
        },
      ];
    }),
    ...segmentRows.map((row) => ({
      revisionId,
      targetType: "segment" as const,
      targetId: row.id,
      text: row.body,
      contentHash: row.contentHash,
    })),
  ];
}

export async function storeEmbeddings(
  ctx: Pick<SourceOperationContext, "db">,
  values: StoredEmbedding[],
): Promise<void> {
  if (!values.length) return;
  if (values.some((value) => value.dimension !== 1536 || value.vector.length !== 1536))
    throw new DomainError(
      "embedding_dimension_mismatch",
      "This deployment is configured for 1536-dimensional pgvector embeddings",
    );
  await ctx.db
    .insert(embeddings)
    .values(
      values.map((value) => ({
        revisionId: value.revisionId,
        targetType: value.targetType,
        targetId: value.targetId,
        spaceId: value.spaceId,
        model: value.model,
        modelVersion: value.modelVersion,
        dimension: value.dimension,
        contentHash: value.contentHash,
        vector: value.vector,
      })),
    )
    .onConflictDoUpdate({
      target: [
        embeddings.revisionId,
        embeddings.targetType,
        embeddings.targetId,
        embeddings.spaceId,
      ],
      set: {
        model: sql`excluded.model`,
        modelVersion: sql`excluded.model_version`,
        dimension: sql`excluded.dimension`,
        contentHash: sql`excluded.content_hash`,
        vector: sql`excluded.vector`,
        createdAt: new Date(),
      },
    });
}
