import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { loadConfig } from "../packages/config/src/index.ts";
import {
  createDatabase,
  createPool,
  SqlKnowledgeRepository,
} from "../packages/database/src/index.ts";
import { runStoragePreflight } from "./check-data-storage.js";

const config = loadConfig();
const preflight = await runStoragePreflight();
if (!preflight.ok) throw new Error(preflight.errors.join("; "));

const pool = createPool(config.databaseUrl);
const db = createDatabase(pool);
const repository = new SqlKnowledgeRepository(db, config.dataDir);

type BackupInspection = {
  manifest: Record<string, unknown>;
  integrityValid: boolean;
  integrityErrors: string[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function batchUpstreamCommit(batch: {
  stagedRecords?: Array<{ metadata: Record<string, unknown> }>;
}): string | undefined {
  const record = batch.stagedRecords?.find((candidate) => {
    const metadata = asRecord(candidate.metadata);
    const nested = asRecord(metadata.provenance);
    return typeof (nested.upstreamCommit ?? metadata.upstreamCommit) === "string";
  });
  if (!record) return undefined;
  const metadata = asRecord(record.metadata);
  const nested = asRecord(metadata.provenance);
  const commit = nested.upstreamCommit ?? metadata.upstreamCommit;
  return typeof commit === "string" ? commit : undefined;
}

function hasAcquisitionProvenance(batch: {
  stagedRecords?: Array<{ metadata: Record<string, unknown> }>;
}) {
  return Boolean(
    batch.stagedRecords?.some((record) => {
      const nested = record.metadata.provenance;
      const provenance =
        nested && typeof nested === "object" && !Array.isArray(nested)
          ? (nested as Record<string, unknown>)
          : record.metadata;
      return typeof (provenance.upstreamCommit ?? record.metadata.upstreamCommit) === "string";
    }),
  );
}

function batchCanonicalKey(record: {
  sourceKey: string;
  metadata: Record<string, unknown>;
}): string {
  const nested = asRecord(record.metadata.provenance);
  const provenance = Object.keys(nested).length ? nested : record.metadata;
  return typeof provenance.canonicalKey === "string" && provenance.canonicalKey.trim()
    ? provenance.canonicalKey.trim()
    : record.sourceKey;
}

function safeRelativeBackupPath(value: unknown): string | undefined {
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

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function verifyBackupIntegrity(
  manifest: Record<string, unknown>,
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  const files = Array.isArray(manifest.files) ? manifest.files.map(asRecord) : [];
  if (!files.length) errors.push("backup manifest has no files");
  for (const file of files) {
    const path = safeRelativeBackupPath(file.path);
    if (!path) {
      errors.push("backup manifest contains an unsafe file path");
      continue;
    }
    try {
      const bytes = await readFile(resolve(config.dataDir, path));
      if (typeof file.bytes === "number" && bytes.length !== file.bytes)
        errors.push(`${path}: byte count mismatch`);
      if (typeof file.sha256 === "string" && sha256(bytes) !== file.sha256)
        errors.push(`${path}: SHA-256 mismatch`);
    } catch {
      errors.push(`${path}: file is missing or unreadable`);
    }
  }
  const dumpPath = safeRelativeBackupPath(manifest.dumpPath);
  if (!dumpPath) errors.push("backup manifest has no safe dumpPath");
  const sourceManifestFile = files.find((file) => {
    const path = safeRelativeBackupPath(file.path);
    return Boolean(
      path && path !== dumpPath && (path === "manifest.json" || path.endsWith("/manifest.json")),
    );
  });
  const sourceManifestPath = safeRelativeBackupPath(sourceManifestFile?.path);
  if (!sourceManifestPath) errors.push("backup manifest has no source Manifest copy");
  if (dumpPath) {
    try {
      const bytes = await readFile(resolve(config.dataDir, dumpPath));
      if (typeof manifest.dumpBytes === "number" && bytes.length !== manifest.dumpBytes)
        errors.push("dumpBytes does not match dump file");
      if (typeof manifest.dumpSha256 === "string" && sha256(bytes) !== manifest.dumpSha256)
        errors.push("dumpSha256 does not match dump file");
    } catch {
      // The per-file check above records the concrete missing-file error.
    }
  }
  if (sourceManifestPath) {
    try {
      const bytes = await readFile(resolve(config.dataDir, sourceManifestPath));
      if (
        typeof manifest.sourceManifestBytes === "number" &&
        bytes.length !== manifest.sourceManifestBytes
      )
        errors.push("sourceManifestBytes does not match copied Manifest");
      if (
        typeof manifest.sourceManifestSha256 === "string" &&
        sha256(bytes) !== manifest.sourceManifestSha256
      )
        errors.push("sourceManifestSha256 does not match copied Manifest");
    } catch {
      // The per-file check above records the concrete missing-file error.
    }
  }
  return { valid: errors.length === 0, errors };
}

async function latestBackup(): Promise<BackupInspection | null> {
  const backupRoot = resolve(config.dataDir, "backups");
  let entries: Array<{ name: string; isDirectory(): boolean }> = [];
  try {
    entries = (await readdir(backupRoot, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => right.name.localeCompare(left.name));
  } catch {
    return null;
  }
  for (const entry of entries) {
    try {
      const manifest = JSON.parse(
        await readFile(join(backupRoot, entry.name, "backup-manifest.json"), "utf8"),
      ) as Record<string, unknown>;
      const integrity = await verifyBackupIntegrity(manifest);
      const inspection: BackupInspection = {
        manifest,
        integrityValid: integrity.valid,
        integrityErrors: integrity.errors,
      };
      return inspection;
    } catch {
      return {
        manifest: {},
        integrityValid: false,
        integrityErrors: [`${entry.name}: backup-manifest.json is missing or invalid`],
      };
    }
  }
  return null;
}

async function findManifest(expectedCommit?: string): Promise<{
  path: string;
  value: Record<string, unknown>;
} | null> {
  const root = resolve(config.dataDir, "imports/normalized/anime-game-data");
  let commits: Array<{ name: string; isDirectory(): boolean }> = [];
  try {
    commits = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .sort((left, right) => right.name.localeCompare(left.name));
  } catch {
    return null;
  }
  for (const commit of commits) {
    if (expectedCommit && commit.name !== expectedCommit) continue;
    const path = join(root, commit.name, "zh-CN", "manifest.json");
    try {
      return { path, value: JSON.parse(await readFile(path, "utf8")) as Record<string, unknown> };
    } catch {
      // Continue if a conversion directory is incomplete or has invalid JSON.
    }
  }
  return null;
}

const animeCategoryFiles = {
  book: "books.json",
  character_story: "character-stories.json",
  item_description: "items.json",
} as const;

const animeCategoryPlural = {
  book: "books",
  character_story: "characterStories",
  item_description: "itemDescriptions",
} as const;

type AnimeCategory = keyof typeof animeCategoryFiles;

function animeCategoryFromParser(parserType: string): AnimeCategory | undefined {
  const category = parserType.replace(/^anime-game-data:/, "");
  return category in animeCategoryFiles ? (category as AnimeCategory) : undefined;
}

async function loadExpectedKeys(
  manifest: { path: string; value: Record<string, unknown> } | null,
): Promise<Map<AnimeCategory, Set<string>>> {
  const result = new Map<AnimeCategory, Set<string>>();
  if (!manifest) return result;
  const declaredRoot =
    typeof manifest.value.outputRecordsPath === "string"
      ? manifest.value.outputRecordsPath
      : undefined;
  const recordsRoot = declaredRoot
    ? resolve(process.cwd(), declaredRoot)
    : resolve(dirname(manifest.path), "records");
  const relativeRecordsRoot = relative(config.dataDir, recordsRoot);
  if (
    !relativeRecordsRoot ||
    relativeRecordsRoot.startsWith("..") ||
    isAbsolute(relativeRecordsRoot)
  )
    return result;
  for (const [category, filename] of Object.entries(animeCategoryFiles) as Array<
    [AnimeCategory, string]
  >) {
    try {
      const rows = JSON.parse(await readFile(join(recordsRoot, filename), "utf8")) as unknown;
      if (!Array.isArray(rows)) continue;
      const keys = new Set(
        rows
          .map((row) => asRecord(row).sourceKey)
          .filter((key): key is string => typeof key === "string" && Boolean(key.trim())),
      );
      result.set(category, keys);
    } catch {
      // A missing records file keeps this source coverage unknown and
      // therefore cannot satisfy the release gate.
    }
  }
  return result;
}

try {
  const game = (await repository.listGames()).find(
    (candidate) => candidate.slug === "genshin-impact",
  );
  if (!game) throw new Error("Seed the genshin-impact game before reporting acquisition status");
  const sourceRows = (
    await pool.query<{
      id: string;
      name: string;
      type: string;
      parserType: string;
      enabled: boolean;
    }>(
      `SELECT id, name, type, parser_type AS "parserType", enabled
         FROM knowledge.sources
        WHERE game_id = $1`,
      [game.id],
    )
  ).rows;
  const animeSourceIds = new Set(
    sourceRows
      .filter((source) => source.parserType.startsWith("anime-game-data:"))
      .map((source) => source.id),
  );
  const batches = (await repository.listImports(game.id)).filter(
    (batch) => animeSourceIds.has(batch.sourceId) || hasAcquisitionProvenance(batch),
  );
  // Keep every acquisition batch that has not reached a terminal state.  A
  // newly queued/running/staged/failed batch must not disappear behind an old
  // review_required batch, otherwise the report could look ready while a
  // newer import is incomplete.
  const currentBatches = batches.filter(
    (batch) => batch.status !== "published" && batch.status !== "cancelled",
  );
  const observationRows = (
    await pool.query<{
      sourceId: string;
      sourceSnapshotId: string;
      canonicalKey: string;
      category: string;
      gameVersion: string;
      locale: string;
    }>(
      `SELECT source_id AS "sourceId", source_snapshot_id AS "sourceSnapshotId",
              canonical_key AS "canonicalKey", category,
              game_version AS "gameVersion", locale
         FROM knowledge.source_observations
        WHERE game_id = $1`,
      [game.id],
    )
  ).rows;
  const sourceById = new Map(sourceRows.map((source) => [source.id, source]));
  const observationBySource = new Map<string, typeof observationRows>();
  for (const observation of observationRows) {
    observationBySource.set(observation.sourceId, [
      ...(observationBySource.get(observation.sourceId) ?? []),
      observation,
    ]);
  }
  const observationsBySource = [...observationBySource.entries()].map(([sourceId, rows]) => ({
    sourceId,
    name: sourceById.get(sourceId)?.name ?? "未知来源",
    type: sourceById.get(sourceId)?.type ?? "unknown",
    observations: rows.length,
    snapshots: new Set(rows.map((row) => row.sourceSnapshotId)).size,
    categories: Object.fromEntries(
      [...new Set(rows.map((row) => row.category))].map((category) => [
        category,
        rows.filter((row) => row.category === category).length,
      ]),
    ),
    versions: [...new Set(rows.map((row) => row.gameVersion))].sort(),
    locales: [...new Set(rows.map((row) => row.locale))].sort(),
  }));
  const observationsByCategory = Object.fromEntries(
    [...new Set(observationRows.map((row) => row.category))].map((category) => [
      category,
      observationRows.filter((row) => row.category === category).length,
    ]),
  );
  const observationIntegrityRow = (
    await pool.query<{
      emptyCanonicalKeys: number;
      emptyCategories: number;
      emptyVersions: number;
      emptyLocales: number;
      emptyTitles: number;
      emptyBodies: number;
      invalidRawHashes: number;
      invalidNormalizedHashes: number;
      rawHashMismatches: number;
      normalizedHashMismatches: number;
      emptyProvenance: number;
      incompleteLineage: number;
    }>(
      `SELECT
         count(*) FILTER (WHERE btrim(canonical_key) = '')::int AS "emptyCanonicalKeys",
         count(*) FILTER (WHERE btrim(category) = '')::int AS "emptyCategories",
         count(*) FILTER (WHERE btrim(game_version) = '')::int AS "emptyVersions",
         count(*) FILTER (WHERE btrim(locale) = '')::int AS "emptyLocales",
         count(*) FILTER (WHERE btrim(title) = '')::int AS "emptyTitles",
         count(*) FILTER (WHERE btrim(body) = '')::int AS "emptyBodies",
         count(*) FILTER (WHERE raw_content_hash !~ '^[0-9a-f]{64}$')::int AS "invalidRawHashes",
         count(*) FILTER (WHERE normalized_content_hash !~ '^[0-9a-f]{64}$')::int AS "invalidNormalizedHashes",
         count(*) FILTER (
           WHERE raw_content_hash <> COALESCE(
             provenance->>'rawContentHash',
             provenance->'provenance'->>'rawContentHash'
           )
           AND COALESCE(
             provenance->>'rawContentHash',
             provenance->'provenance'->>'rawContentHash'
           ) ~ '^[0-9a-f]{64}$'
         )::int AS "rawHashMismatches",
         count(*) FILTER (
           WHERE normalized_content_hash <> COALESCE(
             provenance->>'normalizedContentHash',
             provenance->'provenance'->>'normalizedContentHash'
           )
           AND COALESCE(
             provenance->>'normalizedContentHash',
             provenance->'provenance'->>'normalizedContentHash'
           ) ~ '^[0-9a-f]{64}$'
         )::int AS "normalizedHashMismatches",
         count(*) FILTER (WHERE provenance = '{}'::jsonb)::int AS "emptyProvenance",
         count(*) FILTER (
           WHERE COALESCE(provenance->'lineage', provenance->'provenance'->'lineage')->'title' IS NULL
              OR COALESCE(provenance->'lineage', provenance->'provenance'->'lineage')->'body' IS NULL
         )::int AS "incompleteLineage"
       FROM knowledge.source_observations
      WHERE game_id = $1`,
      [game.id],
    )
  ).rows[0] ?? {
    emptyCanonicalKeys: 0,
    emptyCategories: 0,
    emptyVersions: 0,
    emptyLocales: 0,
    emptyTitles: 0,
    emptyBodies: 0,
    invalidRawHashes: 0,
    invalidNormalizedHashes: 0,
    rawHashMismatches: 0,
    normalizedHashMismatches: 0,
    emptyProvenance: 0,
    incompleteLineage: 0,
  };
  const duplicateObservationKeys = Number(
    (
      await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM (
             SELECT source_snapshot_id, canonical_key
               FROM knowledge.source_observations
              WHERE game_id = $1
              GROUP BY source_snapshot_id, canonical_key
             HAVING count(*) > 1
           ) duplicates`,
        [game.id],
      )
    ).rows[0]?.count ?? 0,
  );
  const snapshotsWithoutObservations = Number(
    (
      await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM knowledge.source_snapshots snapshot
           JOIN knowledge.sources source ON source.id = snapshot.source_id
          WHERE source.game_id = $1
            AND NOT EXISTS (
              SELECT 1
                FROM knowledge.source_observations observation
               WHERE observation.source_snapshot_id = snapshot.id
            )`,
        [game.id],
      )
    ).rows[0]?.count ?? 0,
  );
  const observationIntegrity = {
    ...observationIntegrityRow,
    duplicateObservationKeys,
    snapshotsWithoutObservations,
    ok:
      Object.values(observationIntegrityRow).every((value) => value === 0) &&
      duplicateObservationKeys === 0 &&
      snapshotsWithoutObservations === 0,
  };
  const openConflicts = (await repository.listConflicts?.(game.id, "open")) ?? [];
  const allConflicts = (await repository.listConflicts?.(game.id)) ?? [];
  const conflictsByKind = Object.fromEntries(
    [...new Set(allConflicts.map((conflict) => conflict.kind))].map((kind) => [
      kind,
      allConflicts.filter((conflict) => conflict.kind === kind).length,
    ]),
  );
  const unselectedResolvedConflicts = allConflicts.filter(
    (conflict) =>
      conflict.status === "resolved" &&
      (conflict.kind === "content_conflict" || conflict.kind === "missing_field") &&
      (!conflict.selectedObservationId ||
        !conflict.observationIds.includes(conflict.selectedObservationId)),
  );
  const realResolvedConflicts = allConflicts.filter(
    (conflict) =>
      conflict.status === "resolved" &&
      (conflict.kind === "content_conflict" || conflict.kind === "missing_field") &&
      Boolean(conflict.selectedObservationId),
  );
  const selectedObservationIds = realResolvedConflicts
    .map((conflict) => conflict.selectedObservationId!)
    .filter((id, index, ids) => ids.indexOf(id) === index);
  const selectedObservationRows = selectedObservationIds.length
    ? (
        await pool.query<{ id: string; title: string; body: string }>(
          `SELECT id, title, body
             FROM knowledge.source_observations
            WHERE id = ANY($1::uuid[])`,
          [selectedObservationIds],
        )
      ).rows
    : [];
  const selectedObservationById = new Map(
    selectedObservationRows.map((observation) => [observation.id, observation]),
  );
  const selectedContentMismatchKeys = new Set<string>();
  for (const batch of currentBatches) {
    const stagedByCanonicalKey = new Map(
      (batch.stagedRecords ?? []).map((record) => [batchCanonicalKey(record), record]),
    );
    for (const conflict of realResolvedConflicts) {
      const staged = stagedByCanonicalKey.get(conflict.canonicalKey);
      const selected = conflict.selectedObservationId
        ? selectedObservationById.get(conflict.selectedObservationId)
        : undefined;
      if (!staged || !selected) continue;
      const stagedTitle = staged.title ?? conflict.canonicalKey;
      const stagedBody = staged.body ?? "";
      if (selected.title !== stagedTitle || selected.body !== stagedBody)
        selectedContentMismatchKeys.add(conflict.canonicalKey);
    }
  }
  const reports = [];
  for (const batch of currentBatches) {
    const run = await repository.getVerificationRun?.(batch.id);
    if (!run) {
      reports.push({ batchId: batch.id, status: batch.status, verification: null });
      continue;
    }
    const categories = [...new Set(run.items.map((item) => item.category))].map((category) => {
      const items = run.items.filter((item) => item.category === category);
      const exactGameClient = items.filter(
        (item) =>
          item.status === "exact_match" &&
          item.channel === "game_client" &&
          item.checkedGameVersion === run.expectedGameVersion &&
          item.checkedLocale === run.expectedLocale,
      ).length;
      return {
        category,
        total: items.length,
        pending: items.filter((item) => item.status === "not_checked").length,
        exactGameClient,
        formattingOnly: items.filter((item) => item.status === "formatting_only").length,
        mismatch: items.filter((item) => item.status === "mismatch").length,
        versionMismatch: items.filter((item) => item.status === "version_mismatch").length,
        unavailableDueUnlock: items.filter((item) => item.status === "unavailable_due_unlock")
          .length,
        missingScreenshots: items.filter(
          (item) =>
            ["mismatch", "version_mismatch", "unavailable_due_unlock"].includes(item.status) &&
            item.screenshotCount === 0,
        ).length,
        hoyowiki: items.filter((item) => item.channel === "hoyowiki").length,
      };
    });
    reports.push({
      batchId: batch.id,
      status: batch.status,
      createdAt: batch.createdAt,
      verification: {
        runId: run.id,
        upstreamCommit: run.upstreamCommit,
        status: run.status,
        expectedGameVersion: run.expectedGameVersion,
        expectedLocale: run.expectedLocale,
        categories,
      },
    });
  }
  const backup = await latestBackup();
  const upstreamCommits = [
    ...new Set(
      [
        ...currentBatches.map(batchUpstreamCommit),
        ...reports.map((report) => report.verification?.upstreamCommit),
      ].filter((commit): commit is string => Boolean(commit)),
    ),
  ];
  const expectedCommit = upstreamCommits.length === 1 ? upstreamCommits[0] : undefined;
  const manifest = await findManifest(expectedCommit);
  const expectedKeys = await loadExpectedKeys(manifest);
  const expectedGameVersion =
    typeof manifest?.value.gameVersion === "string" ? manifest.value.gameVersion : undefined;
  const expectedLocale =
    typeof manifest?.value.locale === "string" ? manifest.value.locale : undefined;
  const snapshotRows = (
    await pool.query<{
      id: string;
      sourceId: string;
      capturedAt: Date;
      contentHash: string;
    }>(
      `SELECT id, source_id AS "sourceId", captured_at AS "capturedAt", content_hash AS "contentHash"
         FROM knowledge.source_snapshots
        WHERE source_id = ANY($1::uuid[])`,
      [[...animeSourceIds]],
    )
  ).rows;
  const sourceCoverage = sourceRows
    .map((source) => {
      const category = animeCategoryFromParser(source.parserType);
      if (!category) return undefined;
      const expectedSet = expectedKeys.get(category);
      const accounting = asRecord(
        asRecord(manifest?.value.accounting)[animeCategoryPlural[category]],
      );
      const expectedCount =
        expectedSet?.size ??
        (typeof accounting.converted === "number" ? accounting.converted : undefined);
      const snapshots = snapshotRows
        .filter((snapshot) => snapshot.sourceId === source.id)
        .map((snapshot) => {
          const rows = observationRows.filter(
            (observation) =>
              observation.sourceId === source.id &&
              observation.sourceSnapshotId === snapshot.id &&
              observation.category === category,
          );
          const observedKeys = new Set(rows.map((row) => row.canonicalKey));
          const missingKeys = expectedSet
            ? [...expectedSet].filter((key) => !observedKeys.has(key)).sort()
            : [];
          const unexpectedKeys = expectedSet
            ? [...observedKeys].filter((key) => !expectedSet.has(key)).sort()
            : [];
          const versions = [...new Set(rows.map((row) => row.gameVersion))].sort();
          const locales = [...new Set(rows.map((row) => row.locale))].sort();
          const complete = Boolean(
            expectedSet &&
            expectedCount !== undefined &&
            observedKeys.size === expectedCount &&
            missingKeys.length === 0 &&
            unexpectedKeys.length === 0 &&
            expectedGameVersion &&
            versions.length === 1 &&
            versions[0] === expectedGameVersion &&
            expectedLocale &&
            locales.length === 1 &&
            locales[0] === expectedLocale,
          );
          return {
            snapshotId: snapshot.id,
            capturedAt: snapshot.capturedAt,
            contentHash: snapshot.contentHash,
            observedCount: observedKeys.size,
            expectedCount: expectedCount ?? null,
            coverage: expectedCount && expectedCount > 0 ? observedKeys.size / expectedCount : null,
            missingCount: missingKeys.length,
            missingKeys: missingKeys.slice(0, 20),
            unexpectedCount: unexpectedKeys.length,
            unexpectedKeys: unexpectedKeys.slice(0, 20),
            versions,
            locales,
            complete,
          };
        })
        .sort((left, right) => right.capturedAt.getTime() - left.capturedAt.getTime());
      const latest = snapshots[0];
      return {
        sourceId: source.id,
        name: source.name,
        parserType: source.parserType,
        enabled: source.enabled,
        category,
        snapshots,
        latest: latest ?? null,
        complete: latest?.complete ?? false,
      };
    })
    .filter(
      (
        entry,
      ): entry is {
        sourceId: string;
        name: string;
        parserType: string;
        enabled: boolean;
        category: AnimeCategory;
        snapshots: Array<{
          snapshotId: string;
          capturedAt: Date;
          contentHash: string;
          observedCount: number;
          expectedCount: number | null;
          coverage: number | null;
          missingCount: number;
          missingKeys: string[];
          unexpectedCount: number;
          unexpectedKeys: string[];
          versions: string[];
          locales: string[];
          complete: boolean;
        }>;
        latest: {
          snapshotId: string;
          capturedAt: Date;
          contentHash: string;
          observedCount: number;
          expectedCount: number | null;
          coverage: number | null;
          missingCount: number;
          missingKeys: string[];
          unexpectedCount: number;
          unexpectedKeys: string[];
          versions: string[];
          locales: string[];
          complete: boolean;
        } | null;
        complete: boolean;
      } => Boolean(entry),
    );
  const requiredAnimeCategories = Object.keys(animeCategoryFiles) as AnimeCategory[];
  const sourceCoverageComplete =
    requiredAnimeCategories.every((category) =>
      sourceCoverage.some(
        (entry) => entry.category === category && entry.enabled && entry.complete,
      ),
    ) && sourceCoverage.filter((entry) => entry.enabled).every((entry) => entry.complete);
  const gameVersions = [
    ...new Set(
      reports
        .map((report) => report.verification?.expectedGameVersion)
        .filter((version): version is string => Boolean(version)),
    ),
  ];
  const locales = [
    ...new Set(
      reports
        .map((report) => report.verification?.expectedLocale)
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const mixedGameVersions = gameVersions.length > 1;
  const mixedLocales = locales.length > 1;
  let currentManifestHash: string | undefined;
  if (manifest) {
    try {
      currentManifestHash = sha256(await readFile(manifest.path));
    } catch {
      currentManifestHash = undefined;
    }
  }
  const manifestAccounting = asRecord(manifest?.value.accounting);
  const requiredAccountingKeys = ["books", "characterStories", "itemDescriptions"];
  const accountingComplete =
    requiredAccountingKeys.every((key) => {
      const entry = asRecord(manifestAccounting[key]);
      return entry.coverage === 1;
    }) && Object.keys(manifestAccounting).length === requiredAccountingKeys.length;
  const manifestComplete =
    upstreamCommits.length === 1 &&
    gameVersions.length === 1 &&
    locales.length === 1 &&
    Boolean(manifest) &&
    Array.isArray(manifest?.value.unexplainedMissing) &&
    manifest.value.unexplainedMissing.length === 0 &&
    accountingComplete &&
    sourceCoverageComplete;
  const categoryGate = reports.flatMap((report) => report.verification?.categories ?? []);
  const allSamplesProcessed = categoryGate.every((category) => category.pending === 0);
  const exactMatchPerCategory = Object.fromEntries(
    categoryGate.map((category) => [category.category, category.exactGameClient]),
  );
  const manualGate =
    reports.length > 0 &&
    reports.every((report) => report.verification?.status === "ready") &&
    allSamplesProcessed &&
    categoryGate.every((category) => category.exactGameClient >= 10) &&
    categoryGate.every((category) => category.mismatch === 0) &&
    categoryGate.every((category) => category.missingScreenshots === 0);
  const blockingReasons = new Set<string>();
  if (!reports.length) blockingReasons.add("no_acquisition_batches");
  for (const report of reports) {
    if (!report.verification) {
      blockingReasons.add(`batch:${report.batchId}:verification_run_missing`);
    } else if (report.verification.status !== "ready") {
      blockingReasons.add(
        `batch:${report.batchId}:verification_status_${report.verification.status}`,
      );
    }
  }
  for (const category of categoryGate) {
    if (category.pending > 0)
      blockingReasons.add(`${category.category}:pending_${category.pending}`);
    if (category.exactGameClient < 10) {
      blockingReasons.add(
        `${category.category}:exact_game_client_${category.exactGameClient}_of_10`,
      );
    }
    if (category.mismatch > 0) {
      blockingReasons.add(`${category.category}:mismatch_${category.mismatch}`);
    }
    if (category.missingScreenshots > 0) {
      blockingReasons.add(
        `${category.category}:missing_screenshots_${category.missingScreenshots}`,
      );
    }
  }
  if (!manifestComplete) blockingReasons.add("manifest_incomplete");
  if (!sourceCoverageComplete) blockingReasons.add("source_coverage_incomplete");
  if (!observationIntegrity.ok) blockingReasons.add("observation_integrity_failed");
  if (openConflicts.length > 0) blockingReasons.add(`open_conflicts_${openConflicts.length}`);
  if (unselectedResolvedConflicts.length > 0) {
    blockingReasons.add(
      `resolved_conflicts_without_selection_${unselectedResolvedConflicts.length}`,
    );
  }
  if (selectedContentMismatchKeys.size > 0) {
    blockingReasons.add(`selected_content_mismatch_${selectedContentMismatchKeys.size}`);
  }
  if (!manualGate) blockingReasons.add("manual_verification_not_ready");
  const latestBackupTime = backup?.manifest.createdAt
    ? Date.parse(String(backup.manifest.createdAt))
    : Number.NaN;
  const latestBatchTime = currentBatches.reduce(
    (latest, batch) => Math.max(latest, batch.createdAt.getTime()),
    0,
  );
  const backupMatchesCurrentManifest = Boolean(
    backup?.integrityValid &&
    currentManifestHash &&
    backup.manifest.sourceManifestSha256 === currentManifestHash,
  );
  const backupAfterCurrentBatches =
    backupMatchesCurrentManifest &&
    (latestBatchTime === 0 ||
      (Number.isFinite(latestBackupTime) && latestBackupTime >= latestBatchTime));
  if (!backupAfterCurrentBatches) blockingReasons.add("backup_missing_or_stale");
  const blockingReasonList = [...blockingReasons];
  const report = {
    generatedAt: new Date().toISOString(),
    game: { id: game.id, slug: game.slug, name: game.name },
    conversion: manifest
      ? {
          manifestPath: relative(config.dataDir, manifest.path),
          upstreamCommit: manifest.value.upstream
            ? asRecord(manifest.value.upstream).commit
            : undefined,
          gameVersion: manifest.value.gameVersion,
          locale: manifest.value.locale,
          converterVersion: manifest.value.converterVersion,
          discovered: manifest.value.discovered,
          converted: manifest.value.converted,
          excluded: manifest.value.excluded,
          accounting: manifest.value.accounting,
          unexplainedMissing: manifest.value.unexplainedMissing,
          inputFileCount: Object.keys(asRecord(manifest.value.inputHashes)).length,
        }
      : null,
    observations: {
      total: observationRows.length,
      snapshots: new Set(observationRows.map((row) => row.sourceSnapshotId)).size,
      bySource: observationsBySource,
      byCategory: observationsByCategory,
      sourceCoverage,
      integrity: observationIntegrity,
    },
    acquisitionBatches: reports,
    openConflicts: openConflicts.length,
    conflicts: {
      total: allConflicts.length,
      open: openConflicts.length,
      resolved: allConflicts.filter((conflict) => conflict.status === "resolved").length,
      byKind: conflictsByKind,
      unselectedResolved: unselectedResolvedConflicts.length,
      unselectedResolvedKeys: unselectedResolvedConflicts
        .map((conflict) => conflict.canonicalKey)
        .slice(0, 20),
      selectedContentMismatches: selectedContentMismatchKeys.size,
      selectedContentMismatchKeys: [...selectedContentMismatchKeys].slice(0, 20),
    },
    blockingReasons: blockingReasonList,
    releaseGate: {
      manifestComplete,
      upstreamCommits,
      mixedUpstreamCommits: upstreamCommits.length > 1,
      gameVersions,
      mixedGameVersions,
      locales,
      mixedLocales,
      sourceCoverageComplete,
      observationIntegrity: observationIntegrity.ok,
      allSamplesProcessed,
      exactMatchPerCategory,
      openConflicts: openConflicts.length,
      conflictSelectionComplete:
        unselectedResolvedConflicts.length === 0 && selectedContentMismatchKeys.size === 0,
      backupAvailable: backupAfterCurrentBatches,
      backupAfterCurrentBatches,
      manualVerificationReady: manualGate,
      blockingReasons: blockingReasonList,
      ready:
        manifestComplete &&
        observationIntegrity.ok &&
        manualGate &&
        openConflicts.length === 0 &&
        unselectedResolvedConflicts.length === 0 &&
        selectedContentMismatchKeys.size === 0 &&
        backupAfterCurrentBatches,
    },
    latestBackup: backup
      ? {
          createdAt: backup.manifest.createdAt,
          dumpPath: safeRelativeBackupPath(backup.manifest.dumpPath),
          dumpSha256: backup.manifest.dumpSha256,
          sourceManifestSha256: backup.manifest.sourceManifestSha256,
          integrityValid: backup.integrityValid,
          integrityErrors: backup.integrityErrors,
          matchesCurrentManifest: backupMatchesCurrentManifest,
          afterCurrentBatches: backupAfterCurrentBatches,
        }
      : null,
  };
  const serialized = JSON.stringify(report, null, 2);
  if (process.argv.includes("--write")) {
    const reportPath = resolve(config.dataDir, "verification/reports/latest-anime-status.json");
    await mkdir(dirname(reportPath), { recursive: true });
    await writeFile(reportPath, `${serialized}\n`, "utf8");
    console.error(`Saved acquisition status report to ${relative(config.dataDir, reportPath)}`);
  }
  console.log(serialized);
} finally {
  await pool.end();
}
