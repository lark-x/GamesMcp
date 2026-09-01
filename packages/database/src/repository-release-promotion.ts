import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { DomainError, type DatasetRevision, type ReleaseCandidateReadiness } from "@gip/domain";
import type { Database } from "./client.js";
import {
  auditLog,
  datasetRevisions,
  jobs,
  releaseCandidateBuilds,
  releaseCandidates,
} from "./schema.js";
import { mapDatasetRevision } from "./repository-mappers.js";

type CandidateDetail = {
  id: string;
  gameId: string;
  importBatchIds: string[];
  baseRevisionId?: string | null;
  currentBuildId?: string | null;
  promotedRevisionId?: string | null;
  status: string;
};

type RevisionRow = typeof datasetRevisions.$inferSelect;

type BuildDetail = {
  id: string;
  candidateId: string;
  contentChecksum: string;
  normalizedRecords: RevisionRow["normalizedRecords"];
  manifestId?: string | null;
  indexStatus?: string | null;
};

interface ReleasePromotionContext {
  db: Database;
  getReleaseCandidate(candidateId: string): Promise<CandidateDetail | null>;
  getRevision(revisionId: string, gameId?: string): Promise<RevisionRow | undefined>;
  getCurrentRevision(gameId: string): Promise<RevisionRow | undefined>;
  getReleaseCandidateBuild(buildId: string): Promise<BuildDetail | null>;
  getReleaseCandidateReadiness(candidateId: string): Promise<ReleaseCandidateReadiness>;
}

