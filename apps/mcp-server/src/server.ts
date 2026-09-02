import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KnowledgeRepository } from "@gip/domain";
import {
  DomainError,
  GameDomainService,
  KnowledgeService,
  type TextBindingType,
} from "@gip/domain";
import {
  type DocumentSummary,
  documentIdSchema,
  documentTypeSchema,
  entityIdSchema,
  entityTypeSchema,
  relationshipPredicateSchema,
  segmentIdSchema,
} from "@gip/contracts";
import { z } from "zod";
import { DEFAULT_MCP_RESPONSE_BUDGET, shapeForBudget } from "@gip/search";
import type { GameProviderRegistry } from "@gip/providers";
import { normalizeGameSlug } from "@gip/providers";
import { registerGameProviderTools } from "./tools/provider-tools.js";

const questTypeSchema = z.enum([
  "archon_quest",
  "story_quest",
  "world_quest",
  "event_quest",
  "commission",
  "hangout",
  "other",
]);

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

function materialCandidatesForItemDocument(
  document: DocumentSummary & { provenance?: Record<string, unknown> },
): string[] {
  const sourceKey = document.sourceKey ?? "";
  const sourceMatch = /^item\/(.+)$/u.exec(sourceKey);
  const upstreamId = sourceMatch?.[1];
  const provenance = "provenance" in document ? document.provenance : undefined;
  const upstreamIds =
    provenance?.upstreamIds && typeof provenance.upstreamIds === "object"
      ? (provenance.upstreamIds as Record<string, unknown>)
      : {};
  const materialId =
    typeof upstreamIds.materialId === "number" || typeof upstreamIds.materialId === "string"
      ? String(upstreamIds.materialId)
      : undefined;
  return [
    ...(materialId ? [`genshin:material:${materialId}`, `material/${materialId}`] : []),
    ...(upstreamId ? [`genshin:material:${upstreamId}`, `material/${upstreamId}`] : []),
    sourceKey,
  ].filter((value, index, values): value is string =>
    Boolean(value && value.trim() && values.indexOf(value) === index),
  );
}

async function materialForItemDocument(
  repository: KnowledgeRepository,
  revisionId: string,
  document: DocumentSummary & { provenance?: Record<string, unknown> },
) {
  for (const stableId of materialCandidatesForItemDocument(document)) {
    try {
      const material = await repository.genshin.getMaterial(revisionId, stableId);
      if (material) return material;
    } catch {
      // Item text search should not fail when optional structured enrichment is absent.
    }
  }
  return null;
}

async function shapeItemDocument(
  repository: KnowledgeRepository,
  revisionId: string,
  document: DocumentSummary & { body?: string; provenance?: Record<string, unknown> },
) {
  const material = await materialForItemDocument(repository, revisionId, document);
  return {
    id: document.id,
    stableId: document.id,
    materialStableId: material?.stableId,
    sourceKey: document.sourceKey,
    name: document.title,
    title: document.title,
    category: material?.category ?? "other",
    rarity: material?.rarity ?? null,
    description: document.body ?? document.snippet,
    excerpt: document.snippet ?? document.body,
    sources: material?.sources ?? [],
    usedBy: material?.usedBy ?? [],
    gameVersion: document.gameVersion,
    locale: document.locale,
    revisionId,
    provenance: document.provenance ?? {},
  };
}

