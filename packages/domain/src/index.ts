import type {
  Capability,
  ClaimStatus,
  DocumentSummary,
  DocumentType,
  EntitySummary,
  EntityType,
  GameSummary,
  RelationshipPredicate,
  SearchRequest,
  SearchResult,
} from "@gip/contracts";

export type Id = string;

export type EntityCandidate = {
  sourceKey: string;
  name: string;
  type: EntityType;
  summary?: string;
  aliases?: Array<{ value: string; language?: string; primary?: boolean }>;
  properties?: Record<string, unknown>;
};

export type RelationshipCandidate = {
  subjectSourceKey: string;
  predicate: RelationshipPredicate;
  objectSourceKey: string;
  confidence?: number;
  validFrom?: string;
  validTo?: string;
};

export type ClaimCandidate = {
  sourceKey: string;
  statement: string;
  status: ClaimStatus;
  confidence?: number;
  createdBy?: "import" | "human" | "ai_suggestion";
  entitySourceKeys?: string[];
  evidence?: Array<{
    documentSourceKey: string;
    quote?: string;
    strength?: number;
    note?: string;
  }>;
};

export type NormalizedRecord = {
  sourceKey: string;
  recordType: string;
  title?: string;
  body?: string;
  entityType?: EntityType;
  documentType?: DocumentType;
  gameVersion?: string;
  entities?: EntityCandidate[];
  relationships?: RelationshipCandidate[];
  claims?: ClaimCandidate[];
  metadata: Record<string, unknown>;
  contentHash: string;
  parserVersion: string;
};

export type ValidationIssue = {
  severity: "error" | "warning" | "info";
  code: string;
  message: string;
  sourceKey?: string;
};

export type ImportDiff = {
  added: string[];
  modified: string[];
  deletionCandidates: string[];
  unchanged: string[];
  conflicts: string[];
  unparsed: string[];
};

export type Game = GameSummary & { createdAt: Date; updatedAt: Date };

export type CapabilityRecord = {
  capability: Capability;
  enabled: boolean;
};

export type Source = {
  id: Id;
  gameId: Id;
  name: string;
  type: "local_json" | "local_markdown" | "local_text" | "local_directory";
  pathLabel: string;
  licenseNote?: string | null;
  enabled: boolean;
  parserType: string;
};

export type SourceSnapshot = {
  id: Id;
  sourceId: Id;
  contentHash: string;
  storagePath: string;
  capturedAt: Date;
  metadata: Record<string, unknown>;
};

export type ImportBatch = {
  id: Id;
  gameId: Id;
  sourceId: Id;
  sourceSnapshotId?: Id | null;
  status:
    "pending" | "running" | "staged" | "review_required" | "published" | "failed" | "cancelled";
  parserVersion: string;
  successCount: number;
  failureCount: number;
  warnings: ValidationIssue[];
  errors: ValidationIssue[];
  diff?: ImportDiff;
  stagedRecords?: NormalizedRecord[];
  reviewNote?: string | null;
  confirmedDeletionKeys: string[];
  createdAt: Date;
  completedAt?: Date | null;
};

export type DatasetRevision = {
  id: Id;
  gameId: Id;
  revisionNumber: number;
  sourceBatchId: Id;
  releaseNote?: string | null;
  publishedAt: Date;
  isCurrent: boolean;
  indexStatus: "pending" | "ready" | "stale" | "failed";
};

export type Entity = EntitySummary & {
  gameId: Id;
  properties: Record<string, unknown>;
  deleted: boolean;
  sourceKey?: string | null;
};

export type EntityDetail = Entity & {
  relationships: RelationshipView[];
  documents: DocumentSummary[];
  claims: ClaimView[];
  revision?: string;
};

export type RelationshipView = {
  id: Id;
  subjectId: Id;
  subjectName: string;
  predicate: RelationshipPredicate;
  objectId: Id;
  objectName: string;
  confidence?: number | null;
  revision?: string;
};

export type ClaimView = {
  id: Id;
  statement: string;
  status: ClaimStatus;
  confidence?: number | null;
  evidence: EvidenceView[];
};

export type EvidenceView = {
  id: Id;
  documentId: Id;
  documentTitle: string;
  segmentId: Id;
  quote: string;
  strength?: number | null;
  note?: string | null;
};

