import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import type {
  Capability,
  DocumentSummary,
  DocumentType,
  EntitySummary,
  EntityType,
  RelationshipPredicate,
  SearchRequest,
  SearchResult,
} from "@gip/contracts";
import type { GameSummary } from "@gip/contracts";
import {
  DomainError,
  type ArchiveHome,
  type ClaimView,
  type DocumentDetail,
  type EntityDetail,
  type GetQuestRequest,
  type NormalizedRecord,
  type QuestCompleteness,
  type QuestDialoguePage,
  type QuestRecordPayload,
  type QuestSearchHit,
  type QuestSearchRequest,
  type RelationshipView,
  type TextBinding,
  type TextBindingType,
  type VectorEntityHit,
  type VectorSearchHit,
} from "@gip/domain";
import type { Database } from "./client.js";
import {
  claimEntities,
  claims,
  datasetRevisions,
  documentSegments,
  documents,
  entities,
  entityMentions,
  evidence,
  gameCapabilities,
  games,
  genshinVoiceLines,
  questDialogueEdges,
  questDialogueNodes,
  questSubquests,
  relationships,
  sourceSnapshots,
  sources,
} from "./schema.js";
import { evidenceViews, getAliases } from "./repository-read-helpers.js";
import {
  asDocumentSummary,
  asEntitySummary,
  decodeQuestCursor,
  defaultLimit,
  encodeQuestCursor,
  escapeLike,
  lexicalScore,
  mainQuestIdFromKey,
  normalize,
  publicDocumentCondition,
  publicQuestCondition,
  questKeyFromInput,
  questMetadata,
  revisionLabel,
  safeProvenance,
  stableEntityId,
} from "./repository-utils.js";

export class RepositoryReadModels {
  constructor(private readonly db: Database) {}

