import { sql } from "drizzle-orm";
import type {
  DocumentSearchRequest,
  DialogueSearchFilters,
  EntityCandidateSearchRequest,
  ResolverCandidate,
  SearchMatchType,
  SearchRepositoryPort,
  StructuredSearchRequest,
  StructuredSearchKind,
} from "@gip/search";
import type { DocumentType } from "@gip/contracts";
import type { Database } from "./client.js";
import { escapeLike, normalize } from "./repository-utils.js";

type DbRow = Record<string, unknown>;

type DocumentDbHit = {
  id: string;
  sourceKey: string | null;
  title: string;
  type: string;
  locale: string | null;
  body: string;
  rank: number;
  matchType: SearchMatchType;
};

type SegmentDbHit = DocumentDbHit & {
  documentId: string;
  segmentId: string;
  segmentBody: string;
};

export class SqlSearchRepositoryPort implements SearchRepositoryPort {
  constructor(private readonly db: Database) {}

  async listStructuredAtRevision(
    requestOrGameId: StructuredSearchRequest | string,
    maybeRevisionId?: string,
    maybeQuery?: string,
  ) {
    const request =
      typeof requestOrGameId === "string"
        ? {
            gameId: requestOrGameId,
            revisionId: maybeRevisionId ?? "",
            query: maybeQuery ?? "",
          }
        : requestOrGameId;
    const { gameId, revisionId, query } = request;
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) return [];
    const prefix = `${escapeLike(normalizedQuery)}%`;
    const allowedKinds = new Set<StructuredSearchKind>(
      request.kinds?.length
        ? request.kinds
        : [
            "character",
            "weapon",
            "artifact_set",
            "artifact",
            "material",
            "achievement",
            "enemy",
            "voice",
          ],
    );
    const branches: ReturnType<typeof sql>[] = [];
    if (allowedKinds.has("character"))
      branches.push(sql`
        select 'character'::text as kind, r.stable_id, r.name,
               coalesce(array_remove(array[r.title], null), array[]::text[]) as aliases,
               coalesce(r.description, '') as body, r.normalized_name, r.search_vector,
               t.normalized_query, t.prefix, t.plain_query, t.web_query
        from knowledge.genshin_characters r cross join search_terms t
        where r.game_id = ${gameId}::uuid and r.revision_id = ${revisionId}::uuid
      `);
    if (allowedKinds.has("weapon"))
      branches.push(sql`
        select 'weapon'::text as kind, r.stable_id, r.name,
               coalesce(array_remove(array[r.passive_name], null), array[]::text[]) as aliases,
               coalesce(r.description, '') || ' ' || coalesce(r.passive_description, '') as body,
               r.normalized_name, r.search_vector, t.normalized_query, t.prefix, t.plain_query, t.web_query
        from knowledge.genshin_weapons r cross join search_terms t
        where r.game_id = ${gameId}::uuid and r.revision_id = ${revisionId}::uuid
      `);
    if (allowedKinds.has("artifact_set"))
      branches.push(sql`
        select 'artifact_set'::text as kind, r.stable_id, r.name, array[]::text[] as aliases,
               coalesce(r.two_piece_bonus, '') || ' ' || coalesce(r.four_piece_bonus, '') as body,
               r.normalized_name, r.search_vector, t.normalized_query, t.prefix, t.plain_query, t.web_query
        from knowledge.genshin_artifact_sets r cross join search_terms t
        where r.game_id = ${gameId}::uuid and r.revision_id = ${revisionId}::uuid
      `);
    if (allowedKinds.has("artifact"))
      branches.push(sql`
        select 'artifact'::text as kind, r.stable_id, r.name, array[]::text[] as aliases,
               coalesce(r.description, '') as body, r.normalized_name, r.search_vector,
               t.normalized_query, t.prefix, t.plain_query, t.web_query
        from knowledge.genshin_artifacts r cross join search_terms t
        where r.game_id = ${gameId}::uuid and r.revision_id = ${revisionId}::uuid
      `);
    if (allowedKinds.has("material"))
      branches.push(sql`
        select 'material'::text as kind, r.stable_id, r.name, array[]::text[] as aliases,
               coalesce(r.description, '') as body, r.normalized_name, r.search_vector,
               t.normalized_query, t.prefix, t.plain_query, t.web_query
        from knowledge.genshin_materials r cross join search_terms t
        where r.game_id = ${gameId}::uuid and r.revision_id = ${revisionId}::uuid
      `);
    if (allowedKinds.has("achievement"))
      branches.push(sql`
        select 'achievement'::text as kind, r.stable_id, r.name, array[]::text[] as aliases,
               coalesce(r.requirement, '') as body, r.normalized_name, r.search_vector,
               t.normalized_query, t.prefix, t.plain_query, t.web_query
        from knowledge.genshin_achievements r cross join search_terms t
        where r.game_id = ${gameId}::uuid and r.revision_id = ${revisionId}::uuid
      `);
    if (allowedKinds.has("enemy"))
      branches.push(sql`
        select 'enemy'::text as kind, r.stable_id, r.name,
               coalesce(array_remove(array[r.family], null), array[]::text[]) as aliases,
               coalesce(r.description, '') as body, r.normalized_name, r.search_vector,
               t.normalized_query, t.prefix, t.plain_query, t.web_query
        from knowledge.genshin_enemies r cross join search_terms t
        where r.game_id = ${gameId}::uuid and r.revision_id = ${revisionId}::uuid
      `);
    if (allowedKinds.has("voice"))
      branches.push(sql`
        select 'voice'::text as kind, r.stable_id, r.name, array[]::text[] as aliases,
               r.body, r.normalized_name, r.search_vector,
               t.normalized_query, t.prefix, t.plain_query, t.web_query
        from knowledge.genshin_voice_lines r cross join search_terms t
        where r.game_id = ${gameId}::uuid and r.revision_id = ${revisionId}::uuid
      `);
    if (!branches.length) return [];
    const limit = Math.min(Math.max(request.limit ?? 320, 1), 500);
    const result = await this.db.execute(sql`
      with search_terms as (
        select
          ${normalizedQuery}::text as normalized_query,
          ${prefix}::text as prefix,
          plainto_tsquery('simple'::regconfig, ${query.trim()}) as plain_query,
          websearch_to_tsquery('simple'::regconfig, ${query.trim()}) as web_query
      ), candidates as (
        ${sql.join(branches, sql` union all `)}
      ), ranked as (
        select
          c.*,
          case
            when c.normalized_name = c.normalized_query
              or exists (
                select 1 from unnest(c.aliases) alias_value
                where lower(alias_value) = c.normalized_query
              ) then 1.0
            when c.normalized_name like c.prefix escape '\\'
              or exists (
                select 1 from unnest(c.aliases) alias_value
                where lower(alias_value) like c.prefix escape '\\'
              ) then 0.8
            when c.search_vector @@ c.plain_query
              or c.search_vector @@ c.web_query then greatest(
                ts_rank(c.search_vector, c.plain_query),
                ts_rank(c.search_vector, c.web_query)
              )
            else greatest(
              similarity(c.normalized_name, c.normalized_query),
              similarity(lower(c.body), c.normalized_query)
            )
          end::double precision as rank,
          case
            when c.normalized_name = c.normalized_query
              or exists (
                select 1 from unnest(c.aliases) alias_value
                where lower(alias_value) = c.normalized_query
              ) then 'exact'
            when c.normalized_name like c.prefix escape '\\'
              or exists (
                select 1 from unnest(c.aliases) alias_value
                where lower(alias_value) like c.prefix escape '\\'
              ) then 'prefix'
            when c.search_vector @@ c.plain_query
              or c.search_vector @@ c.web_query then 'fts'
            else 'trgm'
          end as match_type
        from candidates c
      )
      select
        kind,
        stable_id as "stableId",
        name,
        aliases,
        body,
        rank,
        match_type as "matchType"
      from ranked
      where match_type in ('exact', 'prefix', 'fts')
         or rank >= 0.15
      order by
        case match_type
          when 'exact' then 0
          when 'prefix' then 1
          when 'fts' then 2
          else 3
        end,
        rank desc,
        name asc,
        stable_id asc
        limit ${limit}
    `);
    return rowsFromExecuteResult(result).map((row) => ({
      kind: readString(row, "kind") as StructuredSearchKind,
      stableId: readString(row, "stableId", "stable_id"),
      name: readString(row, "name"),
      aliases: readStringArray(row, "aliases"),
      body: readString(row, "body"),
      rank: readNumber(row, "rank"),
      matchType: readMatchType(row, "matchType", "match_type"),
    }));
  }

  async resolveEntityCandidates(
    request: EntityCandidateSearchRequest,
  ): Promise<ResolverCandidate[]> {
    const query = normalize(request.query);
    if (!query) return [];
    const prefix = escapeLike(query) + "%";
    const limit = Math.min(Math.max(request.limit ?? 20, 1), 100);
    const entityTypeFilter = request.entityTypes?.length
      ? sql`and erm.entity_type in (${sql.join(
          request.entityTypes.map((entityType) => sql`${entityType}`),
          sql`, `,
        )})`
      : sql``;
    const result = await this.db.execute(sql`
      with matched_values as (
        select
          erm.entity_id,
          erm.entity_type,
          erm.canonical_name,
          erm.normalized_name as normalized_value,
          erm.canonical_name as matched_text,
          'canonical' as value_kind
        from knowledge.entity_revision_materializations erm
        inner join knowledge.entities e on e.id = erm.entity_id
        where erm.revision_id = ${request.revisionId}::uuid
          and e.game_id = ${request.gameId}::uuid
          ${entityTypeFilter}
        union all
        select
          erm.entity_id,
          erm.entity_type,
          erm.canonical_name,
          a.normalized_value,
          a.value as matched_text,
          'alias' as value_kind
        from knowledge.entity_revision_materializations erm
        inner join knowledge.entities e on e.id = erm.entity_id
        inner join knowledge.entity_aliases a
          on a.entity_id = erm.entity_id
         and a.revision_id = erm.revision_id
        where erm.revision_id = ${request.revisionId}::uuid
          and e.game_id = ${request.gameId}::uuid
          ${entityTypeFilter}
      ), ranked_matches as (
        select distinct on (entity_id)
          entity_id,
          entity_type,
          canonical_name,
          matched_text,
          case
            when value_kind = 'canonical' and normalized_value = ${query} then 'canonical_name'
            when value_kind = 'alias' and normalized_value = ${query} then 'alias'
            when normalized_value like ${prefix} then 'prefix'
            else 'trigram'
          end as match_tier,
          case
            when value_kind = 'canonical' and normalized_value = ${query} then 1.0
            when value_kind = 'alias' and normalized_value = ${query} then 0.95
            when value_kind = 'canonical' and normalized_value like ${prefix} then 0.6
            when value_kind = 'alias' and normalized_value like ${prefix} then 0.57
            when value_kind = 'canonical' then 0.2 + similarity(normalized_value, ${query}) * 0.1
            else 0.19 + similarity(normalized_value, ${query}) * 0.1
          end::double precision as match_confidence
        from matched_values
        where normalized_value = ${query}
           or normalized_value like ${prefix}
           or normalized_value % ${query}
        order by entity_id, match_confidence desc, value_kind asc, matched_text asc
      ), aliases_by_entity as (
        select
          a.entity_id,
          coalesce(array_agg(distinct a.value order by a.value), array[]::text[]) as aliases
        from knowledge.entity_aliases a
        where a.revision_id = ${request.revisionId}::uuid
          and a.entity_id in (select entity_id from ranked_matches)
        group by a.entity_id
      )
      select
        ranked.entity_id as id,
        ranked.entity_type as "entityType",
        ranked.canonical_name as "canonicalName",
        ranked.match_tier as "matchTier",
        ranked.matched_text as "matchedText",
        ranked.match_confidence as "matchConfidence",
        coalesce(aliases.aliases, array[]::text[]) as aliases
      from ranked_matches ranked
      left join aliases_by_entity aliases on aliases.entity_id = ranked.entity_id
      order by ranked.match_confidence desc, ranked.canonical_name asc, ranked.entity_id asc
      limit ${limit}
    `);
    return rowsFromExecuteResult(result) as unknown as ResolverCandidate[];
  }

  async listDialogueHits(
    gameId: string,
    revisionId: string,
    query: string,
    filters: DialogueSearchFilters = {},
  ) {
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) return [];
    const prefix = `${escapeLike(normalizedQuery)}%`;
    const speaker = cleanFilter(filters.speaker)?.toLocaleLowerCase("zh-CN");
    const quest = cleanFilter(filters.quest ?? filters.questKey)?.toLocaleLowerCase("zh-CN");
    const nodeType = cleanFilter(filters.nodeType)?.toLocaleLowerCase("zh-CN");
    const locale = cleanFilter(filters.locale);
    const speakerFilter = speaker
      ? sql`and (
          lower(coalesce(q.speaker_name, '')) = ${speaker}
          or lower(coalesce(q.speaker_key, '')) = ${speaker}
        )`
      : sql``;
    const questFilter = quest
      ? sql`and (
          lower(q.quest_key) = ${quest}
          or lower(d.source_key) = ${quest}
          or lower(d.title) = ${quest}
        )`
      : sql``;
    const nodeTypeFilter = nodeType ? sql`and lower(q.node_type) = ${nodeType}` : sql``;
    const localeFilter = locale ? sql`and d.locale = ${locale}` : sql``;
    const result = await this.db.execute(sql`
      with search_terms as (
        select
          ${normalizedQuery}::text as normalized_query,
          ${prefix}::text as prefix,
          plainto_tsquery('simple'::regconfig, ${query.trim()}) as plain_query,
          websearch_to_tsquery('simple'::regconfig, ${query.trim()}) as web_query
      ), candidates as (
        select
          q.document_id,
          q.node_key,
          q.subquest_key,
          q.quest_key,
          q.speaker_name as speaker,
          q.body,
          d.title as document_title,
          d.type as document_type,
          d.locale,
          q.search_vector as dialogue_search_vector,
          d.search_vector as document_search_vector,
          t.normalized_query,
          t.prefix,
          t.plain_query,
          t.web_query
        from knowledge.quest_dialogue_nodes q
        inner join knowledge.documents d on d.id = q.document_id
        cross join search_terms t
          where q.revision_id = ${revisionId}::uuid
            and d.revision_id = ${revisionId}::uuid
            and d.game_id = ${gameId}::uuid
            and d.deleted = false
            ${speakerFilter}
            ${questFilter}
            ${nodeTypeFilter}
            ${localeFilter}
            and (
              lower(coalesce(q.speaker_name, '')) = t.normalized_query
              or lower(d.title) = t.normalized_query
              or lower(coalesce(q.speaker_name, '')) like t.prefix escape '\\'
              or d.normalized_title like t.prefix escape '\\'
              or q.search_vector @@ t.plain_query
              or q.search_vector @@ t.web_query
              or d.search_vector @@ t.plain_query
              or d.search_vector @@ t.web_query
              or q.body % t.normalized_query
              or d.normalized_title % t.normalized_query
            )
      ), ranked as (
        select
          c.*,
          case
            when lower(c.body) = c.normalized_query
              or lower(coalesce(c.speaker, '')) = c.normalized_query
              or lower(c.document_title) = c.normalized_query then 1.0
            when lower(coalesce(c.speaker, '')) like c.prefix escape '\\'
              or lower(c.document_title) like c.prefix escape '\\' then 0.8
            when c.dialogue_search_vector @@ c.plain_query
              or c.document_search_vector @@ c.plain_query
              or c.dialogue_search_vector @@ c.web_query
              or c.document_search_vector @@ c.web_query then greatest(
                ts_rank(c.dialogue_search_vector, c.plain_query),
                ts_rank(c.document_search_vector, c.plain_query),
                ts_rank(c.dialogue_search_vector, c.web_query),
                ts_rank(c.document_search_vector, c.web_query)
              )
            else greatest(
              similarity(c.body, c.normalized_query),
              similarity(lower(coalesce(c.speaker, '')), c.normalized_query),
              similarity(lower(c.document_title), c.normalized_query)
            )
          end::double precision as rank,
          case
            when lower(c.body) = c.normalized_query
              or lower(coalesce(c.speaker, '')) = c.normalized_query
              or lower(c.document_title) = c.normalized_query then 'exact'
            when lower(coalesce(c.speaker, '')) like c.prefix escape '\\'
              or lower(c.document_title) like c.prefix escape '\\' then 'prefix'
            when c.dialogue_search_vector @@ c.plain_query
              or c.document_search_vector @@ c.plain_query
              or c.dialogue_search_vector @@ c.web_query
              or c.document_search_vector @@ c.web_query then 'fts'
            else 'trgm'
          end as match_type
        from candidates c
      )
      select
        document_id,
        node_key,
        subquest_key,
        quest_key,
        speaker,
        body,
        document_title,
        document_type,
        locale,
        rank,
        match_type as "matchType"
      from ranked
      where match_type in ('exact', 'prefix', 'fts')
         or rank >= 0.15
      order by
        case match_type
          when 'exact' then 0
          when 'prefix' then 1
          when 'fts' then 2
          else 3
        end,
        rank desc,
        document_id asc,
        node_key asc
      limit 60
    `);
    return rowsFromExecuteResult(result).map((row) => ({
      key: `${readString(row, "document_id")}/${readString(row, "node_key")}`,
      title: readString(row, "document_title"),
      body: readString(row, "body"),
      speaker: readNullableString(row, "speaker"),
      questTitle: readString(row, "document_title"),
      questType: readString(row, "document_type"),
      documentId: readString(row, "document_id"),
      nodeKey: readString(row, "node_key"),
      subquestKey: readNullableString(row, "subquest_key"),
      citation: {
        documentId: readString(row, "document_id"),
        locale: readString(row, "locale"),
        questKey: readString(row, "quest_key"),
        subquestKey: readNullableString(row, "subquest_key") ?? undefined,
        dialogueNodeKey: readString(row, "node_key"),
        revision: revisionId,
      },
      rank: readNumber(row, "rank"),
      matchType: readMatchType(row, "matchType", "match_type"),
    }));
  }

  async listDocumentHits(
    requestOrGameId: DocumentSearchRequest | string,
    maybeRevisionId?: string,
    maybeQuery?: string,
  ) {
    const request =
      typeof requestOrGameId === "string"
        ? {
            gameId: requestOrGameId,
            revisionId: maybeRevisionId ?? "",
            query: maybeQuery ?? "",
          }
        : requestOrGameId;
    const { gameId, revisionId, query } = request;
    const normalizedQuery = normalize(query);
    if (!normalizedQuery) return [];
    const prefix = `${escapeLike(normalizedQuery)}%`;
    const includeDocuments = request.includeDocuments !== false;
    const includeSegments = request.includeSegments !== false;
    const candidateLimit = Math.min(Math.max(request.candidateLimit ?? 120, 1), 500);
    const resultLimit = Math.min(Math.max(request.resultLimit ?? 120, 1), 500);
    const documentTypeFilter = request.documentTypes?.length
      ? sql`and d.type in (${sql.join(
          request.documentTypes.map((value) => sql`${value}`),
          sql`, `,
        )})`
      : sql``;
    const localeFilter = request.locales?.length
      ? sql`and d.locale in (${sql.join(
          request.locales.map((value) => sql`${value}`),
          sql`, `,
        )})`
      : sql``;
    if (includeDocuments && !includeSegments && request.documentTypes?.length) {
      const titleResult = await this.db.execute(sql`
        with search_terms as (
          select
            ${normalizedQuery}::text as normalized_query,
            ${prefix}::text as prefix
        ), candidates as (
          select d.id, d.source_key, d.title, d.type, d.locale,
                 case
                   when d.normalized_title = t.normalized_query then 1.0
                   when d.normalized_title like t.prefix escape '\\' then 0.9
                   when position(t.normalized_query in d.normalized_title) > 0 then 0.85
                   else 0.75
                 end::double precision as rank,
                 case
                   when d.normalized_title = t.normalized_query then 'exact'
                   when d.normalized_title like t.prefix escape '\\' then 'prefix'
                   when position(t.normalized_query in d.normalized_title) > 0
                     or d.source_key ilike ${`%${query.trim()}%`} then 'prefix'
                   else 'prefix'
                 end as match_type
          from knowledge.documents d
          cross join search_terms t
          where d.game_id = ${gameId}::uuid
            and d.revision_id = ${revisionId}::uuid
            and d.deleted = false
            ${documentTypeFilter}
            ${localeFilter}
            and (
              d.normalized_title = t.normalized_query
              or d.normalized_title like t.prefix escape '\\'
              or position(t.normalized_query in d.normalized_title) > 0
              or d.source_key ilike ${`%${query.trim()}%`}
            )
          order by
            case
              when d.normalized_title = t.normalized_query then 0
              when d.normalized_title like t.prefix escape '\\' then 1
              when position(t.normalized_query in d.normalized_title) > 0
                or d.source_key ilike ${`%${query.trim()}%`} then 2
              else 2
            end,
            rank desc,
            d.title asc,
            d.id asc
          limit ${resultLimit}
        )
        select
          c.id, c.source_key, c.title, c.type, c.locale,
          c.title as body,
          c.rank,
          c.match_type as "matchType"
        from candidates c
        order by
          case c.match_type
            when 'exact' then 0
            when 'prefix' then 1
            else 2
          end,
          c.rank desc,
          c.title asc,
          c.id asc
      `);
      const titleRows = rowsFromExecuteResult(titleResult).map(toDocumentDbHit);
      if (titleRows.length)
        return titleRows.map((row) => ({
          key: row.id,
          document: documentSummary(row),
          body: row.body.slice(0, 1200),
          title: row.title,
          segmentId: null,
          rank: row.rank,
          matchType: row.matchType,
        }));
    }
    const documentQuery = includeDocuments
      ? this.db.execute(sql`
        with search_terms as (
          select
            ${normalizedQuery}::text as normalized_query,
            ${prefix}::text as prefix,
            plainto_tsquery('simple'::regconfig, ${query.trim()}) as plain_query,
            websearch_to_tsquery('simple'::regconfig, ${query.trim()}) as web_query
        ), candidates as (
          select d.id, d.source_key, d.title, d.type, d.locale,
                 case when d.normalized_title = t.normalized_query then 1.0
                      when d.normalized_title like t.prefix escape '\\' then 0.8
                      when d.search_vector @@ t.plain_query or d.search_vector @@ t.web_query
                        then greatest(ts_rank(d.search_vector, t.plain_query), ts_rank(d.search_vector, t.web_query))
                      else similarity(d.normalized_title, t.normalized_query)
                 end::double precision as rank,
                 case when d.normalized_title = t.normalized_query then 'exact'
                      when d.normalized_title like t.prefix escape '\\' then 'prefix'
                      when d.search_vector @@ t.plain_query or d.search_vector @@ t.web_query then 'fts'
                      else 'trgm'
                 end as match_type
          from knowledge.documents d
          cross join search_terms t
          where d.game_id = ${gameId}::uuid
            and d.revision_id = ${revisionId}::uuid
            and d.deleted = false
            ${documentTypeFilter}
            ${localeFilter}
            and (
              d.normalized_title = t.normalized_query
              or d.normalized_title like t.prefix escape '\\'
              or d.search_vector @@ t.plain_query
              or d.search_vector @@ t.web_query
              or d.normalized_title % t.normalized_query
            )
          order by
            case
              when d.normalized_title = t.normalized_query then 0
              when d.normalized_title like t.prefix escape '\\' then 1
              when d.search_vector @@ t.plain_query or d.search_vector @@ t.web_query then 2
              else 3
            end,
            rank desc,
            d.title asc,
            d.id asc
          limit ${candidateLimit}
        )
          select
            c.id, c.source_key, c.title, c.type, c.locale,
            left(d.body, 1200) as body,
            c.rank,
            c.match_type as "matchType"
        from candidates c
        inner join knowledge.documents d on d.id = c.id
        order by
          case c.match_type
            when 'exact' then 0
            when 'prefix' then 1
            when 'fts' then 2
            else 3
          end,
          c.rank desc,
          c.title asc,
          c.id asc
        limit ${resultLimit}
      `)
      : Promise.resolve([]);
    const segmentQuery = includeSegments
      ? this.db.execute(sql`
        with search_terms as (
          select
            ${normalizedQuery}::text as normalized_query,
            ${prefix}::text as prefix,
            plainto_tsquery('simple'::regconfig, ${query.trim()}) as plain_query,
            websearch_to_tsquery('simple'::regconfig, ${query.trim()}) as web_query
        ), candidates as (
          select
            ds.document_id,
            d.id,
            d.source_key,
            d.title,
            d.type,
            d.locale,
            ds.id as segment_id,
            case
              when lower(ds.body) = t.normalized_query
                or d.normalized_title = t.normalized_query then 1.0
              when lower(ds.body) like t.prefix escape '\\'
                or d.normalized_title like t.prefix escape '\\' then 0.8
              when ds.search_vector @@ t.plain_query
                or ds.search_vector @@ t.web_query then greatest(
                  ts_rank(ds.search_vector, t.plain_query),
                  ts_rank(ds.search_vector, t.web_query)
              )
              else greatest(
                similarity(ds.search_text, t.normalized_query),
                similarity(d.normalized_title, t.normalized_query)
              )
            end::double precision as rank,
            case
              when lower(ds.body) = t.normalized_query
                or d.normalized_title = t.normalized_query then 'exact'
              when lower(ds.body) like t.prefix escape '\\'
                or d.normalized_title like t.prefix escape '\\' then 'prefix'
              when ds.search_vector @@ t.plain_query
                or ds.search_vector @@ t.web_query then 'fts'
              else 'trgm'
            end as match_type
          from knowledge.document_segments ds
          inner join knowledge.documents d on d.id = ds.document_id
          cross join search_terms t
          where ds.revision_id = ${revisionId}::uuid
            and d.revision_id = ${revisionId}::uuid
            and d.game_id = ${gameId}::uuid
            and d.deleted = false
            ${documentTypeFilter}
            ${localeFilter}
            and (
              lower(ds.body) = t.normalized_query
              or d.normalized_title = t.normalized_query
              or lower(ds.body) like t.prefix escape '\\'
              or d.normalized_title like t.prefix escape '\\'
              or ds.search_vector @@ t.plain_query
              or ds.search_vector @@ t.web_query
              or ds.search_text % t.normalized_query
              or d.normalized_title % t.normalized_query
            )
          order by
            case
              when lower(ds.body) = t.normalized_query or d.normalized_title = t.normalized_query then 0
              when lower(ds.body) like t.prefix escape '\\' or d.normalized_title like t.prefix escape '\\' then 1
              when ds.search_vector @@ t.plain_query or ds.search_vector @@ t.web_query then 2
              else 3
            end,
            rank desc,
            ds.document_id asc,
            ds.id asc
          limit ${candidateLimit}
        )
        select
          c.document_id,
          c.segment_id,
          left(ds.body, 1200) as segment_body,
          c.id,
          c.source_key,
          c.title,
          c.type,
          c.locale,
          ''::text as document_body,
          c.rank,
          c.match_type as "matchType"
        from candidates c
        inner join knowledge.document_segments ds on ds.id = c.segment_id
        order by
          case c.match_type
            when 'exact' then 0
            when 'prefix' then 1
            when 'fts' then 2
            else 3
          end,
          c.rank desc,
          c.document_id asc
        limit ${resultLimit}
      `)
      : Promise.resolve([]);
    const [documentResult, segmentResult] = await Promise.all([documentQuery, segmentQuery]);

    const documentRows = rowsFromExecuteResult(documentResult).map(toDocumentDbHit);
    const segmentRows = rowsFromExecuteResult(segmentResult).map(toSegmentDbHit);
    const documentsById = new Map(documentRows.map((row) => [row.id, row]));
    const bestSegmentByDocument = new Map<string, SegmentDbHit>();
    for (const row of segmentRows) {
      const current = bestSegmentByDocument.get(row.documentId);
      if (!current || isBetterRankedHit(row, current))
        bestSegmentByDocument.set(row.documentId, row);
    }

    const documentHits = documentRows.map((row) => {
      const segment = bestSegmentByDocument.get(row.id);
      const best = segment && isBetterRankedHit(segment, row) ? segment : row;
      return {
        key: row.id,
        document: documentSummary(row),
        body: segment?.segmentBody ?? row.body.slice(0, 1200),
        title: row.title,
        segmentId: segment && isBetterRankedHit(segment, row) ? segment.segmentId : null,
        rank: best.rank,
        matchType: best.matchType,
      };
    });
    const segmentOnlyHits = [...bestSegmentByDocument.values()]
      .filter((row) => !documentsById.has(row.documentId))
      .map((row) => ({
        key: row.documentId,
        document: documentSummary(row),
        body: row.segmentBody,
        title: row.title,
        segmentId: row.segmentId,
        rank: row.rank,
        matchType: row.matchType,
      }));
    return [...documentHits, ...segmentOnlyHits];
  }
}

