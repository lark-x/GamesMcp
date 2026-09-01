import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  assertPublishable,
  DomainError,
  type DatasetRevision,
  type ImportBatch,
  type NormalizedRecord,
  type PublishReadiness,
  type StructuredImportRecords,
} from "@gip/domain";
import type { Database } from "./client.js";
import {
  auditLog,
  claimEntities,
  claims,
  datasetRevisions,
  documentSegments,
  documents,
  entities,
  entityAliases,
  entityMentions,
  evidence,
  genshinAchievements,
  genshinArtifacts,
  genshinArtifactSets,
  genshinCharacters,
  genshinEnemies,
  genshinMaterials,
  genshinVoiceLines,
  genshinWeapons,
  importBatches,
  jobs,
  questDialogueEdges,
  questDialogueNodes,
  questSubquests,
  relationships,
  sources,
} from "./schema.js";
import {
  normalize,
  recordLocale,
  recordSegments,
  stableEntityId,
  stableUuid,
} from "./repository-utils.js";

type RevisionRow = typeof datasetRevisions.$inferSelect;

export interface ImportPublicationContext {
  db: Database;
  getImport(batchId: string): Promise<ImportBatch | null>;
  getCurrentRevision(gameId: string): Promise<RevisionRow | undefined>;
  ensureAcquisitionReview(batchId: string): Promise<void>;
  ensureAnimeAcquisitionIntegrity(batch: ImportBatch): Promise<void>;
  ensureReleaseBackup(batch: ImportBatch): Promise<void>;
}

