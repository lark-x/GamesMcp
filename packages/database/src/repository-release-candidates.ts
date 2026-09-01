import { createHash } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import {
  DomainError,
  type NormalizedRecord,
  type ReleaseCandidate,
  type ReleaseCandidateDetail,
} from "@gip/domain";
import type { Database } from "./client.js";
import {
  contentObjects,
  datasetManifestEntries,
  datasetManifests,
  importBatches,
  releaseCandidateBuilds,
  releaseCandidates,
} from "./schema.js";
import { mapReleaseCandidate, mapReleaseCandidateBuild } from "./repository-mappers.js";
import { canonicalRecordBytes, manifestRootHash } from "./repository-utils.js";

type RevisionRow = { id: string };

interface ReleaseCandidateContext {
  db: Database;
  getCurrentRevision(gameId: string): Promise<RevisionRow | undefined>;
}

export async function createReleaseCandidate(
  ctx: ReleaseCandidateContext,
  input: {
    gameId: string;
    name: string;
    importBatchIds: string[];
  },
): Promise<ReleaseCandidate> {
  const batchIds = [...new Set(input.importBatchIds)];
  if (!batchIds.length)
    throw new DomainError("candidate_batches_required", "At least one import batch is required");
  const batches = await ctx.db
    .select()
    .from(importBatches)
    .where(inArray(importBatches.id, batchIds));
  if (batches.length !== batchIds.length)
    throw new DomainError(
      "candidate_batch_not_found",
      "One or more import batches were not found",
      undefined,
      404,
    );
  if (batches.some((batch) => batch.gameId !== input.gameId))
    throw new DomainError(
      "candidate_game_mismatch",
      "Every import batch must belong to the candidate game",
    );
  const current = await ctx.getCurrentRevision(input.gameId);
  const [row] = await ctx.db
    .insert(releaseCandidates)
    .values({
      gameId: input.gameId,
      name: input.name.trim(),
      baseRevisionId: current?.id,
      importBatchIds: batchIds,
      status: "draft",
    })
    .returning();
  if (!row)
    throw new DomainError(
      "candidate_create_failed",
      "Release candidate could not be created",
      undefined,
      500,
    );
  return mapReleaseCandidate(row);
}

export async function listReleaseCandidates(
  ctx: Pick<ReleaseCandidateContext, "db">,
  gameId?: string,
): Promise<ReleaseCandidate[]> {
  const rows = await ctx.db
    .select()
    .from(releaseCandidates)
    .where(gameId ? eq(releaseCandidates.gameId, gameId) : undefined)
    .orderBy(desc(releaseCandidates.createdAt));
  return rows.map((row) => mapReleaseCandidate(row));
}

export async function getReleaseCandidate(
  ctx: Pick<ReleaseCandidateContext, "db">,
  candidateId: string,
): Promise<ReleaseCandidateDetail | null> {
  const rows = await ctx.db
    .select()
    .from(releaseCandidates)
    .where(eq(releaseCandidates.id, candidateId))
    .limit(1);
  const candidate = rows[0];
  if (!candidate) return null;
  const builds = await ctx.db
    .select()
    .from(releaseCandidateBuilds)
    .where(eq(releaseCandidateBuilds.candidateId, candidateId))
    .orderBy(desc(releaseCandidateBuilds.buildNumber));
  return {
    ...mapReleaseCandidate(candidate),
    builds: builds.map((build) => mapReleaseCandidateBuild(build)),
  };
}

export async function createPreviewManifest(
  ctx: Pick<ReleaseCandidateContext, "db">,
  gameId: string,
  records: NormalizedRecord[],
  baseRevisionId?: string | null,
): Promise<string> {
  const entries = records.map((record) => ({
    canonicalKey: record.sourceKey,
    contentHash: createHash("sha256").update(canonicalRecordBytes(record)).digest("hex"),
    record,
  }));
  await ctx.db
    .insert(contentObjects)
    .values(
      entries.map((entry) => ({
        contentHash: entry.contentHash,
        recordType: entry.record.recordType,
        schemaVersion: "normalized-record-v1",
        payload: entry.record as unknown as Record<string, unknown>,
        byteLength: Buffer.byteLength(canonicalRecordBytes(entry.record)),
      })),
    )
    .onConflictDoNothing();
  const [manifest] = await ctx.db
    .insert(datasetManifests)
    .values({
      gameId,
      kind: "preview",
      baseRevisionId: baseRevisionId ?? null,
      rootHash: manifestRootHash(records),
      recordCount: records.length,
    })
    .returning({ id: datasetManifests.id });
  if (!manifest)
    throw new DomainError(
      "manifest_create_failed",
      "Preview manifest could not be created",
      undefined,
      500,
    );
  if (entries.length) {
    await ctx.db.insert(datasetManifestEntries).values(
      entries.map((entry) => ({
        manifestId: manifest.id,
        canonicalKey: entry.canonicalKey,
        contentHash: entry.contentHash,
      })),
    );
  }
  return manifest.id;
}
