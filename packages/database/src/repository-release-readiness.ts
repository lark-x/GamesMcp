import { and, eq, inArray } from "drizzle-orm";
import {
  DomainError,
  type ReleaseCandidateDetail,
  type ReleaseCandidateReadiness,
} from "@gip/domain";
import type { Database } from "./client.js";
import {
  conflictCases,
  datasetManifests,
  datasetRevisions,
  importBatches,
  releaseCandidateBuilds,
  releaseCandidateChecks,
  releaseCandidates,
  reviewIssues,
} from "./schema.js";
import { mapReleaseCandidateBuild } from "./repository-mappers.js";
import { manifestRootHash, releaseCandidateChecksum } from "./repository-utils.js";

type RevisionRow = typeof datasetRevisions.$inferSelect;

interface ReleaseReadinessContext {
  db: Database;
  getReleaseCandidate(candidateId: string): Promise<ReleaseCandidateDetail | null>;
  getCurrentRevision(gameId: string): Promise<RevisionRow | undefined>;
}

export async function getReleaseCandidateBuild(
  ctx: Pick<ReleaseReadinessContext, "db">,
  buildId: string,
) {
  const rows = await ctx.db
    .select({ build: releaseCandidateBuilds, gameId: releaseCandidates.gameId })
    .from(releaseCandidateBuilds)
    .innerJoin(releaseCandidates, eq(releaseCandidates.id, releaseCandidateBuilds.candidateId))
    .where(eq(releaseCandidateBuilds.id, buildId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return {
    ...mapReleaseCandidateBuild(row.build),
    gameId: row.gameId,
    normalizedRecords: row.build.normalizedRecords,
  };
}

export async function getReleaseCandidateReadiness(
  ctx: ReleaseReadinessContext,
  candidateId: string,
): Promise<ReleaseCandidateReadiness> {
  const candidate = await ctx.getReleaseCandidate(candidateId);
  if (!candidate)
    throw new DomainError("candidate_not_found", "Release candidate was not found", undefined, 404);
  const blockingReasons: ReleaseCandidateReadiness["blockingReasons"] = [];
  const build = candidate.currentBuildId
    ? await getReleaseCandidateBuild(ctx, candidate.currentBuildId)
    : null;
  if (!build)
    blockingReasons.push({
      code: "candidate_build_missing",
      message: "Build the candidate first",
    });
  else if (build.contentChecksum !== releaseCandidateChecksum(build.normalizedRecords))
    blockingReasons.push({
      code: "candidate_checksum_invalid",
      message: "The preview build checksum is invalid",
    });
  if (build && build.indexStatus !== "ready")
    blockingReasons.push({
      code: "candidate_index_not_ready",
      message: "Preview build index is not ready",
    });
  if (build?.manifestId) {
    const [manifest] = await ctx.db
      .select()
      .from(datasetManifests)
      .where(eq(datasetManifests.id, build.manifestId))
      .limit(1);
    if (
      !manifest ||
      manifest.rootHash !== manifestRootHash(build.normalizedRecords) ||
      manifest.recordCount !== build.normalizedRecords.length
    )
      blockingReasons.push({
        code: "manifest_invalid",
        message: "Preview manifest does not match build contents",
      });
  } else if (build)
    blockingReasons.push({ code: "manifest_missing", message: "Preview manifest is missing" });
  const current = await ctx.getCurrentRevision(candidate.gameId);
  if ((current?.id ?? null) !== (candidate.baseRevisionId ?? null))
    blockingReasons.push({
      code: "candidate_base_stale",
      message: "The formal revision changed after this candidate was created",
      details: { expected: candidate.baseRevisionId ?? null, actual: current?.id ?? null },
    });
  const batches = candidate.importBatchIds.length
    ? await ctx.db
        .select()
        .from(importBatches)
        .where(inArray(importBatches.id, candidate.importBatchIds))
    : [];
  for (const batch of batches) {
    if (batch.errors.length)
      blockingReasons.push({
        code: "candidate_batch_has_errors",
        message: `Import batch ${batch.id} has errors`,
      });
    if (!batch.sourceSnapshotId)
      blockingReasons.push({
        code: "source_snapshot_missing",
        message: `Import batch ${batch.id} has no source snapshot`,
      });
    const deletions = batch.diff?.deletionCandidates ?? [];
    if (deletions.some((key) => !batch.confirmedDeletionKeys.includes(key)))
      blockingReasons.push({
        code: "deletions_unconfirmed",
        message: `Import batch ${batch.id} has unconfirmed deletions`,
      });
  }
  const issues = await ctx.db
    .select({ id: reviewIssues.id, summary: reviewIssues.summary })
    .from(reviewIssues)
    .where(
      and(
        eq(reviewIssues.candidateId, candidateId),
        eq(reviewIssues.blocking, true),
        inArray(reviewIssues.status, ["open", "reopened"]),
      ),
    );
  for (const issue of issues)
    blockingReasons.push({
      code: "review_issue_open",
      message: issue.summary,
      details: { issueId: issue.id },
    });
  const checks = await ctx.db
    .select()
    .from(releaseCandidateChecks)
    .where(eq(releaseCandidateChecks.candidateId, candidateId));
  for (const check of checks.filter((item) => item.status !== "passed"))
    blockingReasons.push({
      code: "candidate_check_failed",
      message: check.message ?? `Candidate check ${check.checkType} is not complete`,
      details: { checkType: check.checkType, status: check.status },
    });
  const conflicts = await ctx.db
    .select({ id: conflictCases.id })
    .from(conflictCases)
    .where(and(eq(conflictCases.gameId, candidate.gameId), eq(conflictCases.status, "open")))
    .limit(1);
  if (conflicts.length)
    blockingReasons.push({
      code: "open_conflicts",
      message: "Open source conflicts must be resolved",
    });
  return {
    candidateId,
    buildId: build?.id,
    contentChecksum: build?.contentChecksum,
    ready: blockingReasons.length === 0,
    blockingReasons,
  };
}
