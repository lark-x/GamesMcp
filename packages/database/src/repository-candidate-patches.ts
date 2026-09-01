import { createHash } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import {
  DomainError,
  type CandidatePatch,
  type NormalizedRecord,
  type ReleaseCandidateDetail,
  type ReviewEvidence,
  type ReviewIssue,
} from "@gip/domain";
import type { Database } from "./client.js";
import { candidatePatches, datasetRevisions } from "./schema.js";
import { canonicalRecordBytes } from "./repository-utils.js";

type RevisionRow = typeof datasetRevisions.$inferSelect;
type CandidateBuild = {
  id: string;
  candidateId: string;
  gameId: string;
  normalizedRecords: NormalizedRecord[];
};

interface CandidatePatchContext {
  db: Database;
  getReleaseCandidate(candidateId: string): Promise<ReleaseCandidateDetail | null>;
  getReleaseCandidateBuild(buildId: string): Promise<CandidateBuild | null>;
  getRevision(revisionId: string, gameId?: string): Promise<RevisionRow | undefined>;
  getRevisionRecords(revision: RevisionRow): Promise<NormalizedRecord[]>;
  getReviewIssue(issueId: string): Promise<ReviewIssue | null>;
  listReviewEvidence(issueId: string): Promise<ReviewEvidence[]>;
}

export async function listCandidatePatches(
  ctx: Pick<CandidatePatchContext, "db">,
  candidateId: string,
): Promise<CandidatePatch[]> {
  return (await ctx.db
    .select()
    .from(candidatePatches)
    .where(eq(candidatePatches.candidateId, candidateId))
    .orderBy(desc(candidatePatches.createdAt))) as CandidatePatch[];
}

export async function createCandidatePatch(
  ctx: CandidatePatchContext,
  input: {
    candidateId: string;
    issueId?: string;
    canonicalKey: string;
    fieldPath?: string;
    action: string;
    manualValue?: unknown;
    expectedBaseHash?: string;
    expectedIncomingHash?: string;
  },
): Promise<CandidatePatch> {
  const allowedActions = new Set([
    "keep_main",
    "use_incoming",
    "manual",
    "not_duplicate",
    "confirm_delete",
    "exclude_record",
  ]);
  if (!allowedActions.has(input.action))
    throw new DomainError("invalid_patch_action", "Patch action is not supported", undefined, 400);
  if (input.action === "manual" && (!input.fieldPath || input.manualValue === undefined))
    throw new DomainError(
      "patch_manual_value_required",
      "Manual patches require both fieldPath and manualValue",
      undefined,
      400,
    );
  if (input.expectedBaseHash && !/^[a-f0-9]{64}$/.test(input.expectedBaseHash))
    throw new DomainError("invalid_patch_hash", "expectedBaseHash must be sha256");
  if (input.expectedIncomingHash && !/^[a-f0-9]{64}$/.test(input.expectedIncomingHash))
    throw new DomainError("invalid_patch_hash", "expectedIncomingHash must be sha256");
  const candidate = await ctx.getReleaseCandidate(input.candidateId);
  if (!candidate)
    throw new DomainError("candidate_not_found", "Release candidate was not found", undefined, 404);
  if (["promoted", "withdrawn", "abandoned"].includes(candidate.status))
    throw new DomainError(
      "invalid_candidate_state",
      `Candidate cannot be patched from state ${candidate.status}`,
      undefined,
      409,
    );
  const build = candidate.currentBuildId
    ? await ctx.getReleaseCandidateBuild(candidate.currentBuildId)
    : null;
  if (!build)
    throw new DomainError(
      "candidate_build_missing",
      "Build the candidate before recording a patch",
      undefined,
      409,
    );
  const incoming = build.normalizedRecords.find(
    (record) => record.sourceKey === input.canonicalKey,
  );
  if (!incoming && !["confirm_delete", "exclude_record"].includes(input.action))
    throw new DomainError(
      "patch_target_missing",
      `Patch target is missing from the current Build: ${input.canonicalKey}`,
      undefined,
      409,
    );
  if (input.expectedIncomingHash) {
    const actual = incoming
      ? createHash("sha256").update(canonicalRecordBytes(incoming)).digest("hex")
      : null;
    if (actual !== input.expectedIncomingHash)
      throw new DomainError(
        "patch_precondition_failed",
        "The current Build changed before this patch was recorded",
        { expectedIncomingHash: input.expectedIncomingHash, actualIncomingHash: actual },
        409,
      );
  }
  if (input.expectedBaseHash) {
    const baseRevision = candidate.baseRevisionId
      ? await ctx.getRevision(candidate.baseRevisionId, candidate.gameId)
      : null;
    const baseRecord = baseRevision
      ? (await ctx.getRevisionRecords(baseRevision)).find(
          (record) => record.sourceKey === input.canonicalKey,
        )
      : undefined;
    const actual = baseRecord
      ? createHash("sha256").update(canonicalRecordBytes(baseRecord)).digest("hex")
      : null;
    if (actual !== input.expectedBaseHash)
      throw new DomainError(
        "patch_precondition_failed",
        "The formal base changed before this patch was recorded",
        { expectedBaseHash: input.expectedBaseHash, actualBaseHash: actual },
        409,
      );
  }
  if (input.issueId) {
    const issue = await ctx.getReviewIssue(input.issueId);
    if (!issue)
      throw new DomainError("issue_not_found", "Review issue was not found", undefined, 404);
    if (issue.candidateId !== input.candidateId)
      throw new DomainError(
        "patch_issue_candidate_mismatch",
        "Review issue belongs to another candidate",
        undefined,
        409,
      );
    if (
      issue.canonicalKey !== input.canonicalKey ||
      (issue.fieldPath !== null &&
        issue.fieldPath !== undefined &&
        issue.fieldPath !== (input.fieldPath ?? null))
    )
      throw new DomainError(
        "patch_issue_scope_mismatch",
        "Patch key or field does not match the review issue",
        undefined,
        409,
      );
    if (issue.detectedBuildId && issue.detectedBuildId !== build.id) {
      const detectedBuild = await ctx.getReleaseCandidateBuild(issue.detectedBuildId);
      const detectedRecord = detectedBuild?.normalizedRecords.find(
        (record) => record.sourceKey === issue.canonicalKey,
      );
      const currentRecord = build.normalizedRecords.find(
        (record) => record.sourceKey === issue.canonicalKey,
      );
      if (
        !detectedRecord ||
        !currentRecord ||
        canonicalRecordBytes(detectedRecord) !== canonicalRecordBytes(currentRecord)
      )
        throw new DomainError(
          "patch_issue_build_stale",
          "The reviewed record changed after this issue was reported",
          { detectedBuildId: issue.detectedBuildId, currentBuildId: build.id },
          409,
        );
    }
    const uploadedEvidence = await ctx.listReviewEvidence(issue.id);
    if (!uploadedEvidence.length)
      throw new DomainError(
        "review_evidence_required",
        "Upload an in-game screenshot before recording this review decision",
        undefined,
        409,
      );
  }
  const [row] = await ctx.db
    .insert(candidatePatches)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .values(input as any)
    .returning();
  return row as CandidatePatch;
}
