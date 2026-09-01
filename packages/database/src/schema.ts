import { sql } from "drizzle-orm";
import { customType } from "drizzle-orm/pg-core";
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type {
  ClaimCandidate,
  ImportDiff,
  NormalizedRecord,
  StructuredImportRecords,
  ValidationIssue,
} from "@gip/domain";

export const platform = pgSchema("platform");
export const knowledge = pgSchema("knowledge");

const vector = customType<{ data: number[]; driverData: string; config: { dimensions: number } }>({
  dataType: (config) => `vector(${config?.dimensions ?? 1536})`,
  toDriver: (value) => `[${value.join(",")}]`,
  fromDriver: (value) =>
    String(value)
      .replace(/^\[|\]$/g, "")
      .split(",")
      .filter(Boolean)
      .map(Number),
});

export const games = platform.table(
  "games",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("games_slug_unique").on(table.slug)],
);

export const gameCapabilities = platform.table(
  "game_capabilities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    capability: text("capability").notNull(),
    enabled: boolean("enabled").notNull().default(true),
  },
  (table) => [
    uniqueIndex("game_capabilities_game_capability_unique").on(table.gameId, table.capability),
  ],
);

export const jobs = platform.table(
  "jobs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: text("type").notNull(),
    status: text("status").notNull().default("pending"),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    leaseOwner: text("lease_owner"),
    leasedUntil: timestamp("leased_until", { withTimezone: true }),
    heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }),
    cancelRequested: boolean("cancel_requested").notNull().default(false),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("jobs_idempotency_unique").on(table.idempotencyKey),
    index("jobs_status_index").on(table.status),
  ],
);

export const workerHeartbeats = platform.table("worker_heartbeats", {
  workerId: text("worker_id").primaryKey(),
  heartbeatAt: timestamp("heartbeat_at", { withTimezone: true }).notNull().defaultNow(),
});

export const sources = knowledge.table(
  "sources",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id),
    name: text("name").notNull(),
    type: text("type").notNull(),
    pathLabel: text("path_label").notNull(),
    licenseNote: text("license_note"),
    enabled: boolean("enabled").notNull().default(true),
    parserType: text("parser_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("sources_game_index").on(table.gameId)],
);

export const sourceSnapshots = knowledge.table(
  "source_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id),
    contentHash: text("content_hash").notNull(),
    storagePath: text("storage_path").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    uniqueIndex("source_snapshots_source_hash_unique").on(table.sourceId, table.contentHash),
  ],
);

export const sourceObservations = knowledge.table(
  "source_observations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id),
    sourceSnapshotId: uuid("source_snapshot_id")
      .notNull()
      .references(() => sourceSnapshots.id),
    canonicalKey: text("canonical_key").notNull(),
    category: text("category").notNull(),
    gameVersion: text("game_version").notNull(),
    locale: text("locale").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    rawContentHash: text("raw_content_hash").notNull(),
    normalizedContentHash: text("normalized_content_hash").notNull(),
    provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("source_observations_snapshot_key_unique").on(
      table.sourceSnapshotId,
      table.canonicalKey,
    ),
    index("source_observations_compare_index").on(
      table.gameId,
      table.canonicalKey,
      table.gameVersion,
      table.locale,
    ),
  ],
);

export const conflictCases = knowledge.table(
  "conflict_cases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id),
    canonicalKey: text("canonical_key").notNull(),
    gameVersion: text("game_version").notNull(),
    locale: text("locale").notNull(),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("open"),
    observationIds: jsonb("observation_ids").$type<string[]>().notNull().default([]),
    selectedObservationId: uuid("selected_observation_id").references(() => sourceObservations.id),
    resolution: text("resolution"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("conflict_cases_scope_unique").on(
      table.gameId,
      table.canonicalKey,
      table.gameVersion,
      table.locale,
    ),
    index("conflict_cases_status_index").on(table.gameId, table.status),
  ],
);

