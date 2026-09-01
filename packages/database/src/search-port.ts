import { and, eq, inArray, sql } from "drizzle-orm";
import type { SearchRepositoryPort, StructuredSearchKind } from "@gip/search";
import type { DocumentType } from "@gip/contracts";
import type { Database } from "./client.js";
import { escapeLike } from "./repository-utils.js";
import {
  documentSegments,
  documents,
  entities,
  entityAliases,
  genshinAchievements,
  genshinArtifacts,
  genshinArtifactSets,
  genshinCharacters,
  genshinEnemies,
  genshinMaterials,
  genshinVoiceLines,
  genshinWeapons,
  questDialogueNodes,
} from "./schema.js";

export class SqlSearchRepositoryPort implements SearchRepositoryPort {
  constructor(private readonly db: Database) {}

  async listStructuredAtRevision(gameId: string, revisionId: string, query: string) {
    const like = "%" + escapeLike(query) + "%";
    const normalizedLike = "%" + escapeLike(query.trim().toLocaleLowerCase("zh-CN")) + "%";
    const [characters, weapons, artifactSets, artifacts, materials, achievements, enemies, voices] =
      await Promise.all([
        this.db
          .select()
          .from(genshinCharacters)
          .where(
            and(
              eq(genshinCharacters.gameId, gameId),
              eq(genshinCharacters.revisionId, revisionId),
              sql`(${genshinCharacters.normalizedName} like ${normalizedLike} or ${genshinCharacters.description} ilike ${like} or ${genshinCharacters.title} ilike ${like})`,
            ),
          )
          .limit(40),
        this.db
          .select()
          .from(genshinWeapons)
          .where(
            and(
              eq(genshinWeapons.gameId, gameId),
              eq(genshinWeapons.revisionId, revisionId),
              sql`(${genshinWeapons.normalizedName} like ${normalizedLike} or ${genshinWeapons.description} ilike ${like} or ${genshinWeapons.passiveName} ilike ${like})`,
            ),
          )
          .limit(40),
        this.db
          .select()
          .from(genshinArtifactSets)
          .where(
            and(
              eq(genshinArtifactSets.gameId, gameId),
              eq(genshinArtifactSets.revisionId, revisionId),
              sql`(${genshinArtifactSets.normalizedName} like ${normalizedLike} or ${genshinArtifactSets.twoPieceBonus} ilike ${like} or ${genshinArtifactSets.fourPieceBonus} ilike ${like})`,
            ),
          )
          .limit(40),
        this.db
          .select()
          .from(genshinArtifacts)
          .where(
            and(
              eq(genshinArtifacts.gameId, gameId),
              eq(genshinArtifacts.revisionId, revisionId),
              sql`(${genshinArtifacts.normalizedName} like ${normalizedLike} or ${genshinArtifacts.description} ilike ${like})`,
            ),
          )
          .limit(40),
        this.db
          .select()
          .from(genshinMaterials)
          .where(
            and(
              eq(genshinMaterials.gameId, gameId),
              eq(genshinMaterials.revisionId, revisionId),
              sql`(${genshinMaterials.normalizedName} like ${normalizedLike} or ${genshinMaterials.description} ilike ${like})`,
            ),
          )
          .limit(40),
        this.db
          .select()
          .from(genshinAchievements)
          .where(
            and(
              eq(genshinAchievements.gameId, gameId),
              eq(genshinAchievements.revisionId, revisionId),
              sql`(${genshinAchievements.normalizedName} like ${normalizedLike} or ${genshinAchievements.requirement} ilike ${like})`,
            ),
          )
          .limit(40),
        this.db
          .select()
          .from(genshinEnemies)
          .where(
            and(
              eq(genshinEnemies.gameId, gameId),
              eq(genshinEnemies.revisionId, revisionId),
              sql`(${genshinEnemies.normalizedName} like ${normalizedLike} or ${genshinEnemies.description} ilike ${like} or ${genshinEnemies.family} ilike ${like})`,
            ),
          )
          .limit(40),
        this.db
          .select()
          .from(genshinVoiceLines)
          .where(
            and(
              eq(genshinVoiceLines.gameId, gameId),
              eq(genshinVoiceLines.revisionId, revisionId),
              sql`(${genshinVoiceLines.normalizedName} like ${normalizedLike} or ${genshinVoiceLines.title} ilike ${like} or ${genshinVoiceLines.body} ilike ${like})`,
            ),
          )
          .limit(40),
      ]);
    const rows: Array<{
      kind: StructuredSearchKind;
      stableId: string;
      name: string;
      aliases: string[];
      body: string;
    }> = [];
    for (const row of characters)
      rows.push({
        kind: "character",
        stableId: row.stableId,
        name: row.name,
        aliases: [row.title].filter((v): v is string => Boolean(v)),
        body: row.description ?? "",
      });
    for (const row of weapons)
      rows.push({
        kind: "weapon",
        stableId: row.stableId,
        name: row.name,
        aliases: [row.passiveName].filter((v): v is string => Boolean(v)),
        body: row.description ?? "",
      });
    for (const row of artifactSets)
      rows.push({
        kind: "artifact_set",
        stableId: row.stableId,
        name: row.name,
        aliases: [],
        body: row.twoPieceBonus ?? "",
      });
    for (const row of artifacts)
      rows.push({
        kind: "artifact",
        stableId: row.stableId,
        name: row.name,
        aliases: [],
        body: row.description ?? "",
      });
    for (const row of materials)
      rows.push({
        kind: "material",
        stableId: row.stableId,
        name: row.name,
        aliases: [],
        body: row.description ?? "",
      });
    for (const row of achievements)
      rows.push({
        kind: "achievement",
        stableId: row.stableId,
        name: row.name,
        aliases: [],
        body: row.requirement ?? "",
      });
    for (const row of enemies)
      rows.push({
        kind: "enemy",
        stableId: row.stableId,
        name: row.name,
        aliases: [row.family].filter((v): v is string => Boolean(v)),
        body: row.description ?? "",
      });
    for (const row of voices)
      rows.push({
        kind: "voice",
        stableId: row.stableId,
        name: row.title,
        aliases: [],
        body: row.body,
      });
    return rows;
  }

