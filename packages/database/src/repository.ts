import { and, desc, eq, sql } from "drizzle-orm";
import type {
  DocumentSummary,
  DocumentType,
  EntitySummary,
  EntityType,
  RelationshipPredicate,
  SearchRequest,
  SearchResult,
} from "@gip/contracts";
import {
  type ArchiveHome,
  type ConflictCase,
  type ConflictDetail,
  type ConflictKind,
  type DatasetRevision,
  type DialogueSearchRequest,
  type DialogueSearchHit,
  type DocumentDetail,
  type EmbeddingInput,
  type EntityDetail,
  type ImportBatch,
  type ImportDiff,
  type KnowledgeRepository,
  type NormalizedRecord,
  type GetQuestRequest,
  type QuestDialoguePage,
  type QuestSearchHit,
  type QuestSearchRequest,
  type RelationshipView,
  type ReleaseCandidateCheck,
  type ReviewEvidence,
  type ReviewIssue,
  type Source,
  type SourceSnapshot,
  type StoredEmbedding,
  type StructuredImportRecords,
  type TextBinding,
  type TextBindingType,
  type ValidationIssue,
  type VectorSearchHit,
  type VectorEntityHit,
  type VerificationChannel,
  type VerificationItem,
  type VerificationRun,
  type VerificationScreenshot,
  type VerificationStatus,
  type PublishReadiness,
  type ReleaseCandidate,
  type ReleaseCandidateBuild,
  type ReleaseCandidateDetail,
  type ReleaseCandidateReadiness,
} from "@gip/domain";
import type { GameSummary } from "@gip/contracts";
import type { Database } from "./client.js";
import { auditLog, datasetRevisions, importBatches, releaseCandidates } from "./schema.js";
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  heartbeatJob,
  listJobs,
  recordWorkerHeartbeat,
  workerHealth,
} from "./repository-jobs.js";
import * as importOperations from "./repository-imports.js";
import * as conflictOperations from "./repository-conflicts.js";
import * as candidatePatchOperations from "./repository-candidate-patches.js";
import * as releaseBuildOperations from "./repository-release-builds.js";
import * as releaseCandidateOperations from "./repository-release-candidates.js";
import * as releasePromotionOperations from "./repository-release-promotion.js";
import * as releaseReadinessOperations from "./repository-release-readiness.js";
import * as reviewOperations from "./repository-review-operations.js";
import * as revisionMaterializationOperations from "./repository-revision-materialization.js";
import * as publishGateOperations from "./repository-publish-gates.js";
import * as importPublicationOperations from "./repository-import-publication.js";
import * as acquisitionReviewOperations from "./repository-acquisition-reviews.js";
import * as verificationRunOperations from "./repository-verification-runs.js";
import * as sourceOperations from "./repository-source-operations.js";
import * as verificationScreenshotOperations from "./repository-verification-screenshots.js";
import { SqlGenshinStructuredRepository } from "./repository-genshin-core.js";
import { RepositoryReadModels } from "./repository-read-models.js";
import { SqlSearchRepositoryPort } from "./search-port.js";
import type { DialogueSearchFilters, SearchCoreStructuredHit } from "@gip/search";
import * as revisionOperations from "./repository-revisions.js";

import {
  mergeReleaseCandidateRecords,
  releaseCandidateChecksum,
  safeProvenance,
  stableEntityId,
  type AcquisitionManifestInfo,
  type SourceObservationRow,
} from "./repository-utils.js";

export { mergeReleaseCandidateRecords, releaseCandidateChecksum, stableEntityId };

export class SqlKnowledgeRepository implements KnowledgeRepository {
  readonly genshin: SqlGenshinStructuredRepository;

  private readonly readModels: RepositoryReadModels;
  private readonly searchPort: SqlSearchRepositoryPort;

  constructor(
    private readonly db: Database,
    private readonly dataDir?: string,
  ) {
    this.genshin = new SqlGenshinStructuredRepository(db);
    this.readModels = new RepositoryReadModels(db);
    this.searchPort = new SqlSearchRepositoryPort(db);
  }

