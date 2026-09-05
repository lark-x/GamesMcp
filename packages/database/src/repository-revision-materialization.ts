import { createHash } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { DomainError } from "@gip/domain";
import type { Database } from "./client.js";
import {
  claimEntities,
  claims,
  datasetRevisions,
  documentSegments,
  documents,
  entityRevisionMaterializations,
  embeddings,
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
  questDialogueEdges,
  questDialogueNodes,
  questSubquests,
  relationships,
  releaseCandidates,
  sourceSnapshots,
  textBindings,
} from "./schema.js";
import {
  asRecord,
  insertInChunks,
  normalize,
  recordLocale,
  recordSegments,
  stableEntityId,
  stableUuid,
} from "./repository-utils.js";
import { materializeStructuredRecords } from "./repository-import-publication.js";

type TextBindingInsert = typeof textBindings.$inferInsert;

function directBindingTypeForDocument(
  documentType: string | undefined,
): TextBindingInsert["bindingType"] | undefined {
  if (documentType === "character_story") return "character_story";
  if (documentType === "item_description") return "item_description";
  if (documentType === "book") return "book_reference";
  if (documentType === "mechanism") return "mechanism_reference";
  if (documentType === "tutorial") return "tutorial_reference";
  return undefined;
}

/**
 * Build the revision-scoped read model from the immutable Candidate Build.
 *
 * This deliberately does not call publishImport: activation must be a pure
 * function of the Build payload and its captured provenance. Re-running the
 * job first clears only this preparing revision's rows, making worker retries
 * idempotent without changing the currently published revision.
 */