export const importBatches = knowledge.table(
  "import_batches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id),
    sourceSnapshotId: uuid("source_snapshot_id").references(() => sourceSnapshots.id),
    status: text("status").notNull().default("pending"),
    parserVersion: text("parser_version").notNull(),
    successCount: integer("success_count").notNull().default(0),
    failureCount: integer("failure_count").notNull().default(0),
    errors: jsonb("errors").$type<ValidationIssue[]>().notNull().default([]),
    warnings: jsonb("warnings").$type<ValidationIssue[]>().notNull().default([]),
    diff: jsonb("diff").$type<ImportDiff>(),
    stagedRecords: jsonb("staged_records").$type<NormalizedRecord[]>(),
    structuredRecords: jsonb("structured_records").$type<StructuredImportRecords>(),
    reviewNote: text("review_note"),
    confirmedDeletionKeys: jsonb("confirmed_deletion_keys").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("import_batches_game_index").on(table.gameId),
    index("import_batches_status_index").on(table.status),
  ],
);

export const verificationRuns = knowledge.table(
  "verification_runs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => importBatches.id),
    upstreamCommit: text("upstream_commit").notNull(),
    expectedGameVersion: text("expected_game_version").notNull(),
    expectedLocale: text("expected_locale").notNull(),
    seed: text("seed").notNull(),
    status: text("status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("verification_runs_batch_unique").on(table.batchId)],
);

export const verificationItems = knowledge.table(
  "verification_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    runId: uuid("run_id")
      .notNull()
      .references(() => verificationRuns.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    canonicalKey: text("canonical_key").notNull(),
    title: text("title").notNull(),
    status: text("status").notNull().default("not_checked"),
    channel: text("channel"),
    checkedGameVersion: text("checked_game_version"),
    checkedLocale: text("checked_locale"),
    note: text("note"),
    required: boolean("required").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("verification_items_run_key_unique").on(table.runId, table.canonicalKey),
    index("verification_items_status_index").on(table.runId, table.status),
  ],
);

export const verificationScreenshots = knowledge.table(
  "verification_screenshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    itemId: uuid("item_id")
      .notNull()
      .references(() => verificationItems.id, { onDelete: "cascade" }),
    relativePath: text("relative_path").notNull(),
    sha256: text("sha256").notNull(),
    bytes: integer("bytes").notNull(),
    mimeType: text("mime_type").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("verification_screenshots_item_hash_unique").on(table.itemId, table.sha256),
  ],
);

export const datasetRevisions = knowledge.table(
  "dataset_revisions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id),
    revisionNumber: integer("revision_number").notNull(),
    sourceBatchId: uuid("source_batch_id")
      .notNull()
      .references(() => importBatches.id),
    releaseNote: text("release_note"),
    lifecycleStatus: text("lifecycle_status").notNull().default("published"),
    publishedAt: timestamp("published_at", { withTimezone: true }).defaultNow().notNull(),
    isCurrent: boolean("is_current").notNull().default(false),
    indexStatus: text("index_status").notNull().default("pending"),
    normalizedRecords: jsonb("normalized_records").$type<NormalizedRecord[]>(),
    structuredRecords: jsonb("structured_records").$type<StructuredImportRecords>(),
    manifestId: uuid("manifest_id"),
    activatedAt: timestamp("activated_at", { withTimezone: true }),
    activationBuildId: uuid("activation_build_id"),
    activationCandidateId: uuid("activation_candidate_id"),
    activationError: jsonb("activation_error").$type<Record<string, unknown>>(),
    provenance: jsonb("provenance").$type<Record<string, unknown>>(),
    sourceId: uuid("source_id").references(() => sources.id),
    gameVersion: text("game_version"),
    locale: text("locale"),
    archivedReason: text("archived_reason"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("dataset_revisions_game_number_unique").on(table.gameId, table.revisionNumber),
    uniqueIndex("dataset_revisions_activation_candidate_unique")
      .on(table.activationCandidateId)
      .where(sql`${table.activationCandidateId} IS NOT NULL`),
    index("dataset_revisions_current_index").on(table.gameId, table.isCurrent),
    index("dataset_revisions_lifecycle_index").on(table.gameId, table.lifecycleStatus),
    check(
      "dataset_revisions_lifecycle_valid",
      sql`${table.lifecycleStatus} IN ('preparing', 'preview', 'published', 'retired', 'failed')`,
    ),
    check(
      "dataset_revisions_current_must_be_published",
      sql`NOT ${table.isCurrent} OR ${table.lifecycleStatus} = 'published'`,
    ),
  ],
);