  async health() {
    try {
      await this.db.execute(sql`select 1`);
      const current = await this.db
        .select({ id: datasetRevisions.id, indexStatus: datasetRevisions.indexStatus })
        .from(datasetRevisions)
        .where(
          and(
            eq(datasetRevisions.isCurrent, true),
            eq(datasetRevisions.lifecycleStatus, "published"),
          ),
        )
        .limit(1);
      return {
        database: "up" as const,
        currentRevision: current.length ? ("available" as const) : ("missing" as const),
        searchIndex:
          current[0]?.indexStatus === "ready" ? ("ready" as const) : ("not_ready" as const),
      };
    } catch {
      return {
        database: "down" as const,
        currentRevision: "missing" as const,
        searchIndex: "not_ready" as const,
      };
    }
  }

  async listGames(): Promise<GameSummary[]> {
    return this.readModels.listGames();
  }

  async getGame(gameId: string): Promise<GameSummary | null> {
    return this.readModels.getGame(gameId);
  }

  async getGameBySlug(slug: string): Promise<GameSummary | null> {
    return this.readModels.getGameBySlug(slug);
  }

  async getCapabilities(gameId: string) {
    return this.readModels.getCapabilities(gameId);
  }

  async getArchiveHome(
    gameId: string,
    options: { locale?: string; revisionId?: string; limit?: number } = {},
  ): Promise<ArchiveHome> {
    return this.readModels.getArchiveHome(gameId, options);
  }

  async listEntities(
    gameId: string,
    options: {
      query?: string;
      type?: EntityType;
      limit: number;
      offset: number;
      revisionId?: string;
    },
  ): Promise<EntitySummary[]> {
    return this.readModels.listEntities(gameId, options);
  }

  async getEntity(
    gameId: string,
    entityId: string,
    revisionId?: string,
  ): Promise<EntityDetail | null> {
    return this.readModels.getEntity(gameId, entityId, revisionId);
  }

  async getRelationships(
    gameId: string,
    entityId: string,
    options: { predicate?: RelationshipPredicate; limit: number; revisionId?: string },
  ): Promise<RelationshipView[]> {
    return this.readModels.getRelationships(gameId, entityId, options);
  }

  async getEntityDocuments(
    gameId: string,
    entityId: string,
    limit: number,
    revisionId?: string,
  ): Promise<DocumentSummary[]> {
    return this.readModels.getEntityDocuments(gameId, entityId, limit, revisionId);
  }

  async getEntityTextBindings(
    revisionId: string,
    entityStableId: string,
    bindingType?: TextBindingType,
  ): Promise<TextBinding[]> {
    return this.readModels.getEntityTextBindings(revisionId, entityStableId, bindingType);
  }

  async getBindingEntities(
    revisionId: string,
    documentId: string,
    segmentId?: string,
  ): Promise<TextBinding[]> {
    return this.readModels.getBindingEntities(revisionId, documentId, segmentId);
  }

  async listDocuments(
    gameId: string,
    options: {
      query?: string;
      type?: DocumentType;
      locale?: string;
      limit: number;
      offset: number;
      revisionId?: string;
    },
  ): Promise<DocumentSummary[]> {
    return this.readModels.listDocuments(gameId, options);
  }

  async getDocument(
    gameId: string,
    documentId: string,
    revisionId?: string,
  ): Promise<DocumentDetail | null> {
    return this.readModels.getDocument(gameId, documentId, revisionId);
  }

  async search(gameId: string, request: SearchRequest): Promise<SearchResult> {
    const result = await this.readModels.search(gameId, request);
    if (result.revisionId) {
      const core = new (await import("@gip/search")).SearchService(this.searchPort);
      const structured = await core.searchText(gameId, result.revisionId, request.query);
      const lore = await core.searchLore(gameId, result.revisionId, request.query);
      (
        result as SearchResult & {
          coreHits?: { structured: SearchCoreStructuredHit[]; lore: unknown };
        }
      ).coreHits = {
        structured: structured.structured,
        lore,
      };
    }
    return result;
  }