export type DocumentDetail = DocumentSummary & {
  body: string;
  sourceName: string;
  sourceId: Id;
  provenance?: DocumentProvenance;
  segments: Array<{
    id: Id;
    ordinal: number;
    headingPath: string[];
    body: string;
    startOffset: number;
    endOffset: number;
    mentions: Array<{ entityId: Id; name: string; startOffset: number; endOffset: number }>;
  }>;
};

export type DocumentProvenance = {
  datasetRevision?: string;
  sourceSnapshotId?: Id;
  upstreamSource?: string;
  upstreamCommit?: string;
  upstreamCommitDate?: string;
  upstreamVersionLabel?: string;
  locale?: string;
  canonicalKey?: string;
  sourceFiles?: string[];
  lineage?: Record<string, ProvenanceLineage>;
  upstreamIds?: Record<string, string | number | Array<string | number>>;
  textMapHashes?: Record<string, number | number[]>;
  readableFile?: string;
  rawContentHash?: string;
  normalizedContentHash?: string;
  transforms?: string[];
  converterVersion?: string;
  rightsStatus?: string;
};

export type ProvenanceLineage = {
  relativeFile?: string;
  upstreamId?: string | number | Record<string, unknown>;
  hash?: string;
  valueHash?: string;
  readablePath?: string | null;
  sources?: ProvenanceLineage[];
};

export type ConflictKind =
  "exact_match" | "formatting_only" | "version_difference" | "missing_field" | "content_conflict";

export type ConflictCase = {
  id: Id;
  gameId: Id;
  canonicalKey: string;
  gameVersion: string;
  locale: string;
  kind: ConflictKind;
  status: "open" | "resolved";
  observationIds: string[];
  selectedObservationId?: string | null;
  resolution?: string | null;
  createdAt: Date;
  resolvedAt?: Date | null;
};

export type ConflictObservation = {
  id: Id;
  sourceId: Id;
  sourceSnapshotId: Id;
  canonicalKey: string;
  category: string;
  gameVersion: string;
  locale: string;
  title: string;
  body: string;
  rawContentHash: string;
  normalizedContentHash: string;
  provenance?: DocumentProvenance;
};

export type ConflictDetail = ConflictCase & {
  observations: ConflictObservation[];
};

export type VerificationStatus =
  | "exact_match"
  | "formatting_only"
  | "mismatch"
  | "unavailable_due_unlock"
  | "version_mismatch"
  | "not_checked";

export type VerificationChannel = "game_client" | "hoyowiki";

export type VerificationItem = {
  id: Id;
  runId: Id;
  category: "book" | "character_story" | "item_description";
  canonicalKey: string;
  title: string;
  body?: string | null;
  sourceId?: Id | null;
  sourceSnapshotId?: Id | null;
  gameVersion?: string | null;
  locale?: string | null;
  provenance?: DocumentProvenance;
  status: VerificationStatus;
  channel?: VerificationChannel | null;
  checkedGameVersion?: string | null;
  checkedLocale?: string | null;
  note?: string | null;
  required: boolean;
  screenshotCount: number;
};

export type VerificationRun = {
  id: Id;
  batchId: Id;
  datasetRevision?: string | null;
  upstreamCommit: string;
  expectedGameVersion: string;
  expectedLocale: string;
  seed: string;
  status: "pending" | "ready" | "blocked";
  items: VerificationItem[];
  createdAt: Date;
};

export type RepositoryHealth = {
  database: "up" | "down";
  currentRevision: "available" | "missing";
  searchIndex: "ready" | "not_ready";
};

export type EmbeddingInput = {
  targetType: "entity" | "segment";
  targetId: Id;
  text: string;
  contentHash: string;
};

export type StoredEmbedding = EmbeddingInput & {
  spaceId: string;
  model: string;
  modelVersion: string;
  dimension: number;
  vector: number[];
};

export type VectorSearchHit = {
  document: DocumentSummary;
  segmentId: Id;
  snippet: string;
  score: number;
};

export type VectorEntityHit = {
  entity: EntitySummary;
  score: number;
};