export const releaseCandidates = knowledge.table(
  "release_candidates",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id),
    name: text("name").notNull(),
    baseRevisionId: uuid("base_revision_id").references(() => datasetRevisions.id),
    importBatchIds: jsonb("import_batch_ids").$type<string[]>().notNull(),
    status: text("status").notNull().default("draft"),
    currentBuildId: uuid("current_build_id"),
    promotedRevisionId: uuid("promoted_revision_id").references(() => datasetRevisions.id),
    promotionIdempotencyKey: text("promotion_idempotency_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    sourceId: uuid("source_id"),
    targetGameVersion: text("target_game_version"),
    archivedReason: text("archived_reason"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    index("release_candidates_game_status_index").on(table.gameId, table.status),
    uniqueIndex("release_candidates_promotion_key_unique").on(table.promotionIdempotencyKey),
  ],
);

export const releaseCandidateBuilds = knowledge.table(
  "release_candidate_builds",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => releaseCandidates.id, { onDelete: "cascade" }),
    buildNumber: integer("build_number").notNull(),
    status: text("status").notNull().default("ready"),
    contentChecksum: text("content_checksum").notNull(),
    normalizedRecords: jsonb("normalized_records").$type<NormalizedRecord[]>().notNull(),
    structuredRecords: jsonb("structured_records").$type<StructuredImportRecords>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    importBatchId: uuid("import_batch_id"),
    baseRevisionId: uuid("base_revision_id"),
    manifestId: uuid("manifest_id"),
    buildKind: text("build_kind").notNull().default("import"),
    indexStatus: text("index_status").notNull().default("pending"),
    failureDetails: jsonb("failure_details").$type<Record<string, unknown>>(),
    sourceId: uuid("source_id").references(() => sources.id),
    targetGameVersion: text("target_game_version"),
    locale: text("locale"),
    archivedReason: text("archived_reason"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("release_candidate_builds_number_unique").on(table.candidateId, table.buildNumber),
    index("release_candidate_builds_candidate_index").on(table.candidateId),
  ],
);

export const contentObjects = knowledge.table("content_objects", {
  contentHash: text("content_hash").primaryKey(),
  recordType: text("record_type").notNull(),
  schemaVersion: text("schema_version").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  byteLength: integer("byte_length").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const datasetManifests = knowledge.table("dataset_manifests", {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id")
    .notNull()
    .references(() => games.id),
  kind: text("kind").notNull(),
  baseRevisionId: uuid("base_revision_id"),
  rootHash: text("root_hash").notNull(),
  recordCount: integer("record_count").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const datasetManifestEntries = knowledge.table(
  "dataset_manifest_entries",
  {
    manifestId: uuid("manifest_id")
      .notNull()
      .references(() => datasetManifests.id, { onDelete: "cascade" }),
    canonicalKey: text("canonical_key").notNull(),
    contentHash: text("content_hash")
      .notNull()
      .references(() => contentObjects.contentHash),
  },
  (table) => [
    primaryKey({ columns: [table.manifestId, table.canonicalKey] }),
    index("dataset_manifest_entries_content_index").on(table.contentHash),
  ],
);

export const reviewIssues = knowledge.table(
  "review_issues",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => releaseCandidates.id, { onDelete: "cascade" }),
    detectedBuildId: uuid("detected_build_id").references(() => releaseCandidateBuilds.id),
    canonicalKey: text("canonical_key").notNull(),
    fieldPath: text("field_path"),
    kind: text("kind").notNull(),
    status: text("status").notNull().default("open"),
    blocking: boolean("blocking").notNull().default(true),
    fingerprint: text("fingerprint").notNull(),
    baseContentHash: text("base_content_hash"),
    mainContentHash: text("main_content_hash"),
    incomingContentHash: text("incoming_content_hash"),
    summary: text("summary").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    resolutionAction: text("resolution_action"),
    resolutionNote: text("resolution_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("review_issues_candidate_fingerprint_unique").on(
      table.candidateId,
      table.fingerprint,
    ),
    index("review_issues_queue_index").on(
      table.gameId,
      table.candidateId,
      table.status,
      table.blocking,
    ),
  ],
);

export const candidatePatches = knowledge.table(
  "candidate_patches",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => releaseCandidates.id, { onDelete: "cascade" }),
    issueId: uuid("issue_id").references(() => reviewIssues.id, { onDelete: "set null" }),
    canonicalKey: text("canonical_key").notNull(),
    fieldPath: text("field_path"),
    action: text("action").notNull(),
    manualValue: jsonb("manual_value"),
    expectedBaseHash: text("expected_base_hash"),
    expectedIncomingHash: text("expected_incoming_hash"),
    appliedBuildId: uuid("applied_build_id").references(() => releaseCandidateBuilds.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("candidate_patches_candidate_index").on(table.candidateId, table.createdAt)],
);

export const reviewEvidence = knowledge.table(
  "review_evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => reviewIssues.id, { onDelete: "cascade" }),
    relativePath: text("relative_path").notNull(),
    sha256: text("sha256").notNull(),
    bytes: integer("bytes").notNull(),
    mimeType: text("mime_type").notNull(),
    checkedGameVersion: text("checked_game_version").notNull(),
    checkedLocale: text("checked_locale").notNull(),
    note: text("note").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("review_evidence_issue_hash_unique").on(table.issueId, table.sha256)],
);