  async searchQuests(gameId: string, request: QuestSearchRequest): Promise<QuestSearchHit[]> {
    return this.readModels.searchQuests(gameId, request);
  }

  async searchDialogue(
    gameId: string,
    request: DialogueSearchRequest & DialogueSearchFilters,
  ): Promise<DialogueSearchHit[]> {
    const core = new (await import("@gip/search")).SearchService(this.searchPort);
    return core.searchDialogue(gameId, request.revisionId, request.query, {
      speaker: request.speaker,
      quest: request.quest,
      questKey: request.questKey,
      nodeType: request.nodeType,
      locale: request.locale,
    });
  }

  async getQuest(gameId: string, request: GetQuestRequest): Promise<QuestDialoguePage | null> {
    return this.readModels.getQuest(gameId, request);
  }

  async vectorSearch(
    gameId: string,
    request: SearchRequest,
    vectorValue: number[],
    spaceId: string,
    limit: number,
  ): Promise<VectorSearchHit[]> {
    return this.readModels.vectorSearch(gameId, request, vectorValue, spaceId, limit);
  }

  async vectorEntitySearch(
    gameId: string,
    request: SearchRequest,
    vectorValue: number[],
    spaceId: string,
    limit: number,
  ): Promise<VectorEntityHit[]> {
    return this.readModels.vectorEntitySearch(gameId, request, vectorValue, spaceId, limit);
  }

  async createSource(input: Omit<Source, "id">): Promise<Source> {
    return sourceOperations.createSource({ db: this.db }, input);
  }

  async listSources(gameId?: string): Promise<Source[]> {
    return sourceOperations.listSources({ db: this.db }, gameId);
  }

  async getSource(sourceId: string): Promise<Source | null> {
    return sourceOperations.getSource({ db: this.db }, sourceId);
  }

  async createSnapshot(input: Omit<SourceSnapshot, "id" | "capturedAt">): Promise<SourceSnapshot> {
    return sourceOperations.createSnapshot({ db: this.db }, input);
  }

  async getSourceRecordHashes(sourceId: string): Promise<Map<string, string>> {
    return sourceOperations.getSourceRecordHashes({ db: this.db }, sourceId);
  }

  async listEntitySourceKeys(gameId: string, revisionId?: string): Promise<string[]> {
    return sourceOperations.listEntitySourceKeys(
      {
        db: this.db,
        getCurrentRevision: (targetGameId) => this.getCurrentRevision(targetGameId),
        getRevision: (targetRevisionId, targetGameId) =>
          this.getRevision(targetRevisionId, targetGameId),
        getRevisionRecords: (revision) => this.getRevisionRecords(revision),
      },
      gameId,
      revisionId,
    );
  }

  async listEmbeddingInputs(gameId: string, revisionId: string): Promise<EmbeddingInput[]> {
    return sourceOperations.listEmbeddingInputs(
      {
        db: this.db,
        getRevision: (targetRevisionId, targetGameId) =>
          this.getRevision(targetRevisionId, targetGameId),
        getRevisionRecords: (revision) => this.getRevisionRecords(revision),
      },
      gameId,
      revisionId,
    );
  }

  async storeEmbeddings(values: StoredEmbedding[]): Promise<void> {
    return sourceOperations.storeEmbeddings({ db: this.db }, values);
  }

  async createPendingImport(input: {
    gameId: string;
    sourceId: string;
    parserVersion: string;
  }): Promise<ImportBatch> {
    return importOperations.createPendingImport({ db: this.db }, input);
  }

