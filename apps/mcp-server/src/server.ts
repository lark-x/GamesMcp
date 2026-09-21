import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KnowledgeRepository } from "@gip/domain";
import {
  DomainError,
  GameDomainService,
  KnowledgeService,
  type TextBindingType,
} from "@gip/domain";
import {
  type DocumentType,
  documentIdSchema,
  entityIdSchema,
  relationshipPredicateSchema,
  segmentIdSchema,
} from "@gip/contracts";
import { z } from "zod";
import {
  budgetForPageSize,
  DEFAULT_MCP_RESPONSE_BUDGET,
  rankCandidate,
  shapeForBudget,
} from "@gip/search";
import type { GameProviderRegistry } from "@gip/providers";
import { normalizeGameSlug } from "@gip/providers";
import { registerGameProviderTools } from "./tools/provider-tools.js";

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function errorResult(code: string, message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message } }) }],
  };
}

// Sprint 20: unified MCP response budget. List-returning search tools pass
// their hits through this shaper so item count, excerpts and total bytes stay
// bounded regardless of upstream result size.
function shapeSearchForBudget(
  items: Array<{ title?: string; excerpt?: string }>,
  budget = DEFAULT_MCP_RESPONSE_BUDGET,
) {
  return shapeForBudget(items, budget);
}

function errorResultFrom(error: unknown, fallbackCode: string, fallbackMessage: string) {
  return error instanceof DomainError
    ? errorResult(error.code, error.message)
    : errorResult(fallbackCode, fallbackMessage);
}

export interface McpServerOptions {
  providers?: GameProviderRegistry;
}