export const releaseCandidateChecks = knowledge.table(
  "release_candidate_checks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    candidateId: uuid("candidate_id")
      .notNull()
      .references(() => releaseCandidates.id, { onDelete: "cascade" }),
    buildId: uuid("build_id").references(() => releaseCandidateBuilds.id, { onDelete: "cascade" }),
    checkType: text("check_type").notNull(),
    status: text("status").notNull().default("pending"),
    message: text("message"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    retryable: boolean("retryable").notNull().default(true),
    checkedAt: timestamp("checked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("release_candidate_checks_unique").on(
      table.candidateId,
      table.buildId,
      table.checkType,
    ),
  ],
);

export const entities = knowledge.table(
  "entities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id),
    sourceKey: text("source_key"),
    type: text("type").notNull(),
    canonicalName: text("canonical_name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    summary: text("summary"),
    properties: jsonb("properties").$type<Record<string, unknown>>().notNull().default({}),
    firstRevisionId: uuid("first_revision_id").references(() => datasetRevisions.id),
    lastRevisionId: uuid("last_revision_id").references(() => datasetRevisions.id),
    deleted: boolean("deleted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("entities_game_source_key_unique").on(table.gameId, table.sourceKey),
    index("entities_game_name_index").on(table.gameId, table.normalizedName),
    index("entities_game_type_index").on(table.gameId, table.type),
    index("entities_game_type_name_index").on(table.gameId, table.type, table.canonicalName),
  ],
);

export const entityAliases = knowledge.table(
  "entity_aliases",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    value: text("value").notNull(),
    normalizedValue: text("normalized_value").notNull(),
    language: text("language").notNull().default("und"),
    sourceId: uuid("source_id").references(() => sources.id),
    isPrimary: boolean("is_primary").notNull().default(false),
  },
  (table) => [index("entity_aliases_normalized_index").on(table.normalizedValue)],
);

export const documents = knowledge.table(
  "documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id),
    sourceKey: text("source_key").notNull(),
    type: text("type").notNull(),
    title: text("title").notNull(),
    normalizedTitle: text("normalized_title").notNull(),
    gameVersion: text("game_version"),
    locale: text("locale").notNull().default("und"),
    sourceSnapshotId: uuid("source_snapshot_id")
      .notNull()
      .references(() => sourceSnapshots.id),
    body: text("body").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => datasetRevisions.id),
    deleted: boolean("deleted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("documents_game_source_revision_unique").on(
      table.gameId,
      table.sourceKey,
      table.revisionId,
    ),
    index("documents_game_title_index").on(table.gameId, table.normalizedTitle),
    index("documents_revision_type_locale_index").on(table.revisionId, table.type, table.locale),
    index("documents_body_trgm_index").using("gin", table.body.op("gin_trgm_ops")),
    index("documents_public_catalog_index").on(
      table.revisionId,
      table.locale,
      table.type,
      table.normalizedTitle,
    ),
  ],
);

export const documentSegments = knowledge.table(
  "document_segments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => datasetRevisions.id),
    segmentKey: text("segment_key"),
    ordinal: integer("ordinal").notNull(),
    headingPath: jsonb("heading_path").$type<string[]>().notNull().default([]),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    body: text("body").notNull(),
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    tokenEstimate: integer("token_estimate").notNull().default(0),
    contentHash: text("content_hash").notNull(),
    searchText: text("search_text").notNull(),
  },
  (table) => [
    uniqueIndex("document_segments_document_ordinal_unique").on(table.documentId, table.ordinal),
    uniqueIndex("document_segments_document_key_unique")
      .on(table.documentId, table.segmentKey)
      .where(sql`${table.segmentKey} IS NOT NULL`),
    index("document_segments_search_index").on(table.searchText),
    index("document_segments_body_trgm_index").using("gin", table.body.op("gin_trgm_ops")),
  ],
);