  async updateImportStaged(input: {
    batchId: string;
    sourceSnapshotId: string;
    stagedRecords?: NormalizedRecord[];
    structuredRecords?: StructuredImportRecords;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
    diff: ImportDiff;
  }): Promise<ImportBatch> {
    return importOperations.updateImportStaged(
      {
        db: this.db,
        registerAcquisitionReview: (batch) => this.registerAcquisitionReview(batch),
        ensurePreviewForImport: (batch) => this.ensurePreviewForImport(batch),
      },
      input,
    );
  }

  private async ensurePreviewForImport(batch: ImportBatch): Promise<void> {
    if (!batch.stagedRecords?.length) return;
    const first = batch.stagedRecords[0];
    const provenance = first ? safeProvenance(first.metadata, first.sourceKey) : undefined;
    const targetGameVersion = first?.gameVersion ?? provenance?.upstreamVersionLabel ?? "unknown";
    const source = await this.getSource(batch.sourceId);
    const upstreamReference = provenance?.upstreamCommit?.slice(0, 12);
    const candidateName = `预发布 · ${source?.name ?? targetGameVersion}${upstreamReference ? ` · ${upstreamReference}` : ""}`;
    const existing = await this.db
      .select()
      .from(releaseCandidates)
      .where(
        and(
          eq(releaseCandidates.gameId, batch.gameId),
          eq(releaseCandidates.sourceId, batch.sourceId),
          eq(releaseCandidates.targetGameVersion, targetGameVersion),
        ),
      )
      .orderBy(desc(releaseCandidates.createdAt))
      .limit(1);
    let candidateId = existing[0]?.id;
    if (
      !candidateId ||
      ["merged", "abandoned", "promoted", "withdrawn"].includes(existing[0]!.status)
    ) {
      const current = await this.getCurrentRevision(batch.gameId);
      const [created] = await this.db
        .insert(releaseCandidates)
        .values({
          gameId: batch.gameId,
          sourceId: batch.sourceId,
          targetGameVersion,
          name: candidateName,
          baseRevisionId: current?.id,
          importBatchIds: [batch.id],
          status: "draft",
        })
        .returning({ id: releaseCandidates.id });
      candidateId = created?.id;
    } else if (!existing[0]!.importBatchIds.includes(batch.id)) {
      await this.db
        .update(releaseCandidates)
        .set({
          name: candidateName,
          importBatchIds: [...existing[0]!.importBatchIds, batch.id],
          updatedAt: new Date(),
        })
        .where(eq(releaseCandidates.id, candidateId));
    }
    if (!candidateId) return;
    try {
      await this.buildReleaseCandidate(candidateId);
    } catch (error) {
      await this.db
        .update(releaseCandidates)
        .set({ status: "failed", updatedAt: new Date() })
        .where(eq(releaseCandidates.id, candidateId));
      await this.db.insert(auditLog).values({
        action: "preview_build_failed",
        targetType: "release_candidate",
        targetId: candidateId,
        reason: error instanceof Error ? error.message : "Preview build failed",
        metadata: { batchId: batch.id },
      });
    }
  }

  async markImportRunning(batchId: string): Promise<ImportBatch> {
    return importOperations.markImportRunning({ db: this.db }, batchId);
  }

  async markImportFailed(batchId: string, issue: ValidationIssue): Promise<ImportBatch> {
    return importOperations.markImportFailed({ db: this.db }, batchId, issue);
  }

  async enqueueJob(input: {
    type: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
  }): Promise<void> {
    await enqueueJob(this.db, input);
  }

  async createImport(input: {
    gameId: string;
    sourceId: string;
    sourceSnapshotId: string;
    parserVersion: string;
    stagedRecords?: NormalizedRecord[];
    structuredRecords?: StructuredImportRecords;
    errors: ValidationIssue[];
    warnings: ValidationIssue[];
    diff: ImportDiff;
  }): Promise<ImportBatch> {
    return importOperations.createImport(
      {
        db: this.db,
        registerAcquisitionReview: (batch) => this.registerAcquisitionReview(batch),
        ensurePreviewForImport: (batch) => this.ensurePreviewForImport(batch),
      },
      input,
    );
  }

