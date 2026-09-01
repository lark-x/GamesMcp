import { basename } from "node:path";
import type { ImportBatch, Source } from "@gip/domain";

export function safeBatch(batch: ImportBatch) {
  return {
    id: batch.id,
    gameId: batch.gameId,
    sourceId: batch.sourceId,
    sourceSnapshotId: batch.sourceSnapshotId,
    status: batch.status,
    parserVersion: batch.parserVersion,
    successCount: batch.successCount,
    failureCount: batch.failureCount,
    errors: batch.errors,
    warnings: batch.warnings,
    diff: batch.diff,
    reviewNote: batch.reviewNote,
    createdAt: batch.createdAt,
    completedAt: batch.completedAt,
  };
}

export function safeSource(source: Source) {
  return {
    id: source.id,
    gameId: source.gameId,
    name: source.name,
    type: source.type,
    pathLabel: safePathLabel(source.pathLabel),
    licenseNote: source.licenseNote,
    enabled: source.enabled,
    parserType: source.parserType,
  };
}

export function safePathLabel(value: string): string {
  return basename(value.replaceAll("\\", "/"));
}

export function safeAcquisitionStatus(value: Record<string, unknown>): Record<string, unknown> {
  const result = { ...value };
  const conversion = value.conversion;
  if (conversion && typeof conversion === "object" && !Array.isArray(conversion)) {
    const conversionRecord = conversion as Record<string, unknown>;
    result.conversion = {
      ...conversionRecord,
      manifestPath: safeReportPath(conversionRecord.manifestPath),
    };
  }
  const latestBackup = value.latestBackup;
  if (latestBackup && typeof latestBackup === "object" && !Array.isArray(latestBackup)) {
    const backupRecord = latestBackup as Record<string, unknown>;
    result.latestBackup = {
      ...backupRecord,
      dumpPath: safeReportPath(backupRecord.dumpPath),
    };
  }
  return result;
}

function safeReportPath(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const normalized = value.replaceAll("\\", "/");
  if (
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split("/").some((part) => part === "..")
  )
    return undefined;
  return normalized;
}