export const questSubquests = knowledge.table(
  "quest_subquests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => datasetRevisions.id, { onDelete: "cascade" }),
    questKey: text("quest_key").notNull(),
    subquestKey: text("subquest_key").notNull(),
    subquestId: text("subquest_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    title: text("title").notNull(),
    objective: text("objective"),
    completeness: text("completeness").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    uniqueIndex("quest_subquests_revision_key_unique").on(
      table.revisionId,
      table.documentId,
      table.subquestKey,
    ),
    index("quest_subquests_document_index").on(table.documentId, table.ordinal),
  ],
);

export const questDialogueNodes = knowledge.table(
  "quest_dialogue_nodes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => datasetRevisions.id, { onDelete: "cascade" }),
    questKey: text("quest_key").notNull(),
    subquestKey: text("subquest_key"),
    nodeKey: text("node_key").notNull(),
    nodeId: text("node_id").notNull(),
    nodeType: text("node_type").notNull(),
    speakerKey: text("speaker_key"),
    speakerName: text("speaker_name"),
    body: text("body").notNull(),
    segmentId: uuid("segment_id").references(() => documentSegments.id, { onDelete: "set null" }),
    ordinal: integer("ordinal").notNull(),
    variants: jsonb("variants").$type<Record<string, unknown>>().notNull().default({}),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    uniqueIndex("quest_dialogue_nodes_revision_key_unique").on(
      table.revisionId,
      table.documentId,
      table.nodeKey,
    ),
    index("quest_dialogue_nodes_document_index").on(table.documentId, table.ordinal),
    index("quest_dialogue_nodes_speaker_index").on(table.revisionId, table.speakerKey),
    index("quest_dialogue_nodes_document_subquest_ordinal_index").on(
      table.documentId,
      table.subquestKey,
      table.ordinal,
    ),
    index("quest_dialogue_nodes_body_trgm_index").using("gin", table.body.op("gin_trgm_ops")),
  ],
);

export const questDialogueEdges = knowledge.table(
  "quest_dialogue_edges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => datasetRevisions.id, { onDelete: "cascade" }),
    questKey: text("quest_key").notNull(),
    fromNodeKey: text("from_node_key").notNull(),
    toNodeKey: text("to_node_key").notNull(),
    edgeType: text("edge_type").notNull(),
    optionText: text("option_text"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    uniqueIndex("quest_dialogue_edges_revision_scope_unique").on(
      table.revisionId,
      table.documentId,
      table.fromNodeKey,
      table.toNodeKey,
      table.edgeType,
      table.optionText,
    ),
    index("quest_dialogue_edges_document_index").on(table.documentId),
  ],
);

export const entityMentions = knowledge.table(
  "entity_mentions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
    segmentId: uuid("segment_id")
      .notNull()
      .references(() => documentSegments.id, { onDelete: "cascade" }),
    rawText: text("raw_text").notNull(),
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    matchMethod: text("match_method").notNull(),
    confidence: real("confidence").notNull().default(1),
  },
  (table) => [
    index("entity_mentions_entity_index").on(table.entityId),
    index("entity_mentions_segment_index").on(table.segmentId),
  ],
);

export const relationships = knowledge.table(
  "relationships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => entities.id),
    predicate: text("predicate").notNull(),
    objectId: uuid("object_id")
      .notNull()
      .references(() => entities.id),
    sourceKey: text("source_key"),
    sourceId: uuid("source_id").references(() => sources.id),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => datasetRevisions.id),
    status: text("status").notNull().default("active"),
    validFrom: text("valid_from"),
    validTo: text("valid_to"),
    confidence: real("confidence"),
  },
  (table) => [
    index("relationships_subject_index").on(table.subjectId),
    index("relationships_object_index").on(table.objectId),
  ],
);

export const claims = knowledge.table(
  "claims",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id),
    sourceKey: text("source_key"),
    recordSourceKey: text("record_source_key"),
    normalizedStatement: text("normalized_statement").notNull(),
    status: text("status").notNull(),
    confidence: real("confidence"),
    createdBy: text("created_by").notNull(),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => datasetRevisions.id),
  },
  (table) => [index("claims_game_revision_index").on(table.gameId, table.revisionId)],
);