  async getImport(batchId: string): Promise<ImportBatch | null> {
    return importOperations.getImport({ db: this.db }, batchId);
  }

  async listImports(gameId?: string): Promise<ImportBatch[]> {
    return importOperations.listImports({ db: this.db }, gameId);
  }

  async reviewImport(
    batchId: string,
    approved: boolean,
    note: string | undefined,
    confirmedDeletionKeys: string[],
  ): Promise<ImportBatch> {
    return importOperations.reviewImport(
      { db: this.db },
      batchId,
      approved,
      note,
      confirmedDeletionKeys,
    );
  }

  async publishImport(
    batchId: string,
    releaseNote?: string,
    options: {
      skipManualVerification?: boolean;
      recordsOverride?: NormalizedRecord[];
    } = {},
  ): Promise<DatasetRevision> {
    return importPublicationOperations.publishImport(
      {
        db: this.db,
        getImport: (targetBatchId) => this.getImport(targetBatchId),
        getCurrentRevision: (gameId) => this.getCurrentRevision(gameId),
        ensureAcquisitionReview: (targetBatchId) => this.ensureAcquisitionReview(targetBatchId),
        ensureAnimeAcquisitionIntegrity: (batch) => this.ensureAnimeAcquisitionIntegrity(batch),
        ensureReleaseBackup: (batch) => this.ensureReleaseBackup(batch),
      },
      batchId,
      releaseNote,
      options,
    );
  }

  async getPublishReadiness(batchId: string): Promise<PublishReadiness> {
    return importPublicationOperations.getPublishReadiness(
      {
        db: this.db,
        getImport: (targetBatchId) => this.getImport(targetBatchId),
        getCurrentRevision: (gameId) => this.getCurrentRevision(gameId),
        ensureAcquisitionReview: (targetBatchId) => this.ensureAcquisitionReview(targetBatchId),
        ensureAnimeAcquisitionIntegrity: (batch) => this.ensureAnimeAcquisitionIntegrity(batch),
        ensureReleaseBackup: (batch) => this.ensureReleaseBackup(batch),
      },
      batchId,
    );
  }

  private async readAcquisitionManifest(
    batch: ImportBatch,
  ): Promise<AcquisitionManifestInfo | undefined> {
    return publishGateOperations.readAcquisitionManifest(
      { db: this.db, dataDir: this.dataDir },
      batch,
    );
  }

  private async ensureAnimeAcquisitionIntegrity(batch: ImportBatch): Promise<void> {
    return publishGateOperations.ensureAnimeAcquisitionIntegrity(
      { db: this.db, dataDir: this.dataDir },
      batch,
    );
  }

  private async ensureReleaseBackup(batch: ImportBatch): Promise<void> {
    return publishGateOperations.ensureReleaseBackup({ db: this.db, dataDir: this.dataDir }, batch);
  }

  private async acquisitionManifestHash(batch: ImportBatch): Promise<string | undefined> {
    return publishGateOperations.acquisitionManifestHash(
      { db: this.db, dataDir: this.dataDir },
      batch,
    );
  }

  async ensureAcquisitionReview(batchId: string): Promise<void> {
    return publishGateOperations.ensureAcquisitionReview(
      {
        db: this.db,
        dataDir: this.dataDir,
        getImport: (targetBatchId) => this.getImport(targetBatchId),
      },
      batchId,
    );
  }

  private async createPreviewManifest(
    gameId: string,
    records: NormalizedRecord[],
    baseRevisionId?: string | null,
  ): Promise<string> {
    return releaseCandidateOperations.createPreviewManifest(
      { db: this.db },
      gameId,
      records,
      baseRevisionId,
    );
  }

  async createReleaseCandidate(input: {
    gameId: string;
    name: string;
    importBatchIds: string[];
  }): Promise<ReleaseCandidate> {
    return releaseCandidateOperations.createReleaseCandidate(
      {
        db: this.db,
        getCurrentRevision: (gameId) => this.getCurrentRevision(gameId),
      },
      input,
    );
  }

