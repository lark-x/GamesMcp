import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { and, desc, eq, inArray } from "drizzle-orm";
import { DomainError, type ImportBatch } from "@gip/domain";
import type { Database } from "./client.js";
import {
  conflictCases,
  sourceObservations,
  sourceSnapshots,
  sources,
  verificationItems,
  verificationRuns,
  verificationScreenshots,
} from "./schema.js";
import {
  animeCategory,
  animeCategoryFiles,
  animeCategoryPlural,
  asRecord,
  recordCanonicalKey,
  safeProvenance,
  safeRelative,
  type AcquisitionManifestInfo,
  type AnimeCategory,
} from "./repository-utils.js";

export interface PublishGateContext {
  db: Database;
  dataDir?: string;
}

export interface PublishReviewContext extends PublishGateContext {
  getImport(batchId: string): Promise<ImportBatch | null>;
}

export async function readAcquisitionManifest(
  ctx: PublishGateContext,
  batch: ImportBatch,
): Promise<AcquisitionManifestInfo | undefined> {
  if (!ctx.dataDir || !batch.sourceSnapshotId) return undefined;
  const [snapshot] = await ctx.db
    .select({ metadata: sourceSnapshots.metadata })
    .from(sourceSnapshots)
    .where(eq(sourceSnapshots.id, batch.sourceSnapshotId))
    .limit(1);
  const manifestPath = safeRelative(asRecord(snapshot?.metadata).manifestPath);
  if (!manifestPath) return undefined;
  const absolutePath = resolve(process.cwd(), manifestPath);
  const relativeToData = relative(ctx.dataDir, absolutePath);
  if (!relativeToData || relativeToData.startsWith("..") || isAbsolute(relativeToData))
    return undefined;
  try {
    const bytes = await readFile(absolutePath);
    const value = JSON.parse(bytes.toString("utf8")) as unknown;
    return {
      path: absolutePath,
      value: asRecord(value),
      hash: createHash("sha256").update(bytes).digest("hex"),
    };
  } catch {
    return undefined;
  }
}

/**
 * Enforce the deterministic AnimeGameData completeness contract at the
 * actual publication boundary. The status report is useful for operators,
 * but it must not be possible to publish a batch when the report would say
 * that its Manifest or source coverage is incomplete.
 */