export const evidence = knowledge.table(
  "evidence",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    segmentId: uuid("segment_id")
      .notNull()
      .references(() => documentSegments.id),
    quoteStart: integer("quote_start").notNull().default(0),
    quoteEnd: integer("quote_end").notNull().default(0),
    quote: text("quote").notNull().default(""),
    strength: real("strength"),
    note: text("note"),
    valid: boolean("valid").notNull().default(true),
  },
  (table) => [
    index("evidence_claim_index").on(table.claimId),
    index("evidence_segment_index").on(table.segmentId),
  ],
);

export const claimEntities = knowledge.table(
  "claim_entities",
  {
    claimId: uuid("claim_id")
      .notNull()
      .references(() => claims.id, { onDelete: "cascade" }),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.claimId, table.entityId] }),
    index("claim_entities_entity_index").on(table.entityId),
  ],
);

export const embeddings = knowledge.table(
  "embeddings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => datasetRevisions.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    spaceId: text("space_id").notNull(),
    model: text("model").notNull(),
    modelVersion: text("model_version").notNull(),
    dimension: integer("dimension").notNull(),
    contentHash: text("content_hash").notNull(),
    vector: vector("vector", { dimensions: 1536 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("embeddings_target_revision_space_unique").on(
      table.revisionId,
      table.targetType,
      table.targetId,
      table.spaceId,
    ),
    index("embeddings_revision_index").on(table.revisionId),
  ],
);

export const gameVersions = knowledge.table(
  "game_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    version: text("version").notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [uniqueIndex("game_versions_game_version_unique").on(table.gameId, table.version)],
);

export const provenanceRefs = knowledge.table(
  "provenance_refs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => datasetRevisions.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => sources.id),
    sourceSnapshotId: uuid("source_snapshot_id").references(() => sourceSnapshots.id),
    sourceKey: text("source_key").notNull(),
    upstreamPath: text("upstream_path"),
    upstreamId: text("upstream_id"),
    upstreamHash: text("upstream_hash"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("provenance_refs_revision_source_key_unique").on(table.revisionId, table.sourceKey),
    index("provenance_refs_game_revision_index").on(table.gameId, table.revisionId),
  ],
);

export const structuredBindings = knowledge.table(
  "structured_bindings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => datasetRevisions.id, { onDelete: "cascade" }),
    stableId: text("stable_id").notNull(),
    structuredType: text("structured_type").notNull(),
    sourceKey: text("source_key"),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "cascade" }),
    segmentId: uuid("segment_id").references(() => documentSegments.id, { onDelete: "cascade" }),
    relation: text("relation").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    uniqueIndex("structured_bindings_revision_type_source_unique").on(
      table.revisionId,
      table.structuredType,
      table.sourceKey,
      table.relation,
    ),
    index("structured_bindings_revision_stable_index").on(table.revisionId, table.stableId),
    index("structured_bindings_document_index").on(table.documentId),
  ],
);