export interface KnowledgeRepository {
  health(): Promise<RepositoryHealth>;
  listGames(): Promise<GameSummary[]>;
  getGame(gameId: Id): Promise<GameSummary | null>;
  getGameBySlug(slug: string): Promise<GameSummary | null>;
  getCapabilities(gameId: Id): Promise<CapabilityRecord[]>;
  listEntities(
    gameId: Id,
    options: {
      query?: string;
      type?: EntityType;
      limit: number;
      offset: number;
      revisionId?: Id;
    },
  ): Promise<EntitySummary[]>;
  getEntity(gameId: Id, entityId: Id, revisionId?: Id): Promise<EntityDetail | null>;
  getRelationships(
    gameId: Id,
    entityId: Id,
    options: { predicate?: RelationshipPredicate; limit: number; revisionId?: Id },
  ): Promise<RelationshipView[]>;
  getEntityDocuments(
    gameId: Id,
    entityId: Id,
    limit: number,
    revisionId?: Id,
  ): Promise<DocumentSummary[]>;
  listDocuments(
    gameId: Id,
    options: {
      query?: string;
      type?: DocumentType;
      limit: number;
      offset: number;
      revisionId?: Id;
    },
  ): Promise<DocumentSummary[]>;
  getDocument(gameId: Id, documentId: Id, revisionId?: Id): Promise<DocumentDetail | null>;
  search(gameId: Id, request: SearchRequest): Promise<SearchResult>;
  vectorSearch(
    gameId: Id,
    request: SearchRequest,
    vector: number[],
    spaceId: string,
    limit: number,
  ): Promise<VectorSearchHit[]>;
  vectorEntitySearch?(
    gameId: Id,
    request: SearchRequest,
    vector: number[],
    spaceId: string,
    limit: number,
  ): Promise<VectorEntityHit[]>;
  createSource(input: Omit<Source, "id">): Promise<Source>;
  listSources(gameId?: Id): Promise<Source[]>;
  getSource(sourceId: Id): Promise<Source | null>;
  createSnapshot(input: Omit<SourceSnapshot, "id" | "capturedAt">): Promise<SourceSnapshot>;
  getSourceRecordHashes(sourceId: Id): Promise<Map<string, string>>;
  listEntitySourceKeys?(gameId: Id, revisionId?: Id): Promise<string[]>;
  listEmbeddingInputs(gameId: Id, revisionId: Id): Promise<EmbeddingInput[]>;
  storeEmbeddings(embeddings: StoredEmbedding[]): Promise<void>;
  createImport(input: {
    gameId: Id;
    sourceId: Id;
    sourceSnapshotId: Id;
    parserVersion: string;
    stagedRecords: NormalizedRecord[];
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
    diff: ImportDiff;
  }): Promise<ImportBatch>;
  createPendingImport?(input: {
    gameId: Id;
    sourceId: Id;
    parserVersion: string;
  }): Promise<ImportBatch>;
  markImportRunning?(batchId: Id): Promise<ImportBatch>;
  updateImportStaged?(input: {
    batchId: Id;
    sourceSnapshotId: Id;
    stagedRecords: NormalizedRecord[];
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
    diff: ImportDiff;
  }): Promise<ImportBatch>;
  markImportFailed?(batchId: Id, issue: ValidationIssue): Promise<ImportBatch>;
  enqueueJob?(input: {
    type: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
  getImport(batchId: Id): Promise<ImportBatch | null>;
  listImports?(gameId?: Id): Promise<ImportBatch[]>;
  reviewImport(
    batchId: Id,
    approved: boolean,
    note: string | undefined,
    confirmedDeletionKeys: string[],
  ): Promise<ImportBatch>;
  publishImport(batchId: Id, releaseNote?: string): Promise<DatasetRevision>;
  ensureAcquisitionReview?(batchId: Id): Promise<void>;
  getVerificationRun?(batchId: Id): Promise<VerificationRun | null>;
  updateVerificationItem?(input: {
    itemId: Id;
    status: VerificationStatus;
    channel: VerificationChannel;
    checkedGameVersion: string;
    checkedLocale: string;
    note?: string;
  }): Promise<VerificationItem>;
  addVerificationScreenshot?(input: {
    itemId: Id;
    relativePath: string;
    sha256: string;
    bytes: number;
    mimeType: string;
  }): Promise<void>;
  reconcileSourceObservationConflicts?(gameId?: Id): Promise<{
    checked: number;
    repairedRaw: number;
    repairedNormalized: number;
    scopes: number;
    upserted: number;
    open: number;
  }>;
  listConflicts?(gameId: Id, status?: "open" | "resolved"): Promise<ConflictCase[]>;
  getConflict?(conflictId: Id): Promise<ConflictDetail | null>;
  resolveConflict?(
    conflictId: Id,
    resolution: string,
    selectedObservationId?: Id,
  ): Promise<ConflictCase>;
  listRevisions(gameId?: Id): Promise<DatasetRevision[]>;
  rollbackRevision(revisionId: Id, reason: string): Promise<DatasetRevision>;
  listJobs(): Promise<Array<Record<string, unknown>>>;
  claimNextJob(workerId: string): Promise<Record<string, unknown> | null>;
  heartbeatJob(jobId: Id, workerId: string): Promise<boolean>;
  completeJob(jobId: Id, status: "completed" | "failed", error?: string): Promise<void>;
  recordWorkerHeartbeat?(workerId: string): Promise<void>;
  workerHealth?(): Promise<"up" | "not_ready">;
}

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function validateNormalizedRecords(
  records: NormalizedRecord[],
  knownEntityKeys: Set<string> = new Set(),
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const seen = new Set<string>();
  const documentKeys = new Set(
    records
      .filter((record) => record.recordType !== "entity" && !record.entityType)
      .map((record) => record.sourceKey),
  );
  const entityKeys = new Set([
    ...knownEntityKeys,
    ...records.flatMap((record) => (record.entities ?? []).map((entity) => entity.sourceKey)),
  ]);
  const entityDefinitions = new Map<string, { name: string; type: EntityType }>();
  const entityTypes = new Set([
    "character",
    "faction",
    "region",
    "location",
    "item",
    "event",
    "concept",
    "quest",
    "book",
  ]);
  const documentTypes = new Set([
    "archon_quest",
    "story_quest",
    "world_quest",
    "book",
    "character_story",
    "item_description",
    "official_notice",
    "lore",
  ]);
  const predicates = new Set([
    "member_of",
    "located_in",
    "related_to",
    "family_of",
    "ally_of",
    "enemy_of",
    "participated_in",
    "mentioned_by",
  ]);
  const claimStatuses = new Set([
    "confirmed",
    "implied",
    "interpretation",
    "theory",
    "outdated",
    "rejected",
  ]);
  for (const record of records) {
    if (!record.sourceKey.trim()) {
      issues.push({
        severity: "error",
        code: "source_key_required",
        message: "sourceKey is required",
      });
    }
    if (seen.has(record.sourceKey)) {
      issues.push({
        severity: "error",
        code: "duplicate_source_key",
        message: `Duplicate source key: ${record.sourceKey}`,
        sourceKey: record.sourceKey,
      });
    }
    seen.add(record.sourceKey);
    if (!record.title && !record.body) {
      issues.push({
        severity: "error",
        code: "empty_record",
        message: "Record must contain a title or body",
        sourceKey: record.sourceKey,
      });
    }
    if (record.recordType !== "entity" && !record.body?.trim()) {
      issues.push({
        severity: "error",
        code: "empty_body",
        message: "Document records must contain body text",
        sourceKey: record.sourceKey,
      });
    }
    if (record.entityType && !entityTypes.has(record.entityType)) {
      issues.push({
        severity: "error",
        code: "invalid_entity_type",
        message: `Invalid entity type: ${record.entityType}`,
        sourceKey: record.sourceKey,
      });
    }
    if (record.documentType && !documentTypes.has(record.documentType)) {
      issues.push({
        severity: "error",
        code: "invalid_document_type",
        message: `Invalid document type: ${record.documentType}`,
        sourceKey: record.sourceKey,
      });
    }
    if (record.body?.length && record.body.length > 200_000) {
      issues.push({
        severity: "warning",
        code: "large_document",
        message: "Document exceeds the recommended size",
        sourceKey: record.sourceKey,
      });
    }
    for (const entity of record.entities ?? []) {
      const previousDefinition = entityDefinitions.get(entity.sourceKey);
      if (
        previousDefinition &&
        (previousDefinition.name !== entity.name || previousDefinition.type !== entity.type)
      ) {
        issues.push({
          severity: "error",
          code: "conflicting_entity_definition",
          message: `Conflicting definitions for entity: ${entity.sourceKey}`,
          sourceKey: record.sourceKey,
        });
      } else if (!previousDefinition) {
        entityDefinitions.set(entity.sourceKey, { name: entity.name, type: entity.type });
      }
      if (!entityTypes.has(entity.type)) {
        issues.push({
          severity: "error",
          code: "invalid_entity_type",
          message: `Invalid entity type: ${entity.type}`,
          sourceKey: record.sourceKey,
        });
      }
    }
    for (const claim of record.claims ?? []) {
      if (!claimStatuses.has(claim.status)) {
        issues.push({
          severity: "error",
          code: "invalid_claim_status",
          message: `Invalid claim status: ${claim.status}`,
          sourceKey: record.sourceKey,
        });
      }
      if ((claim.status === "confirmed" || claim.status === "implied") && !claim.evidence?.length) {
        issues.push({
          severity: "error",
          code: "claim_evidence_required",
          message: `Claim has no evidence: ${claim.statement}`,
          sourceKey: record.sourceKey,
        });
      }
      for (const entitySourceKey of claim.entitySourceKeys ?? []) {
        if (!entityKeys.has(entitySourceKey))
          issues.push({
            severity: "error",
            code: "invalid_claim_entity_reference",
            message: `Claim references an unknown entity: ${entitySourceKey}`,
            sourceKey: record.sourceKey,
          });
      }
      for (const evidence of claim.evidence ?? []) {
        if (!documentKeys.has(evidence.documentSourceKey))
          issues.push({
            severity: "error",
            code: "invalid_evidence_document_reference",
            message: `Evidence references an unknown document: ${evidence.documentSourceKey}`,
            sourceKey: record.sourceKey,
          });
      }
    }
    for (const relation of record.relationships ?? []) {
      if (!predicates.has(relation.predicate)) {
        issues.push({
          severity: "error",
          code: "invalid_relationship_predicate",
          message: `Invalid relationship predicate: ${relation.predicate}`,
          sourceKey: record.sourceKey,
        });
      }
      if (!entityKeys.has(relation.subjectSourceKey) || !entityKeys.has(relation.objectSourceKey)) {
        issues.push({
          severity: "error",
          code: "invalid_entity_reference",
          message: "Relationship references an entity not present in the batch",
          sourceKey: record.sourceKey,
        });
      }
    }
    if (JSON.stringify(record).includes("\uFFFD")) {
      issues.push({
        severity: "error",
        code: "invalid_encoding",
        message: "Replacement character detected",
        sourceKey: record.sourceKey,
      });
    }
  }
  return issues;
}

export function assertPublishable(
  batch: Pick<ImportBatch, "status" | "errors" | "reviewNote">,
): void {
  if (batch.status !== "review_required") {
    throw new DomainError(
      "invalid_import_state",
      `Import cannot be published from state ${batch.status}`,
    );
  }
  if (batch.errors.length > 0) {
    throw new DomainError(
      "import_has_errors",
      "Import contains blocking validation errors",
      batch.errors,
    );
  }
  if (batch.status === "review_required" && !batch.reviewNote) {
    throw new DomainError("review_required", "Import requires an explicit review decision");
  }
}

export class KnowledgeService {
  constructor(private readonly repository: KnowledgeRepository) {}

  listGames(): Promise<GameSummary[]> {
    return this.repository.listGames();
  }

  async requireGame(gameId: Id): Promise<GameSummary> {
    const game = await this.repository.getGame(gameId);
    if (!game) throw new DomainError("game_not_found", "Game was not found", undefined, 404);
    return game;
  }

  async requireCapability(gameId: Id, capability: Capability): Promise<void> {
    await this.requireGame(gameId);
    const capabilities = await this.repository.getCapabilities(gameId);
    if (!capabilities.some((item) => item.capability === capability && item.enabled)) {
      throw new DomainError(
        "capability_not_available",
        `Capability is not available: ${capability}`,
        undefined,
        404,
      );
    }
  }

  async search(gameId: Id, request: SearchRequest): Promise<SearchResult> {
    await this.requireGame(gameId);
    return this.repository.search(gameId, request);
  }

  async getEntity(gameId: Id, entityId: Id, revisionId?: Id): Promise<EntityDetail> {
    await this.requireGame(gameId);
    const entity = await this.repository.getEntity(gameId, entityId, revisionId);
    if (!entity) throw new DomainError("entity_not_found", "Entity was not found", undefined, 404);
    return entity;
  }

  async getDocument(gameId: Id, documentId: Id, revisionId?: Id): Promise<DocumentDetail> {
    await this.requireGame(gameId);
    const document = await this.repository.getDocument(gameId, documentId, revisionId);
    if (!document)
      throw new DomainError("document_not_found", "Document was not found", undefined, 404);
    return document;
  }
}
