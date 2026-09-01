import type {
  DatasetRevision,
  ImportBatch,
  ReleaseCandidate,
  ReleaseCandidateBuild,
  VerificationChannel,
  VerificationItem,
  VerificationStatus,
} from "@gip/domain";
import {
  datasetRevisions,
  importBatches,
  releaseCandidateBuilds,
  releaseCandidates,
  sourceObservations,
  verificationItems,
} from "./schema.js";
import { safeProvenance } from "./repository-utils.js";

export function mapImport(row: typeof importBatches.$inferSelect): ImportBatch {
  return {
    id: row.id,
    gameId: row.gameId,
    sourceId: row.sourceId,
    sourceSnapshotId: row.sourceSnapshotId,
    status: row.status as ImportBatch["status"],
    parserVersion: row.parserVersion,
    successCount: row.successCount,
    failureCount: row.failureCount,
    errors: row.errors,
    warnings: row.warnings,
    diff: row.diff ?? undefined,
    stagedRecords: row.stagedRecords ?? undefined,
    structuredRecords: row.structuredRecords ?? undefined,
    reviewNote: row.reviewNote,
    confirmedDeletionKeys: row.confirmedDeletionKeys,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

export function mapDatasetRevision(row: typeof datasetRevisions.$inferSelect): DatasetRevision {
  return {
    id: row.id,
    gameId: row.gameId,
    revisionNumber: row.revisionNumber,
    sourceBatchId: row.sourceBatchId,
    releaseNote: row.releaseNote,
    publishedAt: row.publishedAt,
    isCurrent: row.isCurrent,
    indexStatus: row.indexStatus as DatasetRevision["indexStatus"],
    structuredRecords: row.structuredRecords ?? undefined,
    lifecycleStatus: row.lifecycleStatus as DatasetRevision["lifecycleStatus"],
    manifestId: row.manifestId,
    sourceId: row.sourceId,
    gameVersion: row.gameVersion,
    locale: row.locale,
    archivedReason: row.archivedReason,
    archivedAt: row.archivedAt,
  };
}

export function mapReleaseCandidate(row: typeof releaseCandidates.$inferSelect): ReleaseCandidate {
  return {
    id: row.id,
    gameId: row.gameId,
    name: row.name,
    baseRevisionId: row.baseRevisionId,
    importBatchIds: row.importBatchIds,
    status: row.status as ReleaseCandidate["status"],
    currentBuildId: row.currentBuildId,
    promotedRevisionId: row.promotedRevisionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function mapReleaseCandidateBuild(
  row: typeof releaseCandidateBuilds.$inferSelect,
): ReleaseCandidateBuild {
  return {
    id: row.id,
    candidateId: row.candidateId,
    buildNumber: row.buildNumber,
    status: row.status as ReleaseCandidateBuild["status"],
    contentChecksum: row.contentChecksum,
    recordCount: row.normalizedRecords.length,
    createdAt: row.createdAt,
    manifestId: row.manifestId,
    importBatchId: row.importBatchId,
    baseRevisionId: row.baseRevisionId,
    buildKind: row.buildKind,
    indexStatus: row.indexStatus,
  };
}

export function mapVerificationItem(
  row: typeof verificationItems.$inferSelect,
  screenshotCount: number,
  observation?: typeof sourceObservations.$inferSelect,
): VerificationItem {
  return {
    id: row.id,
    runId: row.runId,
    category: row.category as VerificationItem["category"],
    canonicalKey: row.canonicalKey,
    title: row.title,
    body: observation?.body ?? null,
    sourceId: observation?.sourceId ?? null,
    sourceSnapshotId: observation?.sourceSnapshotId ?? null,
    gameVersion: observation?.gameVersion ?? null,
    locale: observation?.locale ?? null,
    provenance: observation
      ? safeProvenance(observation.provenance, observation.canonicalKey)
      : undefined,
    status: row.status as VerificationStatus,
    channel: row.channel as VerificationChannel | null,
    checkedGameVersion: row.checkedGameVersion,
    checkedLocale: row.checkedLocale,
    note: row.note,
    required: row.required,
    screenshotCount,
  };
}
