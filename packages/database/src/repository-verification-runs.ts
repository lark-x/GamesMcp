import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  DomainError,
  type VerificationChannel,
  type VerificationItem,
  type VerificationRun,
  type VerificationStatus,
} from "@gip/domain";
import type { Database } from "./client.js";
import {
  datasetRevisions,
  importBatches,
  sourceObservations,
  verificationItems,
  verificationRuns,
  verificationScreenshots,
} from "./schema.js";
import { mapVerificationItem } from "./repository-mappers.js";
import {
  nextVerificationReplacement,
  recordCanonicalKey,
  revisionLabel,
} from "./repository-utils.js";

export interface VerificationRunContext {
  db: Database;
}

export async function addVerificationReplacement(
  ctx: Pick<VerificationRunContext, "db">,
  runId: string,
  category: string,
): Promise<void> {
  const [run] = await ctx.db
    .select()
    .from(verificationRuns)
    .where(eq(verificationRuns.id, runId))
    .limit(1);
  if (!run) return;
  const [batch] = await ctx.db
    .select({ stagedRecords: importBatches.stagedRecords })
    .from(importBatches)
    .where(eq(importBatches.id, run.batchId))
    .limit(1);
  if (!batch?.stagedRecords?.length) return;
  const existingItems = await ctx.db
    .select({ canonicalKey: verificationItems.canonicalKey })
    .from(verificationItems)
    .where(eq(verificationItems.runId, run.id));
  const existingKeys = new Set(existingItems.map((item) => item.canonicalKey));
  const candidate = nextVerificationReplacement(
    batch.stagedRecords,
    run.seed,
    category,
    existingKeys,
  );
  if (!candidate) return;
  await ctx.db
    .insert(verificationItems)
    .values({
      runId: run.id,
      category,
      canonicalKey: recordCanonicalKey(candidate),
      title: candidate.title ?? recordCanonicalKey(candidate),
    })
    .onConflictDoNothing();
}

export async function updateVerificationItem(
  ctx: Pick<VerificationRunContext, "db">,
  input: {
    itemId: string;
    status: VerificationStatus;
    channel: VerificationChannel;
    checkedGameVersion: string;
    checkedLocale: string;
    note?: string;
  },
): Promise<VerificationItem> {
  const scopeRows = await ctx.db
    .select({
      runId: verificationItems.runId,
      category: verificationItems.category,
      currentStatus: verificationItems.status,
      expectedGameVersion: verificationRuns.expectedGameVersion,
      expectedLocale: verificationRuns.expectedLocale,
    })
    .from(verificationItems)
    .innerJoin(verificationRuns, eq(verificationItems.runId, verificationRuns.id))
    .where(eq(verificationItems.id, input.itemId))
    .limit(1);
  const scope = scopeRows[0];
  if (!scope)
    throw new DomainError(
      "verification_item_not_found",
      "Verification item was not found",
      undefined,
      404,
    );
  if (
    input.status === "exact_match" &&
    input.channel === "game_client" &&
    (input.checkedGameVersion !== scope.expectedGameVersion ||
      input.checkedLocale !== scope.expectedLocale)
  )
    throw new DomainError(
      "verification_scope_mismatch",
      `Exact game-client verification requires version ${scope.expectedGameVersion} and locale ${scope.expectedLocale}`,
    );
  const [row] = await ctx.db
    .update(verificationItems)
    .set({
      status: input.status,
      channel: input.channel,
      checkedGameVersion: input.checkedGameVersion,
      checkedLocale: input.checkedLocale,
      note: input.note,
      updatedAt: new Date(),
    })
    .where(eq(verificationItems.id, input.itemId))
    .returning();
  if (!row)
    throw new DomainError(
      "verification_item_not_found",
      "Verification item was not found",
      undefined,
      404,
    );
  if (
    input.status === "unavailable_due_unlock" &&
    scope.currentStatus !== "unavailable_due_unlock"
  ) {
    await addVerificationReplacement(ctx, scope.runId, scope.category);
  }
  const screenshotCount = await ctx.db
    .select({ count: sql<number>`count(*)` })
    .from(verificationScreenshots)
    .where(eq(verificationScreenshots.itemId, row.id));
  return mapVerificationItem(row, Number(screenshotCount[0]?.count ?? 0));
}

export async function getVerificationRun(
  ctx: Pick<VerificationRunContext, "db">,
  batchId: string,
): Promise<VerificationRun | null> {
  const rows = await ctx.db
    .select()
    .from(verificationRuns)
    .where(eq(verificationRuns.batchId, batchId))
    .limit(1);
  const run = rows[0];
  if (!run) return null;
  const itemRows = await ctx.db
    .select()
    .from(verificationItems)
    .where(eq(verificationItems.runId, run.id))
    .orderBy(asc(verificationItems.category), asc(verificationItems.title));
  const screenshotRows = itemRows.length
    ? await ctx.db
        .select()
        .from(verificationScreenshots)
        .where(
          inArray(
            verificationScreenshots.itemId,
            itemRows.map((item) => item.id),
          ),
        )
    : [];
  const counts = new Map<string, number>();
  for (const screenshot of screenshotRows)
    counts.set(screenshot.itemId, (counts.get(screenshot.itemId) ?? 0) + 1);
  const [batch] = await ctx.db
    .select({ sourceSnapshotId: importBatches.sourceSnapshotId })
    .from(importBatches)
    .where(eq(importBatches.id, run.batchId))
    .limit(1);
  const observationRows =
    batch?.sourceSnapshotId && itemRows.length
      ? await ctx.db
          .select()
          .from(sourceObservations)
          .where(
            and(
              eq(sourceObservations.sourceSnapshotId, batch.sourceSnapshotId),
              inArray(
                sourceObservations.canonicalKey,
                itemRows.map((item) => item.canonicalKey),
              ),
            ),
          )
      : [];
  const observations = new Map(
    observationRows.map((observation) => [observation.canonicalKey, observation]),
  );
  const [revision] = await ctx.db
    .select({ revisionNumber: datasetRevisions.revisionNumber })
    .from(datasetRevisions)
    .where(eq(datasetRevisions.sourceBatchId, run.batchId))
    .limit(1);
  return {
    id: run.id,
    batchId: run.batchId,
    datasetRevision: revision ? revisionLabel(revision.revisionNumber) : null,
    upstreamCommit: run.upstreamCommit,
    expectedGameVersion: run.expectedGameVersion,
    expectedLocale: run.expectedLocale,
    seed: run.seed,
    status: run.status as VerificationRun["status"],
    createdAt: run.createdAt,
    items: itemRows.map((item) =>
      mapVerificationItem(item, counts.get(item.id) ?? 0, observations.get(item.canonicalKey)),
    ),
  };
}