export async function ensureAnimeAcquisitionIntegrity(
  ctx: PublishGateContext,
  batch: ImportBatch,
): Promise<void> {
  if (!ctx.dataDir || !batch.sourceSnapshotId) return;
  const [source] = await ctx.db
    .select({ parserType: sources.parserType })
    .from(sources)
    .where(eq(sources.id, batch.sourceId))
    .limit(1);
  if (!source?.parserType.startsWith("anime-game-data:")) return;
  if (source.parserType === "anime-game-data:structured") {
    await ensureStructuredAnimeAcquisitionIntegrity(ctx, batch);
    return;
  }
  if (!batch.stagedRecords?.length)
    throw new DomainError(
      "acquisition_manifest_incomplete",
      "AnimeGameData batch has no staged records",
      { batchId: batch.id },
    );
  const manifestInfo = await readAcquisitionManifest(ctx, batch);
  if (!manifestInfo)
    throw new DomainError(
      "acquisition_manifest_required",
      "The AnimeGameData Manifest for this batch could not be located or read",
      { batchId: batch.id },
    );

  const manifest = manifestInfo.value;
  const upstream = asRecord(manifest.upstream);
  const upstreamCommit = typeof upstream.commit === "string" ? upstream.commit : undefined;
  const gameVersion = typeof manifest.gameVersion === "string" ? manifest.gameVersion : undefined;
  const locale = typeof manifest.locale === "string" ? manifest.locale : undefined;
  const accounting = asRecord(manifest.accounting);
  const invalidAccounting = Object.entries(animeCategoryPlural)
    .filter(([category, plural]) => {
      const entry = asRecord(accounting[plural]);
      const discovered = typeof entry.discovered === "number" ? entry.discovered : undefined;
      const converted = typeof entry.converted === "number" ? entry.converted : undefined;
      const excluded = typeof entry.excluded === "number" ? entry.excluded : undefined;
      const failures = typeof entry.failures === "number" ? entry.failures : undefined;
      const accounted = typeof entry.accounted === "number" ? entry.accounted : undefined;
      const validCounts = [discovered, converted, excluded, failures, accounted].every(
        (value): value is number => Number.isSafeInteger(value),
      );
      const countsConsistent =
        validCounts &&
        accounted === (converted ?? 0) + (excluded ?? 0) + (failures ?? 0) &&
        accounted === (discovered ?? 0);
      return !animeCategory(category) || entry.coverage !== 1 || !validCounts || !countsConsistent;
    })
    .map(([category]) => category);
  const accountedCoverage = asRecord(manifest.accountedCoverage);
  const invalidAccountedCoverage = Object.entries(animeCategoryPlural)
    .filter(([, plural]) => accountedCoverage[plural] !== 1)
    .map(([category]) => category);
  const unexplainedMissing = Array.isArray(manifest.unexplainedMissing)
    ? manifest.unexplainedMissing
    : undefined;
  if (
    !upstreamCommit ||
    !gameVersion ||
    !locale ||
    !unexplainedMissing ||
    unexplainedMissing.length > 0 ||
    invalidAccounting.length > 0 ||
    invalidAccountedCoverage.length > 0
  )
    throw new DomainError(
      "acquisition_manifest_incomplete",
      "AnimeGameData Manifest is incomplete or has unexplained missing records",
      {
        batchId: batch.id,
        invalidAccounting,
        invalidAccountedCoverage,
        unexplainedMissing: unexplainedMissing ?? "missing",
      },
    );

  const declaredRecordsRoot = safeRelative(manifest.outputRecordsPath);
  const recordsRoot = declaredRecordsRoot
    ? resolve(process.cwd(), declaredRecordsRoot)
    : resolve(dirname(manifestInfo.path), "records");
  const recordsRelative = relative(ctx.dataDir, recordsRoot);
  if (!recordsRelative || recordsRelative.startsWith("..") || isAbsolute(recordsRelative))
    throw new DomainError(
      "acquisition_manifest_incomplete",
      "AnimeGameData Manifest records path is outside the external data directory",
      { batchId: batch.id },
    );

  const expectedKeys = new Map<AnimeCategory, Set<string>>();
  const recordFileErrors: string[] = [];
  for (const [category, filename] of Object.entries(animeCategoryFiles) as Array<
    [AnimeCategory, string]
  >) {
    try {
      const rows = JSON.parse(await readFile(join(recordsRoot, filename), "utf8")) as unknown;
      if (!Array.isArray(rows)) {
        recordFileErrors.push(`${category}: not an array`);
        continue;
      }
      const keys = new Set(
        rows
          .map((row) => asRecord(row).sourceKey)
          .filter((key): key is string => typeof key === "string" && Boolean(key.trim())),
      );
      if (keys.size !== rows.length) recordFileErrors.push(`${category}: duplicate or empty key`);
      expectedKeys.set(category, keys);
      const entry = asRecord(accounting[animeCategoryPlural[category]]);
      if (entry.converted !== keys.size)
        recordFileErrors.push(
          `${category}: Manifest converted=${String(entry.converted)} but records=${keys.size}`,
        );
    } catch {
      recordFileErrors.push(`${category}: records file is missing or invalid`);
    }
  }
  if (recordFileErrors.length)
    throw new DomainError(
      "acquisition_manifest_incomplete",
      "AnimeGameData records do not match the Manifest",
      { batchId: batch.id, recordFileErrors: recordFileErrors.slice(0, 20) },
    );

  const sourceCategory = animeCategory(source.parserType.replace(/^anime-game-data:/, ""));
  const stagedCategories = [
    ...new Set(
      batch.stagedRecords
        .map((record) => animeCategory(record.documentType ?? record.recordType))
        .filter((category): category is AnimeCategory => Boolean(category)),
    ),
  ];
  if (
    !sourceCategory ||
    stagedCategories.length === 0 ||
    !stagedCategories.includes(sourceCategory)
  )
    throw new DomainError(
      "acquisition_manifest_incomplete",
      "AnimeGameData batch category does not match its source parser",
      { batchId: batch.id, sourceCategory, stagedCategories },
    );

  const stagedKeyErrors: string[] = [];
  for (const category of stagedCategories) {
    const expected = expectedKeys.get(category) ?? new Set<string>();
    const staged = new Set(
      batch.stagedRecords
        .filter((record) => animeCategory(record.documentType ?? record.recordType) === category)
        .map(
          (record) =>
            safeProvenance(record.metadata, record.sourceKey).canonicalKey ?? record.sourceKey,
        ),
    );
    const missing = [...expected].filter((key) => !staged.has(key));
    const unexpected = [...staged].filter((key) => !expected.has(key));
    if (missing.length || unexpected.length)
      stagedKeyErrors.push(
        `${category}: missing=${missing.slice(0, 10).join(",")} unexpected=${unexpected.slice(0, 10).join(",")}`,
      );
    for (const record of batch.stagedRecords.filter(
      (candidate) => animeCategory(candidate.documentType ?? candidate.recordType) === category,
    )) {
      const provenance = safeProvenance(record.metadata, record.sourceKey);
      if (
        record.gameVersion !== gameVersion ||
        provenance.locale !== locale ||
        provenance.upstreamCommit !== upstreamCommit
      )
        stagedKeyErrors.push(`${category}: scope mismatch for ${record.sourceKey}`);
    }
  }
  if (stagedKeyErrors.length)
    throw new DomainError(
      "acquisition_manifest_incomplete",
      "AnimeGameData staged records do not match the Manifest scope",
      { batchId: batch.id, errors: stagedKeyErrors.slice(0, 20) },
    );

  const sourceRows = await ctx.db
    .select({ id: sources.id, parserType: sources.parserType, enabled: sources.enabled })
    .from(sources)
    .where(eq(sources.gameId, batch.gameId));
  const animeSources = sourceRows.filter((candidate) =>
    candidate.parserType.startsWith("anime-game-data:"),
  );
  const coverageErrors: string[] = [];
  for (const category of stagedCategories) {
    const expected = expectedKeys.get(category) ?? new Set<string>();
    const categorySources = animeSources.filter(
      (candidate) => candidate.enabled && candidate.parserType === `anime-game-data:${category}`,
    );
    if (!categorySources.length) {
      coverageErrors.push(`${category}: no enabled source`);
      continue;
    }
    for (const candidate of categorySources) {
      const [latest] = await ctx.db
        .select({ id: sourceSnapshots.id })
        .from(sourceSnapshots)
        .where(eq(sourceSnapshots.sourceId, candidate.id))
        .orderBy(desc(sourceSnapshots.capturedAt))
        .limit(1);
      if (!latest) {
        coverageErrors.push(`${category}/${candidate.id}: no snapshot`);
        continue;
      }
      const observations = await ctx.db
        .select()
        .from(sourceObservations)
        .where(eq(sourceObservations.sourceSnapshotId, latest.id));
      const observed = observations.filter((observation) => observation.category === category);
      const observedKeys = new Set(observed.map((observation) => observation.canonicalKey));
      const missing = [...expected].filter((key) => !observedKeys.has(key));
      const unexpected = [...observedKeys].filter((key) => !expected.has(key));
      const versions = new Set(observed.map((observation) => observation.gameVersion));
      const locales = new Set(observed.map((observation) => observation.locale));
      const commits = new Set(
        observed.map(
          (observation) =>
            safeProvenance(observation.provenance, observation.canonicalKey).upstreamCommit,
        ),
      );
      if (
        observations.length !== observed.length ||
        observed.length !== observedKeys.size ||
        missing.length ||
        unexpected.length ||
        observed.length !== expected.size ||
        versions.size !== 1 ||
        !versions.has(gameVersion) ||
        locales.size !== 1 ||
        !locales.has(locale) ||
        commits.size !== 1 ||
        !commits.has(upstreamCommit)
      )
        coverageErrors.push(
          `${category}/${candidate.id}: observed=${observedKeys.size} expected=${expected.size} missing=${missing.slice(0, 10).join(",")} unexpected=${unexpected.slice(0, 10).join(",")}`,
        );
    }
  }
  if (coverageErrors.length)
    throw new DomainError(
      "source_coverage_incomplete",
      "Enabled AnimeGameData source coverage is incomplete",
      { batchId: batch.id, errors: coverageErrors.slice(0, 20) },
    );

  const animeSourceIds = animeSources.map((candidate) => candidate.id);
  const observations = animeSourceIds.length
    ? await ctx.db
        .select()
        .from(sourceObservations)
        .where(
          and(
            eq(sourceObservations.gameId, batch.gameId),
            inArray(sourceObservations.sourceId, animeSourceIds),
          ),
        )
    : [];
  const observationErrors: string[] = [];
  for (const observation of observations) {
    const provenance = safeProvenance(observation.provenance, observation.canonicalKey);
    if (
      !observation.canonicalKey.trim() ||
      !observation.category.trim() ||
      !observation.gameVersion.trim() ||
      !observation.locale.trim() ||
      !observation.title.trim() ||
      !observation.body.trim() ||
      !/^[0-9a-f]{64}$/i.test(observation.rawContentHash) ||
      !/^[0-9a-f]{64}$/i.test(observation.normalizedContentHash) ||
      provenance.rawContentHash !== observation.rawContentHash ||
      provenance.normalizedContentHash !== observation.normalizedContentHash ||
      !provenance.lineage?.title ||
      !provenance.lineage.body
    )
      observationErrors.push(observation.id);
  }
  if (observationErrors.length)
    throw new DomainError(
      "acquisition_observation_integrity_failed",
      "AnimeGameData source observations failed the integrity audit",
      { batchId: batch.id, observationIds: observationErrors.slice(0, 20) },
    );
}