  async listReleaseCandidates(gameId?: string): Promise<ReleaseCandidate[]> {
    return releaseCandidateOperations.listReleaseCandidates({ db: this.db }, gameId);
  }

  async getReleaseCandidate(candidateId: string): Promise<ReleaseCandidateDetail | null> {
    return releaseCandidateOperations.getReleaseCandidate({ db: this.db }, candidateId);
  }

  async buildReleaseCandidate(candidateId: string): Promise<ReleaseCandidateBuild> {
    return releaseBuildOperations.buildReleaseCandidate(
      {
        db: this.db,
        getReleaseCandidate: (targetCandidateId) => this.getReleaseCandidate(targetCandidateId),
        getRevision: (revisionId, gameId) => this.getRevision(revisionId, gameId),
        getRevisionRecords: (revision) => this.getRevisionRecords(revision),
        createPreviewManifest: (gameId, records, baseRevisionId) =>
          this.createPreviewManifest(gameId, records, baseRevisionId),
      },
      candidateId,
    );
  }

  async getReleaseCandidateBuild(buildId: string) {
    return releaseReadinessOperations.getReleaseCandidateBuild({ db: this.db }, buildId);
  }

  async getReleaseCandidateReadiness(candidateId: string): Promise<ReleaseCandidateReadiness> {
    return releaseReadinessOperations.getReleaseCandidateReadiness(
      {
        db: this.db,
        getReleaseCandidate: (targetCandidateId) => this.getReleaseCandidate(targetCandidateId),
        getCurrentRevision: (gameId) => this.getCurrentRevision(gameId),
      },
      candidateId,
    );
  }

  async promoteReleaseCandidate(input: {
    candidateId: string;
    buildId: string;
    contentChecksum: string;
    expectedCurrentRevisionId?: string | null;
    releaseNote?: string;
    idempotencyKey: string;
  }): Promise<DatasetRevision> {
    return releasePromotionOperations.promoteReleaseCandidate(
      {
        db: this.db,
        getReleaseCandidate: (candidateId) => this.getReleaseCandidate(candidateId),
        getRevision: (revisionId, gameId) => this.getRevision(revisionId, gameId),
        getCurrentRevision: (gameId) => this.getCurrentRevision(gameId),
        getReleaseCandidateBuild: (buildId) => this.getReleaseCandidateBuild(buildId),
        getReleaseCandidateReadiness: (candidateId) =>
          this.getReleaseCandidateReadiness(candidateId),
      },
      input,
    );
  }

  async finalizeActivation(input: {
    revisionId: string;
    candidateId: string;
    buildId: string;
    contentChecksum: string;
    expectedCurrentRevisionId?: string | null;
  }): Promise<DatasetRevision> {
    return releasePromotionOperations.finalizeActivation({ db: this.db }, input);
  }

  async setRevisionIndexStatus(
    revisionId: string,
    status: "ready" | "failed",
    error?: string,
  ): Promise<void> {
    return releasePromotionOperations.setRevisionIndexStatus(
      { db: this.db },
      revisionId,
      status,
      error,
    );
  }

  async listReviewIssues(candidateId: string): Promise<ReviewIssue[]> {
    return reviewOperations.listReviewIssues({ db: this.db }, candidateId);
  }

  async reportReviewIssue(input: {
    candidateId: string;
    buildId: string;
    canonicalKey: string;
    fieldPath?: string;
    summary: string;
    details?: Record<string, unknown>;
  }): Promise<ReviewIssue> {
    return reviewOperations.reportReviewIssue(
      {
        db: this.db,
        getReleaseCandidateBuild: (buildId) => this.getReleaseCandidateBuild(buildId),
      },
      input,
    );
  }

  async getReviewIssue(issueId: string): Promise<ReviewIssue | null> {
    return reviewOperations.getReviewIssue({ db: this.db }, issueId);
  }