export async function publishImport(
  ctx: ImportPublicationContext,
  batchId: string,
  releaseNote?: string,
  options: {
    skipManualVerification?: boolean;
    recordsOverride?: NormalizedRecord[];
  } = {},
): Promise<DatasetRevision> {
  const existing = await ctx.getImport(batchId);
  if (!existing)
    throw new DomainError("import_not_found", "Import batch was not found", undefined, 404);
  assertPublishable(existing);
  if (!hasImportData(existing))
    throw new DomainError("staged_data_missing", "Import contains no staged or structured records");
  if (!existing.sourceSnapshotId)
    throw new DomainError("source_snapshot_missing", "Source snapshot is missing");
  if (!options.skipManualVerification) await ctx.ensureAcquisitionReview(batchId);
  await ctx.ensureAnimeAcquisitionIntegrity(existing);
  await ctx.ensureReleaseBackup(existing);
  const sourceSnapshotId = existing.sourceSnapshotId;
  const stagedRecords = options.recordsOverride ?? existing.stagedRecords ?? [];
  const diff = existing.diff;
  if (
    diff &&
    diff.added.length === 0 &&
    diff.modified.length === 0 &&
    diff.deletionCandidates.length === 0
  ) {
    const current = await ctx.getCurrentRevision(existing.gameId);
    if (current) {
      await ctx.db
        .update(importBatches)
        .set({ status: "published", completedAt: new Date() })
        .where(eq(importBatches.id, batchId));
      await ctx.db.insert(auditLog).values({
        action: "publish_noop",
        targetType: "import_batch",
        targetId: batchId,
        reason: releaseNote ?? "No data changes",
        metadata: { gameId: existing.gameId, revisionId: current.id },
      });
      return {
        id: current.id,
        gameId: current.gameId,
        revisionNumber: current.revisionNumber,
        sourceBatchId: current.sourceBatchId,
        releaseNote: current.releaseNote,
        lifecycleStatus: current.lifecycleStatus as DatasetRevision["lifecycleStatus"],
        publishedAt: current.publishedAt,
        isCurrent: current.isCurrent,
        indexStatus: current.indexStatus as DatasetRevision["indexStatus"],
      };
    }
  }
  return ctx.db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from platform.games where id = ${existing.gameId}::uuid for update`,
    );
    const currentRows = await tx
      .select()
      .from(datasetRevisions)
      .where(eq(datasetRevisions.gameId, existing.gameId))
      .orderBy(desc(datasetRevisions.revisionNumber))
      .limit(1);
    const activeRows = await tx
      .select()
      .from(datasetRevisions)
      .where(
        and(
          eq(datasetRevisions.gameId, existing.gameId),
          eq(datasetRevisions.isCurrent, true),
          eq(datasetRevisions.lifecycleStatus, "published"),
        ),
      )
      .limit(1);
    const previousRevision = activeRows[0];
    const stagedKeys = new Set(stagedRecords.map((record) => record.sourceKey));
    const confirmedDeletionKeys = new Set(existing.confirmedDeletionKeys);
    let previousRecords: NormalizedRecord[] = [];
    if (previousRevision) {
      if (previousRevision.normalizedRecords) {
        previousRecords = previousRevision.normalizedRecords;
      } else {
        const previousBatchRows = await tx
          .select({ stagedRecords: importBatches.stagedRecords })
          .from(importBatches)
          .where(eq(importBatches.id, previousRevision.sourceBatchId))
          .limit(1);
        previousRecords = previousBatchRows[0]?.stagedRecords ?? [];
      }
    }
    const normalizedRecords = [
      ...previousRecords.filter(
        (record) =>
          !stagedKeys.has(record.sourceKey) && !confirmedDeletionKeys.has(record.sourceKey),
      ),
      ...stagedRecords,
    ];
    const structuredRecords = mergeStructuredRecords(
      previousRevision?.structuredRecords ?? undefined,
      existing.structuredRecords,
    );
    const nextNumber = (currentRows[0]?.revisionNumber ?? 0) + 1;
    await tx
      .update(datasetRevisions)
      .set({ isCurrent: false })
      .where(eq(datasetRevisions.gameId, existing.gameId));
    const [revision] = await tx
      .insert(datasetRevisions)
      .values({
        gameId: existing.gameId,
        revisionNumber: nextNumber,
        sourceBatchId: batchId,
        releaseNote,
        lifecycleStatus: "published",
        isCurrent: true,
        indexStatus: "pending",
        normalizedRecords,
        structuredRecords,
      })
      .returning();
    if (!revision)
      throw new DomainError(
        "revision_create_failed",
        "Dataset revision could not be created",
        undefined,
        500,
      );
    await materializeStructuredRecords(
      tx as Database,
      existing.gameId,
      revision.id,
      structuredRecords,
    );
    const source = await tx
      .select()
      .from(sources)
      .where(eq(sources.id, existing.sourceId))
      .limit(1);
    const sourceRow = source[0];
    const entityIdBySourceKey = new Map<string, string>();
    const allCandidates = normalizedRecords.flatMap((record) => record.entities ?? []);
    const stagedCandidates = stagedRecords.flatMap((record) => record.entities ?? []);
    for (const candidate of allCandidates) {
      const id = stableEntityId(existing.gameId, candidate.sourceKey);
      entityIdBySourceKey.set(candidate.sourceKey, id);
    }
    for (const candidate of stagedCandidates) {
      const id = entityIdBySourceKey.get(candidate.sourceKey);
      if (!id) continue;
      await tx
        .insert(entities)
        .values({
          id,
          gameId: existing.gameId,
          sourceKey: candidate.sourceKey,
          type: candidate.type,
          canonicalName: candidate.name,
          normalizedName: normalize(candidate.name),
          summary: candidate.summary,
          properties: candidate.properties ?? {},
          firstRevisionId: revision.id,
          lastRevisionId: revision.id,
          deleted: false,
        })
        .onConflictDoUpdate({
          target: [entities.gameId, entities.sourceKey],
          set: {
            type: candidate.type,
            canonicalName: candidate.name,
            normalizedName: normalize(candidate.name),
            summary: candidate.summary,
            properties: candidate.properties ?? {},
            lastRevisionId: revision.id,
            deleted: false,
            updatedAt: new Date(),
          },
        });
      if (candidate.aliases?.length && sourceRow) {
        await tx.delete(entityAliases).where(eq(entityAliases.entityId, id));
        await tx.insert(entityAliases).values(
          candidate.aliases.map((alias) => ({
            entityId: id,
            value: alias.value,
            normalizedValue: normalize(alias.value),
            language: alias.language ?? "und",
            sourceId: sourceRow.id,
            isPrimary: alias.primary ?? false,
          })),
        );
      }
    }
    const documentBySourceKey = new Map<
      string,
      { id: string; segments: Array<{ id: string; body: string }> }
    >();
    const previousDocumentSourceById = new Map<string, string>();
    const previousSegmentOrdinalById = new Map<string, number>();
    const stagedRelationKeys = new Set(
      stagedRecords.flatMap((record) =>
        (record.relationships ?? []).flatMap((relation) => {
          const subjectId = entityIdBySourceKey.get(relation.subjectSourceKey);
          const objectId = entityIdBySourceKey.get(relation.objectSourceKey);
          return subjectId && objectId ? [`${subjectId}|${relation.predicate}|${objectId}`] : [];
        }),
      ),
    );
    if (previousRevision) {
      const previousRelations = await tx
        .select()
        .from(relationships)
        .where(
          and(
            eq(relationships.gameId, existing.gameId),
            eq(relationships.revisionId, previousRevision.id),
          ),
        );
      for (const previousRelation of previousRelations) {
        const relationKey = `${previousRelation.subjectId}|${previousRelation.predicate}|${previousRelation.objectId}`;
        if (
          (previousRelation.sourceKey &&
            (stagedKeys.has(previousRelation.sourceKey) ||
              confirmedDeletionKeys.has(previousRelation.sourceKey))) ||
          (!previousRelation.sourceKey && stagedRelationKeys.has(relationKey))
        )
          continue;
        await tx.insert(relationships).values({
          gameId: previousRelation.gameId,
          subjectId: previousRelation.subjectId,
          predicate: previousRelation.predicate,
          objectId: previousRelation.objectId,
          sourceKey: previousRelation.sourceKey,
          sourceId: previousRelation.sourceId,
          revisionId: revision.id,
          status: previousRelation.status,
          validFrom: previousRelation.validFrom,
          validTo: previousRelation.validTo,
          confidence: previousRelation.confidence,
        });
      }
      const previousDocuments = await tx
        .select()
        .from(documents)
        .where(
          and(
            eq(documents.gameId, existing.gameId),
            eq(documents.revisionId, previousRevision.id),
            eq(documents.deleted, false),
          ),
        );
      for (const previousDocument of previousDocuments) {
        previousDocumentSourceById.set(previousDocument.id, previousDocument.sourceKey);
        const previousSegments = await tx
          .select()
          .from(documentSegments)
          .where(eq(documentSegments.documentId, previousDocument.id))
          .orderBy(asc(documentSegments.ordinal));
        for (const previousSegment of previousSegments)
          previousSegmentOrdinalById.set(previousSegment.id, previousSegment.ordinal);
        if (
          stagedKeys.has(previousDocument.sourceKey) ||
          confirmedDeletionKeys.has(previousDocument.sourceKey)
        )
          continue;
        const documentId = stableUuid(
          `${existing.gameId}:document:${previousDocument.sourceKey}:${revision.id}`,
        );
        await tx.insert(documents).values({
          id: documentId,
          gameId: existing.gameId,
          sourceKey: previousDocument.sourceKey,
          type: previousDocument.type,
          title: previousDocument.title,
          normalizedTitle: previousDocument.normalizedTitle,
          gameVersion: previousDocument.gameVersion,
          locale: previousDocument.locale,
          sourceSnapshotId: previousDocument.sourceSnapshotId,
          body: previousDocument.body,
          metadata: previousDocument.metadata,
          revisionId: revision.id,
          deleted: false,
        });
        const segmentRefs: Array<{ id: string; body: string }> = [];
        for (const previousSegment of previousSegments) {
          const segmentId = stableUuid(
            `${documentId}:segment:${previousSegment.ordinal}:${previousSegment.contentHash}`,
          );
          await tx.insert(documentSegments).values({
            id: segmentId,
            documentId,
            revisionId: revision.id,
            segmentKey: previousSegment.segmentKey,
            ordinal: previousSegment.ordinal,
            headingPath: previousSegment.headingPath,
            metadata: previousSegment.metadata,
            body: previousSegment.body,
            startOffset: previousSegment.startOffset,
            endOffset: previousSegment.endOffset,
            tokenEstimate: previousSegment.tokenEstimate,
            contentHash: previousSegment.contentHash,
            searchText: previousSegment.searchText,
          });
          segmentRefs.push({ id: segmentId, body: previousSegment.body });
          const previousMentions = await tx
            .select()
            .from(entityMentions)
            .where(eq(entityMentions.segmentId, previousSegment.id));
          if (previousMentions.length)
            await tx.insert(entityMentions).values(
              previousMentions.map((mention) => ({
                entityId: mention.entityId,
                segmentId,
                rawText: mention.rawText,
                startOffset: mention.startOffset,
                endOffset: mention.endOffset,
                matchMethod: mention.matchMethod,
                confidence: mention.confidence,
              })),
            );
        }
        documentBySourceKey.set(previousDocument.sourceKey, {
          id: documentId,
          segments: segmentRefs,
        });
      }
    }
    for (const record of stagedRecords) {
      if (record.recordType === "entity" || record.entityType) continue;
      if (!record.title && !record.body) continue;
      const body = record.body ?? record.title ?? "";
      const documentId = stableUuid(
        `${existing.gameId}:document:${record.sourceKey}:${revision.id}`,
      );
      await tx.insert(documents).values({
        id: documentId,
        gameId: existing.gameId,
        sourceKey: record.sourceKey,
        type: record.documentType ?? "lore",
        title: record.title ?? record.sourceKey,
        normalizedTitle: normalize(record.title ?? record.sourceKey),
        gameVersion: record.gameVersion,
        locale: recordLocale(record),
        sourceSnapshotId,
        body,
        metadata: record.metadata,
        revisionId: revision.id,
        deleted: false,
      });
      const segments = recordSegments(record, body);
      const segmentRefs: Array<{ id: string; body: string }> = [];
      const segmentIdByKey = new Map<string, string>();
      for (let index = 0; index < segments.length; index += 1) {
        const segment = segments[index];
        if (!segment) continue;
        const segmentId = stableUuid(`${documentId}:segment:${index}:${record.contentHash}`);
        if (segment.segmentKey) segmentIdByKey.set(segment.segmentKey, segmentId);
        await tx.insert(documentSegments).values({
          id: segmentId,
          documentId,
          revisionId: revision.id,
          segmentKey: segment.segmentKey,
          ordinal: index,
          headingPath: segment.headingPath,
          metadata: segment.metadata,
          body: segment.body,
          startOffset: segment.start,
          endOffset: segment.end,
          tokenEstimate: Math.ceil(segment.body.length / 4),
          contentHash: createHash("sha256").update(segment.body).digest("hex"),
          searchText: segment.body,
        });
        segmentRefs.push({ id: segmentId, body: segment.body });
        for (const [sourceKey, entityId] of entityIdBySourceKey) {
          const candidate = allCandidates.find((item) => item.sourceKey === sourceKey);
          if (!candidate) continue;
          const names = [candidate.name, ...(candidate.aliases ?? []).map((item) => item.value)];
          for (const name of names) {
            const position = segment.body.indexOf(name);
            if (position >= 0) {
              await tx.insert(entityMentions).values({
                entityId,
                segmentId,
                rawText: name,
                startOffset: position,
                endOffset: position + name.length,
                matchMethod: name === candidate.name ? "canonical_name" : "alias",
                confidence: 1,
              });
              break;
            }
          }
        }
      }
      if (record.quest) {
        if (record.quest.subquests.length)
          await tx.insert(questSubquests).values(
            record.quest.subquests.map((subquest) => ({
              documentId,
              revisionId: revision.id,
              questKey: record.quest!.questKey,
              subquestKey: subquest.subquestKey,
              subquestId: String(subquest.subquestId),
              ordinal: subquest.order,
              title: subquest.title,
              objective: subquest.objective,
              completeness: subquest.completeness,
              metadata: subquest.metadata ?? {},
            })),
          );
        if (record.quest.dialogueNodes.length)
          await tx.insert(questDialogueNodes).values(
            record.quest.dialogueNodes.map((node, index) => ({
              documentId,
              revisionId: revision.id,
              questKey: record.quest!.questKey,
              subquestKey: node.subquestKey,
              nodeKey: node.nodeKey,
              nodeId: String(node.nodeId),
              nodeType: node.type,
              speakerKey: node.speakerKey,
              speakerName: node.speakerName,
              body: node.body,
              segmentId: node.segmentKey ? segmentIdByKey.get(node.segmentKey) : undefined,
              ordinal: node.order ?? index,
              variants: node.variants ?? {},
              metadata: node.metadata ?? {},
            })),
          );
        if (record.quest.dialogueEdges.length)
          await tx.insert(questDialogueEdges).values(
            record.quest.dialogueEdges.map((edge) => ({
              documentId,
              revisionId: revision.id,
              questKey: record.quest!.questKey,
              fromNodeKey: edge.fromNodeKey,
              toNodeKey: edge.toNodeKey,
              edgeType: edge.type,
              optionText: edge.optionText,
              metadata: edge.metadata ?? {},
            })),
          );
      }
      documentBySourceKey.set(record.sourceKey, { id: documentId, segments: segmentRefs });
    }
    const stagedClaimKeys = new Set(
      stagedRecords.flatMap((record) => (record.claims ?? []).map((claim) => claim.sourceKey)),
    );
    if (previousRevision) {
      const previousClaims = await tx
        .select()
        .from(claims)
        .where(and(eq(claims.gameId, existing.gameId), eq(claims.revisionId, previousRevision.id)));
      for (const previousClaim of previousClaims) {
        const preserve = previousClaim.recordSourceKey
          ? !stagedKeys.has(previousClaim.recordSourceKey) &&
            !confirmedDeletionKeys.has(previousClaim.recordSourceKey)
          : !stagedClaimKeys.has(previousClaim.sourceKey ?? "");
        if (!preserve) continue;

        const claimId = stableUuid(
          `${existing.gameId}:claim:${previousClaim.sourceKey ?? previousClaim.id}:${revision.id}`,
        );
        await tx.insert(claims).values({
          id: claimId,
          gameId: previousClaim.gameId,
          sourceKey: previousClaim.sourceKey,
          recordSourceKey: previousClaim.recordSourceKey,
          normalizedStatement: previousClaim.normalizedStatement,
          status: previousClaim.status,
          confidence: previousClaim.confidence,
          createdBy: previousClaim.createdBy,
          revisionId: revision.id,
        });

        const previousClaimEntities = await tx
          .select()
          .from(claimEntities)
          .where(eq(claimEntities.claimId, previousClaim.id));
        if (previousClaimEntities.length)
          await tx
            .insert(claimEntities)
            .values(
              previousClaimEntities.map((item) => ({
                claimId,
                entityId: item.entityId,
              })),
            )
            .onConflictDoNothing();

        const previousEvidence = await tx
          .select()
          .from(evidence)
          .where(eq(evidence.claimId, previousClaim.id));
        for (const previousItem of previousEvidence) {
          const documentSourceKey = previousDocumentSourceById.get(previousItem.documentId);
          const targetDocument = documentSourceKey
            ? documentBySourceKey.get(documentSourceKey)
            : undefined;
          const ordinal = previousSegmentOrdinalById.get(previousItem.segmentId);
          const targetSegment = targetDocument?.segments[ordinal ?? 0];
          if (!targetDocument || !targetSegment) continue;
          await tx.insert(evidence).values({
            claimId,
            documentId: targetDocument.id,
            segmentId: targetSegment.id,
            quoteStart: previousItem.quoteStart,
            quoteEnd: previousItem.quoteEnd,
            quote: previousItem.quote,
            strength: previousItem.strength,
            note: previousItem.note,
            valid: previousItem.valid,
          });
        }
      }
    }
    for (const record of stagedRecords) {
      for (const relation of record.relationships ?? []) {
        const subjectId = entityIdBySourceKey.get(relation.subjectSourceKey);
        const objectId = entityIdBySourceKey.get(relation.objectSourceKey);
        if (!subjectId || !objectId)
          throw new DomainError(
            "invalid_entity_reference",
            `Relationship references an unknown entity in ${record.sourceKey}`,
          );
        await tx.insert(relationships).values({
          gameId: existing.gameId,
          subjectId,
          predicate: relation.predicate,
          objectId,
          sourceKey: record.sourceKey,
          sourceId: sourceRow?.id,
          revisionId: revision.id,
          status: "active",
          validFrom: relation.validFrom,
          validTo: relation.validTo,
          confidence: relation.confidence,
        });
      }
      for (const claim of record.claims ?? []) {
        if ((claim.status === "confirmed" || claim.status === "implied") && !claim.evidence?.length)
          throw new DomainError(
            "claim_evidence_required",
            `Claim has no evidence: ${claim.statement}`,
          );
        const [claimRow] = await tx
          .insert(claims)
          .values({
            gameId: existing.gameId,
            sourceKey: claim.sourceKey,
            recordSourceKey: record.sourceKey,
            normalizedStatement: claim.statement,
            status: claim.status,
            confidence: claim.confidence,
            createdBy: claim.createdBy ?? "import",
            revisionId: revision.id,
          })
          .returning();
        if (!claimRow) continue;
        for (const sourceKey of claim.entitySourceKeys ?? []) {
          const entityId = entityIdBySourceKey.get(sourceKey);
          if (entityId)
            await tx
              .insert(claimEntities)
              .values({ claimId: claimRow.id, entityId })
              .onConflictDoNothing();
        }
        for (const claimEvidence of claim.evidence ?? []) {
          const target =
            documentBySourceKey.get(claimEvidence.documentSourceKey) ??
            documentBySourceKey.get(record.sourceKey);
          if (!target || !target.segments[0])
            throw new DomainError(
              "evidence_document_missing",
              `Evidence document is missing: ${claimEvidence.documentSourceKey}`,
            );
          const located = claimEvidence.quote
            ? target.segments
                .map((segment) => ({
                  segment,
                  start: segment.body.indexOf(claimEvidence.quote!),
                }))
                .find((candidate) => candidate.start >= 0)
            : { segment: target.segments[0], start: 0 };
          if (!located)
            throw new DomainError(
              "evidence_quote_missing",
              `Evidence quote was not found in document: ${claimEvidence.documentSourceKey}`,
            );
          const segment = located.segment;
          const quote = claimEvidence.quote ?? segment.body.slice(0, 500);
          const start = located.start;
          await tx.insert(evidence).values({
            claimId: claimRow.id,
            documentId: target.id,
            segmentId: segment.id,
            quoteStart: start,
            quoteEnd: start + quote.length,
            quote,
            strength: claimEvidence.strength,
            note: claimEvidence.note,
            valid: true,
          });
        }
      }
    }
    if (existing.confirmedDeletionKeys.length) {
      await tx
        .update(entities)
        .set({ deleted: true, lastRevisionId: revision.id, updatedAt: new Date() })
        .where(
          and(
            eq(entities.gameId, existing.gameId),
            inArray(entities.sourceKey, existing.confirmedDeletionKeys),
          ),
        );
    }
    await tx
      .update(importBatches)
      .set({ status: "published", completedAt: new Date() })
      .where(eq(importBatches.id, batchId));
    await tx
      .insert(jobs)
      .values({
        type: "rebuild_search",
        idempotencyKey: `rebuild_search:${revision.id}`,
        payload: { gameId: existing.gameId, revisionId: revision.id },
      })
      .onConflictDoNothing();
    await tx
      .insert(jobs)
      .values({
        type: "generate_embeddings",
        idempotencyKey: `generate_embeddings:${revision.id}`,
        payload: { gameId: existing.gameId, revisionId: revision.id },
      })
      .onConflictDoNothing();
    await tx.insert(auditLog).values({
      action: "publish_revision",
      targetType: "dataset_revision",
      targetId: revision.id,
      reason: releaseNote,
      metadata: { gameId: existing.gameId, sourceBatchId: batchId },
    });
    return {
      id: revision.id,
      gameId: revision.gameId,
      revisionNumber: revision.revisionNumber,
      sourceBatchId: revision.sourceBatchId,
      releaseNote: revision.releaseNote,
      lifecycleStatus: revision.lifecycleStatus as DatasetRevision["lifecycleStatus"],
      publishedAt: revision.publishedAt,
      isCurrent: revision.isCurrent,
      indexStatus: revision.indexStatus as DatasetRevision["indexStatus"],
    };
  });
}

function hasImportData(batch: ImportBatch): boolean {
  return (
    (batch.stagedRecords?.length ?? 0) > 0 ||
    Object.values(batch.structuredRecords ?? {}).some((records) => (records?.length ?? 0) > 0)
  );
}

function mergeByStableId<T extends { stableId: string }>(
  previous: T[] | undefined,
  incoming: T[] | undefined,
): T[] {
  const merged = new Map<string, T>();
  for (const record of previous ?? []) merged.set(record.stableId, record);
  for (const record of incoming ?? []) merged.set(record.stableId, record);
  return [...merged.values()].sort((left, right) => left.stableId.localeCompare(right.stableId));
}

function mergeStructuredRecords(
  previous: StructuredImportRecords | undefined,
  incoming: StructuredImportRecords | undefined,
): StructuredImportRecords | undefined {
  const merged: StructuredImportRecords = {
    characters: mergeByStableId(previous?.characters, incoming?.characters),
    weapons: mergeByStableId(previous?.weapons, incoming?.weapons),
    artifactSets: mergeByStableId(previous?.artifactSets, incoming?.artifactSets),
    artifacts: mergeByStableId(previous?.artifacts, incoming?.artifacts),
    materials: mergeByStableId(previous?.materials, incoming?.materials),
    achievements: mergeByStableId(previous?.achievements, incoming?.achievements),
    enemies: mergeByStableId(previous?.enemies, incoming?.enemies),
    voices: mergeByStableId(previous?.voices, incoming?.voices),
  };
  return Object.values(merged).some((records) => records.length) ? merged : undefined;
}

function structuredBase(
  gameId: string,
  revisionId: string,
  kind: string,
  record: {
    stableId: string;
    sourceKey: string;
    name: string;
    locale?: string | null;
    gameVersion?: string | null;
    sourceId?: string | null;
    sourceSnapshotId?: string | null;
    provenance?: Record<string, unknown>;
  },
) {
  return {
    id: stableUuid(`${gameId}:structured:${kind}:${revisionId}:${record.stableId}`),
    gameId,
    revisionId,
    stableId: record.stableId,
    sourceKey: record.sourceKey,
    name: record.name,
    normalizedName: normalize(record.name),
    locale: record.locale ?? "und",
    gameVersion: record.gameVersion,
    sourceId: record.sourceId,
    sourceSnapshotId: record.sourceSnapshotId,
    provenance: record.provenance ?? {},
  };
}

async function materializeStructuredRecords(
  db: Database,
  gameId: string,
  revisionId: string,
  records: StructuredImportRecords | undefined,
): Promise<void> {
  if (!records) return;
  if (records.characters?.length)
    await db.insert(genshinCharacters).values(
      records.characters.map((record) => ({
        ...structuredBase(gameId, revisionId, "character", record),
        title: record.title,
        rarity: record.rarity,
        element: record.element,
        weaponType: record.weaponType,
        region: record.region,
        affiliation: record.affiliation,
        birthday: record.birthday,
        constellation: record.constellation,
        description: record.description,
        profile: record.profile ?? {},
      })),
    );
  if (records.weapons?.length)
    await db.insert(genshinWeapons).values(
      records.weapons.map((record) => ({
        ...structuredBase(gameId, revisionId, "weapon", record),
        weaponType: record.weaponType,
        rarity: record.rarity,
        baseAttack: record.baseAttack,
        subStat: record.subStat,
        passiveName: record.passiveName,
        passiveDescription: record.passiveDescription,
        ascensionMaterials: record.ascensionMaterials ?? [],
        description: record.description,
      })),
    );
  if (records.artifactSets?.length)
    await db.insert(genshinArtifactSets).values(
      records.artifactSets.map((record) => ({
        ...structuredBase(gameId, revisionId, "artifact-set", record),
        maxRarity: record.maxRarity,
        twoPieceBonus: record.twoPieceBonus,
        fourPieceBonus: record.fourPieceBonus,
        pieces: record.pieces ?? [],
      })),
    );
  if (records.artifacts?.length)
    await db.insert(genshinArtifacts).values(
      records.artifacts.map((record) => ({
        ...structuredBase(gameId, revisionId, "artifact", record),
        setStableId: record.setStableId,
        slot: record.slot,
        rarity: record.rarity,
        description: record.description,
      })),
    );
  if (records.materials?.length)
    await db.insert(genshinMaterials).values(
      records.materials.map((record) => ({
        ...structuredBase(gameId, revisionId, "material", record),
        category: record.category,
        rarity: record.rarity,
        description: record.description,
        sources: record.sources ?? [],
        usedBy: record.usedBy ?? [],
      })),
    );
  if (records.achievements?.length)
    await db.insert(genshinAchievements).values(
      records.achievements.map((record) => ({
        ...structuredBase(gameId, revisionId, "achievement", record),
        category: record.category,
        requirement: record.requirement,
        rewardPrimogems: record.rewardPrimogems,
        hidden: record.hidden ?? false,
      })),
    );
  if (records.enemies?.length)
    await db.insert(genshinEnemies).values(
      records.enemies.map((record) => ({
        ...structuredBase(gameId, revisionId, "enemy", record),
        category: record.category,
        family: record.family,
        description: record.description,
        drops: record.drops ?? [],
        resistances: record.resistances ?? {},
      })),
    );
  if (records.voices?.length)
    await db.insert(genshinVoiceLines).values(
      records.voices.map((record) => ({
        ...structuredBase(gameId, revisionId, "voice", record),
        characterStableId: record.characterStableId,
        title: record.title,
        body: record.body,
        contentHash: record.contentHash,
      })),
    );
}

export async function getPublishReadiness(
  ctx: ImportPublicationContext,
  batchId: string,
): Promise<PublishReadiness> {
  const batch = await ctx.getImport(batchId);
  if (!batch)
    throw new DomainError("import_not_found", "Import batch was not found", undefined, 404);
  const blockingReasons: PublishReadiness["blockingReasons"] = [];
  const checks: Array<() => Promise<void> | void> = [
    () => assertPublishable(batch),
    () => {
      if (!hasImportData(batch))
        throw new DomainError(
          "staged_data_missing",
          "Import contains no staged or structured records",
        );
    },
    () => {
      if (!batch.sourceSnapshotId)
        throw new DomainError("source_snapshot_missing", "Source snapshot is missing");
    },
    () => ctx.ensureAcquisitionReview(batchId),
    () => ctx.ensureAnimeAcquisitionIntegrity(batch),
    () => ctx.ensureReleaseBackup(batch),
  ];
  for (const check of checks) {
    try {
      await check();
    } catch (error) {
      if (error instanceof DomainError)
        blockingReasons.push({
          code: error.code,
          message: error.message,
          details: error.details,
        });
      else
        blockingReasons.push({
          code: "publish_gate_error",
          message: "A publish gate could not be evaluated",
        });
    }
  }
  return { ready: blockingReasons.length === 0, blockingReasons };
}