export async function materializeRevision(db: Database, revisionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from knowledge.dataset_revisions where id = ${revisionId}::uuid for update`,
    );
    const [revision] = await tx
      .select()
      .from(datasetRevisions)
      .where(eq(datasetRevisions.id, revisionId))
      .limit(1);
    if (!revision?.normalizedRecords)
      throw new DomainError(
        "revision_materialization_missing",
        "Preparing revision payload is missing",
      );
    if (revision.lifecycleStatus === "published" && revision.indexStatus === "ready") return;
    if (revision.lifecycleStatus !== "preparing")
      throw new DomainError(
        "revision_materialization_invalid_state",
        `Revision ${revisionId} is not preparing`,
        { lifecycleStatus: revision.lifecycleStatus },
        409,
      );

    const records = revision.normalizedRecords;
    const provenance = asRecord(revision.provenance);
    const recordedBatchIds = Array.isArray(provenance.batchIds)
      ? provenance.batchIds.filter((value): value is string => typeof value === "string")
      : [];
    const batchIds = [...new Set([...recordedBatchIds, revision.sourceBatchId])];
    const batchRows = batchIds.length
      ? await tx.select().from(importBatches).where(inArray(importBatches.id, batchIds))
      : [];
    const batchesById = new Map(batchRows.map((row) => [row.id, row]));
    const snapshotByRecord = new Map<string, string>();
    const sourceByRecord = new Map<string, string>();
    for (const batchId of batchIds) {
      const batch = batchesById.get(batchId);
      if (!batch?.sourceSnapshotId || !batch.stagedRecords)
        throw new DomainError(
          "revision_provenance_incomplete",
          "Candidate Build references an import without staged snapshot data",
          { batchId },
        );
      if (batch.gameId !== revision.gameId)
        throw new DomainError(
          "revision_provenance_game_mismatch",
          "Candidate Build import belongs to another game",
          { batchId },
        );
      for (const record of batch.stagedRecords) {
        snapshotByRecord.set(record.sourceKey, batch.sourceSnapshotId);
        sourceByRecord.set(record.sourceKey, batch.sourceId);
      }
    }

    const [candidate] = revision.activationCandidateId
      ? await tx
          .select()
          .from(releaseCandidates)
          .where(eq(releaseCandidates.id, revision.activationCandidateId))
          .limit(1)
      : [];
    if (candidate?.baseRevisionId) {
      const baseDocuments = await tx
        .select({
          sourceKey: documents.sourceKey,
          sourceSnapshotId: documents.sourceSnapshotId,
          sourceId: sourceSnapshots.sourceId,
        })
        .from(documents)
        .innerJoin(sourceSnapshots, eq(documents.sourceSnapshotId, sourceSnapshots.id))
        .where(eq(documents.revisionId, candidate.baseRevisionId));
      for (const document of baseDocuments) {
        if (!snapshotByRecord.has(document.sourceKey))
          snapshotByRecord.set(document.sourceKey, document.sourceSnapshotId);
        if (!sourceByRecord.has(document.sourceKey))
          sourceByRecord.set(document.sourceKey, document.sourceId);
      }
    }

    // A failed activation can be retried safely: remove only rows owned by
    // this preparing revision. Claim deletion cascades to claim_entities and
    // evidence; document deletion cascades to segments and mentions.
    await tx.delete(embeddings).where(eq(embeddings.revisionId, revisionId));
    await tx.delete(textBindings).where(eq(textBindings.revisionId, revisionId));
    await tx
      .delete(entityRevisionMaterializations)
      .where(eq(entityRevisionMaterializations.revisionId, revisionId));
    await tx.delete(entityAliases).where(eq(entityAliases.revisionId, revisionId));
    await tx.delete(claims).where(eq(claims.revisionId, revisionId));
    await tx.delete(relationships).where(eq(relationships.revisionId, revisionId));
    await tx.delete(documents).where(eq(documents.revisionId, revisionId));
    await tx.delete(genshinVoiceLines).where(eq(genshinVoiceLines.revisionId, revisionId));
    await tx.delete(genshinEnemies).where(eq(genshinEnemies.revisionId, revisionId));
    await tx.delete(genshinAchievements).where(eq(genshinAchievements.revisionId, revisionId));
    await tx.delete(genshinMaterials).where(eq(genshinMaterials.revisionId, revisionId));
    await tx.delete(genshinArtifacts).where(eq(genshinArtifacts.revisionId, revisionId));
    await tx.delete(genshinArtifactSets).where(eq(genshinArtifactSets.revisionId, revisionId));
    await tx.delete(genshinWeapons).where(eq(genshinWeapons.revisionId, revisionId));
    await tx.delete(genshinCharacters).where(eq(genshinCharacters.revisionId, revisionId));

    const entityIdBySourceKey = new Map<string, string>();
    const entityRecordBySourceKey = new Map<string, string>();
    const allCandidates = records.flatMap((record) =>
      (record.entities ?? []).map((candidateValue) => {
        entityRecordBySourceKey.set(candidateValue.sourceKey, record.sourceKey);
        return candidateValue;
      }),
    );
    for (const candidateValue of allCandidates) {
      const id = stableEntityId(revision.gameId, candidateValue.sourceKey);
      entityIdBySourceKey.set(candidateValue.sourceKey, id);
      await tx
        .insert(entities)
        .values({
          id,
          gameId: revision.gameId,
          sourceKey: candidateValue.sourceKey,
          type: candidateValue.type,
          canonicalName: candidateValue.name,
          normalizedName: normalize(candidateValue.name),
          summary: candidateValue.summary,
          properties: candidateValue.properties ?? {},
          firstRevisionId: revisionId,
          lastRevisionId: revisionId,
          deleted: false,
        })
        .onConflictDoUpdate({
          target: [entities.gameId, entities.sourceKey],
          set: {
            type: candidateValue.type,
            canonicalName: candidateValue.name,
            normalizedName: normalize(candidateValue.name),
            summary: candidateValue.summary,
            properties: candidateValue.properties ?? {},
            lastRevisionId: revisionId,
            deleted: false,
            updatedAt: new Date(),
          },
        });
    }
    const entityIds = [...entityIdBySourceKey.values()];
    const uniqueCandidates = [
      ...new Map(
        allCandidates.map((candidateValue) => [candidateValue.sourceKey, candidateValue]),
      ).values(),
    ];
    if (entityIds.length) {
      await insertInChunks(
        tx,
        entityRevisionMaterializations,
        uniqueCandidates.map((candidateValue) => ({
          revisionId,
          entityId: entityIdBySourceKey.get(candidateValue.sourceKey)!,
          entityType: candidateValue.type,
          canonicalName: candidateValue.name,
          normalizedName: normalize(candidateValue.name),
          summary: candidateValue.summary,
        })),
      );
    }
    for (const candidateValue of uniqueCandidates) {
      const entityId = entityIdBySourceKey.get(candidateValue.sourceKey);
      if (!entityId || !candidateValue.aliases?.length) continue;
      const recordKey = entityRecordBySourceKey.get(candidateValue.sourceKey);
      await tx.insert(entityAliases).values(
        candidateValue.aliases.map((alias) => ({
          entityId,
          revisionId,
          value: alias.value,
          normalizedValue: normalize(alias.value),
          language: alias.language ?? "und",
          sourceId: recordKey ? sourceByRecord.get(recordKey) : undefined,
          isPrimary: alias.primary ?? false,
        })),
      );
    }

    const documentBySourceKey = new Map<
      string,
      { id: string; segments: Array<{ id: string; body: string }> }
    >();
    const textBindingRows: TextBindingInsert[] = [];
    const addTextBinding = (input: Omit<TextBindingInsert, "id" | "gameId" | "revisionId">) => {
      textBindingRows.push({
        id: stableUuid(
          [
            revision.gameId,
            revisionId,
            input.entityStableId,
            input.documentId,
            input.segmentId ?? "",
            input.bindingType,
            input.bindingSource,
          ].join(":"),
        ),
        gameId: revision.gameId,
        revisionId,
        ...input,
      });
    };
    for (const record of records) {
      if (record.recordType === "entity" || record.entityType) continue;
      if (!record.title && !record.body) continue;
      const recordMentionCandidates = record.entities ?? [];
      const sourceSnapshotId = snapshotByRecord.get(record.sourceKey);
      if (!sourceSnapshotId)
        throw new DomainError(
          "revision_document_provenance_missing",
          `No immutable source snapshot was found for ${record.sourceKey}`,
          { sourceKey: record.sourceKey },
        );
      const body = record.body ?? record.title ?? "";
      const documentId = stableUuid(
        `${revision.gameId}:document:${record.sourceKey}:${revisionId}`,
      );
      await tx.insert(documents).values({
        id: documentId,
        gameId: revision.gameId,
        sourceKey: record.sourceKey,
        type: record.documentType ?? "lore",
        title: record.title ?? record.sourceKey,
        normalizedTitle: normalize(record.title ?? record.sourceKey),
        gameVersion: record.gameVersion,
        locale: recordLocale(record),
        sourceSnapshotId,
        body,
        metadata: record.metadata,
        revisionId,
        deleted: false,
      });
      const directBindingType = directBindingTypeForDocument(record.documentType);
      if (directBindingType) {
        for (const candidateValue of recordMentionCandidates) {
          addTextBinding({
            entityType: candidateValue.type,
            entityStableId: candidateValue.sourceKey,
            documentId,
            segmentId: null,
            bindingType: directBindingType,
            bindingSource: "direct_upstream",
            confidence: 1,
            metadata: { sourceKey: record.sourceKey, documentType: record.documentType },
          });
        }
      }
      const segmentRefs: Array<{ id: string; body: string }> = [];
      const segmentIdByKey = new Map<string, string>();
      for (const [ordinal, segment] of recordSegments(record, body).entries()) {
        const segmentId = stableUuid(`${documentId}:segment:${ordinal}:${record.contentHash}`);
        if (segment.segmentKey) segmentIdByKey.set(segment.segmentKey, segmentId);
        await tx.insert(documentSegments).values({
          id: segmentId,
          documentId,
          revisionId,
          segmentKey: segment.segmentKey,
          ordinal,
          headingPath: segment.headingPath,
          headingKey: headingKey(segment.headingPath),
          metadata: segment.metadata,
          body: segment.body,
          startOffset: segment.start,
          endOffset: segment.end,
          tokenEstimate: Math.ceil(segment.body.length / 4),
          contentHash: createHash("sha256").update(segment.body).digest("hex"),
          searchText: segment.body,
        });
        segmentRefs.push({ id: segmentId, body: segment.body });
        for (const candidateValue of recordMentionCandidates) {
          const names = [
            candidateValue.name,
            ...(candidateValue.aliases ?? []).map((alias) => alias.value),
          ];
          const matched = names
            .map((name) => ({ name, offset: segment.body.indexOf(name) }))
            .find((value) => value.offset >= 0);
          if (!matched) continue;
          await tx.insert(entityMentions).values({
            entityId: entityIdBySourceKey.get(candidateValue.sourceKey)!,
            segmentId,
            rawText: matched.name,
            startOffset: matched.offset,
            endOffset: matched.offset + matched.name.length,
            matchMethod: matched.name === candidateValue.name ? "canonical_name" : "alias",
            confidence: 1,
          });
          addTextBinding({
            entityType: candidateValue.type,
            entityStableId: candidateValue.sourceKey,
            documentId,
            segmentId,
            bindingType: "mention",
            bindingSource: matched.name === candidateValue.name ? "canonical_exact" : "alias_exact",
            confidence: matched.name === candidateValue.name ? 1 : 0.9,
            metadata: {
              rawText: matched.name,
              startOffset: matched.offset,
              endOffset: matched.offset + matched.name.length,
              sourceKey: record.sourceKey,
            },
          });
        }
      }
      if (record.quest) {
        if (record.quest.subquests.length)
          await tx.insert(questSubquests).values(
            record.quest.subquests.map((subquest) => ({
              documentId,
              revisionId,
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
          await insertInChunks(
            tx,
            questDialogueNodes,
            record.quest.dialogueNodes.map((node, index) => ({
              documentId,
              revisionId,
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
        for (const node of record.quest.dialogueNodes) {
          if (!node.speakerKey || !entityIdBySourceKey.has(node.speakerKey)) continue;
          addTextBinding({
            entityType: "npc",
            entityStableId: node.speakerKey,
            documentId,
            segmentId: node.segmentKey ? (segmentIdByKey.get(node.segmentKey) ?? null) : null,
            bindingType: "speaker",
            bindingSource: "speaker_resolution",
            confidence: node.speakerName ? 1 : 0.5,
            metadata: {
              questKey: record.quest.questKey,
              dialogueNodeKey: node.nodeKey,
              speakerName: node.speakerName,
              speakerNameResolution: node.metadata?.speakerNameResolution,
            },
          });
        }
        if (record.quest.dialogueEdges.length)
          await insertInChunks(
            tx,
            questDialogueEdges,
            [
              ...new Map(
                record.quest.dialogueEdges.map((edge) => [
                  [edge.fromNodeKey, edge.toNodeKey, edge.type, edge.optionText ?? ""].join(
                    "\u0000",
                  ),
                  edge,
                ]),
              ).values(),
            ].map((edge) => ({
              documentId,
              revisionId,
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

    for (const record of records) {
      for (const relation of record.relationships ?? []) {
        const subjectId = entityIdBySourceKey.get(relation.subjectSourceKey);
        const objectId = entityIdBySourceKey.get(relation.objectSourceKey);
        if (!subjectId || !objectId)
          throw new DomainError(
            "invalid_entity_reference",
            `Relationship references an unknown entity in ${record.sourceKey}`,
          );
        await tx.insert(relationships).values({
          gameId: revision.gameId,
          subjectId,
          predicate: relation.predicate,
          objectId,
          sourceKey: record.sourceKey,
          sourceId: sourceByRecord.get(record.sourceKey),
          revisionId,
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
            gameId: revision.gameId,
            sourceKey: claim.sourceKey,
            recordSourceKey: record.sourceKey,
            normalizedStatement: claim.statement,
            status: claim.status,
            confidence: claim.confidence,
            createdBy: claim.createdBy ?? "import",
            revisionId,
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
          if (!target?.segments[0])
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
                .find((candidateValue) => candidateValue.start >= 0)
            : { segment: target.segments[0], start: 0 };
          if (!located)
            throw new DomainError(
              "evidence_quote_missing",
              `Evidence quote was not found in ${claimEvidence.documentSourceKey}`,
            );
          const quote = claimEvidence.quote ?? located.segment.body.slice(0, 500);
          await tx.insert(evidence).values({
            claimId: claimRow.id,
            documentId: target.id,
            segmentId: located.segment.id,
            quoteStart: located.start,
            quoteEnd: located.start + quote.length,
            quote,
            strength: claimEvidence.strength,
            note: claimEvidence.note,
            valid: true,
          });
        }
      }
    }

    const uniqueTextBindingRows = [
      ...new Map(textBindingRows.map((row) => [row.id ?? "", row])).values(),
    ];
    if (uniqueTextBindingRows.length)
      await insertInChunks(tx, textBindings, uniqueTextBindingRows);

    const expectedDocuments = records.filter(
      (record) =>
        record.recordType !== "entity" &&
        !record.entityType &&
        Boolean(record.title || record.body),
    ).length;
    const expectedRelationships = records.reduce(
      (total, record) => total + (record.relationships?.length ?? 0),
      0,
    );
    const expectedClaims = records.reduce(
      (total, record) => total + (record.claims?.length ?? 0),
      0,
    );
    const expectedTextBindings = uniqueTextBindingRows.length;
    const [counts] = await tx
      .select({
        documents: sql<number>`(select count(*)::int from knowledge.documents where revision_id = ${revisionId}::uuid)`,
        relationships: sql<number>`(select count(*)::int from knowledge.relationships where revision_id = ${revisionId}::uuid)`,
        claims: sql<number>`(select count(*)::int from knowledge.claims where revision_id = ${revisionId}::uuid)`,
        textBindings: sql<number>`(select count(*)::int from knowledge.text_bindings where revision_id = ${revisionId}::uuid)`,
      })
      .from(datasetRevisions)
      .where(eq(datasetRevisions.id, revisionId));
    if (
      !counts ||
      counts.documents !== expectedDocuments ||
      counts.relationships !== expectedRelationships ||
      counts.claims !== expectedClaims ||
      counts.textBindings !== expectedTextBindings
    )
      throw new DomainError(
        "revision_materialization_incomplete",
        "Revision read model counts do not match the immutable Build",
        {
          expected: {
            documents: expectedDocuments,
            relationships: expectedRelationships,
            claims: expectedClaims,
            textBindings: expectedTextBindings,
          },
          actual: counts,
        },
      );
    await materializeStructuredRecords(
      tx,
      revision.gameId,
      revisionId,
      revision.structuredRecords ?? undefined,
    );
  });
  await analyzeRevisionReadModelTables(db);
}

function headingKey(headingPath: string[] = []): string | null {
  const normalized = normalize(headingPath.join(" / "));
  return normalized || null;
}

async function analyzeRevisionReadModelTables(db: Database): Promise<void> {
  for (const tableName of [
    "knowledge.documents",
    "knowledge.document_segments",
    "knowledge.quest_dialogue_nodes",
    "knowledge.quest_dialogue_edges",
    "knowledge.quest_subquests",
    "knowledge.entity_revision_materializations",
    "knowledge.entity_aliases",
    "knowledge.text_bindings",
    "knowledge.genshin_characters",
    "knowledge.genshin_weapons",
    "knowledge.genshin_artifact_sets",
    "knowledge.genshin_artifacts",
    "knowledge.genshin_materials",
    "knowledge.genshin_achievements",
    "knowledge.genshin_enemies",
    "knowledge.genshin_voice_lines",
  ]) {
    await db.execute(sql.raw(`analyze ${tableName}`));
  }
}