export function createMcpServer(
  repository: KnowledgeRepository,
  options: McpServerOptions = {},
): McpServer {
  const server = new McpServer({ name: "game-intelligence-platform", version: "0.1.0" });
  const domain = new KnowledgeService(repository);
  const gameDomain = new GameDomainService(repository);

  // Sprint 19: game_id is optional on every tool. When omitted, the platform
  // resolves the single registered public game so MCP callers never need an
  // internal UUID. Ambiguity is an explicit error, not a guess.
  const optionalGameId = z.string().uuid().optional();

  async function resolveGameId(gameIdInput: string | undefined): Promise<string> {
    if (gameIdInput) return gameIdInput;
    const games = await repository.listGames();
    const first = games[0];
    if (games.length === 1 && first) return first.id;
    if (games.length === 0)
      throw new DomainError("no_game_registered", "No game is registered in the platform");
    throw new DomainError(
      "game_id_required",
      "Multiple games are registered; pass game_id explicitly",
      { registered: games.length },
      400,
    );
  }

  server.tool("list_games", "List games registered in the knowledge platform.", {}, async () => {
    try {
      const games = await repository.listGames();
      const providerHealth = options.providers ? await options.providers.health() : [];
      return textResult({
        games: games.map((game) => {
          const health = providerHealth.filter(
            (provider) => normalizeGameSlug(provider.game) === normalizeGameSlug(game.slug),
          );
          return {
            ...game,
            providers: health.reduce<Record<string, string>>((accumulator, provider) => {
              accumulator[provider.kind] = provider.status;
              accumulator[provider.id] = provider.status;
              return accumulator;
            }, {}),
          };
        }),
      });
    } catch (error) {
      return errorResultFrom(error, "list_games_failed", "Games could not be loaded");
    }
  });

  registerGameProviderTools(server, options.providers);

  server.tool(
    "get_game_capabilities",
    "List capabilities enabled for a game.",
    { game_id: optionalGameId },
    async ({ game_id: gameIdInput }) => {
      try {
        const game_id = await resolveGameId(gameIdInput);
        await domain.requireGame(game_id);
        return textResult({ game_id, capabilities: await repository.getCapabilities(game_id) });
      } catch (error) {
        return errorResultFrom(error, "game_not_found", "Game was not found");
      }
    },
  );

  const nameInput = z.string().trim().min(1).max(120);

  /**
   * Item text lives under different document types per game: Genshin uses
   * item_description, StarRail splits into item_lore plus lightcone_lore and
   * relic_lore. Selecting by game keeps one tool usable for both corpora.
   */
  /**
   * Game slugs are hyphenated ("honkai-star-rail"), so matching only on
   * "starrail" never hits. Accept the separator-less, hyphenated and "honkai"
   * forms, mirroring the existing checks elsewhere in the platform.
   */
  async function isStarRail(gameId: string): Promise<boolean> {
    const game = await repository.getGame(gameId);
    const slug = (game?.slug ?? "").toLowerCase();
    return slug.includes("starrail") || slug.includes("star-rail") || slug.includes("honkai");
  }

  async function itemDocumentTypes(gameId: string): Promise<DocumentType[]> {
    return (await isStarRail(gameId))
      ? ["item_lore", "lightcone_lore", "relic_lore"]
      : ["item_description"];
  }

  /**
   * Mechanism-style explainer text is stored under one document type per game:
   * Genshin splits it across mechanism/tutorial/guide/tip kinds, StarRail keeps
   * tutorial-style prose in story_atlas and train_visitor alongside messages.
   */
  async function mechanismDocumentTypes(gameId: string): Promise<DocumentType[]> {
    if (await isStarRail(gameId)) {
      return ["mechanism", "tutorial", "guide", "story_atlas"];
    }
    return [
      "mechanism",
      "tutorial",
      "guide",
      "exploration_tip",
      "system_tip",
      "loading_tips",
      "gcg",
      "activity_tutorial",
    ];
  }

  server.tool(
    "get_character",
    "Get one playable character by display name with structured facts.",
    { game_id: optionalGameId, name: nameInput },
    async ({ game_id: gameIdInput, name }) => {
      try {
        const game_id = await resolveGameId(gameIdInput);
        const character = await gameDomain.findStructuredByName(game_id, "character", name);
        if (!character)
          return errorResult("character_not_found", `Character was not found: ${name}`);
        return textResult({ character });
      } catch (error) {
        return errorResultFrom(error, "get_character_failed", "Character could not be loaded");
      }
    },
  );

  server.tool(
    "get_material",
    "Get one material by display name, including usage and sources.",
    { game_id: optionalGameId, name: nameInput },
    async ({ game_id: gameIdInput, name }) => {
      try {
        const game_id = await resolveGameId(gameIdInput);
        const material = await gameDomain.findStructuredByName(game_id, "material", name);
        if (!material) return errorResult("material_not_found", `Material was not found: ${name}`);
        return textResult({ material });
      } catch (error) {
        return errorResultFrom(error, "get_material_failed", "Material could not be loaded");
      }
    },
  );

  server.tool(
    "get_equipment",
    "Get one signature equipment (Genshin weapon or StarRail light cone) by display name with structured facts.",
    { game_id: optionalGameId, name: nameInput },
    async ({ game_id: gameIdInput, name }) => {
      try {
        const game_id = await resolveGameId(gameIdInput);
        const equipment = await gameDomain.findStructuredByName(game_id, "weapon", name);
        if (!equipment)
          return errorResult("equipment_not_found", `Equipment was not found: ${name}`);
        return textResult({ equipment });
      } catch (error) {
        return errorResultFrom(error, "get_equipment_failed", "Equipment could not be loaded");
      }
    },
  );

  server.tool(
    "get_enemy",
    "Get one enemy or boss by display name with structured facts.",
    { game_id: optionalGameId, name: nameInput },
    async ({ game_id: gameIdInput, name }) => {
      try {
        const game_id = await resolveGameId(gameIdInput);
        const enemy = await gameDomain.findStructuredByName(game_id, "enemy", name);
        if (!enemy) return errorResult("enemy_not_found", `Enemy was not found: ${name}`);
        return textResult({ enemy });
      } catch (error) {
        return errorResultFrom(error, "get_enemy_failed", "Enemy could not be loaded");
      }
    },
  );

  server.tool(
    "resolve_entity",
    "Resolve a display name or alias to the canonical entity with confidence.",
    { game_id: optionalGameId, query: z.string().trim().min(1).max(200) },
    async ({ game_id: gameIdInput, query }) => {
      try {
        const game_id = await resolveGameId(gameIdInput);
        const entity = await gameDomain.resolveAlias(game_id, query);
        if (!entity) return errorResult("entity_not_found", `Entity was not found: ${query}`);
        return textResult({
          entityType: entity.type,
          id: entity.id,
          canonicalName: entity.name,
          matchedText: query,
          sourceKey: entity.sourceKey,
          aliases: entity.aliases,
        });
      } catch (error) {
        return errorResultFrom(error, "resolve_entity_failed", "Entity resolution failed");
      }
    },
  );

  /**
   * Unified retrieval entry point. Every corpus (dialogue, quest, document,
   * item, mechanism, structured record) is searched in one pass and merged into
   * a single relevance-ordered list, so callers never have to guess which of a
   * dozen surface-specific tools to use. Results carry a `type` tag plus
   * citation ids that feed the `get_*` detail tools.
   */
  /**
   * Share of a page reserved for the per-surface floor. At 0.5, half the page
   * is split evenly across every matching surface and the rest is filled by
   * score, so a surface holding the prose answer cannot be fully evicted by a
   * surface that only has many high-scoring look-alikes.
   */
  const QUOTA_PAGE_SHARE = 0.5;
  const searchTypeSchema = z.enum([
    "all",
    "dialogue",
    "quest",
    "document",
    "item",
    "mechanism",
    "structured",
  ]);

  server.tool(
    "search",
    "Search all published game text (dialogue, quests, documents, items, mechanics, structured records) in one call and return relevance-ordered hits with citations.",
    {
      game_id: optionalGameId,
      query: z.string().trim().min(1).max(500),
      type: searchTypeSchema.default("all"),
      speaker: z.string().trim().min(1).max(200).optional(),
      quest: z.string().trim().min(1).max(200).optional(),
      // Chinese is the default reading language. The corpus is bilingual
      // (Genshin stores each quest twice: zh-CN plus an en twin), so pass a
      // locale such as "en" to search the English material instead.
      locale: z.string().trim().min(1).max(40).optional(),
      limit: z.number().int().min(1).max(50).default(10),
    },
    async ({ game_id: gameIdInput, query, type, speaker, quest, locale, limit }) => {
      try {
        const game_id = await resolveGameId(gameIdInput);
        await gameDomain.requireCapability(game_id, "lore_search");
        const revisionId = await requirePublicRevision(repository, game_id);

        const wants = (surface: string) => type === "all" || type === surface;
        /**
         * Locale scoping. The corpus is bilingual: Genshin keeps each quest
         * twice (zh-CN plus an en twin with the same dialogue), so an
         * unfiltered search can return English rows for an English query and
         * mixes the two languages in one result list. Chinese is the default
         * reading language; callers opt into another language explicitly.
         */
        const requestedLocales = locale ? [locale] : ["zh-CN"];
        const localeFilter = <T extends Record<string, unknown>>(base: T): T =>
          ({ ...base, locales: requestedLocales }) as T;
        // Surface-specific document types keep item/mechanism scoping intact.
        const itemTypes = wants("item") ? await itemDocumentTypes(game_id) : [];
        const mechanismTypes = wants("mechanism") ? await mechanismDocumentTypes(game_id) : [];

        const [structuredResult, documentResult, dialogue, quests, itemResult, mechanismResult] =
          await Promise.all([
            wants("structured")
              ? repository.search(game_id, {
                  query,
                  types: ["entity"],
                  limit,
                  revisionId,
                  debug: false,
                })
              : Promise.resolve(null),
            wants("document")
              ? repository.search(
                  game_id,
                  localeFilter({
                    query,
                    types: ["document", "segment"],
                    limit,
                    revisionId,
                    debug: false,
                  }),
                )
              : Promise.resolve(null),
            wants("dialogue") && repository.searchDialogue
              ? repository.searchDialogue(game_id, {
                  query,
                  limit,
                  revisionId,
                  ...(speaker ? { speaker } : {}),
                  ...(quest ? { quest } : {}),
                  locale: requestedLocales[0],
                } as Parameters<NonNullable<typeof repository.searchDialogue>>[1])
              : Promise.resolve([]),
            wants("quest") && repository.searchQuests
              ? repository.searchQuests(game_id, {
                  query,
                  limit,
                  locale: requestedLocales[0],
                  revisionId,
                })
              : Promise.resolve([]),
            wants("item")
              ? repository.search(
                  game_id,
                  localeFilter({
                    query,
                    types: ["document"],
                    documentTypes: itemTypes,
                    limit,
                    revisionId,
                    debug: false,
                  }),
                )
              : Promise.resolve(null),
            wants("mechanism")
              ? repository.search(
                  game_id,
                  localeFilter({
                    query,
                    types: ["document", "segment"],
                    documentTypes: mechanismTypes,
                    limit,
                    revisionId,
                    debug: false,
                  }),
                )
              : Promise.resolve(null),
          ]);

        // A single search call owns the revision-not-ready contract: when the
        // platform has no searchable revision the tool must report
        // index_not_ready rather than silently returning zero hits.
        for (const result of [structuredResult, documentResult, itemResult, mechanismResult]) {
          if (result && !result.revision)
            return errorResult("index_not_ready", "No searchable Dataset Revision is ready");
        }

        const toDocumentHits = (result: typeof documentResult, options: { segments: boolean }) => [
          ...(result?.documents ?? []).map((doc) => ({
            id: doc.id,
            title: doc.title,
            excerpt: doc.snippet ?? null,
            segmentId: null as string | null,
            score: doc.score ?? 0,
          })),
          ...(options.segments
            ? (result?.segments ?? []).map((seg) => ({
                id: seg.id,
                title: seg.title,
                excerpt: seg.snippet ?? null,
                segmentId: seg.segmentId ?? null,
                score: seg.score ?? 0,
              }))
            : []),
        ];
        /**
         * Structured hits come from the shared search core, which reads the
         * routable structured catalog (character / material / weapon /
         * artifact / enemy / voice / achievement). The legacy `entities` index
         * is a different surface: it only carries npc/quest/item rows, so using
         * it here made weapons and artifacts unreachable from `search` even
         * though they are real published records. Fall back to it only when the
         * core result is unavailable (older adapters and test doubles).
         */
        const structuredRecords = structuredResult?.coreHits?.structured;
        const structured: Array<{
          name: string;
          summary?: string | null;
          id: string;
          sourceKey?: string | null;
          kind?: string;
          score?: number;
        }> = structuredRecords?.length
          ? structuredRecords.map((hit) => ({
              name: hit.name,
              summary: hit.body?.trim() ? hit.body : null,
              id: hit.stableId,
              sourceKey: null,
              kind: hit.kind,
              score: hit.score,
            }))
          : (structuredResult?.entities ?? []).map((hit) => ({
              name: hit.name,
              summary: hit.summary ?? null,
              id: hit.id,
              sourceKey: hit.sourceKey ?? null,
              kind: hit.type,
              score: 0,
            }));
        const documents = toDocumentHits(documentResult, { segments: true });
        const items = toDocumentHits(itemResult, { segments: false });
        const mechanics = toDocumentHits(mechanismResult, { segments: true });

        type UnifiedHit = {
          type: string;
          title: string;
          excerpt?: string | null;
          score: number;
          questKey?: string;
          documentId?: string;
          segmentId?: string | null;
          dialogueNodeKey?: string;
          speaker?: string | null;
          stableId?: string;
          sourceKey?: string | null;
          structuredKind?: string | null;
          citation?: unknown;
        };

        const hits: UnifiedHit[] = [
          ...dialogue.map((hit) => ({
            type: "dialogue" as const,
            title: hit.quest,
            excerpt: hit.text,
            score: hit.score,
            questKey: hit.citation.questKey,
            documentId: hit.citation.documentId,
            dialogueNodeKey: hit.dialogueNodeKey,
            speaker: hit.speaker,
            citation: hit.citation,
          })),
          ...quests.map((item) => ({
            type: "quest" as const,
            title: item.title,
            excerpt: item.excerpt ?? null,
            // Quest hits are ranked locally: the SQL tier only reports how the
            // row was found, and searchQuests does not return a numeric score.
            score: rankCandidate(query, { title: item.title, body: item.excerpt ?? "" }).score,
            questKey: item.questKey,
            documentId: item.documentId,
          })),
          ...items.map((hit) => ({
            type: "item" as const,
            title: hit.title,
            excerpt: hit.excerpt,
            score: hit.score,
            documentId: hit.id,
            sourceKey: null as string | null,
          })),
          ...mechanics.map((hit) => ({
            type: "mechanism" as const,
            title: hit.title,
            excerpt: hit.excerpt,
            score: hit.score,
            documentId: hit.id,
            segmentId: hit.segmentId,
            sourceKey: null as string | null,
          })),
          ...documents.map((hit) => ({
            type: "document" as const,
            title: hit.title,
            excerpt: hit.excerpt,
            score: hit.score,
            documentId: hit.id,
            segmentId: hit.segmentId,
            sourceKey: null as string | null,
          })),
          ...structured.map((hit) => ({
            type: "structured" as const,
            title: hit.name,
            excerpt: hit.summary ?? null,
            // The shared search core already scored these hits against the
            // query, so keeping the real score lets structured rows compete
            // with dialogue and documents instead of always sorting last.
            score: hit.score ?? 0,
            stableId: hit.id,
            sourceKey: hit.sourceKey,
            structuredKind: hit.kind ?? null,
          })),
        ];

        // Relevance-first ordering; ties break on title then a stable id so the
        // same query always returns the same ordering.
        const compareHits = (left: UnifiedHit, right: UnifiedHit) =>
          right.score - left.score ||
          left.title.localeCompare(right.title, "zh-CN") ||
          String(left.documentId ?? left.stableId ?? "").localeCompare(
            String(right.documentId ?? right.stableId ?? ""),
          );

        /**
         * Merge with a per-surface floor.
         *
         * Each surface scores on its own scale: structured/document reach ~8.8
         * while dialogue caps around 6.6, so pure score ordering lets a surface
         * that merely has many high-scoring look-alikes evict the surface that
         * actually holds the prose answer. Guaranteeing every matching surface a
         * share of the page keeps quest and dialogue text reachable, then the
         * remainder is filled by score. Display order stays score-first.
         */
        const bySurface = new Map<string, UnifiedHit[]>();
        for (const hit of hits) {
          const bucket = bySurface.get(hit.type);
          if (bucket) bucket.push(hit);
          else bySurface.set(hit.type, [hit]);
        }
        const surfaces = [...bySurface.values()]
          .map((bucket) => bucket.sort(compareHits))
          .filter((bucket) => bucket.length > 0);
        const reserved = Math.max(1, Math.floor((limit * QUOTA_PAGE_SHARE) / surfaces.length));
        // Quota picks are reserved first, then leftover slots are filled by
        // score. Selecting before sorting is what makes the floor real:
        // re-sorting the whole candidate set would push the lower-scoring
        // quota picks past the cut-off again.
        const selected: UnifiedHit[] = [];
        for (const bucket of surfaces) {
          // Within a surface the order is already score-first.
          for (const hit of bucket.slice(0, reserved)) {
            if (selected.length >= limit) break;
            selected.push(hit);
          }
          if (selected.length >= limit) break;
        }
        const selectedKeys = new Set(selected);
        const remainder = surfaces
          .flatMap((bucket) => bucket)
          .filter((hit) => !selectedKeys.has(hit))
          .sort(compareHits);
        for (const hit of remainder) {
          if (selected.length >= limit) break;
          selected.push(hit);
        }
        const merged = selected.sort(compareHits);

        const shaped = shapeSearchForBudget(
          merged.map((hit) => ({ ...hit, excerpt: hit.excerpt ?? undefined })),
          // The caller's limit is the page size. Both the item cap and the byte
          // ceiling scale with it: the default budget is sized for a 10-item
          // page, so reusing it for a larger page silently dropped the tail,
          // including surfaces held to the quota floor.
          budgetForPageSize(limit),
        );
        return textResult({
          query,
          type,
          revision: revisionId,
          hits: shaped.items,
          returnedCount: shaped.items.length,
          truncated: shaped.truncated,
          nextCursor: null,
          estimatedBytes: shaped.estimatedBytes,
        });
      } catch (error) {
        return errorResultFrom(error, "search_failed", "Search failed");
      }
    },
  );

  server.tool(
    "get_quest",
    "Read a published quest with subquests, paginated dialogue nodes, branch edges and citations.",
    {
      game_id: optionalGameId,
      quest_id: z.string().min(1).max(120),
      locale: z.string().min(1).max(40).default("zh-CN"),
      subquest_id: z.string().min(1).max(120).optional(),
      cursor: z.string().min(1).optional(),
      node_limit: z.number().int().min(1).max(300).default(100),
    },
    async ({ game_id: gameIdInput, quest_id, locale, subquest_id, cursor, node_limit }) => {
      try {
        const game_id = await resolveGameId(gameIdInput);
        await domain.requireCapability(game_id, "lore_search");
        const revisionId = await requirePublicRevision(repository, game_id);
        if (!repository.getQuest)
          throw new DomainError("quest_tools_not_ready", "Quest reading is not implemented");
        const quest = await repository.getQuest(game_id, {
          questKey: quest_id,
          locale,
          cursor,
          nodeLimit: node_limit,
          revisionId,
        });
        if (!quest) throw new DomainError("quest_not_found", "Quest was not found", undefined, 404);
        if (!subquest_id) return textResult({ quest });
        const subquestKey = subquest_id.startsWith("quest/")
          ? subquest_id
          : `${quest.questKey}/subquest/${subquest_id}`;
        const dialogueNodes = quest.dialogueNodes.filter(
          (node) => node.subquestKey === subquestKey,
        );
        const nodeKeys = new Set(dialogueNodes.map((node) => node.nodeKey));
        return textResult({
          quest: {
            ...quest,
            subquests: quest.subquests.filter((subquest) => subquest.subquestKey === subquestKey),
            dialogueNodes,
            dialogueEdges: quest.dialogueEdges.filter((edge) => nodeKeys.has(edge.fromNodeKey)),
            citations: quest.citations.filter((citation) => citation.subquestKey === subquestKey),
          },
        });
      } catch (error) {
        return errorResultFrom(error, "get_quest_failed", "Quest could not be loaded");
      }
    },
  );

  /**
   * Reads any published document by id, replacing the former split between
   * get_lore_document and get_item_text. Item results from `search` carry a
   * documentId, so one reader covers lore, items and mechanisms alike.
   */
  server.tool(
    "get_document",
    "Read a published document (lore, item text, mechanism or quest body) by document id, with citation-addressable segments.",
    {
      game_id: optionalGameId,
      document_id: documentIdSchema,
      segment_id: segmentIdSchema.optional(),
      max_chars: z.number().int().min(100).max(20_000).default(8_000),
    },
    async ({ game_id: gameIdInput, document_id, segment_id, max_chars }) => {
      try {
        const game_id = await resolveGameId(gameIdInput);
        await domain.requireCapability(game_id, "lore_search");
        const revisionId = await requirePublicRevision(repository, game_id);
        const document = await domain.getDocument(game_id, document_id, revisionId);
        if (segment_id && !document.segments.some((segment) => segment.id === segment_id))
          throw new DomainError("segment_not_found", "Segment was not found", undefined, 404);
        return textResult({ document: truncateDocument(document, segment_id, max_chars) });
      } catch (error) {
        return errorResultFrom(error, "document_not_found", "Document was not found");
      }
    },
  );

  server.tool(
    "get_relationships",
    "Get one-hop relationships for an entity.",
    {
      game_id: optionalGameId,
      entity_id: entityIdSchema,
      predicate: relationshipPredicateSchema.optional(),
      limit: z.number().int().min(1).max(100).default(50),
    },
    async ({ game_id: gameIdInput, entity_id, predicate, limit }) => {
      try {
        const game_id = await resolveGameId(gameIdInput);
        await domain.requireCapability(game_id, "relationships");
        const revisionId = await requirePublicRevision(repository, game_id);
        await domain.getEntity(game_id, entity_id, revisionId);
        return textResult({
          game_id,
          entity_id,
          relationships: await repository.getRelationships(game_id, entity_id, {
            predicate,
            limit,
            revisionId,
          }),
        });
      } catch (error) {
        return errorResultFrom(error, "relationships_failed", "Relationships failed");
      }
    },
  );

  server.tool(
    "get_entity_texts",
    "Get published texts bound to an entity (stories, mentions, descriptions) with citations.",
    {
      game_id: optionalGameId,
      entity_id: z.string().min(1).max(200),
      binding_type: z.string().trim().min(1).max(60).optional(),
    },
    async ({ game_id: gameIdInput, entity_id, binding_type }) => {
      try {
        const game_id = await resolveGameId(gameIdInput);
        const texts = await gameDomain.getEntityTexts(
          game_id,
          entity_id,
          binding_type as TextBindingType | undefined,
        );
        const shaped = shapeForBudget(
          texts.map((binding) => ({
            bindingType: binding.bindingType,
            bindingSource: binding.bindingSource,
            confidence: binding.confidence,
            documentId: binding.documentId,
            segmentId: binding.segmentId ?? undefined,
            title: binding.documentTitle ?? binding.bindingType,
            excerpt:
              binding.excerpt ?? (binding.metadata ? JSON.stringify(binding.metadata) : undefined),
          })),
        );
        return textResult({
          entity_id,
          bindings: shaped.items,
          returnedCount: shaped.items.length,
          truncated: shaped.truncated,
          nextCursor: null,
          estimatedBytes: shaped.estimatedBytes,
        });
      } catch (error) {
        return errorResultFrom(error, "entity_texts_failed", "Entity texts could not be loaded");
      }
    },
  );

  server.resource(
    "game",
    new ResourceTemplate("game://{game_id}", { list: undefined }),
    async (uri, variables) => {
      try {
        const id = String(variables.game_id);
        const revisionId = await requirePublicRevision(repository, id);
        const game = await repository.getGame(id);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(
                game
                  ? { ...game, currentRevision: revisionId }
                  : { error: { code: "game_not_found" } },
              ),
            },
          ],
        };
      } catch (error) {
        return resourceError(uri.href, error, "game_not_found");
      }
    },
  );
  server.resource(
    "entity",
    new ResourceTemplate("entity://{game_id}/{entity_id}", { list: undefined }),
    async (uri, variables) => {
      try {
        const revisionId = await requirePublicRevision(repository, String(variables.game_id));
        const entity = await domain.getEntity(
          String(variables.game_id),
          String(variables.entity_id),
          revisionId,
        );
        return {
          contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(entity) }],
        };
      } catch (error) {
        return resourceError(uri.href, error, "entity_not_found");
      }
    },
  );
  server.resource(
    "document",
    new ResourceTemplate("document://{game_id}/{document_id}", { list: undefined }),
    async (uri, variables) => {
      try {
        const revisionId = await requirePublicRevision(repository, String(variables.game_id));
        const document = await domain.getDocument(
          String(variables.game_id),
          String(variables.document_id),
          revisionId,
        );
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(truncateDocument(document, undefined, 8_000)),
            },
          ],
        };
      } catch (error) {
        return resourceError(uri.href, error, "document_not_found");
      }
    },
  );
  server.resource(
    "revision",
    new ResourceTemplate("revision://{game_id}/current", { list: undefined }),
    async (uri, variables) => {
      try {
        const revisions = await repository.listRevisions(String(variables.game_id));
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(
                revisions.find(
                  (revision) =>
                    revision.isCurrent &&
                    revision.lifecycleStatus === "published" &&
                    revision.indexStatus === "ready",
                ) ?? null,
              ),
            },
          ],
        };
      } catch (error) {
        return resourceError(uri.href, error, "revision_not_found");
      }
    },
  );
  return server;
}