  async listEntityCandidates(gameId: string, revisionId: string) {
    void revisionId;
    const rows = await this.db
      .select()
      .from(entities)
      .where(and(eq(entities.gameId, gameId), eq(entities.deleted, false)));
    if (!rows.length) return [];
    const aliasRows = await this.db
      .select({ entityId: entityAliases.entityId, value: entityAliases.value })
      .from(entityAliases)
      .where(
        inArray(
          entityAliases.entityId,
          rows.map((row) => row.id),
        ),
      );
    const aliases = new Map<string, string[]>();
    for (const row of aliasRows) {
      const list = aliases.get(row.entityId) ?? [];
      list.push(row.value);
      aliases.set(row.entityId, list);
    }
    return rows.map((row) => ({
      id: row.id,
      entityType: row.type,
      canonicalName: row.canonicalName,
      normalized: row.normalizedName,
      aliases: aliases.get(row.id) ?? [],
    }));
  }

  async listDialogueHits(gameId: string, revisionId: string, query: string) {
    const like = "%" + escapeLike(query) + "%";
    const rows = await this.db
      .select({
        documentId: questDialogueNodes.documentId,
        nodeKey: questDialogueNodes.nodeKey,
        subquestKey: questDialogueNodes.subquestKey,
        questKey: questDialogueNodes.questKey,
        speaker: questDialogueNodes.speakerName,
        body: questDialogueNodes.body,
        documentTitle: documents.title,
        documentType: documents.type,
        locale: documents.locale,
      })
      .from(questDialogueNodes)
      .innerJoin(documents, eq(questDialogueNodes.documentId, documents.id))
      .where(
        and(
          eq(questDialogueNodes.revisionId, revisionId),
          eq(documents.gameId, gameId),
          eq(documents.deleted, false),
          sql`(${questDialogueNodes.body} ilike ${like} or ${questDialogueNodes.speakerName} ilike ${like})`,
        ),
      )
      .limit(60);
    return rows.map((row) => ({
      key: row.documentId + "/" + row.nodeKey,
      title: row.documentTitle,
      body: row.body,
      speaker: row.speaker,
      questTitle: row.documentTitle,
      questType: row.documentType,
      documentId: row.documentId,
      nodeKey: row.nodeKey,
      subquestKey: row.subquestKey,
      citation: {
        documentId: row.documentId,
        locale: row.locale,
        questKey: row.questKey,
        subquestKey: row.subquestKey ?? undefined,
        dialogueNodeKey: row.nodeKey,
        revision: revisionId,
      },
    }));
  }

  async listDocumentHits(gameId: string, revisionId: string, query: string) {
    const like = "%" + escapeLike(query) + "%";
    const documentRows = await this.db
      .select({
        id: documents.id,
        sourceKey: documents.sourceKey,
        title: documents.title,
        type: documents.type,
        locale: documents.locale,
        body: documents.body,
      })
      .from(documents)
      .where(
        and(
          eq(documents.gameId, gameId),
          eq(documents.revisionId, revisionId),
          eq(documents.deleted, false),
          sql`(${documents.body} ilike ${like} or ${documents.title} ilike ${like})`,
        ),
      )
      .limit(60);
    const segmentRows = await this.db
      .select({
        documentId: documentSegments.documentId,
        body: documentSegments.body,
        id: documents.id,
        sourceKey: documents.sourceKey,
        title: documents.title,
        type: documents.type,
        locale: documents.locale,
        documentBody: documents.body,
      })
      .from(documentSegments)
      .innerJoin(documents, eq(documentSegments.documentId, documents.id))
      .where(
        and(
          eq(documentSegments.revisionId, revisionId),
          eq(documents.gameId, gameId),
          eq(documents.deleted, false),
          sql`${documentSegments.body} ilike ${like}`,
        ),
      )
      .limit(60);
    const rowsByDocument = new Map<string, (typeof documentRows)[number]>();
    for (const row of documentRows) rowsByDocument.set(row.id, row);
    const segmentByDocument = new Map<string, (typeof segmentRows)[number]>();
    for (const row of segmentRows)
      if (!segmentByDocument.has(row.documentId)) segmentByDocument.set(row.documentId, row);
    const documentHits = documentRows.map((row) => ({
      key: row.id,
      document: {
        id: row.id,
        sourceKey: row.sourceKey,
        title: row.title,
        type: row.type as DocumentType,
        locale: row.locale,
      },
      body: segmentByDocument.get(row.id)?.body ?? row.body.slice(0, 1200),
      title: row.title,
    }));
    const segmentOnlyHits = [...segmentByDocument.values()]
      .filter((row) => !rowsByDocument.has(row.documentId))
      .map((row) => ({
        key: row.documentId,
        document: {
          id: row.id,
          sourceKey: row.sourceKey,
          title: row.title,
          type: row.type as DocumentType,
          locale: row.locale,
        },
        body: row.body,
        title: row.title,
      }));
    return [...documentHits, ...segmentOnlyHits];
  }
}