async function hydrateItemDocument(
  repository: KnowledgeRepository,
  gameId: string,
  revisionId: string,
  document: DocumentSummary,
): Promise<DocumentSummary & { body?: string; provenance?: Record<string, unknown> }> {
  try {
    return (await repository.getDocument(gameId, document.id, revisionId)) ?? document;
  } catch {
    return document;
  }
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

  server.tool(
    "get_character",
    "Get one Genshin character by display name with structured facts.",
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
    "Get one Genshin material by display name, including usage and sources.",
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
    "get_weapon",
    "Get one Genshin weapon by display name with structured facts.",
    { game_id: optionalGameId, name: nameInput },
    async ({ game_id: gameIdInput, name }) => {
      try {
        const game_id = await resolveGameId(gameIdInput);
        const weapon = await gameDomain.findStructuredByName(game_id, "weapon", name);
        if (!weapon) return errorResult("weapon_not_found", `Weapon was not found: ${name}`);
        return textResult({ weapon });
      } catch (error) {
        return errorResultFrom(error, "get_weapon_failed", "Weapon could not be loaded");
      }
    },
  );

  server.tool(
    "get_enemy",
    "Get one Genshin enemy by display name with structured facts.",
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

  server.tool(
    "search_dialogue",
    "Search published quest dialogue lines with citations.",
    {
      game_id: optionalGameId,
      query: z.string().trim().min(1).max(500),
      speaker: z.string().trim().min(1).max(200).optional(),
      quest: z.string().trim().min(1).max(200).optional(),
      node_type: z.string().trim().min(1).max(80).optional(),
      locale: z.string().trim().min(1).max(40).optional(),
      limit: z.number().int().min(1).max(10).default(5),
    },
    async ({ game_id: gameIdInput, query, speaker, quest, node_type, locale, limit }) => {
      try {
        const game_id = await resolveGameId(gameIdInput);
        await gameDomain.requireCapability(game_id, "lore_search");
        const revisionId = await gameDomain.requirePublicRevision(game_id);
        if (!repository.searchDialogue)
          throw new DomainError("dialogue_tools_not_ready", "Dialogue search is not implemented");
        const request = {
          query,
          limit,
          revisionId,
          speaker,
          quest,
          nodeType: node_type,
          locale,
        };
        const hits = await repository.searchDialogue(game_id, request);
        const shaped = shapeSearchForBudget(
          hits.slice(0, limit).map((hit) => ({
            quest: hit.quest,
            subquest: hit.subquest,
            speaker: hit.speaker,
            text: hit.text,
            dialogueNodeKey: hit.dialogueNodeKey,
            score: hit.score,
            citation: hit.citation,
            title: hit.quest,
            excerpt: hit.text,
          })),
        );
        return textResult({
          hits: shaped.items,
          returnedCount: shaped.items.length,
          truncated: shaped.truncated,
          nextCursor: null,
          estimatedBytes: shaped.estimatedBytes,
        });
      } catch (error) {
        return errorResultFrom(error, "search_dialogue_failed", "Dialogue search failed");
      }
    },
  );

  server.tool(
    "search_entities",
    "[Deprecated] Prefer get_character / get_material / resolve_entity. Search entities by canonical name or alias.",
    {
      game_id: optionalGameId,
      query: z.string().min(1).max(500),
      entity_type: entityTypeSchema.optional(),
      limit: z.number().int().min(1).max(50).default(20),
    },
    async ({ game_id: gameIdInput, query, entity_type, limit }) => {
      try {
        const game_id = await resolveGameId(gameIdInput);
        await domain.requireCapability(game_id, "entity_search");
        const revisionId = await requirePublicRevision(repository, game_id);
        const result = await repository.search(game_id, {
          query,
          types: ["entity"],
          entityTypes: entity_type ? [entity_type] : undefined,
          limit,
          revisionId,
          debug: false,
        });
        if (!result.revision)
          return errorResult("index_not_ready", "No searchable Dataset Revision is ready");
        const shapedEntities = shapeSearchForBudget(
          result.entities.map((entity) => ({
            id: entity.id,
            sourceKey: entity.sourceKey,
            name: entity.name,
            type: entity.type,
            revision: entity.revision,
            title: entity.name,
            excerpt: entity.summary ?? undefined,
          })),
        );
        return textResult({
          revision: result.revision,
          indexStatus: result.indexStatus,
          entities: shapedEntities.items,
          returnedCount: shapedEntities.items.length,
          truncated: shapedEntities.truncated,
          nextCursor: null,
          estimatedBytes: shapedEntities.estimatedBytes,
        });
      } catch (error) {
        return errorResultFrom(error, "search_failed", "Search failed");
      }
    },
  );

  server.tool(
    "get_entity",
    "[Deprecated] Prefer get_character for structured facts. Get entity details, relationships, documents and evidence claims.",
    { game_id: optionalGameId, entity_id: entityIdSchema },
    async ({ game_id: gameIdInput, entity_id }) => {
      try {
        const game_id = await resolveGameId(gameIdInput);
        await domain.requireCapability(game_id, "entity_search");
        const revisionId = await requirePublicRevision(repository, game_id);
        return textResult({ entity: await domain.getEntity(game_id, entity_id, revisionId) });
      } catch (error) {
        return errorResultFrom(error, "entity_not_found", "Entity was not found");
      }
    },
  );

  server.tool(
    "search_lore",
    "[Deprecated] Prefer search_dialogue for quest text. Search published lore documents and evidence-bearing segments.",
    {
      game_id: optionalGameId,
      query: z.string().min(1).max(500),
      document_type: documentTypeSchema.optional(),
      limit: z.number().int().min(1).max(50).default(20),
    },
    async ({ game_id: gameIdInput, query, document_type, limit }) => {
      try {
        const game_id = await resolveGameId(gameIdInput);
        await domain.requireCapability(game_id, "lore_search");
        const revisionId = await requirePublicRevision(repository, game_id);
        const result = await repository.search(game_id, {
          query,
          types: ["document", "segment"],
          documentTypes: document_type ? [document_type] : undefined,
          limit,
          revisionId,
          debug: false,
        });
        if (!result.revision)
          return errorResult("index_not_ready", "No searchable Dataset Revision is ready");
        const loreHits = [
          ...result.documents.map((doc) => ({
            kind: "document" as const,
            id: doc.id,
            title: doc.title,
            excerpt: doc.snippet,
          })),
          ...result.segments.map((seg) => ({
            kind: "segment" as const,
            id: seg.id,
            segmentId: seg.segmentId,
            title: seg.title,
            excerpt: seg.snippet,
          })),
        ];
        const shapedLore = shapeSearchForBudget(loreHits);
        return textResult({
          revision: result.revision,
          indexStatus: result.indexStatus,
          hits: shapedLore.items,
          returnedCount: shapedLore.items.length,
          truncated: shapedLore.truncated,
          nextCursor: null,
          estimatedBytes: shapedLore.estimatedBytes,
        });
      } catch (error) {
        return errorResultFrom(error, "search_failed", "Search failed");
      }
    },
  );

  server.tool(
    "search_quests",
    "Search published quest documents by quest title, body, type, locale and game version.",
    {
      game_id: optionalGameId,
      query: z.string().min(1).max(500),
      quest_type: questTypeSchema.optional(),
      locale: z.string().min(1).max(40).default("zh-CN"),
      game_version: z.string().min(1).max(40).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    },
    async ({ game_id: gameIdInput, query, quest_type, locale, game_version, limit }) => {
      try {
        const game_id = await resolveGameId(gameIdInput);
        await domain.requireCapability(game_id, "lore_search");
        const revisionId = await requirePublicRevision(repository, game_id);
        if (!repository.searchQuests)
          throw new DomainError("quest_tools_not_ready", "Quest search is not implemented");
        const quests = await repository.searchQuests(game_id, {
          query,
          questTypes: quest_type ? [quest_type] : undefined,
          locale,
          gameVersion: game_version,
          limit,
          revisionId,
        });
        const shaped = shapeSearchForBudget(
          quests.map((quest) => ({
            ...quest,
            title: quest.title,
            excerpt: quest.match,
          })),
        );
        return textResult({
          quests: shaped.items,
          returnedCount: shaped.items.length,
          truncated: shaped.truncated,
          nextCursor: null,
          estimatedBytes: shaped.estimatedBytes,
        });
      } catch (error) {
        return errorResultFrom(error, "search_quests_failed", "Quest search failed");
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

  server.tool(
    "get_lore_document",
    "Get a document and its citation-addressable segments.",
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

  server.tool(
    "search_items",
    "Search item and material texts by name, description or type.",
    {
      game_id: optionalGameId,
      query: z.string().trim().min(1).max(200),
      item_type: z.string().trim().min(1).max(60).optional(),
      limit: z.number().int().min(1).max(50).default(10),
    },
    async ({ game_id: gameIdInput, query, item_type, limit }) => {
      try {
        const game_id = await resolveGameId(gameIdInput);
        const revisionId = await requirePublicRevision(repository, game_id);
        const result = await repository.search(game_id, {
          query,
          types: ["document"],
          documentTypes: ["item_description"],
          limit: item_type ? Math.min(limit * 4, 100) : limit,
          revisionId,
          debug: false,
        });
        if (!result.revision)
          return errorResult("index_not_ready", "No searchable Dataset Revision is ready");
        const itemTexts = await Promise.all(
          result.documents.map(async (document) =>
            shapeItemDocument(
              repository,
              revisionId,
              await hydrateItemDocument(repository, game_id, revisionId, document),
            ),
          ),
        );
        const filtered = item_type
          ? itemTexts.filter((item) => item.category.toLowerCase() === item_type.toLowerCase())
          : itemTexts;
        const shaped = shapeSearchForBudget(filtered);
        return textResult({
          query,
          items: shaped.items,
          returnedCount: shaped.items.length,
          truncated: shaped.truncated,
          nextCursor: null,
          estimatedBytes: shaped.estimatedBytes,
        });
      } catch (error) {
        return errorResultFrom(error, "search_items_failed", "Item search failed");
      }
    },
  );

  server.tool(
    "get_item_text",
    "Get the full published text of one item/material by stable id.",
    { game_id: optionalGameId, item_id: z.string().min(1).max(200) },
    async ({ game_id: gameIdInput, item_id }) => {
      try {
        const game_id = await resolveGameId(gameIdInput);
        const revisionId = await requirePublicRevision(repository, game_id);
        const document = documentIdSchema.safeParse(item_id).success
          ? await repository.getDocument(game_id, item_id, revisionId)
          : null;
        if (document?.type === "item_description") {
          return textResult({
            item: await shapeItemDocument(repository, revisionId, document),
          });
        }
        const material = await gameDomain.getMaterial(game_id, item_id);
        return textResult({ item: material });
      } catch (error) {
        return errorResultFrom(error, "item_not_found", "Item was not found");
      }
    },
  );

  server.tool(
    "search_mechanics",
    "Search official in-game mechanism and tutorial explanations.",
    {
      game_id: optionalGameId,
      query: z.string().trim().min(1).max(200),
      category: z.string().trim().min(1).max(60).optional(),
      limit: z.number().int().min(1).max(20).default(5),
    },
    async ({ game_id: gameIdInput, query, category, limit }) => {
      try {
        const game_id = await resolveGameId(gameIdInput);
        await domain.requireCapability(game_id, "lore_search");
        const revisionId = await requirePublicRevision(repository, game_id);
        const result = await repository.search(game_id, {
          query,
          types: ["document", "segment"],
          documentTypes: ["mechanism"],
          limit,
          revisionId,
          debug: false,
        });
        if (!result.revision)
          return errorResult("index_not_ready", "No searchable Dataset Revision is ready");
        const hits = [
          ...result.documents.map((doc) => ({
            kind: "document" as const,
            id: doc.id,
            sourceKey: doc.sourceKey,
            title: doc.title,
            type: doc.type,
            excerpt: doc.snippet,
          })),
          ...result.segments.map((seg) => ({
            kind: "segment" as const,
            id: seg.id,
            sourceKey: seg.sourceKey,
            segmentId: seg.segmentId,
            title: seg.title,
            type: seg.type,
            excerpt: seg.snippet,
          })),
        ];
        const shaped = shapeSearchForBudget(hits);
        return textResult({
          query,
          category: category ?? null,
          revision: result.revision,
          indexStatus: result.indexStatus,
          hits: shaped.items,
          returnedCount: shaped.items.length,
          truncated: shaped.truncated,
          nextCursor: null,
          estimatedBytes: shaped.estimatedBytes,
          corpusStatus: hits.length ? "available" : "mechanism_source_empty",
        });
      } catch (error) {
        return errorResultFrom(error, "search_mechanics_failed", "Mechanism search failed");
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