/** Snapshot the public read boundary once per request. Preview, retired, stale and
 * unindexed revisions are intentionally invisible to MCP. */
async function requirePublicRevision(repository: KnowledgeRepository, gameId: string) {
  return new GameDomainService(repository).requirePublicRevision(gameId);
}

function truncateDocument(
  document: Awaited<ReturnType<KnowledgeRepository["getDocument"]>> extends infer Detail
    ? Exclude<Detail, null>
    : never,
  segmentId: string | undefined,
  maxChars: number,
) {
  const segments = segmentId
    ? document.segments.filter((segment) => segment.id === segmentId)
    : document.segments;
  let remaining = maxChars;
  const truncatedSegments = segments.map((segment) => {
    const body = segment.body.slice(0, Math.max(0, remaining));
    remaining -= body.length;
    return { ...segment, body };
  });
  return {
    ...document,
    body: document.body.slice(0, maxChars),
    segments: truncatedSegments,
    truncated:
      document.body.length > maxChars ||
      truncatedSegments.some((segment, index) => {
        const original = segments[index];
        return Boolean(original && original.body.length > segment.body.length);
      }),
  };
}

function resourceError(uri: string, error: unknown, fallbackCode: string) {
  const domainError = error instanceof DomainError ? error : undefined;
  return {
    contents: [
      {
        uri,
        mimeType: "application/json",
        text: JSON.stringify({
          error: {
            code: domainError?.code ?? fallbackCode,
            message: domainError?.message ?? "Resource could not be loaded",
          },
        }),
      },
    ],
  };
}