export async function promoteReleaseCandidate(
  ctx: ReleasePromotionContext,
  input: {
    candidateId: string;
    buildId: string;
    contentChecksum: string;
    expectedCurrentRevisionId?: string | null;
    releaseNote?: string;
    idempotencyKey: string;
  },
): Promise<DatasetRevision> {
  const candidate = await ctx.getReleaseCandidate(input.candidateId);
  if (!candidate)
    throw new DomainError("candidate_not_found", "Release candidate was not found", undefined, 404);
  if (candidate.status === "promoted" && candidate.promotedRevisionId) {
    const revision = await ctx.getRevision(candidate.promotedRevisionId, candidate.gameId);
    if (revision) return mapDatasetRevision(revision);
  }
  const [promotionState] = await ctx.db
    .select({ idempotencyKey: releaseCandidates.promotionIdempotencyKey })
    .from(releaseCandidates)
    .where(eq(releaseCandidates.id, candidate.id))
    .limit(1);
  let existingPromotion: RevisionRow | undefined;
  if (promotionState?.idempotencyKey) {
    if (promotionState.idempotencyKey !== input.idempotencyKey)
      throw new DomainError(
        "candidate_promotion_in_progress",
        "This candidate already has a promotion in progress",
        undefined,
        409,
      );
    [existingPromotion] = await ctx.db
      .select()
      .from(datasetRevisions)
      .where(
        and(
          eq(datasetRevisions.activationCandidateId, candidate.id),
          eq(datasetRevisions.activationBuildId, input.buildId),
        ),
      )
      .orderBy(desc(datasetRevisions.revisionNumber))
      .limit(1);
  }
  const build = await ctx.getReleaseCandidateBuild(input.buildId);
  if (!build || build.candidateId !== candidate.id || candidate.currentBuildId !== build.id)
    throw new DomainError("candidate_build_mismatch", "Promote the current build only");
  if (build.contentChecksum !== input.contentChecksum)
    throw new DomainError("candidate_checksum_mismatch", "Preview build checksum does not match");
  if (existingPromotion) return mapDatasetRevision(existingPromotion);
  const current = await ctx.getCurrentRevision(candidate.gameId);
  if (
    input.expectedCurrentRevisionId !== undefined &&
    (current?.id ?? null) !== input.expectedCurrentRevisionId
  )
    throw new DomainError(
      "current_revision_changed",
      "The formal revision changed before promotion",
      undefined,
      409,
    );
  const readiness = await ctx.getReleaseCandidateReadiness(candidate.id);
  if (!readiness.ready)
    throw new DomainError(
      "candidate_not_ready",
      "Release candidate is not ready to promote",
      readiness.blockingReasons,
    );
  const existingKey = await ctx.db
    .select({ id: releaseCandidates.id })
    .from(releaseCandidates)
    .where(eq(releaseCandidates.promotionIdempotencyKey, input.idempotencyKey))
    .limit(1);
  if (existingKey[0] && existingKey[0].id !== candidate.id)
    throw new DomainError(
      "idempotency_key_conflict",
      "Promotion idempotency key was already used",
      undefined,
      409,
    );
  await ctx.db
    .update(releaseCandidates)
    .set({
      promotionIdempotencyKey: input.idempotencyKey,
      status: "ready_to_promote",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(releaseCandidates.id, candidate.id),
        inArray(releaseCandidates.status, ["preview_ready", "ready_to_promote"]),
      ),
    );
  const revision = await ctx.db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from platform.games where id = ${candidate.gameId}::uuid for update`,
    );
    const latest = await tx
      .select()
      .from(datasetRevisions)
      .where(eq(datasetRevisions.gameId, candidate.gameId))
      .orderBy(desc(datasetRevisions.revisionNumber))
      .limit(1);
    const [preparing] = await tx
      .insert(datasetRevisions)
      .values({
        gameId: candidate.gameId,
        revisionNumber: (latest[0]?.revisionNumber ?? 0) + 1,
        sourceBatchId: candidate.importBatchIds[0]!,
        releaseNote: input.releaseNote,
        lifecycleStatus: "preparing",
        isCurrent: false,
        indexStatus: "pending",
        normalizedRecords: build.normalizedRecords,
        manifestId: build.manifestId,
        activationBuildId: build.id,
        activationCandidateId: candidate.id,
        provenance: {
          candidateId: candidate.id,
          buildId: build.id,
          batchIds: candidate.importBatchIds,
        },
      })
      .returning();
    if (!preparing)
      throw new DomainError(
        "revision_create_failed",
        "Preparing revision could not be created",
        undefined,
        500,
      );
    await tx.insert(auditLog).values({
      action: "revision_preparing",
      targetType: "dataset_revision",
      targetId: preparing.id,
      reason: input.releaseNote ?? "Candidate promotion",
      metadata: { candidateId: candidate.id, buildId: build.id },
    });
    await tx.insert(jobs).values({
      type: "activate_revision",
      idempotencyKey: `activate_revision:${preparing.id}`,
      payload: {
        revisionId: preparing.id,
        candidateId: candidate.id,
        buildId: build.id,
        contentChecksum: build.contentChecksum,
        expectedCurrentRevisionId: input.expectedCurrentRevisionId ?? null,
      },
    });
    return preparing;
  });
  return mapDatasetRevision(revision);
}

export async function finalizeActivation(
  ctx: Pick<ReleasePromotionContext, "db">,
  input: {
    revisionId: string;
    candidateId: string;
    buildId: string;
    contentChecksum: string;
    expectedCurrentRevisionId?: string | null;
  },
): Promise<DatasetRevision> {
  return ctx.db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from platform.games where id = (select game_id from knowledge.dataset_revisions where id = ${input.revisionId}::uuid) for update`,
    );
    const [revision] = await tx
      .select()
      .from(datasetRevisions)
      .where(eq(datasetRevisions.id, input.revisionId))
      .limit(1);
    const [candidate] = await tx
      .select()
      .from(releaseCandidates)
      .where(eq(releaseCandidates.id, input.candidateId))
      .limit(1);
    const [build] = await tx
      .select()
      .from(releaseCandidateBuilds)
      .where(eq(releaseCandidateBuilds.id, input.buildId))
      .limit(1);
    if (
      !revision ||
      !candidate ||
      !build ||
      revision.lifecycleStatus !== "preparing" ||
      build.contentChecksum !== input.contentChecksum ||
      build.manifestId !== revision.manifestId ||
      build.indexStatus !== "ready"
    )
      throw new DomainError(
        "activation_not_ready",
        "Preparing revision failed activation checks",
        undefined,
        409,
      );
    const [current] = await tx
      .select()
      .from(datasetRevisions)
      .where(
        and(eq(datasetRevisions.gameId, revision.gameId), eq(datasetRevisions.isCurrent, true)),
      )
      .limit(1);
    if (
      input.expectedCurrentRevisionId !== undefined &&
      (current?.id ?? null) !== input.expectedCurrentRevisionId
    )
      throw new DomainError(
        "current_revision_changed",
        "The formal revision changed before activation",
        undefined,
        409,
      );
    if (current)
      await tx
        .update(datasetRevisions)
        .set({ isCurrent: false })
        .where(eq(datasetRevisions.id, current.id));
    const [active] = await tx
      .update(datasetRevisions)
      .set({ lifecycleStatus: "published", isCurrent: true, activatedAt: new Date() })
      .where(eq(datasetRevisions.id, revision.id))
      .returning();
    await tx
      .update(releaseCandidates)
      .set({ status: "promoted", promotedRevisionId: revision.id, updatedAt: new Date() })
      .where(eq(releaseCandidates.id, candidate.id));
    await tx.insert(auditLog).values({
      action: "revision_activated",
      targetType: "dataset_revision",
      targetId: revision.id,
      reason: "Candidate Build activation",
      metadata: { candidateId: candidate.id, buildId: build.id },
    });
    return mapDatasetRevision(active!);
  });
}

export async function setRevisionIndexStatus(
  ctx: Pick<ReleasePromotionContext, "db">,
  revisionId: string,
  status: "ready" | "failed",
  error?: string,
): Promise<void> {
  await ctx.db
    .update(datasetRevisions)
    .set({
      indexStatus: status,
      lifecycleStatus: status === "failed" ? "failed" : undefined,
      activationError: error ? { error } : null,
    })
    .where(eq(datasetRevisions.id, revisionId));
}