function cleanFilter(value: string | undefined): string | undefined {
  const cleaned = value?.normalize("NFKC").trim();
  return cleaned || undefined;
}

function rowsFromExecuteResult(result: unknown): DbRow[] {
  if (Array.isArray(result)) return result.filter(isDbRow);
  if (result && typeof result === "object" && "rows" in result) {
    const rows = (result as { rows?: unknown }).rows;
    return Array.isArray(rows) ? rows.filter(isDbRow) : [];
  }
  return [];
}

function isDbRow(value: unknown): value is DbRow {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readValue(row: DbRow, ...keys: string[]): unknown {
  for (const key of keys) if (key in row) return row[key];
  return undefined;
}

function readString(row: DbRow, ...keys: string[]): string {
  const value = readValue(row, ...keys);
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function readNullableString(row: DbRow, ...keys: string[]): string | null {
  const value = readValue(row, ...keys);
  return value == null ? null : typeof value === "string" ? value : String(value);
}

function readStringArray(row: DbRow, ...keys: string[]): string[] {
  const value = readValue(row, ...keys);
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function readNumber(row: DbRow, ...keys: string[]): number {
  const value = Number(readValue(row, ...keys) ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function readMatchType(row: DbRow, ...keys: string[]): SearchMatchType {
  const value = readValue(row, ...keys);
  return value === "exact" || value === "prefix" || value === "fts" || value === "trgm"
    ? value
    : "fts";
}

function toDocumentDbHit(row: DbRow): DocumentDbHit {
  return {
    id: readString(row, "id"),
    sourceKey: readNullableString(row, "source_key", "sourceKey"),
    title: readString(row, "title"),
    type: readString(row, "type"),
    locale: readNullableString(row, "locale"),
    body: readString(row, "body"),
    rank: readNumber(row, "rank"),
    matchType: readMatchType(row, "matchType", "match_type"),
  };
}

function toSegmentDbHit(row: DbRow): SegmentDbHit {
  return {
    ...toDocumentDbHit(row),
    documentId: readString(row, "document_id", "documentId"),
    segmentId: readString(row, "segment_id", "segmentId"),
    segmentBody: readString(row, "segment_body", "segmentBody"),
  };
}

function documentSummary(row: DocumentDbHit) {
  return {
    id: row.id,
    sourceKey: row.sourceKey,
    title: row.title,
    type: row.type as DocumentType,
    locale: row.locale,
  };
}

function matchTypePriority(matchType: SearchMatchType): number {
  switch (matchType) {
    case "exact":
      return 4;
    case "prefix":
      return 3;
    case "fts":
      return 2;
    case "trgm":
      return 1;
  }
}

function isBetterRankedHit(candidate: DocumentDbHit, current: DocumentDbHit): boolean {
  const candidatePriority = matchTypePriority(candidate.matchType);
  const currentPriority = matchTypePriority(current.matchType);
  return (
    candidatePriority > currentPriority ||
    (candidatePriority === currentPriority && candidate.rank > current.rank)
  );
}