  async resolveReviewIssue(issueId: string, action?: string, note?: string): Promise<ReviewIssue> {
    return reviewOperations.resolveReviewIssue({ db: this.db }, issueId, action, note);
  }

  async reopenReviewIssue(issueId: string): Promise<ReviewIssue> {
    return reviewOperations.reopenReviewIssue({ db: this.db }, issueId);
  }

  async listReviewEvidence(issueId: string): Promise<ReviewEvidence[]> {
    return reviewOperations.listReviewEvidence({ db: this.db }, issueId);
  }

  async addReviewEvidence(
    input: Omit<ReviewEvidence, "id" | "createdAt">,
  ): Promise<ReviewEvidence> {
    return reviewOperations.addReviewEvidence({ db: this.db }, input);
  }

  async getReviewEvidence(evidenceId: string): Promise<ReviewEvidence | null> {
    return reviewOperations.getReviewEvidence({ db: this.db }, evidenceId);
  }

  async deleteReviewEvidence(evidenceId: string): Promise<ReviewEvidence | null> {
    return reviewOperations.deleteReviewEvidence({ db: this.db }, evidenceId);
  }

  async listReleaseCandidateChecks(candidateId: string): Promise<ReleaseCandidateCheck[]> {
    return reviewOperations.listReleaseCandidateChecks({ db: this.db }, candidateId);
  }

  async listCandidatePatches(candidateId: string) {
    return candidatePatchOperations.listCandidatePatches({ db: this.db }, candidateId);
  }

  async createCandidatePatch(input: {
    candidateId: string;
    issueId?: string;
    canonicalKey: string;
    fieldPath?: string;
    action: string;
    manualValue?: unknown;
    expectedBaseHash?: string;
    expectedIncomingHash?: string;
  }) {
    return candidatePatchOperations.createCandidatePatch(
      {
        db: this.db,
        getReleaseCandidate: (candidateId) => this.getReleaseCandidate(candidateId),
        getReleaseCandidateBuild: (buildId) => this.getReleaseCandidateBuild(buildId),
        getRevision: (revisionId, gameId) => this.getRevision(revisionId, gameId),
        getRevisionRecords: (revision) => this.getRevisionRecords(revision),
        getReviewIssue: (issueId) => this.getReviewIssue(issueId),
        listReviewEvidence: (issueId) => this.listReviewEvidence(issueId),
      },
      input,
    );
  }

  async materializeRevision(revisionId: string): Promise<void> {
    return revisionMaterializationOperations.materializeRevision(this.db, revisionId);
  }

  private async upsertObservationConflict(
    observations: SourceObservationRow[],
  ): Promise<ConflictKind | undefined> {
    return acquisitionReviewOperations.upsertObservationConflict({ db: this.db }, observations);
  }

  async reconcileSourceObservationConflicts(gameId?: string): Promise<{
    checked: number;
    repairedRaw: number;
    repairedNormalized: number;
    scopes: number;
    upserted: number;
    open: number;
  }> {
    return acquisitionReviewOperations.reconcileSourceObservationConflicts({ db: this.db }, gameId);
  }

  private async registerAcquisitionReview(batch: ImportBatch): Promise<void> {
    return acquisitionReviewOperations.registerAcquisitionReview({ db: this.db }, batch);
  }

  private async addVerificationReplacement(runId: string, category: string): Promise<void> {
    return verificationRunOperations.addVerificationReplacement({ db: this.db }, runId, category);
  }

  async getVerificationRun(batchId: string): Promise<VerificationRun | null> {
    return verificationRunOperations.getVerificationRun({ db: this.db }, batchId);
  }

  async updateVerificationItem(input: {
    itemId: string;
    status: VerificationStatus;
    channel: VerificationChannel;
    checkedGameVersion: string;
    checkedLocale: string;
    note?: string;
  }): Promise<VerificationItem> {
    return verificationRunOperations.updateVerificationItem({ db: this.db }, input);
  }