const structuredRecordFiles = {
  characters: "characters.json",
  weapons: "weapons.json",
  artifactSets: "artifact-sets.json",
  artifacts: "artifacts.json",
  materials: "materials.json",
  achievements: "achievements.json",
  enemies: "enemies.json",
  voices: "voices.json",
} as const;

type StructuredKind = keyof typeof structuredRecordFiles;

async function ensureStructuredAnimeAcquisitionIntegrity(
  ctx: PublishGateContext,
  batch: ImportBatch,
): Promise<void> {
  if (!ctx.dataDir) return;
  if (!batch.structuredRecords)
    throw new DomainError(
      "acquisition_manifest_incomplete",
      "Structured AnimeGameData batch has no structured records",
      { batchId: batch.id },
    );
  const manifestInfo = await readAcquisitionManifest(ctx, batch);
  if (!manifestInfo)
    throw new DomainError(
      "acquisition_manifest_required",
      "The structured AnimeGameData Manifest for this batch could not be located or read",
      { batchId: batch.id },
    );
  const manifest = manifestInfo.value;
  const converted = asRecord(manifest.converted);
  const coverage = asRecord(manifest.coverage);
  const stableIdCoverage = asRecord(manifest.stableIdCoverage);
  const missingOrIncomplete = (Object.keys(structuredRecordFiles) as StructuredKind[]).filter(
    (kind) =>
      typeof converted[kind] !== "number" || coverage[kind] !== 1 || stableIdCoverage[kind] !== 1,
  );
  if (
    manifest.converterVersion !== "anime-game-data-structured-v1" ||
    typeof manifest.upstreamCommit !== "string" ||
    typeof manifest.gameVersion !== "string" ||
    typeof manifest.contentHash !== "string" ||
    missingOrIncomplete.length
  )
    throw new DomainError(
      "acquisition_manifest_incomplete",
      "Structured AnimeGameData Manifest is incomplete",
      { batchId: batch.id, missingOrIncomplete },
    );

  const declaredRecordsRoot = safeRelative(manifest.outputRecordsPath);
  const recordsRoot = declaredRecordsRoot
    ? resolve(process.cwd(), declaredRecordsRoot)
    : resolve(dirname(manifestInfo.path), "records");
  const recordsRelative = relative(ctx.dataDir, recordsRoot);
  if (!recordsRelative || recordsRelative.startsWith("..") || isAbsolute(recordsRelative))
    throw new DomainError(
      "acquisition_manifest_incomplete",
      "Structured AnimeGameData records path is outside the external data directory",
      { batchId: batch.id },
    );

  const errors: string[] = [];
  for (const [kind, filename] of Object.entries(structuredRecordFiles) as Array<
    [StructuredKind, string]
  >) {
    try {
      const rows = JSON.parse(await readFile(join(recordsRoot, filename), "utf8")) as unknown;
      if (!Array.isArray(rows)) {
        errors.push(`${kind}: not an array`);
        continue;
      }
      const fileStableIds = new Set(
        rows
          .map((row) => asRecord(row).stableId)
          .filter((value): value is string => typeof value === "string" && Boolean(value.trim())),
      );
      const stagedStableIds = new Set(
        (batch.structuredRecords[kind] ?? []).map((record) => record.stableId),
      );
      if (fileStableIds.size !== rows.length) errors.push(`${kind}: duplicate or empty stableId`);
      if (converted[kind] !== fileStableIds.size)
        errors.push(
          `${kind}: Manifest converted=${String(converted[kind])} but records=${fileStableIds.size}`,
        );
      const missing = [...fileStableIds].filter((id) => !stagedStableIds.has(id));
      const unexpected = [...stagedStableIds].filter((id) => !fileStableIds.has(id));
      if (missing.length || unexpected.length)
        errors.push(
          `${kind}: missing=${missing.slice(0, 10).join(",")} unexpected=${unexpected.slice(0, 10).join(",")}`,
        );
    } catch {
      errors.push(`${kind}: records file is missing or invalid`);
    }
  }
  if (errors.length)
    throw new DomainError(
      "acquisition_manifest_incomplete",
      "Structured AnimeGameData records do not match the Manifest",
      { batchId: batch.id, errors: errors.slice(0, 20) },
    );
}