  async listGames(): Promise<GameSummary[]> {
    const rows = await this.db.select().from(games).orderBy(asc(games.name));
    const revisions = await this.db
      .select()
      .from(datasetRevisions)
      .where(
        and(
          eq(datasetRevisions.isCurrent, true),
          eq(datasetRevisions.lifecycleStatus, "published"),
        ),
      );
    const revisionMap = new Map(
      revisions.map((revision) => [revision.gameId, revisionNumberLabel(revision.revisionNumber)]),
    );
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      currentRevision: revisionMap.get(row.id),
    }));
  }

  async getGame(gameId: string): Promise<GameSummary | null> {
    const rows = await this.db.select().from(games).where(eq(games.id, gameId)).limit(1);
    const row = rows[0];
    if (!row) return null;
    const revision = await this.getCurrentRevision(gameId);
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      currentRevision: revision ? revisionLabel(revision.revisionNumber) : undefined,
    };
  }

  async getGameBySlug(slug: string): Promise<GameSummary | null> {
    const rows = await this.db.select().from(games).where(eq(games.slug, slug)).limit(1);
    const row = rows[0];
    return row ? this.getGame(row.id) : null;
  }

  async getCapabilities(gameId: string) {
    const rows = await this.db
      .select()
      .from(gameCapabilities)
      .where(eq(gameCapabilities.gameId, gameId));
    return rows.map((row) => ({ capability: row.capability as Capability, enabled: row.enabled }));
  }

  async getArchiveHome(
    gameId: string,
    options: { locale?: string; revisionId?: string; limit?: number } = {},
  ): Promise<ArchiveHome> {
    const current = await this.getCurrentRevision(gameId);
    if (!current)
      return {
        gameId,
        revision: "",
        locale: options.locale ?? "zh-CN",
        categories: [],
        latestRevision: undefined,
        latestRevisionId: undefined,
      };
    const revision = options.revisionId
      ? await this.getRevision(options.revisionId, gameId)
      : await this.getSearchableRevision(gameId, current);
    if (!revision)
      return {
        gameId,
        revision: "",
        locale: options.locale ?? "zh-CN",
        categories: [],
        latestRevision: revisionLabel(current.revisionNumber),
        latestRevisionId: current.id,
      };
    const locale = options.locale ?? "zh-CN";
    const limit = Math.min(Math.max(options.limit ?? 6, 1), 12);
    const entityCategory = async (
      id: string,
      label: string,
      description: string,
      types: EntityType[],
    ) => {
      if (options.revisionId) {
        const candidates = new Map(
          (await this.getRevisionRecords(revision)).flatMap((record) =>
            (record.entities ?? []).map((candidate) => [candidate.sourceKey, candidate]),
          ),
        );
        const filtered = [...candidates.values()]
          .filter((candidate) => types.includes(candidate.type))
          .filter(
            (candidate) =>
              !["???", "？？？", "NPC ???"].includes(candidate.name) &&
              !/^NPC \d+$/i.test(candidate.name),
          )
          .sort((left, right) => left.name.localeCompare(right.name));
        return {
          id,
          label,
          description,
          count: filtered.length,
          entries: filtered.slice(0, limit).map((candidate) => ({
            id: stableEntityId(gameId, candidate.sourceKey),
            name: candidate.name,
            kind: "entity" as const,
            type: candidate.type,
          })),
        };
      }
      const conditions = [
        eq(entities.gameId, gameId),
        eq(entities.deleted, false),
        inArray(entities.type, types),
        sql`${entities.canonicalName} not in ('???', '？？？', 'NPC ???')`,
        sql`${entities.canonicalName} !~* '^NPC [0-9]+$'`,
      ];
      const [countRows, rows] = await Promise.all([
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(entities)
          .where(and(...conditions)),
        this.db
          .select({ id: entities.id, name: entities.canonicalName, type: entities.type })
          .from(entities)
          .where(and(...conditions))
          .orderBy(asc(entities.canonicalName))
          .limit(limit),
      ]);
      return {
        id,
        label,
        description,
        count: Number(countRows[0]?.count ?? 0),
        entries: rows.map((row) => ({
          id: row.id,
          name: row.name,
          kind: "entity" as const,
          type: row.type,
        })),
      };
    };
    const documentCategory = async (
      id: string,
      label: string,
      description: string,
      types: DocumentType[],
    ) => {
      const conditions = [
        eq(documents.gameId, gameId),
        eq(documents.revisionId, revision.id),
        eq(documents.deleted, false),
        eq(documents.locale, locale),
        publicDocumentCondition(),
        inArray(documents.type, types),
      ];
      const [countRows, rows] = await Promise.all([
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(documents)
          .where(and(...conditions)),
        this.db
          .select({
            id: documents.id,
            name: documents.title,
            type: documents.type,
            locale: documents.locale,
          })
          .from(documents)
          .where(and(...conditions))
          .orderBy(asc(documents.title))
          .limit(limit),
      ]);
      return {
        id,
        label,
        description,
        count: Number(countRows[0]?.count ?? 0),
        entries: rows.map((row) => ({
          id: row.id,
          name: row.name,
          kind: "document" as const,
          type: row.type,
          locale: row.locale,
        })),
      };
    };
    const dialogueCategory = async () => {
      const conditions = [
        eq(questDialogueNodes.revisionId, revision.id),
        eq(questDialogueNodes.documentId, documents.id),
        eq(documents.gameId, gameId),
        eq(documents.revisionId, revision.id),
        eq(documents.deleted, false),
        eq(documents.locale, locale),
        publicDocumentCondition(),
        publicQuestCondition(),
      ];
      const [countRows, rows] = await Promise.all([
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(questDialogueNodes)
          .innerJoin(documents, eq(questDialogueNodes.documentId, documents.id))
          .where(and(...conditions)),
        this.db
          .select({
            id: questDialogueNodes.nodeKey,
            documentId: questDialogueNodes.documentId,
            name: documents.title,
            speakerName: questDialogueNodes.speakerName,
            type: questDialogueNodes.nodeType,
            locale: documents.locale,
          })
          .from(questDialogueNodes)
          .innerJoin(documents, eq(questDialogueNodes.documentId, documents.id))
          .where(and(...conditions))
          .orderBy(asc(documents.title), asc(questDialogueNodes.ordinal))
          .limit(limit),
      ]);
      return {
        id: "dialogue",
        label: "对话节点",
        description: "任务对话、旁白、选项与分支关系",
        count: Number(countRows[0]?.count ?? 0),
        entries: rows.map((row) => ({
          id: row.id,
          documentId: row.documentId,
          anchorId: row.id,
          name: row.speakerName ? `${row.name} · ${row.speakerName}` : row.name,
          kind: "document" as const,
          type: row.type === "player_choice" ? "player_choice" : "dialogue",
          locale: row.locale,
        })),
      };
    };
    const voiceCategory = async () => {
      const conditions = [
        eq(genshinVoiceLines.gameId, gameId),
        eq(genshinVoiceLines.revisionId, revision.id),
        eq(genshinVoiceLines.locale, locale),
        sql`${genshinVoiceLines.title} <> ''`,
      ];
      const [countRows, rows] = await Promise.all([
        this.db
          .select({ count: sql<number>`count(*)::int` })
          .from(genshinVoiceLines)
          .where(and(...conditions)),
        this.db
          .select({
            id: genshinVoiceLines.id,
            name: genshinVoiceLines.title,
            type: sql<string>`'voice'`,
            locale: genshinVoiceLines.locale,
          })
          .from(genshinVoiceLines)
          .where(and(...conditions))
          .orderBy(asc(genshinVoiceLines.title), asc(genshinVoiceLines.stableId))
          .limit(limit),
      ]);
      return {
        id: "voices",
        label: "角色语音",
        description: "角色语音文本与对应的游戏版本",
        count: Number(countRows[0]?.count ?? 0),
        entries: rows.map((row) => ({
          id: row.id,
          name: row.name,
          kind: "document" as const,
          type: row.type,
          locale: row.locale,
        })),
      };
    };
    const [
      characters,
      quests,
      dialogue,
      items,
      books,
      voices,
      characterStories,
      regions,
      factions,
    ] = await Promise.all([
      entityCategory("characters", "角色", "人物、别名与关系", ["character"]),
      documentCategory("quests", "任务剧情", "魔神、传说、世界与活动任务", [
        "archon_quest",
        "story_quest",
        "world_quest",
        "event_quest",
        "commission",
        "hangout",
        "other",
      ]),
      dialogueCategory(),
      entityCategory("items", "物品图鉴", "物品实体与描述", ["item"]),
      documentCategory("books", "书籍与设定", "书籍、世界设定与背景资料", ["book", "lore"]),
      voiceCategory(),
      documentCategory("character-stories", "角色故事", "角色档案、故事与解锁文本", [
        "character_story",
      ]),
      entityCategory("regions", "地区与地点", "国家、区域与场景", ["region", "location"]),
      entityCategory("factions", "阵营与 NPC", "组织、势力与非玩家角色", ["faction", "npc"]),
    ]);
    return {
      gameId,
      revision: revisionLabel(revision.revisionNumber),
      locale,
      revisionId: revision.id,
      latestRevision: revisionLabel(current.revisionNumber),
      latestRevisionId: current.id,
      categories: [
        characters,
        quests,
        dialogue,
        books,
        characterStories,
        voices,
        items,
        regions,
        factions,
      ],
    };
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
    if (options.revisionId) {
      const revision = await this.getRevision(options.revisionId, gameId);
      if (!revision) return [];
      const records = await this.getRevisionRecords(revision);
      const candidates = new Map(
        records.flatMap((record) =>
          (record.entities ?? []).map((candidate) => [candidate.sourceKey, candidate]),
        ),
      );
      const rows = await this.db.select().from(entities).where(eq(entities.gameId, gameId));
      const query = options.query ? normalize(options.query) : undefined;
      return rows
        .flatMap((row) => {
          const candidate = row.sourceKey ? candidates.get(row.sourceKey) : undefined;
          if (!candidate || (options.type && candidate.type !== options.type)) return [];
          const values = [candidate.name, ...(candidate.aliases ?? []).map((alias) => alias.value)];
          if (query && !values.some((value) => normalize(value).includes(query))) return [];
          return [
            {
              id: row.id,
              sourceKey: row.sourceKey,
              name: candidate.name,
              type: candidate.type,
              summary: candidate.summary ?? null,
              aliases: (candidate.aliases ?? []).map((alias) => alias.value),
              revision: revisionLabel(revision.revisionNumber),
            },
          ];
        })
        .slice(options.offset, options.offset + options.limit);
    }
    const current = await this.getCurrentRevision(gameId);
    if (current) {
      if (current.isCurrent && current.normalizedRecords !== null) {
        const rows = await this.db
          .select()
          .from(entities)
          .where(
            and(
              eq(entities.gameId, gameId),
              eq(entities.deleted, false),
              eq(entities.lastRevisionId, current.id),
            ),
          )
          .orderBy(asc(entities.canonicalName))
          .limit(Math.max(options.limit * 4, 40));
        const aliases = await getAliases(
          this.db,
          rows.map((row) => row.id),
          current.id,
        );
        const query = options.query ? normalize(options.query) : undefined;
        return rows
          .filter((row) => {
            if (options.type && row.type !== options.type) return false;
            const values = [row.canonicalName, ...(aliases.get(row.id) ?? [])];
            return !query || values.some((value) => normalize(value).includes(query));
          })
          .map((row) => ({ ...asEntitySummary(row), aliases: aliases.get(row.id) ?? [] }))
          .slice(options.offset, options.offset + options.limit);
      }
      const enforceSnapshotMembership =
        current.lifecycleStatus === "preview" || current.normalizedRecords !== null;
      const candidates = new Map(
        (await this.getRevisionRecords(current)).flatMap((record) =>
          (record.entities ?? []).map((candidate) => [candidate.sourceKey, candidate]),
        ),
      );
      const rows = await this.db.select().from(entities).where(eq(entities.gameId, gameId));
      const aliases = await getAliases(
        this.db,
        rows.map((row) => row.id),
        current.id,
      );
      const query = options.query ? normalize(options.query) : undefined;
      return rows
        .flatMap((row) => {
          const candidate = row.sourceKey ? candidates.get(row.sourceKey) : undefined;
          if (!candidate && (enforceSnapshotMembership || row.deleted)) return [];
          const type = candidate?.type ?? (row.type as EntityType);
          const name = candidate?.name ?? row.canonicalName;
          const summary = candidate?.summary ?? row.summary;
          const rowAliases = candidate
            ? (candidate.aliases ?? []).map((alias) => alias.value)
            : (aliases.get(row.id) ?? []);
          if (options.type && type !== options.type) return [];
          if (query && ![name, ...rowAliases].some((value) => normalize(value).includes(query)))
            return [];
          return [
            {
              id: row.id,
              sourceKey: row.sourceKey,
              name,
              type,
              summary,
              aliases: rowAliases,
              revision: revisionLabel(current.revisionNumber),
            },
          ];
        })
        .slice(options.offset, options.offset + options.limit);
    }
    const rows = await this.db
      .select()
      .from(entities)
      .where(and(eq(entities.gameId, gameId), eq(entities.deleted, false)))
      .limit(options.limit)
      .offset(options.offset);
    return rows.map((row) => asEntitySummary(row));
  }

  async getEntity(
    gameId: string,
    entityId: string,
    revisionId?: string,
  ): Promise<EntityDetail | null> {
    const rows = await this.db
      .select()
      .from(entities)
      .where(and(eq(entities.gameId, gameId), eq(entities.id, entityId)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const revision = revisionId
      ? await this.getRevision(revisionId, gameId)
      : await this.getCurrentRevision(gameId);
    if (!revision) return null;
    const revisionCandidate = (await this.getRevisionRecords(revision))
      .flatMap((record) => record.entities ?? [])
      .find((candidate) => candidate.sourceKey === row.sourceKey);
    const enforceSnapshotMembership =
      revision.lifecycleStatus === "preview" || revision.normalizedRecords !== null;
    if (!revisionCandidate && (enforceSnapshotMembership || row.deleted)) return null;
    const aliases = await getAliases(this.db, [row.id], revision.id);
    const entitySummary = revisionCandidate
      ? {
          id: row.id,
          sourceKey: row.sourceKey,
          name: revisionCandidate.name,
          type: revisionCandidate.type,
          summary: revisionCandidate.summary ?? null,
          aliases: (revisionCandidate.aliases ?? []).map((alias) => alias.value),
        }
      : asEntitySummary(row, aliases.get(row.id) ?? []);
    const relationRows = await this.db
      .select()
      .from(relationships)
      .where(
        and(
          eq(relationships.gameId, gameId),
          revision ? eq(relationships.revisionId, revision.id) : sql`false`,
          or(eq(relationships.subjectId, entityId), eq(relationships.objectId, entityId)),
        ),
      );
    const relatedIds = [
      ...new Set(relationRows.flatMap((item) => [item.subjectId, item.objectId])),
    ];
    const relatedRows = relatedIds.length
      ? await this.db.select().from(entities).where(inArray(entities.id, relatedIds))
      : [];
    const revisionCandidates = new Map(
      (await this.getRevisionRecords(revision)).flatMap((record) =>
        (record.entities ?? []).map((candidate) => [candidate.sourceKey, candidate.name]),
      ),
    );
    const names = new Map(
      relatedRows.map((item) => [
        item.id,
        (item.sourceKey && revisionCandidates.get(item.sourceKey)) || item.canonicalName,
      ]),
    );
    const relationViews = relationRows.map((item) => ({
      id: item.id,
      subjectId: item.subjectId,
      subjectName: names.get(item.subjectId) ?? item.subjectId,
      predicate: item.predicate as RelationshipPredicate,
      objectId: item.objectId,
      objectName: names.get(item.objectId) ?? item.objectId,
      confidence: item.confidence,
      revision: revision ? revisionLabel(revision.revisionNumber) : undefined,
    }));
    const docs = await this.getEntityDocuments(gameId, entityId, 20, revision?.id);
    const linkedClaims = await this.db
      .select({ claimId: claimEntities.claimId })
      .from(claimEntities)
      .where(eq(claimEntities.entityId, entityId));
    const claimRows = linkedClaims.length
      ? await this.db
          .select()
          .from(claims)
          .where(
            and(
              eq(claims.gameId, gameId),
              revision ? eq(claims.revisionId, revision.id) : sql`false`,
              inArray(
                claims.id,
                linkedClaims.map((item) => item.claimId),
              ),
            ),
          )
      : [];
    const claimViews: ClaimView[] = [];
    for (const claim of claimRows) {
      const claimEvidence = await this.db
        .select()
        .from(evidence)
        .where(eq(evidence.claimId, claim.id));
      const claimEvidenceViews = await evidenceViews(this.db, claimEvidence);
      if (claimEvidenceViews.some((item) => item.documentTitle))
        claimViews.push({
          id: claim.id,
          statement: claim.normalizedStatement,
          status: claim.status as ClaimView["status"],
          confidence: claim.confidence,
          evidence: claimEvidenceViews,
        });
    }
    return {
      ...entitySummary,
      gameId: row.gameId,
      properties: revisionCandidate?.properties ?? row.properties,
      deleted: revisionCandidate ? false : row.deleted,
      sourceKey: row.sourceKey,
      relationships: relationViews,
      documents: docs,
      claims: claimViews,
      revision: revision ? revisionLabel(revision.revisionNumber) : undefined,
    };
  }

  async getRelationships(
    gameId: string,
    entityId: string,
    options: { predicate?: RelationshipPredicate; limit: number; revisionId?: string },
  ): Promise<RelationshipView[]> {
    const revision = options.revisionId
      ? await this.getRevision(options.revisionId, gameId)
      : await this.getCurrentRevision(gameId);
    if (!revision) return [];
    const conditions = [
      eq(relationships.gameId, gameId),
      eq(relationships.revisionId, revision.id),
      or(eq(relationships.subjectId, entityId), eq(relationships.objectId, entityId)),
    ];
    if (options.predicate) conditions.push(eq(relationships.predicate, options.predicate));
    const rows = await this.db
      .select()
      .from(relationships)
      .where(and(...conditions))
      .limit(options.limit);
    const ids = [...new Set(rows.flatMap((item) => [item.subjectId, item.objectId]))];
    const related = ids.length
      ? await this.db.select().from(entities).where(inArray(entities.id, ids))
      : [];
    const revisionCandidates = new Map(
      (await this.getRevisionRecords(revision)).flatMap((record) =>
        (record.entities ?? []).map((candidate) => [candidate.sourceKey, candidate.name]),
      ),
    );
    const names = new Map(
      related.map((item) => [
        item.id,
        (item.sourceKey && revisionCandidates.get(item.sourceKey)) || item.canonicalName,
      ]),
    );
    return rows.map((item) => ({
      id: item.id,
      subjectId: item.subjectId,
      subjectName: names.get(item.subjectId) ?? item.subjectId,
      predicate: item.predicate as RelationshipPredicate,
      objectId: item.objectId,
      objectName: names.get(item.objectId) ?? item.objectId,
      confidence: item.confidence,
      revision: revisionLabel(revision.revisionNumber),
    }));
  }

  async getEntityDocuments(
    gameId: string,
    entityId: string,
    limit: number,
    revisionId?: string,
  ): Promise<DocumentSummary[]> {
    const revision = revisionId
      ? await this.getRevision(revisionId, gameId)
      : await this.getCurrentRevision(gameId);
    if (!revision) return [];
    const rows = await this.db
      .select({ document: documents, sourceSnapshot: sourceSnapshots })
      .from(entityMentions)
      .innerJoin(documentSegments, eq(entityMentions.segmentId, documentSegments.id))
      .innerJoin(documents, eq(documentSegments.documentId, documents.id))
      .innerJoin(sourceSnapshots, eq(documents.sourceSnapshotId, sourceSnapshots.id))
      .where(
        and(
          eq(entityMentions.entityId, entityId),
          eq(documents.gameId, gameId),
          eq(documents.revisionId, revision.id),
          eq(documents.deleted, false),
          publicDocumentCondition(),
        ),
      )
      .limit(limit);
    const seen = new Set<string>();
    return rows
      .filter((row) => !seen.has(row.document.id) && seen.add(row.document.id))
      .map((row) => ({
        ...asDocumentSummary(row.document, row.sourceSnapshot.contentHash),
        revision: revisionLabel(revision.revisionNumber),
      }));
  }

  async getEntityTextBindings(
    revisionId: string,
    entityStableId: string,
    bindingType?: TextBindingType,
  ): Promise<TextBinding[]> {
    const bindingTypeCondition = bindingType ? sql`and tb.binding_type = ${bindingType}` : sql``;
    const result = await this.db.execute(sql`
      select tb.id,
             tb.game_id,
             tb.revision_id,
             tb.entity_type,
             tb.entity_stable_id,
             tb.document_id,
             tb.segment_id,
             tb.binding_type,
             tb.confidence,
             tb.binding_source,
             tb.metadata,
             tb.created_at,
             d.title as document_title,
             d.type as document_type,
             d.locale as document_locale,
             left(coalesce(ds.body, d.body), 600) as excerpt
      from knowledge.text_bindings tb
      inner join knowledge.documents d
        on d.id = tb.document_id
       and d.revision_id = tb.revision_id
       and d.deleted = false
      left join knowledge.document_segments ds
        on ds.id = tb.segment_id
       and ds.revision_id = tb.revision_id
      where tb.revision_id = ${revisionId}::uuid
        and tb.entity_stable_id = ${entityStableId}
        ${bindingTypeCondition}
      order by tb.created_at asc, tb.id asc
    `);
    return textBindingRows(result).map(mapTextBinding);
  }

  async getBindingEntities(
    revisionId: string,
    documentId: string,
    segmentId?: string,
  ): Promise<TextBinding[]> {
    const segmentCondition = segmentId ? sql`and segment_id = ${segmentId}::uuid` : sql``;
    const result = await this.db.execute(sql`
      select id,
             game_id,
             revision_id,
             entity_type,
             entity_stable_id,
             document_id,
             segment_id,
             binding_type,
             confidence,
             binding_source,
             metadata,
             created_at
      from knowledge.text_bindings
      where revision_id = ${revisionId}::uuid
        and document_id = ${documentId}::uuid
        ${segmentCondition}
      order by entity_type asc, entity_stable_id asc, created_at asc, id asc
    `);
    return textBindingRows(result).map(mapTextBinding);
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
    const revision = options.revisionId
      ? await this.getRevisionMeta(options.revisionId, gameId)
      : await this.getCurrentRevision(gameId);
    if (!revision) return [];
    const conditions = [
      eq(documents.gameId, gameId),
      eq(documents.revisionId, revision.id),
      eq(documents.deleted, false),
      publicDocumentCondition(),
    ];
    if (options.type) conditions.push(eq(documents.type, options.type));
    if (options.locale) conditions.push(eq(documents.locale, options.locale));
    if (options.query)
      conditions.push(
        or(
          ilike(documents.normalizedTitle, `%${normalize(options.query)}%`),
          ilike(documents.title, `%${options.query}%`),
        ) ?? sql`false`,
      );
    const rows = await this.db
      .select({ document: documents, sourceSnapshot: sourceSnapshots })
      .from(documents)
      .innerJoin(sourceSnapshots, eq(documents.sourceSnapshotId, sourceSnapshots.id))
      .where(and(...conditions))
      .orderBy(asc(documents.title))
      .limit(options.limit)
      .offset(options.offset);
    return rows.map((row) => ({
      ...asDocumentSummary(row.document, row.sourceSnapshot.contentHash),
      revision: revisionLabel(revision.revisionNumber),
    }));
  }

  async getDocument(
    gameId: string,
    documentId: string,
    revisionId?: string,
  ): Promise<DocumentDetail | null> {
    const revision = revisionId
      ? await this.getRevision(revisionId, gameId)
      : await this.getCurrentRevision(gameId);
    if (!revision) return null;
    const rows = await this.db
      .select({
        id: documents.id,
        gameId: documents.gameId,
        sourceKey: documents.sourceKey,
        type: documents.type,
        title: documents.title,
        normalizedTitle: documents.normalizedTitle,
        gameVersion: documents.gameVersion,
        locale: documents.locale,
        sourceSnapshotId: documents.sourceSnapshotId,
        body: documents.body,
        searchVector: documents.searchVector,
        metadata: documents.metadata,
        revisionId: documents.revisionId,
        deleted: documents.deleted,
        createdAt: documents.createdAt,
      })
      .from(documents)
      .where(
        and(
          eq(documents.gameId, gameId),
          eq(documents.id, documentId),
          eq(documents.revisionId, revision.id),
          eq(documents.deleted, false),
          publicDocumentCondition(),
        ),
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const sourceRows = await this.db
      .select()
      .from(sources)
      .innerJoin(sourceSnapshots, eq(sourceSnapshots.sourceId, sources.id))
      .where(eq(sourceSnapshots.id, row.sourceSnapshotId))
      .limit(1);
    const source = sourceRows[0]?.sources;
    const sourceSnapshot = sourceRows[0]?.source_snapshots;
    const segmentRows = await this.db
      .select({
        id: documentSegments.id,
        documentId: documentSegments.documentId,
        revisionId: documentSegments.revisionId,
        ordinal: documentSegments.ordinal,
        headingPath: documentSegments.headingPath,
        body: documentSegments.body,
        startOffset: documentSegments.startOffset,
        endOffset: documentSegments.endOffset,
      })
      .from(documentSegments)
      .where(
        and(eq(documentSegments.documentId, row.id), eq(documentSegments.revisionId, revision.id)),
      )
      .orderBy(asc(documentSegments.ordinal));
    const mentionRows = segmentRows.length
      ? await this.db
          .select({ mention: entityMentions, entity: entities })
          .from(entityMentions)
          .innerJoin(entities, eq(entityMentions.entityId, entities.id))
          .where(
            inArray(
              entityMentions.segmentId,
              segmentRows.map((segment) => segment.id),
            ),
          )
      : [];
    // PERF: resolve display names only for entities actually mentioned in this document
    // (was: full game-wide entity scan per getDocument call).
    const mentionedSourceKeys = [
      ...new Set(
        mentionRows.flatMap((row) => (row.entity.sourceKey ? [row.entity.sourceKey] : [])),
      ),
    ];
    const revisionEntityNames =
      mentionedSourceKeys.length === 0
        ? new Map<string, string>()
        : revision.isCurrent
          ? new Map(
              (
                await this.db
                  .select({ sourceKey: entities.sourceKey, name: entities.canonicalName })
                  .from(entities)
                  .where(
                    and(
                      eq(entities.gameId, gameId),
                      eq(entities.deleted, false),
                      inArray(entities.sourceKey, mentionedSourceKeys),
                    ),
                  )
              ).flatMap((candidate) =>
                candidate.sourceKey ? [[candidate.sourceKey, candidate.name] as const] : [],
              ),
            )
          : new Map(
              (await this.getRevisionRecords(revision)).flatMap((record) =>
                (record.entities ?? []).map((candidate) => [candidate.sourceKey, candidate.name]),
              ),
            );
    const mentionsBySegment = new Map<string, typeof mentionRows>();
    for (const row of mentionRows)
      mentionsBySegment.set(row.mention.segmentId, [
        ...(mentionsBySegment.get(row.mention.segmentId) ?? []),
        row,
      ]);
    const segments = segmentRows.map((segment) => {
      const segmentMentions = mentionsBySegment.get(segment.id) ?? [];
      return {
        id: segment.id,
        ordinal: segment.ordinal,
        headingPath: segment.headingPath,
        body: segment.body,
        startOffset: segment.startOffset,
        endOffset: segment.endOffset,
        mentions: segmentMentions.map((item) => ({
          entityId: item.mention.entityId,
          name:
            (item.entity.sourceKey && revisionEntityNames.get(item.entity.sourceKey)) ||
            item.entity.canonicalName,
          startOffset: item.mention.startOffset,
          endOffset: item.mention.endOffset,
        })),
      };
    });
    return {
      ...asDocumentSummary(row, sourceSnapshot?.contentHash),
      revision: revisionLabel(revision.revisionNumber),
      body: row.body,
      sourceName: source?.name ?? "unknown",
      sourceId: source?.id ?? "",
      provenance: {
        ...safeProvenance(row.metadata, row.sourceKey),
        datasetRevision: revisionLabel(revision.revisionNumber),
        sourceSnapshotId: sourceSnapshot?.id ?? row.sourceSnapshotId,
      },
      segments,
    };
  }

  async readDocumentSection(request: {
    gameId: string;
    revisionId: string;
    documentId: string;
    segmentId?: string;
    section?: string;
    maxChars: number;
  }): Promise<import("@gip/domain").SectionReadResult | null> {
    const revision = await this.getRevisionMeta(request.revisionId, request.gameId);
    if (!revision) return null;
    const maxChars = Math.min(Math.max(request.maxChars, 100), 8000);
    const heading = request.section ? normalize(request.section) : "";
    const segmentFilter = request.segmentId
      ? sql`and ds.id = ${request.segmentId}::uuid`
      : heading
        ? sql`and (
            ds.heading_key = ${heading}
            or ds.heading_key like ${`${escapeLike(heading)}%`} escape '\\'
            or lower(ds.heading_path::text) like ${`%${escapeLike(heading)}%`} escape '\\'
          )`
        : sql``;
    if (request.segmentId || heading) {
      const rows = await this.db.execute(sql`
        select d.id as document_id,
               d.title,
               d.locale,
               ds.id as segment_id,
               ds.heading_path,
               left(ds.body, ${maxChars + 1}) as body
        from knowledge.document_segments ds
        inner join knowledge.documents d on d.id = ds.document_id
        where d.game_id = ${request.gameId}::uuid
          and d.revision_id = ${revision.id}::uuid
          and d.id = ${request.documentId}::uuid
          and d.deleted = false
          ${segmentFilter}
        order by ds.ordinal asc
        limit 1
      `);
      const row = textReadRows(rows)[0];
      if (!row) return null;
      const body = row.body.length > maxChars ? row.body.slice(0, maxChars) : row.body;
      return {
        documentId: row.document_id,
        title: row.title,
        locale: row.locale ?? "",
        revision: revisionLabel(revision.revisionNumber),
        headingPath: row.heading_path,
        body,
        truncated: row.body.length > maxChars,
        citations: [
          {
            documentId: row.document_id,
            locale: row.locale ?? "",
            segmentId: row.segment_id ?? undefined,
            revision: revisionLabel(revision.revisionNumber),
          },
        ],
      };
    }
    const rows = await this.db.execute(sql`
      select d.id as document_id,
             d.title,
             d.locale,
             left(d.body, ${maxChars + 1}) as body
      from knowledge.documents d
      where d.game_id = ${request.gameId}::uuid
        and d.revision_id = ${revision.id}::uuid
        and d.id = ${request.documentId}::uuid
        and d.deleted = false
      limit 1
    `);
    const row = textReadRows(rows)[0];
    if (!row) return null;
    const body = row.body.length > maxChars ? row.body.slice(0, maxChars) : row.body;
    return {
      documentId: row.document_id,
      title: row.title,
      locale: row.locale ?? "",
      revision: revisionLabel(revision.revisionNumber),
      headingPath: [],
      body,
      truncated: row.body.length > maxChars,
      citations: [
        {
          documentId: row.document_id,
          locale: row.locale ?? "",
          revision: revisionLabel(revision.revisionNumber),
        },
      ],
    };
  }

  async search(gameId: string, request: SearchRequest): Promise<SearchResult> {
    const current = await this.getCurrentRevision(gameId);
    if (!current)
      return {
        entities: [],
        documents: [],
        segments: [],
        revision: "",
        indexStatus: "not_ready",
        debug: request.debug ? { reason: "no_revision" } : undefined,
      };
    const searchable = request.revisionId
      ? await this.getRevision(request.revisionId, gameId)
      : await this.getSearchableRevision(gameId, current);
    if (!searchable)
      return {
        entities: [],
        documents: [],
        segments: [],
        revision: "",
        indexStatus: current.indexStatus,
        debug: request.debug ? { reason: "index_not_ready" } : undefined,
      };
    const result: SearchResult = {
      entities: [],
      documents: [],
      segments: [],
      revision: revisionLabel(searchable.revisionNumber),
      revisionId: searchable.id,
      indexStatus: current.indexStatus,
    };
    const limit = request.limit ?? defaultLimit;
    const types = request.types ?? ["entity", "document", "segment"];
    const query = normalize(request.query);

    if (types.includes("entity")) {
      result.entities = await this.searchEntitiesAtRevision(gameId, request, searchable);
    }

    if (types.includes("document") || types.includes("segment")) {
      const documentConditions = [
        eq(documents.gameId, gameId),
        eq(documents.revisionId, searchable.id),
        eq(documents.deleted, false),
        publicDocumentCondition(),
        or(
          sql`${documents.searchVector} @@ websearch_to_tsquery('simple', ${request.query})`,
          sql`${documents.normalizedTitle} % ${query}`,
        ),
      ];
      if (request.documentTypes?.length)
        documentConditions.push(inArray(documents.type, request.documentTypes));
      if (request.gameVersions?.length)
        documentConditions.push(inArray(documents.gameVersion, request.gameVersions));
      if (request.locales?.length)
        documentConditions.push(inArray(documents.locale, request.locales));
      if (request.sourceId)
        documentConditions.push(
          sql`${documents.sourceSnapshotId} in (select id from knowledge.source_snapshots where source_id = ${request.sourceId}::uuid)`,
        );
      const docRows = await this.db
        .select({ document: documents, sourceSnapshot: sourceSnapshots })
        .from(documents)
        .innerJoin(sourceSnapshots, eq(documents.sourceSnapshotId, sourceSnapshots.id))
        .where(and(...documentConditions))
        .limit(Math.max(limit * 4, 40));
      result.documents = docRows
        .map(({ document: row, sourceSnapshot }) => {
          const match = lexicalScore(request.query, `${row.title} ${row.body}`);
          return {
            ...asDocumentSummary(row, sourceSnapshot.contentHash),
            score: match.score,
            match: `document_${match.match}`,
            revision: revisionLabel(searchable.revisionNumber),
          };
        })
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, limit);
      if (types.includes("segment")) {
        const segmentConditions = [
          eq(documentSegments.revisionId, searchable.id),
          eq(documents.gameId, gameId),
          eq(documents.deleted, false),
          publicDocumentCondition(),
          or(
            sql`${documentSegments.searchVector} @@ websearch_to_tsquery('simple', ${request.query})`,
          ),
        ];
        if (request.documentTypes?.length)
          segmentConditions.push(inArray(documents.type, request.documentTypes));
        if (request.gameVersions?.length)
          segmentConditions.push(inArray(documents.gameVersion, request.gameVersions));
        if (request.locales?.length)
          segmentConditions.push(inArray(documents.locale, request.locales));
        if (request.sourceId)
          segmentConditions.push(
            sql`${documents.sourceSnapshotId} in (select id from knowledge.source_snapshots where source_id = ${request.sourceId}::uuid)`,
          );
        const segmentRows = await this.db
          .select({
            segment: documentSegments,
            document: documents,
            sourceSnapshot: sourceSnapshots,
          })
          .from(documentSegments)
          .innerJoin(documents, eq(documentSegments.documentId, documents.id))
          .innerJoin(sourceSnapshots, eq(documents.sourceSnapshotId, sourceSnapshots.id))
          .where(and(...segmentConditions))
          .limit(limit);
        result.segments = segmentRows
          .map((item) => {
            const match = lexicalScore(request.query, item.segment.body);
            return {
              ...asDocumentSummary(item.document, item.sourceSnapshot.contentHash),
              segmentId: item.segment.id,
              snippet: item.segment.body.slice(0, 300),
              score: match.score,
              match: `segment_${match.match}`,
              revision: revisionLabel(searchable.revisionNumber),
            };
          })
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
      }
    }
    if (request.debug)
      result.debug = {
        lexical: true,
        vector: false,
        currentRevision: revisionLabel(current.revisionNumber),
        searchedRevision: revisionLabel(searchable.revisionNumber),
      };
    return result;
  }

  async searchQuests(gameId: string, request: QuestSearchRequest): Promise<QuestSearchHit[]> {
    const revision = request.revisionId
      ? await this.getRevisionMeta(request.revisionId, gameId)
      : await (async () => {
          const current = await this.getCurrentRevision(gameId);
          return current ? this.getSearchableRevision(gameId, current) : null;
        })();
    if (!revision) return [];
    const normalizedQuery = normalize(request.query);
    const prefix = `${escapeLike(normalizedQuery)}%`;
    const contains = `%${escapeLike(normalizedQuery)}%`;
    const questTypes = request.questTypes?.length
      ? request.questTypes
      : ([
          "archon_quest",
          "story_quest",
          "world_quest",
          "event_quest",
          "commission",
          "hangout",
          "other",
        ] as const);
    const baseConditions = [
      eq(documents.gameId, gameId),
      eq(documents.revisionId, revision.id),
      eq(documents.deleted, false),
      inArray(documents.type, [...questTypes]),
    ];
    if (request.publicOnly !== false) baseConditions.push(publicQuestCondition());
    if (request.locale) baseConditions.push(eq(documents.locale, request.locale));
    if (request.gameVersion) baseConditions.push(eq(documents.gameVersion, request.gameVersion));
    const titleRows = await this.db
      .select()
      .from(documents)
      .where(
        and(
          ...baseConditions,
          or(
            eq(documents.normalizedTitle, normalizedQuery),
            sql`${documents.normalizedTitle} like ${prefix} escape '\\'`,
            sql`${documents.normalizedTitle} like ${contains} escape '\\'`,
            sql`${documents.normalizedTitle} % ${normalizedQuery}`,
            ilike(documents.sourceKey, `%${request.query}%`),
          ),
        ),
      )
      .orderBy(asc(documents.title))
      .limit(request.limit);
    const rows =
      titleRows.length > 0
        ? titleRows
        : await this.db
            .select()
            .from(documents)
            .where(
              and(
                ...baseConditions,
                or(
                  sql`${documents.searchVector} @@ websearch_to_tsquery('simple', ${request.query})`,
                  sql`${documents.normalizedTitle} % ${normalizedQuery}`,
                ),
              ),
            )
            .orderBy(asc(documents.title))
            .limit(request.limit);
    return rows.map((row) => {
      const metadata = questMetadata(row);
      const questKey = metadata.questKey ?? questKeyFromInput(row.sourceKey);
      return {
        questKey,
        mainQuestId: String(metadata.mainQuestId ?? mainQuestIdFromKey(questKey)),
        title: row.title,
        type: row.type as QuestRecordPayload["questType"],
        chapter: metadata.chapter ?? null,
        series: metadata.series ?? null,
        completeness: metadata.completeness ?? "partial",
        locale: row.locale,
        documentId: row.id,
        revision: revisionLabel(revision.revisionNumber),
        match: row.sourceKey.includes(request.query) ? "source_key" : "text",
      };
    });
  }

  async getQuest(gameId: string, request: GetQuestRequest): Promise<QuestDialoguePage | null> {
    const revision = request.revisionId
      ? await this.getRevisionMeta(request.revisionId, gameId)
      : await (async () => {
          const current = await this.getCurrentRevision(gameId);
          return current ? this.getSearchableRevision(gameId, current) : null;
        })();
    if (!revision) return null;
    const cursor = decodeQuestCursor(request.cursor);
    const questKey = questKeyFromInput(cursor?.questKey ?? request.questKey);
    const requestedLocale = cursor?.locale ?? request.locale ?? "zh-CN";
    const requestedSubquestKey = request.subquestId
      ? request.subquestId.startsWith("quest/")
        ? request.subquestId
        : `${questKey}/subquest/${request.subquestId}`
      : cursor?.subquestKey;
    if (
      cursor &&
      (cursor.revisionId !== revision.id ||
        cursor.questKey !== questKey ||
        cursor.locale !== requestedLocale ||
        cursor.subquestKey !== requestedSubquestKey)
    )
      throw new DomainError(
        "quest_cursor_invalid",
        "Quest cursor does not match this request",
        undefined,
        400,
      );
    const findDocument = async (locale: string) =>
      (
        await this.db
          .select({ document: documents, source: sources, snapshot: sourceSnapshots })
          .from(documents)
          .innerJoin(sourceSnapshots, eq(sourceSnapshots.id, documents.sourceSnapshotId))
          .innerJoin(sources, eq(sources.id, sourceSnapshots.sourceId))
          .where(
            and(
              eq(documents.gameId, gameId),
              eq(documents.revisionId, revision.id),
              eq(documents.sourceKey, `${questKey}/locale/${locale}`),
              eq(documents.deleted, false),
            ),
          )
          .limit(1)
      )[0];
    let documentRow = await findDocument(requestedLocale);
    const warnings: string[] = [];
    let locale = requestedLocale;
    if (!documentRow) {
      const fallback = requestedLocale === "zh-CN" ? "en" : "zh-CN";
      documentRow = await findDocument(fallback);
      if (documentRow) {
        locale = fallback;
        warnings.push(`locale_fallback:${requestedLocale}->${fallback}`);
      }
    }
    const document = documentRow?.document;
    const source = documentRow?.source;
    const sourceSnapshot = documentRow?.snapshot;
    if (!document) return null;
    if (request.publicOnly !== false) {
      const visibility = questMetadata(document).visibility;
      const isPublic =
        visibility === "public" ||
        (visibility === undefined &&
          questMetadata(document).completeness === "complete" &&
          !/\$(?:HIDDEN|UNRELEASED|TEST)\$/i.test(document.title) &&
          !/^Quest\s+\d+$/i.test(document.title));
      if (!isPublic) return null;
    }
    const metadata = questMetadata(document);
    const nodeLimit = Math.min(Math.max(request.nodeLimit, 1), 300);
    const offset = cursor?.offset ?? 0;
    const subquestRows = await this.db
      .select()
      .from(questSubquests)
      .where(
        and(eq(questSubquests.documentId, document.id), eq(questSubquests.revisionId, revision.id)),
      )
      .orderBy(asc(questSubquests.ordinal));
    const nodeConditions = [
      eq(questDialogueNodes.documentId, document.id),
      eq(questDialogueNodes.revisionId, revision.id),
      ...(requestedSubquestKey ? [eq(questDialogueNodes.subquestKey, requestedSubquestKey)] : []),
    ];
    const totalRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(questDialogueNodes)
      .where(and(...nodeConditions));
    const totalDialogueNodes = Number(totalRows[0]?.count ?? 0);
    const nodeRows = await this.db
      .select()
      .from(questDialogueNodes)
      .where(and(...nodeConditions))
      .orderBy(asc(questDialogueNodes.ordinal))
      .offset(offset)
      .limit(nodeLimit + 1);
    const pageRows = nodeRows.slice(0, nodeLimit);
    const pageNodeKeys = pageRows.map((row) => row.nodeKey);
    const edgeRows = pageNodeKeys.length
      ? await this.db
          .select()
          .from(questDialogueEdges)
          .where(
            and(
              eq(questDialogueEdges.documentId, document.id),
              eq(questDialogueEdges.revisionId, revision.id),
              inArray(questDialogueEdges.fromNodeKey, pageNodeKeys),
            ),
          )
      : [];
    const speakerKeys = [
      ...new Set(
        pageRows.map((row) => row.speakerKey).filter((key): key is string => Boolean(key)),
      ),
    ];
    const participantRows = speakerKeys.length
      ? await this.db
          .select()
          .from(entities)
          .where(and(eq(entities.gameId, gameId), inArray(entities.sourceKey, speakerKeys)))
      : [];
    return {
      questKey,
      title: document.title,
      type: document.type as QuestRecordPayload["questType"],
      locale: document.locale,
      gameVersion: document.gameVersion,
      documentId: document.id,
      revision: revisionLabel(revision.revisionNumber),
      completeness: metadata.completeness ?? "partial",
      subquests: subquestRows.map((row) => ({
        subquestKey: row.subquestKey,
        subquestId: row.subquestId,
        title: row.title,
        objective: row.objective ?? undefined,
        order: row.ordinal,
        completeness: row.completeness as QuestCompleteness,
        metadata: row.metadata,
      })),
      dialogueNodes: pageRows.map((row) => ({
        nodeKey: row.nodeKey,
        nodeId: row.nodeId,
        type: row.nodeType as QuestRecordPayload["dialogueNodes"][number]["type"],
        subquestKey: row.subquestKey ?? undefined,
        speakerKey: row.speakerKey ?? undefined,
        speakerName: row.speakerName ?? undefined,
        body: row.body,
        segmentId: row.segmentId,
        order: row.ordinal,
        variants: row.variants,
        metadata: row.metadata,
      })),
      dialogueEdges: edgeRows.map((row) => ({
        fromNodeKey: row.fromNodeKey,
        toNodeKey: row.toNodeKey,
        type: row.edgeType as QuestRecordPayload["dialogueEdges"][number]["type"],
        optionText: row.optionText ?? undefined,
        metadata: row.metadata,
      })),
      participants: participantRows.map((row) => asEntitySummary(row)),
      prerequisites: metadata.prerequisites ?? [],
      citations: pageRows.map((row) => ({
        documentId: document.id,
        locale: document.locale,
        questKey,
        subquestKey: row.subquestKey ?? undefined,
        dialogueNodeKey: row.nodeKey,
        segmentId: row.segmentId,
        sourceKey: document.sourceKey,
        sourceName: source?.name,
        sourceSnapshotId: sourceSnapshot?.id ?? document.sourceSnapshotId,
        revision: revisionLabel(revision.revisionNumber),
      })),
      warnings,
      totalDialogueNodes,
      loadedDialogueNodes: pageRows.length,
      hasMore: nodeRows.length > nodeLimit,
      nextCursor:
        nodeRows.length > nodeLimit
          ? encodeQuestCursor({
              revisionId: revision.id,
              questKey,
              locale,
              subquestKey: requestedSubquestKey,
              offset: offset + nodeLimit,
            })
          : null,
    };
  }

  async vectorSearch(
    gameId: string,
    request: SearchRequest,
    vectorValue: number[],
    spaceId: string,
    limit: number,
  ): Promise<VectorSearchHit[]> {
    if (vectorValue.length !== 1536) return [];
    const current = await this.getCurrentRevision(gameId);
    if (!current) return [];
    const revision = request.revisionId
      ? await this.getRevisionMeta(request.revisionId, gameId)
      : await this.getSearchableRevision(gameId, current);
    if (!revision) return [];
    const vectorLiteral = `[${vectorValue.join(",")}]`;
    const documentTypeFilter = request.documentTypes?.length
      ? sql`and d.type in (${sql.join(
          request.documentTypes.map((value) => sql`${value}`),
          sql`, `,
        )})`
      : sql``;
    const gameVersionFilter = request.gameVersions?.length
      ? sql`and d.game_version in (${sql.join(
          request.gameVersions.map((value) => sql`${value}`),
          sql`, `,
        )})`
      : sql``;
    const sourceFilter = request.sourceId
      ? sql`and d.source_snapshot_id in (select id from knowledge.source_snapshots where source_id = ${request.sourceId}::uuid)`
      : sql``;
    const localeFilter = request.locales?.length
      ? sql`and d.locale in (${sql.join(
          request.locales.map((value) => sql`${value}`),
          sql`, `,
        )})`
      : sql``;
    const rows = await this.db.execute(sql`
      select ds.id as segment_id, d.id as document_id, d.source_key, d.title, d.type, d.game_version,
             ss.content_hash as source_version, ds.body,
             1 - (e.vector <=> ${vectorLiteral}::vector) as score
      from knowledge.embeddings e
      inner join knowledge.document_segments ds on ds.id = e.target_id
      inner join knowledge.documents d on d.id = ds.document_id
      inner join knowledge.source_snapshots ss on ss.id = d.source_snapshot_id
      where e.target_type = 'segment'
        and e.space_id = ${spaceId}
        and e.revision_id = ${revision.id}
        and ds.revision_id = ${revision.id}
        and d.game_id = ${gameId}
        and d.deleted = false
        and (
          d.type not in ('archon_quest', 'story_quest', 'world_quest', 'event_quest', 'commission', 'hangout', 'other')
          or (
            coalesce(d.metadata->'questPayload'->>'visibility', d.metadata->'quest'->>'visibility') = 'public'
            or (
              coalesce(d.metadata->'questPayload'->>'visibility', d.metadata->'quest'->>'visibility') is null
              and coalesce(d.metadata->'questPayload'->>'completeness', d.metadata->'quest'->>'completeness') = 'complete'
            )
          )
        )
        ${documentTypeFilter}
        ${gameVersionFilter}
        ${localeFilter}
        ${sourceFilter}
      order by e.vector <=> ${vectorLiteral}::vector
      limit ${limit}
    `);
    return (
      rows as unknown as Array<{
        segment_id: string;
        document_id: string;
        source_key: string;
        title: string;
        type: string;
        game_version: string | null;
        source_version: string;
        body: string;
        score: number;
      }>
    ).map((row) => ({
      document: {
        id: row.document_id,
        sourceKey: row.source_key,
        sourceVersion: row.source_version,
        title: row.title,
        type: row.type as DocumentType,
        gameVersion: row.game_version,
        revision: revisionLabel(revision.revisionNumber),
      },
      segmentId: row.segment_id,
      snippet: row.body.slice(0, 300),
      score: Number(row.score),
    }));
  }

  async vectorEntitySearch(
    gameId: string,
    request: SearchRequest,
    vectorValue: number[],
    spaceId: string,
    limit: number,
  ): Promise<VectorEntityHit[]> {
    if (vectorValue.length !== 1536) return [];
    const current = await this.getCurrentRevision(gameId);
    if (!current) return [];
    const revision = request.revisionId
      ? await this.getRevision(request.revisionId, gameId)
      : await this.getSearchableRevision(gameId, current);
    if (!revision) return [];
    const vectorLiteral = `[${vectorValue.join(",")}]`;
    const rows = await this.db.execute(sql`
      select e.target_id as entity_id,
             1 - (e.vector <=> ${vectorLiteral}::vector) as score
      from knowledge.embeddings e
      inner join knowledge.entities entity on entity.id = e.target_id
      where e.target_type = 'entity'
        and e.space_id = ${spaceId}
        and e.revision_id = ${revision.id}
        and entity.game_id = ${gameId}
      order by e.vector <=> ${vectorLiteral}::vector
      limit ${Math.max(limit * 4, 40)}
    `);
    const typedRows = rows as unknown as Array<{ entity_id: string; score: number }>;
    if (!typedRows.length) return [];
    const entityRows = await this.db
      .select()
      .from(entities)
      .where(
        inArray(
          entities.id,
          typedRows.map((row) => row.entity_id),
        ),
      );
    const aliases = await getAliases(
      this.db,
      entityRows.map((row) => row.id),
      revision.id,
    );
    const candidates = new Map(
      (await this.getRevisionRecords(revision)).flatMap((record) =>
        (record.entities ?? []).map((candidate) => [candidate.sourceKey, candidate]),
      ),
    );
    const entityMap = new Map(entityRows.map((row) => [row.id, row]));
    return typedRows
      .flatMap((hit) => {
        const row = entityMap.get(hit.entity_id);
        if (!row) return [];
        const candidate = row.sourceKey ? candidates.get(row.sourceKey) : undefined;
        if (
          !candidate &&
          (revision.lifecycleStatus === "preview" ||
            revision.normalizedRecords !== null ||
            row.deleted)
        )
          return [];
        const type = candidate?.type ?? (row.type as EntityType);
        if (request.entityTypes?.length && !request.entityTypes.includes(type)) return [];
        return [
          {
            entity: {
              id: row.id,
              sourceKey: row.sourceKey,
              name: candidate?.name ?? row.canonicalName,
              type,
              summary: candidate?.summary ?? row.summary,
              aliases: candidate
                ? (candidate.aliases ?? []).map((alias) => alias.value)
                : (aliases.get(row.id) ?? []),
              score: Number(hit.score),
              match: "vector",
              revision: revisionLabel(revision.revisionNumber),
            },
            score: Number(hit.score),
          },
        ];
      })
      .slice(0, limit);
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

  /**
   * PERF: metadata-only revision lookup for hot read paths. Unlike getRevision, this
   * excludes the normalizedRecords JSON column (tens of megabytes per published
   * revision), which dominated per-call latency on entity/document read paths.
   */
  private async getRevisionMeta(revisionId: string, gameId?: string) {
    const rows = await this.db
      .select({
        id: datasetRevisions.id,
        gameId: datasetRevisions.gameId,
        revisionNumber: datasetRevisions.revisionNumber,
        sourceBatchId: datasetRevisions.sourceBatchId,
        releaseNote: datasetRevisions.releaseNote,
        lifecycleStatus: datasetRevisions.lifecycleStatus,
        publishedAt: datasetRevisions.publishedAt,
        isCurrent: datasetRevisions.isCurrent,
        indexStatus: datasetRevisions.indexStatus,
        manifestId: datasetRevisions.manifestId,
        activatedAt: datasetRevisions.activatedAt,
        activationBuildId: datasetRevisions.activationBuildId,
        activationCandidateId: datasetRevisions.activationCandidateId,
        activationError: datasetRevisions.activationError,
        provenance: datasetRevisions.provenance,
        sourceId: datasetRevisions.sourceId,
        gameVersion: datasetRevisions.gameVersion,
        locale: datasetRevisions.locale,
        archivedReason: datasetRevisions.archivedReason,
        archivedAt: datasetRevisions.archivedAt,
      })
      .from(datasetRevisions)
      .where(
        gameId
          ? and(eq(datasetRevisions.id, revisionId), eq(datasetRevisions.gameId, gameId))
          : eq(datasetRevisions.id, revisionId),
      )
      .limit(1);
    return rows[0];
  }

  private async getSearchableRevision(
    gameId: string,
    current: typeof datasetRevisions.$inferSelect,
  ) {
    if (current.indexStatus === "ready") return current;
    const rows = await this.db
      .select()
      .from(datasetRevisions)
      .where(
        and(
          eq(datasetRevisions.gameId, gameId),
          eq(datasetRevisions.lifecycleStatus, "published"),
          eq(datasetRevisions.indexStatus, "ready"),
        ),
      )
      .orderBy(desc(datasetRevisions.revisionNumber))
      .limit(1);
    return rows[0];
  }

  private async getRevisionRecords(
    revision: typeof datasetRevisions.$inferSelect,
  ): Promise<NormalizedRecord[]> {
    const cached = this.revisionRecordsCache.get(revision.id);
    if (cached) return cached;
    const rows = await this.db
      .select({ normalizedRecords: datasetRevisions.normalizedRecords })
      .from(datasetRevisions)
      .where(eq(datasetRevisions.id, revision.id))
      .limit(1);
    const records = rows[0]?.normalizedRecords ?? [];
    this.revisionRecordsCache.set(revision.id, Promise.resolve(records));
    return records;
  }

  private revisionRecordsCache = new Map<string, Promise<NormalizedRecord[]>>();

  private async searchEntitiesAtRevision(
    gameId: string,
    request: SearchRequest,
    revision: typeof datasetRevisions.$inferSelect,
  ): Promise<EntitySummary[]> {
    // Current published entities are already materialized in the read model;
    // do not deserialize the complete normalized-record JSON for every search.
    // Historical/preview revisions still use their immutable candidate payload
    // so their membership remains exact.
    if (revision.isCurrent) {
      // Full scan over the game's entities: lexical scoring is done in JS and
      // cannot be expressed as a SQL pre-filter without losing recall (the query
      // may be a longer phrase containing the entity name).
      const rows = await this.db
        .select()
        .from(entities)
        .where(and(eq(entities.gameId, gameId), eq(entities.deleted, false)));
      const aliases = await getAliases(
        this.db,
        rows.map((row) => row.id),
        revision.id,
      );
      const query = normalize(request.query);
      return rows
        .flatMap((row) => {
          const rowAliases = aliases.get(row.id) ?? [];
          const type = row.type as EntityType;
          if (request.entityTypes?.length && !request.entityTypes.includes(type)) return [];
          const values = [row.canonicalName, ...rowAliases];
          const matches = values.map((value) => lexicalScore(request.query, value));
          const best = matches.sort((left, right) => right.score - left.score)[0];
          if (
            !best ||
            (!values.some((value) => normalize(value).includes(query)) && best.score < 0.15)
          )
            return [];
          return [
            {
              id: row.id,
              sourceKey: row.sourceKey,
              name: row.canonicalName,
              type,
              summary: row.summary,
              aliases: rowAliases,
              score: best.score,
              match: `name_${best.match}`,
              revision: revisionLabel(revision.revisionNumber),
            },
          ];
        })
        .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
        .slice(0, request.limit ?? defaultLimit);
    }
    const records = await this.getRevisionRecords(revision);
    const candidates = new Map(
      records.flatMap((record) =>
        (record.entities ?? []).map((candidate) => [candidate.sourceKey, candidate]),
      ),
    );
    const rows = await this.db.select().from(entities).where(eq(entities.gameId, gameId));
    const query = normalize(request.query);
    return rows
      .flatMap((row) => {
        const candidate = row.sourceKey ? candidates.get(row.sourceKey) : undefined;
        if (
          !candidate ||
          (request.entityTypes?.length && !request.entityTypes.includes(candidate.type))
        )
          return [];
        const nameMatch = lexicalScore(request.query, candidate.name);
        const aliasMatch = (candidate.aliases ?? [])
          .map((alias) => lexicalScore(request.query, alias.value))
          .sort((left, right) => right.score - left.score)[0];
        const weightedNameMatch = { ...nameMatch, score: nameMatch.score };
        const weightedAliasMatch = aliasMatch
          ? { ...aliasMatch, score: aliasMatch.score * 0.95 }
          : undefined;
        const best =
          weightedAliasMatch && weightedAliasMatch.score > weightedNameMatch.score
            ? weightedAliasMatch
            : weightedNameMatch;
        const bestValue =
          weightedAliasMatch && weightedAliasMatch.score > weightedNameMatch.score
            ? "alias"
            : "name";
        const values = [candidate.name, ...(candidate.aliases ?? []).map((alias) => alias.value)];
        if (!values.some((value) => normalize(value).includes(query)) && best.score < 0.15)
          return [];
        return [
          {
            id: row.id,
            sourceKey: row.sourceKey,
            name: candidate.name,
            type: candidate.type,
            summary: candidate.summary ?? null,
            aliases: (candidate.aliases ?? []).map((alias) => alias.value),
            score: best.score,
            match: `${bestValue}_${best.match}`,
            revision: revisionLabel(revision.revisionNumber),
          },
        ];
      })
      .sort((left, right) => (right.score ?? 0) - (left.score ?? 0))
      .slice(0, request.limit ?? defaultLimit);
  }
}

function revisionNumberLabel(value: number): string {
  return revisionLabel(value);
}

type TextBindingRow = {
  id: string;
  game_id: string;
  revision_id: string;
  entity_type: string;
  entity_stable_id: string;
  document_id: string;
  segment_id: string | null;
  binding_type: TextBindingType;
  confidence: number | string | null;
  binding_source: TextBinding["bindingSource"];
  metadata: Record<string, unknown> | null;
  document_title?: string | null;
  document_type?: string | null;
  document_locale?: string | null;
  excerpt?: string | null;
  created_at: Date | string;
};

function textBindingRows(result: unknown): TextBindingRow[] {
  if (Array.isArray(result)) return result as TextBindingRow[];
  if (
    result &&
    typeof result === "object" &&
    "rows" in result &&
    Array.isArray((result as { rows?: unknown }).rows)
  )
    return (result as { rows: TextBindingRow[] }).rows;
  return [];
}

function mapTextBinding(row: TextBindingRow): TextBinding {
  return {
    id: row.id,
    gameId: row.game_id,
    revisionId: row.revision_id,
    entityType: row.entity_type,
    entityStableId: row.entity_stable_id,
    documentId: row.document_id,
    segmentId: row.segment_id,
    bindingType: row.binding_type,
    confidence: row.confidence === null ? null : Number(row.confidence),
    bindingSource: row.binding_source,
    metadata: row.metadata ?? {},
    documentTitle: row.document_title ?? undefined,
    documentType: row.document_type ?? undefined,
    documentLocale: row.document_locale ?? undefined,
    excerpt: row.excerpt ?? undefined,
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
  };
}

type TextReadRow = {
  document_id: string;
  title: string;
  locale: string | null;
  segment_id?: string | null;
  heading_path?: unknown;
  body: string;
};

function textReadRows(
  result: unknown,
): Array<Omit<TextReadRow, "heading_path"> & { heading_path: string[] }> {
  const rows = Array.isArray(result)
    ? result
    : result && typeof result === "object" && "rows" in result
      ? (result as { rows?: unknown }).rows
      : [];
  return (Array.isArray(rows) ? rows : [])
    .filter((row): row is TextReadRow => Boolean(row && typeof row === "object"))
    .map((row) => ({
      document_id: String(row.document_id ?? ""),
      title: String(row.title ?? ""),
      locale: row.locale == null ? null : String(row.locale),
      segment_id: row.segment_id == null ? null : String(row.segment_id),
      heading_path: Array.isArray(row.heading_path)
        ? row.heading_path.filter((value): value is string => typeof value === "string")
        : [],
      body: String(row.body ?? ""),
    }));
}