  async addVerificationScreenshot(input: {
    itemId: string;
    relativePath: string;
    sha256: string;
    bytes: number;
    mimeType: string;
  }): Promise<void> {
    return verificationScreenshotOperations.addVerificationScreenshot({ db: this.db }, input);
  }

  async listVerificationScreenshots(itemId: string): Promise<VerificationScreenshot[]> {
    return verificationScreenshotOperations.listVerificationScreenshots({ db: this.db }, itemId);
  }

  async getVerificationScreenshot(screenshotId: string): Promise<VerificationScreenshot | null> {
    return verificationScreenshotOperations.getVerificationScreenshot(
      { db: this.db },
      screenshotId,
    );
  }

  async deleteVerificationScreenshot(screenshotId: string): Promise<VerificationScreenshot> {
    return verificationScreenshotOperations.deleteVerificationScreenshot(
      { db: this.db },
      screenshotId,
    );
  }

  async listConflicts(gameId: string, status?: "open" | "resolved"): Promise<ConflictCase[]> {
    return conflictOperations.listConflicts({ db: this.db }, gameId, status);
  }

  async getConflict(conflictId: string): Promise<ConflictDetail | null> {
    return conflictOperations.getConflict({ db: this.db }, conflictId);
  }

  async resolveConflict(
    conflictId: string,
    resolution: string,
    selectedObservationId?: string,
  ): Promise<ConflictCase> {
    return conflictOperations.resolveConflict(
      { db: this.db },
      conflictId,
      resolution,
      selectedObservationId,
    );
  }

  async listRevisions(gameId?: string): Promise<DatasetRevision[]> {
    return revisionOperations.listRevisions({ db: this.db }, gameId);
  }

  async rollbackRevision(revisionId: string, reason: string): Promise<DatasetRevision> {
    return revisionOperations.rollbackRevision({ db: this.db }, revisionId, reason);
  }

  async listJobs(): Promise<Array<Record<string, unknown>>> {
    return listJobs(this.db);
  }

  async recordWorkerHeartbeat(workerId: string): Promise<void> {
    return recordWorkerHeartbeat(this.db, workerId);
  }

  async workerHealth(): Promise<"up" | "not_ready"> {
    return workerHealth(this.db);
  }

  async claimNextJob(workerId: string): Promise<Record<string, unknown> | null> {
    return claimNextJob(this.db, workerId);
  }

  async heartbeatJob(jobId: string, workerId: string): Promise<boolean> {
    return heartbeatJob(this.db, jobId, workerId);
  }

  async completeJob(jobId: string, status: "completed" | "failed", error?: string): Promise<void> {
    return completeJob(this.db, jobId, status, error);
  }

  private async getCurrentRevision(gameId: string) {
    const rows = await this.db
      .select()
      .from(datasetRevisions)
      .where(
        and(
          eq(datasetRevisions.gameId, gameId),
          eq(datasetRevisions.isCurrent, true),
          eq(datasetRevisions.lifecycleStatus, "published"),
        ),
      )
      .limit(1);
    return rows[0];
  }

  private async getRevision(revisionId: string, gameId?: string) {
    const rows = await this.db
      .select()
      .from(datasetRevisions)
      .where(
        gameId
          ? and(eq(datasetRevisions.id, revisionId), eq(datasetRevisions.gameId, gameId))
          : eq(datasetRevisions.id, revisionId),
      )
      .limit(1);
    return rows[0];
  }

  private async getRevisionRecords(
    revision: typeof datasetRevisions.$inferSelect,
  ): Promise<NormalizedRecord[]> {
    if (revision.normalizedRecords) return revision.normalizedRecords;
    const rows = await this.db
      .select({ stagedRecords: importBatches.stagedRecords })
      .from(importBatches)
      .where(eq(importBatches.id, revision.sourceBatchId))
      .limit(1);
    return rows[0]?.stagedRecords ?? [];
  }
}
