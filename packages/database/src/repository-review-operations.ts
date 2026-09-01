import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  DomainError,
  type ReleaseCandidateCheck,
  type ReviewEvidence,
  type ReviewIssue,
} from "@gip/domain";
import type { Database } from "./client.js";
import { releaseCandidateChecks, reviewEvidence, reviewIssues } from "./schema.js";

interface ReviewOperationContext {
  db: Database;
  getReleaseCandidateBuild(
    buildId: string,
  ): Promise<{ candidateId: string; gameId: string } | null>;
}

export async function listReviewIssues(
  ctx: Pick<ReviewOperationContext, "db">,
  candidateId: string,
): Promise<ReviewIssue[]> {
  const rows = await ctx.db
    .select()
    .from(reviewIssues)
    .where(eq(reviewIssues.candidateId, candidateId))
    .orderBy(desc(reviewIssues.createdAt));
  return rows as ReviewIssue[];
}

export async function reportReviewIssue(
  ctx: ReviewOperationContext,
  input: {
    candidateId: string;
    buildId: string;
    canonicalKey: string;
    fieldPath?: string;
    summary: string;
    details?: Record<string, unknown>;
  },
): Promise<ReviewIssue> {
  const build = await ctx.getReleaseCandidateBuild(input.buildId);
  if (!build || build.candidateId !== input.candidateId)
    throw new DomainError(
      "candidate_build_mismatch",
      "Reported issue must belong to the candidate build",
      undefined,
      400,
    );
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        "reported",
        input.canonicalKey,
        input.fieldPath ?? "",
        input.summary,
        input.details ?? {},
      ]),
    )
    .digest("hex");
  const [row] = await ctx.db
    .insert(reviewIssues)
    .values({
      gameId: build.gameId,
      candidateId: input.candidateId,
      detectedBuildId: input.buildId,
      canonicalKey: input.canonicalKey,
      fieldPath: input.fieldPath,
      kind: "reported",
      status: "open",
      blocking: true,
      fingerprint,
      summary: input.summary,
      details: input.details ?? {},
    })
    .onConflictDoNothing({ target: [reviewIssues.candidateId, reviewIssues.fingerprint] })
    .returning();
  if (row) return row as ReviewIssue;
  const [existing] = await ctx.db
    .select()
    .from(reviewIssues)
    .where(
      and(
        eq(reviewIssues.candidateId, input.candidateId),
        eq(reviewIssues.fingerprint, fingerprint),
      ),
    )
    .limit(1);
  if (!existing)
    throw new DomainError(
      "issue_create_failed",
      "Review issue could not be created",
      undefined,
      500,
    );
  return existing as ReviewIssue;
}

export async function getReviewIssue(
  ctx: Pick<ReviewOperationContext, "db">,
  id: string,
): Promise<ReviewIssue | null> {
  const [row] = await ctx.db.select().from(reviewIssues).where(eq(reviewIssues.id, id)).limit(1);
  return (row as ReviewIssue | undefined) ?? null;
}

export async function resolveReviewIssue(
  ctx: Pick<ReviewOperationContext, "db">,
  id: string,
  action?: string,
  note?: string,
): Promise<ReviewIssue> {
  const [row] = await ctx.db
    .update(reviewIssues)
    .set({
      status: "resolved",
      resolutionAction: action,
      resolutionNote: note,
      resolvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(reviewIssues.id, id))
    .returning();
  if (!row) throw new DomainError("issue_not_found", "Review issue was not found", undefined, 404);
  return row as ReviewIssue;
}

export async function reopenReviewIssue(
  ctx: Pick<ReviewOperationContext, "db">,
  id: string,
): Promise<ReviewIssue> {
  const [row] = await ctx.db
    .update(reviewIssues)
    .set({ status: "reopened", resolvedAt: null, updatedAt: new Date() })
    .where(eq(reviewIssues.id, id))
    .returning();
  if (!row) throw new DomainError("issue_not_found", "Review issue was not found", undefined, 404);
  return row as ReviewIssue;
}

export async function listReviewEvidence(
  ctx: Pick<ReviewOperationContext, "db">,
  issueId: string,
): Promise<ReviewEvidence[]> {
  return (await ctx.db
    .select()
    .from(reviewEvidence)
    .where(eq(reviewEvidence.issueId, issueId))
    .orderBy(desc(reviewEvidence.createdAt))) as ReviewEvidence[];
}

export async function addReviewEvidence(
  ctx: Pick<ReviewOperationContext, "db">,
  input: Omit<ReviewEvidence, "id" | "createdAt">,
): Promise<ReviewEvidence> {
  if (!/^image\/(png|jpeg|webp)$/i.test(input.mimeType) || input.bytes <= 0)
    throw new DomainError("invalid_review_evidence", "Review evidence must be a non-empty image");
  if (!input.checkedGameVersion.trim() || !input.checkedLocale.trim() || !input.note.trim())
    throw new DomainError(
      "review_evidence_provenance_required",
      "Review evidence requires game version, language, and explanation",
    );
  const [row] = await ctx.db
    .insert(reviewEvidence)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .values(input as any)
    .onConflictDoNothing({ target: [reviewEvidence.issueId, reviewEvidence.sha256] })
    .returning();
  if (row) return row as ReviewEvidence;
  const [existing] = await ctx.db
    .select()
    .from(reviewEvidence)
    .where(and(eq(reviewEvidence.issueId, input.issueId), eq(reviewEvidence.sha256, input.sha256)))
    .limit(1);
  if (!existing)
    throw new DomainError(
      "review_evidence_create_failed",
      "Review evidence could not be recorded",
      undefined,
      500,
    );
  return existing as ReviewEvidence;
}

export async function getReviewEvidence(
  ctx: Pick<ReviewOperationContext, "db">,
  evidenceId: string,
): Promise<ReviewEvidence | null> {
  const [row] = await ctx.db
    .select()
    .from(reviewEvidence)
    .where(eq(reviewEvidence.id, evidenceId))
    .limit(1);
  return (row as ReviewEvidence | undefined) ?? null;
}

export async function deleteReviewEvidence(
  ctx: Pick<ReviewOperationContext, "db">,
  evidenceId: string,
): Promise<ReviewEvidence | null> {
  const [row] = await ctx.db
    .delete(reviewEvidence)
    .where(eq(reviewEvidence.id, evidenceId))
    .returning();
  return (row as ReviewEvidence | undefined) ?? null;
}

export async function listReleaseCandidateChecks(
  ctx: Pick<ReviewOperationContext, "db">,
  candidateId: string,
): Promise<ReleaseCandidateCheck[]> {
  return (await ctx.db
    .select()
    .from(releaseCandidateChecks)
    .where(eq(releaseCandidateChecks.candidateId, candidateId))
    .orderBy(desc(releaseCandidateChecks.checkedAt))) as ReleaseCandidateCheck[];
}
