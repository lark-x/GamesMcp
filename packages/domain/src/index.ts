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
  GenshinAchievement,
  GenshinArtifact,
  GenshinArtifactSet,
  GenshinCharacter,
  GenshinEnemy,
  GenshinMaterial,
  GenshinWeapon,
} from "@gip/contracts";

export type {
  GenshinAchievement,
  GenshinAchievementCategory,
  GenshinArtifact,
  GenshinArtifactSet,
  GenshinCharacter,
  GenshinElement,
  GenshinEnemy,
  GenshinEnemyCategory,
  GenshinMaterial,
  GenshinMaterialCategory,
  GenshinWeapon,
  GenshinWeaponType,
  StructuredBinding,
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

export type NormalizedSegment = {
  segmentKey: string;
  ordinal: number;
  headingPath?: string[];
  body: string;
  startOffset: number;
  endOffset: number;
  metadata?: Record<string, unknown>;
};

export type QuestCompleteness = "complete" | "partial" | "metadata_only";

export type QuestVisibility = "public" | "hidden" | "unreleased" | "test" | "unresolved";

export type QuestSubquestPayload = {
  subquestKey: string;
  subquestId: string | number;
  title: string;
  objective?: string;
  order: number;
  completeness: QuestCompleteness;
  metadata?: Record<string, unknown>;
};

export type QuestDialogueNodePayload = {
  nodeKey: string;
  nodeId: string | number;
  type: "dialogue" | "player_choice" | "narration" | "objective" | "system_text";
  subquestKey?: string;
  speakerKey?: string;
  speakerName?: string;
  body: string;
  segmentKey?: string;
  order?: number;
  variants?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type QuestDialogueEdgePayload = {
  fromNodeKey: string;
  toNodeKey: string;
  type: "next" | "choice" | "optional" | "fallback";
  optionText?: string;
  metadata?: Record<string, unknown>;
};

export type QuestRecordPayload = {
  questKey: string;
  mainQuestId: string | number;
  questType: "archon_quest" | "story_quest" | "world_quest" | "event_quest";
  locale: string;
  chapter?: string;
  series?: string;
  order?: number;
  completeness: QuestCompleteness;
  /** Records outside the public game-facing catalogue remain available to admin preview only. */
  visibility?: QuestVisibility;
  visibilityReason?: string;
  prerequisites?: string[];
  subquests: QuestSubquestPayload[];
  dialogueNodes: QuestDialogueNodePayload[];
  dialogueEdges: QuestDialogueEdgePayload[];
  metadata?: Record<string, unknown>;
};

export type NormalizedRecord = {
  sourceKey: string;
  recordType: string;
  title?: string;
  body?: string;
  entityType?: EntityType;
  documentType?: DocumentType;
  gameVersion?: string;
  locale?: string;
  segments?: NormalizedSegment[];
  quest?: QuestRecordPayload;
  entities?: EntityCandidate[];
  relationships?: RelationshipCandidate[];
  claims?: ClaimCandidate[];
  metadata: Record<string, unknown>;
  contentHash: string;
  parserVersion: string;
};

export type GenshinVoiceLine = {
  id: Id;
  gameId: Id;
  revisionId: Id;
  stableId: string;
  sourceKey: string;
  characterStableId: string;
  name: string;
  title: string;
  body: string;
  locale: string;
  gameVersion?: string | null;
  provenance: Record<string, unknown>;
  contentHash: string;
};

export type StructuredImportRecords = {
  characters?: GenshinCharacter[];
  weapons?: GenshinWeapon[];
  artifactSets?: GenshinArtifactSet[];
  artifacts?: GenshinArtifact[];
  materials?: GenshinMaterial[];
  achievements?: GenshinAchievement[];
  enemies?: GenshinEnemy[];
  voices?: GenshinVoiceLine[];
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
  structuredRecords?: StructuredImportRecords;
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
  lifecycleStatus: "preparing" | "preview" | "published" | "retired" | "failed";
  publishedAt: Date;
  isCurrent: boolean;
  indexStatus: "pending" | "ready" | "stale" | "failed";
  structuredRecords?: StructuredImportRecords;
  manifestId?: Id | null;
  sourceId?: Id | null;
  gameVersion?: string | null;
  locale?: string | null;
  archivedReason?: string | null;
  archivedAt?: Date | null;
};

export type ContentObject = {
  contentHash: string;
  recordType: string;
  schemaVersion: string;
  payload: Record<string, unknown>;
  byteLength: number;
  createdAt: Date;
};
export type DatasetManifest = {
  id: Id;
  gameId: Id;
  kind: "preview" | "published";
  baseRevisionId?: Id | null;
  rootHash: string;
  recordCount: number;
  createdAt: Date;
};
export type DatasetManifestEntry = { manifestId: Id; canonicalKey: string; contentHash: string };
export type ReviewIssue = {
  id: Id;
  gameId: Id;
  candidateId: Id;
  detectedBuildId?: Id | null;
  canonicalKey: string;
  fieldPath?: string | null;
  kind: string;
  status: "open" | "resolved" | "reopened";
  blocking: boolean;
  fingerprint: string;
  summary: string;
  details: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date | null;
};
export type CandidatePatch = {
  id: Id;
  candidateId: Id;
  issueId?: Id | null;
  canonicalKey: string;
  fieldPath?: string | null;
  action: string;
  manualValue?: unknown;
  createdAt: Date;
};
export type ReviewEvidence = {
  id: Id;
  issueId: Id;
  relativePath: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  checkedGameVersion: string;
  checkedLocale: string;
  note: string;
  createdAt: Date;
};
export type ReleaseCandidateCheck = {
  id: Id;
  candidateId: Id;
  buildId?: Id | null;
  checkType: string;
  status: "pending" | "passed" | "blocked" | "failed";
  message?: string | null;
  details: Record<string, unknown>;
  retryable: boolean;
  checkedAt?: Date | null;
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
  upstreamId?: string | number | Array<string | number> | Record<string, unknown>;
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

export type VerificationScreenshot = {
  id: Id;
  itemId: Id;
  relativePath: string;
  sha256: string;
  bytes: number;
  mimeType: string;
  createdAt: Date;
};
export type PublishReadiness = {
  ready: boolean;
  blockingReasons: Array<{ code: string; message: string; details?: unknown }>;
};

export type ReleaseCandidateStatus =
  "draft" | "preview_ready" | "ready_to_promote" | "promoted" | "withdrawn" | "failed";

/**
 * A release candidate is administrative state only. It is deliberately not a
 * DatasetRevision, so preview data can never become visible to MCP readers by
 * merely creating or building a candidate.
 */
export type ReleaseCandidate = {
  id: Id;
  gameId: Id;
  name: string;
  baseRevisionId?: Id | null;
  importBatchIds: Id[];
  status: ReleaseCandidateStatus;
  currentBuildId?: Id | null;
  promotedRevisionId?: Id | null;
  createdAt: Date;
  updatedAt: Date;
  sourceId?: Id | null;
  targetGameVersion?: string | null;
  archivedReason?: string | null;
  archivedAt?: Date | null;
};

export type ReleaseCandidateBuild = {
  id: Id;
  candidateId: Id;
  buildNumber: number;
  status: "ready" | "failed";
  contentChecksum: string;
  recordCount: number;
  createdAt: Date;
  manifestId?: Id | null;
  importBatchId?: Id | null;
  baseRevisionId?: Id | null;
  buildKind?: string;
  indexStatus?: string;
  sourceId?: Id | null;
  targetGameVersion?: string | null;
  locale?: string | null;
  archivedReason?: string | null;
  archivedAt?: Date | null;
};

export type ReleaseCandidateDetail = ReleaseCandidate & {
  builds: ReleaseCandidateBuild[];
};

export type ReleaseCandidateReadiness = PublishReadiness & {
  candidateId: Id;
  buildId?: Id;
  contentChecksum?: string;
};

export type GenshinStructuredListOptions = {
  revisionId: Id;
  query?: string;
  limit: number;
  offset?: number;
};

export interface GenshinStructuredRepository {
  upsertCharacter(
    input: Omit<import("@gip/contracts").GenshinCharacter, "id">,
  ): Promise<import("@gip/contracts").GenshinCharacter>;
  getCharacter(
    revisionId: Id,
    stableId: string,
  ): Promise<import("@gip/contracts").GenshinCharacter | null>;
  listCharacters(
    options: GenshinStructuredListOptions,
  ): Promise<import("@gip/contracts").GenshinCharacter[]>;
  upsertWeapon(
    input: Omit<import("@gip/contracts").GenshinWeapon, "id">,
  ): Promise<import("@gip/contracts").GenshinWeapon>;
  getWeapon(
    revisionId: Id,
    stableId: string,
  ): Promise<import("@gip/contracts").GenshinWeapon | null>;
  listWeapons(
    options: GenshinStructuredListOptions,
  ): Promise<import("@gip/contracts").GenshinWeapon[]>;
  upsertArtifactSet(
    input: Omit<import("@gip/contracts").GenshinArtifactSet, "id">,
  ): Promise<import("@gip/contracts").GenshinArtifactSet>;
  getArtifactSet(
    revisionId: Id,
    stableId: string,
  ): Promise<import("@gip/contracts").GenshinArtifactSet | null>;
  listArtifactSets(
    options: GenshinStructuredListOptions,
  ): Promise<import("@gip/contracts").GenshinArtifactSet[]>;
  upsertArtifact(
    input: Omit<import("@gip/contracts").GenshinArtifact, "id">,
  ): Promise<import("@gip/contracts").GenshinArtifact>;
  getArtifact(
    revisionId: Id,
    stableId: string,
  ): Promise<import("@gip/contracts").GenshinArtifact | null>;
  listArtifacts(
    options: GenshinStructuredListOptions,
  ): Promise<import("@gip/contracts").GenshinArtifact[]>;
  upsertMaterial(
    input: Omit<import("@gip/contracts").GenshinMaterial, "id">,
  ): Promise<import("@gip/contracts").GenshinMaterial>;
  getMaterial(
    revisionId: Id,
    stableId: string,
  ): Promise<import("@gip/contracts").GenshinMaterial | null>;
  listMaterials(
    options: GenshinStructuredListOptions,
  ): Promise<import("@gip/contracts").GenshinMaterial[]>;
  upsertAchievement(
    input: Omit<import("@gip/contracts").GenshinAchievement, "id">,
  ): Promise<import("@gip/contracts").GenshinAchievement>;
  getAchievement(
    revisionId: Id,
    stableId: string,
  ): Promise<import("@gip/contracts").GenshinAchievement | null>;
  listAchievements(
    options: GenshinStructuredListOptions,
  ): Promise<import("@gip/contracts").GenshinAchievement[]>;
  upsertEnemy(
    input: Omit<import("@gip/contracts").GenshinEnemy, "id">,
  ): Promise<import("@gip/contracts").GenshinEnemy>;
  getEnemy(revisionId: Id, stableId: string): Promise<import("@gip/contracts").GenshinEnemy | null>;
  listEnemies(
    options: GenshinStructuredListOptions,
  ): Promise<import("@gip/contracts").GenshinEnemy[]>;
}

export type RepositoryHealth = {
  database: "up" | "down";
  currentRevision: "available" | "missing";
  searchIndex: "ready" | "not_ready";
};

export type EmbeddingInput = {
  revisionId: Id;
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

export type QuestSearchRequest = {
  query: string;
  questTypes?: Array<QuestRecordPayload["questType"]>;
  locale?: string;
  gameVersion?: string;
  limit: number;
  /** Public callers use the curated, readable catalogue by default. */
  publicOnly?: boolean;
  revisionId?: Id;
};

export type QuestSearchHit = {
  questKey: string;
  mainQuestId: string;
  title: string;
  type: QuestRecordPayload["questType"];
  chapter?: string | null;
  series?: string | null;
  completeness: QuestCompleteness;
  locale: string;
  documentId: Id;
  revision: string;
  match?: string;
};

export type QuestDialoguePage = {
  questKey: string;
  title: string;
  type: QuestRecordPayload["questType"];
  locale: string;
  gameVersion?: string | null;
  documentId: Id;
  revision: string;
  completeness: QuestCompleteness;
  subquests: QuestSubquestPayload[];
  dialogueNodes: Array<QuestDialogueNodePayload & { segmentId?: Id | null }>;
  dialogueEdges: QuestDialogueEdgePayload[];
  participants: EntitySummary[];
  prerequisites: string[];
  citations: Array<{
    documentId: Id;
    locale: string;
    questKey: string;
    subquestKey?: string;
    dialogueNodeKey?: string;
    revision: string;
  }>;
  warnings: string[];
  totalDialogueNodes?: number;
  loadedDialogueNodes?: number;
  hasMore?: boolean;
  nextCursor?: string | null;
};

export type GetQuestRequest = {
  questKey: string;
  locale?: string;
  nodeLimit: number;
  cursor?: string;
  subquestId?: string;
  /** Defaults to true for public APIs; admin preview can explicitly disable it. */
  publicOnly?: boolean;
  revisionId?: Id;
};

export type ArchiveHome = import("@gip/contracts").ArchiveHomeResponse;

export interface KnowledgeRepository {
  readonly genshin: GenshinStructuredRepository;

  health(): Promise<RepositoryHealth>;
  listGames(): Promise<GameSummary[]>;
  getGame(gameId: Id): Promise<GameSummary | null>;
  getGameBySlug(slug: string): Promise<GameSummary | null>;
  getCapabilities(gameId: Id): Promise<CapabilityRecord[]>;
  getArchiveHome?(
    gameId: Id,
    options: { locale?: string; revisionId?: Id; limit?: number },
  ): Promise<ArchiveHome>;
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
      locale?: string;
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
  searchQuests?(gameId: Id, request: QuestSearchRequest): Promise<QuestSearchHit[]>;
  getQuest?(gameId: Id, request: GetQuestRequest): Promise<QuestDialoguePage | null>;
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
    stagedRecords?: NormalizedRecord[];
    structuredRecords?: StructuredImportRecords;
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
    stagedRecords?: NormalizedRecord[];
    structuredRecords?: StructuredImportRecords;
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
  publishImport(
    batchId: Id,
    releaseNote?: string,
    options?: { skipManualVerification?: boolean },
  ): Promise<DatasetRevision>;
  materializeRevision?(revisionId: Id): Promise<void>;
  getPublishReadiness?(batchId: Id): Promise<PublishReadiness>;
  createReleaseCandidate?(input: {
    gameId: Id;
    name: string;
    importBatchIds: Id[];
  }): Promise<ReleaseCandidate>;
  listReleaseCandidates?(gameId?: Id): Promise<ReleaseCandidate[]>;
  getReleaseCandidate?(candidateId: Id): Promise<ReleaseCandidateDetail | null>;
  buildReleaseCandidate?(candidateId: Id): Promise<ReleaseCandidateBuild>;
  getReleaseCandidateBuild?(buildId: Id): Promise<
    | (ReleaseCandidateBuild & {
        gameId: Id;
        normalizedRecords: NormalizedRecord[];
      })
    | null
  >;
  getReleaseCandidateReadiness?(candidateId: Id): Promise<ReleaseCandidateReadiness>;
  promoteReleaseCandidate?(input: {
    candidateId: Id;
    buildId: Id;
    contentChecksum: string;
    expectedCurrentRevisionId?: Id | null;
    releaseNote?: string;
    idempotencyKey: string;
  }): Promise<DatasetRevision>;
  finalizeActivation?(input: {
    revisionId: Id;
    candidateId: Id;
    buildId: Id;
    contentChecksum: string;
    expectedCurrentRevisionId?: Id | null;
  }): Promise<DatasetRevision>;
  setRevisionIndexStatus?(
    revisionId: Id,
    status: "ready" | "failed",
    error?: string,
  ): Promise<void>;
  finalizeActivation?(input: {
    revisionId: Id;
    candidateId: Id;
    buildId: Id;
    contentChecksum: string;
    expectedCurrentRevisionId?: Id | null;
  }): Promise<DatasetRevision>;
  listReviewIssues?(candidateId: Id): Promise<ReviewIssue[]>;
  reportReviewIssue?(input: {
    candidateId: Id;
    buildId: Id;
    canonicalKey: string;
    fieldPath?: string;
    summary: string;
    details?: Record<string, unknown>;
  }): Promise<ReviewIssue>;
  getReviewIssue?(issueId: Id): Promise<ReviewIssue | null>;
  resolveReviewIssue?(issueId: Id, action?: string, note?: string): Promise<ReviewIssue>;
  reopenReviewIssue?(issueId: Id): Promise<ReviewIssue>;
  listCandidatePatches?(candidateId: Id): Promise<CandidatePatch[]>;
  createCandidatePatch?(input: {
    candidateId: Id;
    issueId?: Id;
    canonicalKey: string;
    fieldPath?: string;
    action: string;
    manualValue?: unknown;
    expectedBaseHash?: string;
    expectedIncomingHash?: string;
  }): Promise<CandidatePatch>;
  listReviewEvidence?(issueId: Id): Promise<ReviewEvidence[]>;
  addReviewEvidence?(input: Omit<ReviewEvidence, "id" | "createdAt">): Promise<ReviewEvidence>;
  getReviewEvidence?(evidenceId: Id): Promise<ReviewEvidence | null>;
  deleteReviewEvidence?(evidenceId: Id): Promise<ReviewEvidence | null>;
  listReleaseCandidateChecks?(candidateId: Id): Promise<ReleaseCandidateCheck[]>;
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
  listVerificationScreenshots?(itemId: Id): Promise<VerificationScreenshot[]>;
  getVerificationScreenshot?(screenshotId: Id): Promise<VerificationScreenshot | null>;
  deleteVerificationScreenshot?(screenshotId: Id): Promise<VerificationScreenshot>;
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
  const entityDefinitions = new Map<
    string,
    { type: EntityType; namesByLanguage: Map<string, string> }
  >();
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
    "npc",
  ]);
  const documentTypes = new Set([
    "archon_quest",
    "story_quest",
    "world_quest",
    "event_quest",
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
    "prerequisite_for",
    "part_of",
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
    if (record.locale !== undefined && !record.locale.trim()) {
      issues.push({
        severity: "error",
        code: "invalid_locale",
        message: "locale must not be blank",
        sourceKey: record.sourceKey,
      });
    }
    const segmentKeys = new Set<string>();
    for (const segment of record.segments ?? []) {
      if (!segment.segmentKey.trim()) {
        issues.push({
          severity: "error",
          code: "segment_key_required",
          message: "Structured segments require segmentKey",
          sourceKey: record.sourceKey,
        });
      }
      if (segmentKeys.has(segment.segmentKey)) {
        issues.push({
          severity: "error",
          code: "duplicate_segment_key",
          message: `Duplicate segment key: ${segment.segmentKey}`,
          sourceKey: record.sourceKey,
        });
      }
      segmentKeys.add(segment.segmentKey);
      if (!segment.body.trim()) {
        issues.push({
          severity: "error",
          code: "empty_segment",
          message: `Structured segment is empty: ${segment.segmentKey}`,
          sourceKey: record.sourceKey,
        });
      }
      if (segment.endOffset < segment.startOffset) {
        issues.push({
          severity: "error",
          code: "invalid_segment_offsets",
          message: `Segment offsets are invalid: ${segment.segmentKey}`,
          sourceKey: record.sourceKey,
        });
      }
    }
    if (record.quest) {
      const questTypes = new Set(["archon_quest", "story_quest", "world_quest", "event_quest"]);
      const nodeTypes = new Set([
        "dialogue",
        "player_choice",
        "narration",
        "objective",
        "system_text",
      ]);
      const edgeTypes = new Set(["next", "choice", "optional", "fallback"]);
      if (
        !questTypes.has(record.quest.questType) ||
        record.documentType !== record.quest.questType
      ) {
        issues.push({
          severity: "error",
          code: "quest_document_type_mismatch",
          message: "Quest payload type must match documentType",
          sourceKey: record.sourceKey,
        });
      }
      if (record.locale && record.quest.locale !== record.locale) {
        issues.push({
          severity: "error",
          code: "quest_locale_mismatch",
          message: "Quest payload locale must match record locale",
          sourceKey: record.sourceKey,
        });
      }
      const subquestKeys = new Set<string>();
      for (const subquest of record.quest.subquests) {
        if (subquestKeys.has(subquest.subquestKey)) {
          issues.push({
            severity: "error",
            code: "duplicate_subquest_key",
            message: `Duplicate subquest key: ${subquest.subquestKey}`,
            sourceKey: record.sourceKey,
          });
        }
        subquestKeys.add(subquest.subquestKey);
      }
      const nodeKeys = new Set<string>();
      for (const node of record.quest.dialogueNodes) {
        if (!nodeTypes.has(node.type)) {
          issues.push({
            severity: "error",
            code: "invalid_quest_node_type",
            message: `Invalid quest dialogue node type: ${node.type}`,
            sourceKey: record.sourceKey,
          });
        }
        if (nodeKeys.has(node.nodeKey)) {
          issues.push({
            severity: "error",
            code: "duplicate_dialogue_node_key",
            message: `Duplicate dialogue node key: ${node.nodeKey}`,
            sourceKey: record.sourceKey,
          });
        }
        nodeKeys.add(node.nodeKey);
        if (node.subquestKey && !subquestKeys.has(node.subquestKey)) {
          issues.push({
            severity: "error",
            code: "invalid_dialogue_subquest_reference",
            message: `Dialogue node references an unknown subquest: ${node.subquestKey}`,
            sourceKey: record.sourceKey,
          });
        }
        if (node.segmentKey && !segmentKeys.has(node.segmentKey)) {
          issues.push({
            severity: "error",
            code: "invalid_dialogue_segment_reference",
            message: `Dialogue node references an unknown segment: ${node.segmentKey}`,
            sourceKey: record.sourceKey,
          });
        }
      }
      for (const edge of record.quest.dialogueEdges) {
        if (!edgeTypes.has(edge.type)) {
          issues.push({
            severity: "error",
            code: "invalid_dialogue_edge_type",
            message: `Invalid dialogue edge type: ${edge.type}`,
            sourceKey: record.sourceKey,
          });
        }
        if (!nodeKeys.has(edge.fromNodeKey) || !nodeKeys.has(edge.toNodeKey)) {
          issues.push({
            severity: "error",
            code: "dangling_dialogue_edge",
            message: "Dialogue edge references a missing node",
            sourceKey: record.sourceKey,
          });
        }
      }
    }
    for (const entity of record.entities ?? []) {
      const previousDefinition = entityDefinitions.get(entity.sourceKey);
      const language =
        entity.aliases?.find((alias) => alias.primary && alias.language)?.language ??
        entity.aliases?.find((alias) => alias.language)?.language ??
        "und";
      const previousName = previousDefinition?.namesByLanguage.get(language);
      if (previousDefinition && previousDefinition.type !== entity.type) {
        issues.push({
          severity: "error",
          code: "conflicting_entity_definition",
          message: `Conflicting definitions for entity: ${entity.sourceKey}`,
          sourceKey: record.sourceKey,
        });
      } else if (previousName && previousName !== entity.name) {
        issues.push({
          severity: "error",
          code: "conflicting_entity_definition",
          message: `Conflicting definitions for entity: ${entity.sourceKey}`,
          sourceKey: record.sourceKey,
        });
      } else if (!previousDefinition) {
        entityDefinitions.set(entity.sourceKey, {
          type: entity.type,
          namesByLanguage: new Map([[language, entity.name]]),
        });
      } else if (!previousName) {
        previousDefinition.namesByLanguage.set(language, entity.name);
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

export type CitationView = {
  documentId: Id;
  locale: string;
  questKey?: string;
  subquestKey?: string;
  dialogueNodeKey?: string;
  segmentId?: Id;
  revision: string;
};

export type SectionReadRequest = {
  gameId: Id;
  documentId: Id;
  revisionId?: Id;
  section?: string;
  maxChars?: number;
};

export type SectionReadResult = {
  documentId: Id;
  title: string;
  locale: string;
  revision: string;
  headingPath: string[];
  body: string;
  truncated: boolean;
  citations: CitationView[];
};

/**
 * Shared read-model service for Game Codex API and Game MCP. Both consumers
 * must go through this service instead of calling each other or reaching into
 * repository internals directly.
 */
export class GameDomainService {
  constructor(private readonly repository: KnowledgeRepository) {}

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

  /** Resolve the current public, searchable, published revision. */
  async requirePublicRevision(gameId: Id): Promise<Id> {
    await this.requireGame(gameId);
    const revision = (await this.repository.listRevisions(gameId)).find(
      (item) =>
        item.isCurrent &&
        item.lifecycleStatus === "published" &&
        item.indexStatus === "ready" &&
        Boolean(item.manifestId),
    );
    if (!revision)
      throw new DomainError(
        "index_not_ready",
        "No searchable Dataset Revision is ready",
        undefined,
        503,
      );
    return revision.id;
  }

  /** Alias resolution over structured entities plus legacy entity aliases. */
  async resolveAlias(gameId: Id, query: string, revisionId?: Id): Promise<EntitySummary | null> {
    await this.requireCapability(gameId, "entity_search");
    const revision = revisionId ?? (await this.requirePublicRevision(gameId));
    const result = await this.repository.search(gameId, {
      query,
      types: ["entity"],
      limit: 1,
      revisionId: revision,
      debug: false,
    });
    return result.entities[0] ?? null;
  }

  async listCharacters(
    gameId: Id,
    revisionId?: Id,
    options: { query?: string; limit?: number; offset?: number } = {},
  ) {
    await this.requireCapability(gameId, "entity_search");
    const revision = revisionId ?? (await this.requirePublicRevision(gameId));
    return this.repository.genshin.listCharacters({
      revisionId: revision,
      query: options.query,
      limit: Math.min(Math.max(options.limit ?? 20, 1), 100),
      offset: options.offset ?? 0,
    });
  }

  async getCharacter(gameId: Id, stableId: string, revisionId?: Id) {
    await this.requireCapability(gameId, "entity_search");
    const revision = revisionId ?? (await this.requirePublicRevision(gameId));
    const character = await this.repository.genshin.getCharacter(revision, stableId);
    if (!character)
      throw new DomainError("character_not_found", "Character was not found", undefined, 404);
    return character;
  }

  async listMaterials(
    gameId: Id,
    revisionId?: Id,
    options: { query?: string; limit?: number; offset?: number } = {},
  ) {
    await this.requireCapability(gameId, "entity_search");
    const revision = revisionId ?? (await this.requirePublicRevision(gameId));
    return this.repository.genshin.listMaterials({
      revisionId: revision,
      query: options.query,
      limit: Math.min(Math.max(options.limit ?? 20, 1), 100),
      offset: options.offset ?? 0,
    });
  }

  async getMaterial(gameId: Id, stableId: string, revisionId?: Id) {
    await this.requireCapability(gameId, "entity_search");
    const revision = revisionId ?? (await this.requirePublicRevision(gameId));
    const material = await this.repository.genshin.getMaterial(revision, stableId);
    if (!material)
      throw new DomainError("material_not_found", "Material was not found", undefined, 404);
    return material;
  }

  async listWeapons(gameId: Id, revisionId?: Id) {
    await this.requireCapability(gameId, "entity_search");
    const revision = revisionId ?? (await this.requirePublicRevision(gameId));
    return this.repository.genshin.listWeapons({
      revisionId: revision,
      limit: 100,
    });
  }

  async getWeapon(gameId: Id, stableId: string, revisionId?: Id) {
    await this.requireCapability(gameId, "entity_search");
    const revision = revisionId ?? (await this.requirePublicRevision(gameId));
    const weapon = await this.repository.genshin.getWeapon(revision, stableId);
    if (!weapon) throw new DomainError("weapon_not_found", "Weapon was not found", undefined, 404);
    return weapon;
  }

  async listArtifacts(gameId: Id, revisionId?: Id) {
    await this.requireCapability(gameId, "entity_search");
    const revision = revisionId ?? (await this.requirePublicRevision(gameId));
    return this.repository.genshin.listArtifacts({
      revisionId: revision,
      limit: 100,
    });
  }

  async getArtifact(gameId: Id, stableId: string, revisionId?: Id) {
    await this.requireCapability(gameId, "entity_search");
    const revision = revisionId ?? (await this.requirePublicRevision(gameId));
    const artifact = await this.repository.genshin.getArtifact(revision, stableId);
    if (!artifact)
      throw new DomainError("artifact_not_found", "Artifact was not found", undefined, 404);
    return artifact;
  }

  async listArtifactSets(gameId: Id, revisionId?: Id) {
    await this.requireCapability(gameId, "entity_search");
    const revision = revisionId ?? (await this.requirePublicRevision(gameId));
    return this.repository.genshin.listArtifactSets({
      revisionId: revision,
      limit: 100,
    });
  }

  async getArtifactSet(gameId: Id, stableId: string, revisionId?: Id) {
    await this.requireCapability(gameId, "entity_search");
    const revision = revisionId ?? (await this.requirePublicRevision(gameId));
    const artifactSet = await this.repository.genshin.getArtifactSet(revision, stableId);
    if (!artifactSet)
      throw new DomainError("artifact_set_not_found", "Artifact set was not found", undefined, 404);
    return artifactSet;
  }

  async listAchievements(gameId: Id, revisionId?: Id) {
    await this.requireCapability(gameId, "entity_search");
    const revision = revisionId ?? (await this.requirePublicRevision(gameId));
    return this.repository.genshin.listAchievements({
      revisionId: revision,
      limit: 100,
    });
  }

  async getAchievement(gameId: Id, stableId: string, revisionId?: Id) {
    await this.requireCapability(gameId, "entity_search");
    const revision = revisionId ?? (await this.requirePublicRevision(gameId));
    const achievement = await this.repository.genshin.getAchievement(revision, stableId);
    if (!achievement)
      throw new DomainError("achievement_not_found", "Achievement was not found", undefined, 404);
    return achievement;
  }

  async listEnemies(gameId: Id, revisionId?: Id) {
    await this.requireCapability(gameId, "entity_search");
    const revision = revisionId ?? (await this.requirePublicRevision(gameId));
    return this.repository.genshin.listEnemies({
      revisionId: revision,
      limit: 100,
    });
  }

  async getEnemy(gameId: Id, stableId: string, revisionId?: Id) {
    await this.requireCapability(gameId, "entity_search");
    const revision = revisionId ?? (await this.requirePublicRevision(gameId));
    const enemy = await this.repository.genshin.getEnemy(revision, stableId);
    if (!enemy) throw new DomainError("enemy_not_found", "Enemy was not found", undefined, 404);
    return enemy;
  }

  /**
   * Find one structured entity by display name within the public revision.
   * Used by MCP get_* tools so agents never need internal stable IDs.
   */
  async findStructuredByName(
    gameId: Id,
    kind:
      "character" | "weapon" | "artifact" | "artifact_set" | "material" | "achievement" | "enemy",
    name: string,
    revisionId?: Id,
  ): Promise<unknown | null> {
    await this.requireCapability(gameId, "entity_search");
    const revision = revisionId ?? (await this.requirePublicRevision(gameId));
    const wanted = name.trim().toLocaleLowerCase("zh-CN");
    const lists: Record<string, Array<{ name: string; stableId: string }>> = {
      character: await this.repository.genshin.listCharacters({
        revisionId: revision,
        limit: 100,
      }),
      weapon: await this.repository.genshin.listWeapons({ revisionId: revision, limit: 100 }),
      artifact: await this.repository.genshin.listArtifacts({ revisionId: revision, limit: 100 }),
      artifact_set: await this.repository.genshin.listArtifactSets({
        revisionId: revision,
        limit: 100,
      }),
      material: await this.repository.genshin.listMaterials({ revisionId: revision, limit: 100 }),
      achievement: await this.repository.genshin.listAchievements({
        revisionId: revision,
        limit: 100,
      }),
      enemy: await this.repository.genshin.listEnemies({ revisionId: revision, limit: 100 }),
    };
    const match = lists[kind]?.find(
      (item) => item.name.trim().toLocaleLowerCase("zh-CN") === wanted,
    );
    if (!match) return null;
    switch (kind) {
      case "character":
        return this.repository.genshin.getCharacter(revision, match.stableId);
      case "weapon":
        return this.repository.genshin.getWeapon(revision, match.stableId);
      case "artifact":
        return this.repository.genshin.getArtifact(revision, match.stableId);
      case "artifact_set":
        return this.repository.genshin.getArtifactSet(revision, match.stableId);
      case "material":
        return this.repository.genshin.getMaterial(revision, match.stableId);
      case "achievement":
        return this.repository.genshin.getAchievement(revision, match.stableId);
      case "enemy":
        return this.repository.genshin.getEnemy(revision, match.stableId);
    }
  }

  /**
   * Section-aware text read over a published document. When a section heading
   * is given, the smallest matching segment is returned with citations; the
   * whole document body is only returned without a section filter.
   */
  async readSection(request: SectionReadRequest): Promise<SectionReadResult> {
    await this.requireCapability(request.gameId, "lore_search");
    const revision = request.revisionId ?? (await this.requirePublicRevision(request.gameId));
    const document = await this.repository.getDocument(
      request.gameId,
      request.documentId,
      revision,
    );
    if (!document)
      throw new DomainError("document_not_found", "Document was not found", undefined, 404);
    const maxChars = Math.min(Math.max(request.maxChars ?? 800, 100), 8000);
    const wanted = request.section?.trim().toLocaleLowerCase("zh-CN");
    const matching = wanted
      ? document.segments.filter((segment) =>
          segment.headingPath.some((heading) =>
            heading.toLocaleLowerCase("zh-CN").includes(wanted),
          ),
        )
      : [];
    const chosen = matching[0];
    const joinedBody = document.segments.map((segment) => segment.body).join("\n\n");
    const fullBody = chosen ? chosen.body : joinedBody || document.body;
    const truncated = fullBody.length > maxChars;
    return {
      documentId: document.id,
      title: document.title,
      locale: document.locale ?? "",
      revision: document.revision ?? "",
      headingPath: chosen?.headingPath ?? [],
      body: truncated ? fullBody.slice(0, maxChars) : fullBody,
      truncated,
      citations: [
        {
          documentId: document.id,
          locale: document.locale ?? "",
          segmentId: chosen?.id ?? undefined,
          revision: document.revision ?? "",
        },
      ],
    };
  }
}