/**
 * A release backup is an operational prerequisite for acquired upstream
 * data.  The API/worker passes the external data directory to this
 * repository; fixture repositories leave it undefined and retain the
 * existing non-acquisition publish behavior.
 */
export async function ensureReleaseBackup(
  ctx: PublishGateContext,
  batch: ImportBatch,
): Promise<void> {
  if (!ctx.dataDir) return;
  const requiresBackup = Boolean(
    batch.stagedRecords?.some((record) => {
      const provenance = asRecord(record.metadata.provenance);
      return typeof (provenance.upstreamCommit ?? record.metadata.upstreamCommit) === "string";
    }) ||
    Object.values(batch.structuredRecords ?? {}).some((records) =>
      records?.some((record) => typeof asRecord(record.provenance).upstreamCommit === "string"),
    ),
  );
  if (!requiresBackup) return;

  const expectedManifestHash = await acquisitionManifestHash(ctx, batch);
  if (!expectedManifestHash)
    throw new DomainError(
      "release_manifest_required",
      "The acquisition Manifest for this batch could not be located or read",
      { batchId: batch.id },
    );

  const backupRoot = resolve(ctx.dataDir, "backups");
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = (await readdir(backupRoot, { withFileTypes: true })).filter((entry) =>
      entry.isDirectory(),
    );
  } catch {
    throw new DomainError(
      "release_backup_required",
      "Run the acquisition backup before publishing this batch",
    );
  }

  const batchCreatedAt = batch.createdAt.getTime();
  for (const entry of entries) {
    const directory = join(backupRoot, entry.name);
    const backupManifestPath = join(directory, "backup-manifest.json");
    try {
      const parsed = JSON.parse(await readFile(backupManifestPath, "utf8")) as Record<
        string,
        unknown
      >;
      const createdAt = typeof parsed.createdAt === "string" ? Date.parse(parsed.createdAt) : NaN;
      if (!Number.isFinite(createdAt) || createdAt < batchCreatedAt) continue;
      const dumpRelative = safeRelative(parsed.dumpPath);
      const manifestRelative = safeRelative(
        Array.isArray(parsed.files)
          ? (
              parsed.files.find((file) => asRecord(file).path?.toString().endsWith("gip.dump")) as
                Record<string, unknown> | undefined
            )?.path
          : undefined,
      );
      if (!dumpRelative || !manifestRelative) continue;
      const dumpPath = resolve(ctx.dataDir, dumpRelative);
      const copiedManifestPath = resolve(
        ctx.dataDir,
        manifestRelative.replace(/gip\.dump$/, "manifest.json"),
      );
      const dumpRelativeToRoot = relative(ctx.dataDir, dumpPath);
      const copiedRelativeToRoot = relative(ctx.dataDir, copiedManifestPath);
      if (
        !dumpRelativeToRoot ||
        dumpRelativeToRoot.startsWith("..") ||
        isAbsolute(dumpRelativeToRoot) ||
        !copiedRelativeToRoot ||
        copiedRelativeToRoot.startsWith("..") ||
        isAbsolute(copiedRelativeToRoot)
      )
        continue;
      const [dump, copiedManifest] = await Promise.all([
        readFile(dumpPath),
        readFile(copiedManifestPath),
      ]);
      const copiedManifestObject = JSON.parse(copiedManifest.toString("utf8")) as Record<
        string,
        unknown
      >;
      const copiedUpstream = asRecord(copiedManifestObject.upstream);
      const expectedCommits = new Set([
        ...(batch.stagedRecords ?? []).flatMap((record) => {
          const metadata = asRecord(record.metadata.provenance);
          const provenance = Object.keys(metadata).length ? metadata : record.metadata;
          return typeof provenance.upstreamCommit === "string" ? [provenance.upstreamCommit] : [];
        }),
        ...Object.values(batch.structuredRecords ?? {}).flatMap((records) =>
          (records ?? []).flatMap((record) => {
            const provenance = asRecord(record.provenance);
            return typeof provenance.upstreamCommit === "string" ? [provenance.upstreamCommit] : [];
          }),
        ),
      ]);
      if (expectedCommits.size && !expectedCommits.has(String(copiedUpstream.commit ?? "")))
        continue;
      const dumpHash = createHash("sha256").update(dump).digest("hex");
      const manifestHash = createHash("sha256").update(copiedManifest).digest("hex");
      if (
        dumpHash === parsed.dumpSha256 &&
        dump.length === parsed.dumpBytes &&
        manifestHash === parsed.sourceManifestSha256 &&
        copiedManifest.length === parsed.sourceManifestBytes &&
        manifestHash === expectedManifestHash
      )
        return;
    } catch {
      // Ignore incomplete or corrupt candidate directories and continue
      // looking for a newer valid backup.
    }
  }
  throw new DomainError(
    "release_backup_required",
    "Run the acquisition backup after staging this batch and before publishing",
    { batchId: batch.id },
  );
}

