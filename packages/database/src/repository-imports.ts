import { desc, eq } from "drizzle-orm";
import {
  DomainError,
  type ImportBatch,
  type ImportDiff,
  type NormalizedRecord,
  type StructuredImportRecords,
  type ValidationIssue,
} from "@gip/domain";
import type { Database } from "./client.js";
import { importBatches } from "./schema.js";
import { mapImport } from "./repository-mappers.js";

interface ImportContext {
  db: Database;
}

interface ImportReviewContext extends ImportContext {
  registerAcquisitionReview(batch: ImportBatch): Promise<void>;
  ensurePreviewForImport(batch: ImportBatch): Promise<void>;
}

export async function createPendingImport(
  ctx: ImportContext,
  input: {
    gameId: string;
    sourceId: string;
    parserVersion: string;
  },
): Promise<ImportBatch> {
  const [row] = await ctx.db
    .insert(importBatches)
    .values({
      gameId: input.gameId,
      sourceId: input.sourceId,
      sourceSnapshotId: null,
      status: "pending",
      parserVersion: input.parserVersion,
    })
    .returning();
  if (!row)
    throw new DomainError(
      "import_create_failed",
      "Import batch could not be created",
      undefined,
      500,
    );
  return mapImport(row);
}

export async function updateImportStaged(
  ctx: ImportReviewContext,
  input: {
    batchId: string;
    sourceSnapshotId: string;
    stagedRecords?: NormalizedRecord[];
    structuredRecords?: StructuredImportRecords;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
    diff: ImportDiff;
  },
): Promise<ImportBatch> {
  const [row] = await ctx.db
    .update(importBatches)
    .set({
      sourceSnapshotId: input.sourceSnapshotId,
      status: input.errors.length ? "failed" : "review_required",
      successCount: importRecordCount(input.stagedRecords, input.structuredRecords),
      failureCount: input.errors.length,
      errors: input.errors,
      warnings: input.warnings,
      diff: input.diff,
      stagedRecords: input.stagedRecords ?? [],
      structuredRecords: input.structuredRecords,
      completedAt: new Date(),
    })
    .where(eq(importBatches.id, input.batchId))
    .returning();
  if (!row) throw new DomainError("import_not_found", "Import batch was not found", undefined, 404);
  const batch = mapImport(row);
  await ctx.registerAcquisitionReview(batch);
  await ctx.ensurePreviewForImport(batch);
  return batch;
}

export async function markImportRunning(ctx: ImportContext, batchId: string): Promise<ImportBatch> {
  const [row] = await ctx.db
    .update(importBatches)
    .set({ status: "running", completedAt: null })
    .where(eq(importBatches.id, batchId))
    .returning();
  if (!row) throw new DomainError("import_not_found", "Import batch was not found", undefined, 404);
  return mapImport(row);
}

export async function markImportFailed(
  ctx: ImportContext,
  batchId: string,
  issue: ValidationIssue,
): Promise<ImportBatch> {
  const [row] = await ctx.db
    .update(importBatches)
    .set({ status: "failed", failureCount: 1, errors: [issue], completedAt: new Date() })
    .where(eq(importBatches.id, batchId))
    .returning();
  if (!row) throw new DomainError("import_not_found", "Import batch was not found", undefined, 404);
  return mapImport(row);
}

export async function createImport(
  ctx: ImportReviewContext,
  input: {
    gameId: string;
    sourceId: string;
    sourceSnapshotId: string;
    parserVersion: string;
    stagedRecords?: NormalizedRecord[];
    structuredRecords?: StructuredImportRecords;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
    diff: ImportDiff;
  },
): Promise<ImportBatch> {
  const status = input.errors.length ? "failed" : "review_required";
  const [row] = await ctx.db
    .insert(importBatches)
    .values({
      gameId: input.gameId,
      sourceId: input.sourceId,
      sourceSnapshotId: input.sourceSnapshotId,
      status,
      parserVersion: input.parserVersion,
      successCount: importRecordCount(input.stagedRecords, input.structuredRecords),
      failureCount: input.errors.length,
      errors: input.errors,
      warnings: input.warnings,
      diff: input.diff,
      stagedRecords: input.stagedRecords ?? [],
      structuredRecords: input.structuredRecords,
    })
    .returning();
  if (!row)
    throw new DomainError(
      "import_create_failed",
      "Import batch could not be created",
      undefined,
      500,
    );
  const batch = mapImport(row);
  await ctx.registerAcquisitionReview(batch);
  await ctx.ensurePreviewForImport(batch);
  return batch;
}

function importRecordCount(
  stagedRecords: NormalizedRecord[] | undefined,
  structuredRecords: StructuredImportRecords | undefined,
): number {
  return (
    (stagedRecords?.length ?? 0) +
    Object.values(structuredRecords ?? {}).reduce((sum, records) => sum + (records?.length ?? 0), 0)
  );
}

export async function getImport(ctx: ImportContext, batchId: string): Promise<ImportBatch | null> {
  const rows = await ctx.db
    .select()
    .from(importBatches)
    .where(eq(importBatches.id, batchId))
    .limit(1);
  return rows[0] ? mapImport(rows[0]) : null;
}

export async function listImports(ctx: ImportContext, gameId?: string): Promise<ImportBatch[]> {
  const rows = await ctx.db
    .select()
    .from(importBatches)
    .where(gameId ? eq(importBatches.gameId, gameId) : undefined)
    .orderBy(desc(importBatches.createdAt))
    .limit(100);
  return rows.map((row) => mapImport(row));
}

export async function reviewImport(
  ctx: ImportContext,
  batchId: string,
  approved: boolean,
  note: string | undefined,
  confirmedDeletionKeys: string[],
): Promise<ImportBatch> {
  const existing = await getImport(ctx, batchId);
  if (!existing)
    throw new DomainError("import_not_found", "Import batch was not found", undefined, 404);
  if (existing.status !== "review_required" && existing.status !== "staged")
    throw new DomainError(
      "invalid_import_state",
      `Import cannot be reviewed from state ${existing.status}`,
    );
  if (!approved) {
    const [row] = await ctx.db
      .update(importBatches)
      .set({
        status: "cancelled",
        reviewNote: note ?? "Rejected during review",
        confirmedDeletionKeys,
        completedAt: new Date(),
      })
      .where(eq(importBatches.id, batchId))
      .returning();
    if (!row) throw new DomainError("import_review_failed", "Import review failed", undefined, 500);
    return mapImport(row);
  }
  const deletionCandidates = new Set(existing.diff?.deletionCandidates ?? []);
  const invalidDeletionKeys = confirmedDeletionKeys.filter(
    (sourceKey) => !deletionCandidates.has(sourceKey),
  );
  if (invalidDeletionKeys.length)
    throw new DomainError(
      "invalid_deletion_confirmation",
      "Only deletion candidates from this import can be confirmed",
      invalidDeletionKeys,
    );
  if (existing.errors.length)
    throw new DomainError(
      "import_has_errors",
      "Import contains blocking validation errors",
      existing.errors,
    );
  const [row] = await ctx.db
    .update(importBatches)
    .set({ status: "review_required", reviewNote: note ?? "Reviewed", confirmedDeletionKeys })
    .where(eq(importBatches.id, batchId))
    .returning();
  if (!row) throw new DomainError("import_review_failed", "Import review failed", undefined, 500);
  return mapImport(row);
}