const genshinBaseColumns = {
  id: uuid("id").defaultRandom().primaryKey(),
  gameId: uuid("game_id")
    .notNull()
    .references(() => games.id, { onDelete: "cascade" }),
  revisionId: uuid("revision_id")
    .notNull()
    .references(() => datasetRevisions.id, { onDelete: "cascade" }),
  stableId: text("stable_id").notNull(),
  sourceKey: text("source_key").notNull(),
  name: text("name").notNull(),
  normalizedName: text("normalized_name").notNull(),
  locale: text("locale").notNull().default("und"),
  gameVersion: text("game_version"),
  sourceId: uuid("source_id").references(() => sources.id),
  sourceSnapshotId: uuid("source_snapshot_id").references(() => sourceSnapshots.id),
  provenance: jsonb("provenance").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const genshinCharacters = knowledge.table(
  "genshin_characters",
  {
    ...genshinBaseColumns,
    title: text("title"),
    rarity: integer("rarity"),
    element: text("element"),
    weaponType: text("weapon_type"),
    region: text("region"),
    affiliation: text("affiliation"),
    birthday: text("birthday"),
    constellation: text("constellation"),
    description: text("description"),
    profile: jsonb("profile").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    uniqueIndex("genshin_characters_revision_stable_unique").on(table.revisionId, table.stableId),
    uniqueIndex("genshin_characters_revision_source_unique").on(table.revisionId, table.sourceKey),
    index("genshin_characters_game_revision_index").on(table.gameId, table.revisionId),
    index("genshin_characters_name_index").on(table.revisionId, table.normalizedName),
  ],
);

export const genshinWeapons = knowledge.table(
  "genshin_weapons",
  {
    ...genshinBaseColumns,
    weaponType: text("weapon_type").notNull(),
    rarity: integer("rarity").notNull(),
    baseAttack: real("base_attack"),
    subStat: text("sub_stat"),
    passiveName: text("passive_name"),
    passiveDescription: text("passive_description"),
    ascensionMaterials: jsonb("ascension_materials").$type<string[]>().notNull().default([]),
    description: text("description"),
  },
  (table) => [
    uniqueIndex("genshin_weapons_revision_stable_unique").on(table.revisionId, table.stableId),
    uniqueIndex("genshin_weapons_revision_source_unique").on(table.revisionId, table.sourceKey),
    index("genshin_weapons_game_revision_index").on(table.gameId, table.revisionId),
    index("genshin_weapons_type_index").on(table.revisionId, table.weaponType),
  ],
);

export const genshinArtifactSets = knowledge.table(
  "genshin_artifact_sets",
  {
    ...genshinBaseColumns,
    maxRarity: integer("max_rarity"),
    twoPieceBonus: text("two_piece_bonus"),
    fourPieceBonus: text("four_piece_bonus"),
    pieces: jsonb("pieces").$type<string[]>().notNull().default([]),
  },
  (table) => [
    uniqueIndex("genshin_artifact_sets_revision_stable_unique").on(
      table.revisionId,
      table.stableId,
    ),
    uniqueIndex("genshin_artifact_sets_revision_source_unique").on(
      table.revisionId,
      table.sourceKey,
    ),
    index("genshin_artifact_sets_game_revision_index").on(table.gameId, table.revisionId),
  ],
);

export const genshinArtifacts = knowledge.table(
  "genshin_artifacts",
  {
    ...genshinBaseColumns,
    setStableId: text("set_stable_id"),
    slot: text("slot"),
    rarity: integer("rarity"),
    description: text("description"),
  },
  (table) => [
    uniqueIndex("genshin_artifacts_revision_stable_unique").on(table.revisionId, table.stableId),
    uniqueIndex("genshin_artifacts_revision_source_unique").on(table.revisionId, table.sourceKey),
    index("genshin_artifacts_game_revision_index").on(table.gameId, table.revisionId),
    index("genshin_artifacts_set_index").on(table.revisionId, table.setStableId),
  ],
);

export const genshinMaterials = knowledge.table(
  "genshin_materials",
  {
    ...genshinBaseColumns,
    category: text("category").notNull(),
    rarity: integer("rarity"),
    description: text("description"),
    sources: jsonb("sources").$type<string[]>().notNull().default([]),
    usedBy: jsonb("used_by").$type<string[]>().notNull().default([]),
  },
  (table) => [
    uniqueIndex("genshin_materials_revision_stable_unique").on(table.revisionId, table.stableId),
    uniqueIndex("genshin_materials_revision_source_unique").on(table.revisionId, table.sourceKey),
    index("genshin_materials_game_revision_index").on(table.gameId, table.revisionId),
    index("genshin_materials_category_index").on(table.revisionId, table.category),
  ],
);

export const genshinAchievements = knowledge.table(
  "genshin_achievements",
  {
    ...genshinBaseColumns,
    category: text("category").notNull(),
    requirement: text("requirement"),
    rewardPrimogems: integer("reward_primogems"),
    hidden: boolean("hidden").notNull().default(false),
  },
  (table) => [
    uniqueIndex("genshin_achievements_revision_stable_unique").on(table.revisionId, table.stableId),
    uniqueIndex("genshin_achievements_revision_source_unique").on(
      table.revisionId,
      table.sourceKey,
    ),
    index("genshin_achievements_game_revision_index").on(table.gameId, table.revisionId),
    index("genshin_achievements_category_index").on(table.revisionId, table.category),
    index("genshin_achievements_name_trgm_index").using(
      "gin",
      table.normalizedName.op("gin_trgm_ops"),
    ),
  ],
);

export const genshinEnemies = knowledge.table(
  "genshin_enemies",
  {
    ...genshinBaseColumns,
    category: text("category").notNull(),
    family: text("family"),
    description: text("description"),
    drops: jsonb("drops").$type<string[]>().notNull().default([]),
    resistances: jsonb("resistances").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    uniqueIndex("genshin_enemies_revision_stable_unique").on(table.revisionId, table.stableId),
    uniqueIndex("genshin_enemies_revision_source_unique").on(table.revisionId, table.sourceKey),
    index("genshin_enemies_game_revision_index").on(table.gameId, table.revisionId),
    index("genshin_enemies_category_index").on(table.revisionId, table.category),
  ],
);

export const genshinBooks = knowledge.table(
  "genshin_books",
  {
    ...genshinBaseColumns,
    volume: integer("volume"),
    series: text("series"),
    body: text("body").notNull().default(""),
  },
  (table) => [
    uniqueIndex("genshin_books_revision_stable_unique").on(table.revisionId, table.stableId),
    uniqueIndex("genshin_books_revision_source_unique").on(table.revisionId, table.sourceKey),
    index("genshin_books_game_revision_index").on(table.gameId, table.revisionId),
  ],
);

export const genshinCharacterStories = knowledge.table(
  "genshin_character_stories",
  {
    ...genshinBaseColumns,
    characterStableId: text("character_stable_id").notNull(),
    storyKey: text("story_key").notNull(),
    unlockCondition: text("unlock_condition"),
    body: text("body").notNull().default(""),
  },
  (table) => [
    uniqueIndex("genshin_character_stories_revision_story_unique").on(
      table.revisionId,
      table.characterStableId,
      table.storyKey,
    ),
    uniqueIndex("genshin_character_stories_revision_source_unique").on(
      table.revisionId,
      table.sourceKey,
    ),
    index("genshin_character_stories_character_index").on(
      table.revisionId,
      table.characterStableId,
    ),
  ],
);

export const genshinItemDescriptions = knowledge.table(
  "genshin_item_descriptions",
  {
    ...genshinBaseColumns,
    itemStableId: text("item_stable_id"),
    body: text("body").notNull().default(""),
  },
  (table) => [
    uniqueIndex("genshin_item_descriptions_revision_stable_unique").on(
      table.revisionId,
      table.stableId,
    ),
    uniqueIndex("genshin_item_descriptions_revision_source_unique").on(
      table.revisionId,
      table.sourceKey,
    ),
    index("genshin_item_descriptions_item_index").on(table.revisionId, table.itemStableId),
  ],
);

export const genshinVoiceLines = knowledge.table(
  "genshin_voice_lines",
  {
    ...genshinBaseColumns,
    characterStableId: text("character_stable_id").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    contentHash: text("content_hash").notNull(),
  },
  (table) => [
    uniqueIndex("genshin_voice_lines_revision_stable_unique").on(table.revisionId, table.stableId),
    uniqueIndex("genshin_voice_lines_revision_source_unique").on(table.revisionId, table.sourceKey),
    index("genshin_voice_lines_character_index").on(table.revisionId, table.characterStableId),
  ],
);

export const searchDocuments = knowledge.table(
  "search_documents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    gameId: uuid("game_id")
      .notNull()
      .references(() => games.id, { onDelete: "cascade" }),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => datasetRevisions.id, { onDelete: "cascade" }),
    stableId: text("stable_id").notNull(),
    targetType: text("target_type").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    locale: text("locale").notNull().default("und"),
    contentHash: text("content_hash").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("search_documents_revision_target_unique").on(
      table.revisionId,
      table.targetType,
      table.stableId,
      table.locale,
    ),
    index("search_documents_game_revision_index").on(table.gameId, table.revisionId),
    index("search_documents_title_body_trgm_index").using("gin", table.title.op("gin_trgm_ops")),
    index("search_documents_body_trgm_index").using("gin", table.body.op("gin_trgm_ops")),
  ],
);

export const auditLog = platform.table("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: uuid("target_id"),
  reason: text("reason"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type GameRow = typeof games.$inferSelect;
export type EntityRow = typeof entities.$inferSelect;
export type DocumentRow = typeof documents.$inferSelect;
export type ClaimRow = typeof claims.$inferSelect;
export type ClaimCandidateRow = ClaimCandidate;