/**
 * Resolve the immutable normalized Manifest recorded on the acquisition
 * snapshot and hash it.  The path is stored relative to the repository
 * working directory; reject anything outside the configured external data
 * directory so a provenance record cannot redirect the release check.
 */
export async function acquisitionManifestHash(
  ctx: PublishGateContext,
  batch: ImportBatch,
): Promise<string | undefined> {
  return (await readAcquisitionManifest(ctx, batch))?.hash;
}

export async function ensureAcquisitionReview(
  ctx: PublishReviewContext,
  batchId: string,
): Promise<void> {
  const batch = await ctx.getImport(batchId);
  if (!batch)
    throw new DomainError("import_not_found", "Import batch was not found", undefined, 404);
  const runs = await ctx.db
    .select()
    .from(verificationRuns)
    .where(eq(verificationRuns.batchId, batchId))
    .limit(1);
  const run = runs[0];
  if (!run) {
    return;
  }
  const items = await ctx.db
    .select()
    .from(verificationItems)
    .where(eq(verificationItems.runId, run.id));
  const screenshots = items.length
    ? await ctx.db
        .select()
        .from(verificationScreenshots)
        .where(
          inArray(
            verificationScreenshots.itemId,
            items.map((item) => item.id),
          ),
        )
    : [];
  const screenshotItems = new Set(screenshots.map((item) => item.itemId));
  const screenshotRequired = new Set(["mismatch", "version_mismatch", "unavailable_due_unlock"]);
  const missingScreenshots = items.filter(
    (item) => screenshotRequired.has(item.status) && !screenshotItems.has(item.id),
  );
  const unresolvedItems = items.filter((item) => item.required && item.status === "not_checked");
  const mismatches = items.filter((item) => item.status === "mismatch");
  // Conflict cases are game-scoped review decisions.  Do not narrow this
  // check to the current source snapshot: an older open case can still
  // describe a canonical key that would be published into the same game,
  // and the status report/release UI treats any open case as blocking.
  const conflicts = await ctx.db
    .select()
    .from(conflictCases)
    .where(and(eq(conflictCases.gameId, batch.gameId), eq(conflictCases.status, "open")));
  const resolvedConflicts = await ctx.db
    .select()
    .from(conflictCases)
    .where(and(eq(conflictCases.gameId, batch.gameId), eq(conflictCases.status, "resolved")));
  const invalidConflictSelections = resolvedConflicts.filter(
    (conflict) =>
      (conflict.kind === "content_conflict" || conflict.kind === "missing_field") &&
      (!conflict.selectedObservationId ||
        !conflict.observationIds.includes(conflict.selectedObservationId)),
  );
  const stagedByCanonicalKey = new Map(
    (batch.stagedRecords ?? []).map((record) => [recordCanonicalKey(record), record]),
  );
  const selectedObservationIds = resolvedConflicts
    .filter(
      (conflict) =>
        (conflict.kind === "content_conflict" || conflict.kind === "missing_field") &&
        Boolean(conflict.selectedObservationId),
    )
    .map((conflict) => conflict.selectedObservationId!)
    .filter((id, index, ids) => ids.indexOf(id) === index);
  const selectedObservationRows = selectedObservationIds.length
    ? await ctx.db
        .select()
        .from(sourceObservations)
        .where(inArray(sourceObservations.id, selectedObservationIds))
    : [];
  const selectedObservationById = new Map(
    selectedObservationRows.map((observation) => [observation.id, observation]),
  );
  const conflictSelectionMismatches = resolvedConflicts.flatMap((conflict) => {
    if (conflict.kind !== "content_conflict" && conflict.kind !== "missing_field") return [];
    const staged = stagedByCanonicalKey.get(conflict.canonicalKey);
    if (!staged || !conflict.selectedObservationId) return [];
    const selected = selectedObservationById.get(conflict.selectedObservationId);
    if (!selected) return [];
    const stagedTitle = staged.title ?? conflict.canonicalKey;
    const stagedBody = staged.body ?? "";
    return selected.title === stagedTitle && selected.body === stagedBody
      ? []
      : [
          {
            canonicalKey: conflict.canonicalKey,
            selectedObservationId: conflict.selectedObservationId,
          },
        ];
  });
  if (
    unresolvedItems.length ||
    mismatches.length ||
    missingScreenshots.length ||
    conflicts.length ||
    invalidConflictSelections.length ||
    conflictSelectionMismatches.length
  ) {
    await ctx.db
      .update(verificationRuns)
      .set({ status: "blocked" })
      .where(eq(verificationRuns.id, run.id));
    throw new DomainError("verification_gate_failed", "Acquisition verification is incomplete", {
      unchecked: unresolvedItems.length,
      mismatches: mismatches.length,
      missingScreenshots: missingScreenshots.length,
      openConflicts: conflicts.length,
      invalidConflictSelections: invalidConflictSelections.length,
      conflictSelectionMismatches,
    });
  }
  await ctx.db
    .update(verificationRuns)
    .set({ status: "ready" })
    .where(eq(verificationRuns.id, run.id));
}
