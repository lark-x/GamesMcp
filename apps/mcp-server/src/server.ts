import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KnowledgeRepository } from "@gip/domain";
import { DomainError, GameDomainService, KnowledgeService } from "@gip/domain";
import {
  documentIdSchema,
  documentTypeSchema,
  entityIdSchema,
  entityTypeSchema,
  relationshipPredicateSchema,
  segmentIdSchema,
} from "@gip/contracts";
import { z } from "zod";

const questTypeSchema = z.enum(["archon_quest", "story_quest", "world_quest", "event_quest"]);

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function errorResult(code: string, message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message } }) }],
  };
}

function errorResultFrom(error: unknown, fallbackCode: string, fallbackMessage: string) {
  return error instanceof DomainError
    ? errorResult(error.code, error.message)
    : errorResult(fallbackCode, fallbackMessage);
}

export function createMcpServer(repository: KnowledgeRepository): McpServer {
  const server = new McpServer({ name: "game-intelligence-platform", version: "0.1.0" });
  const domain = new KnowledgeService(repository);
  const gameDomain = new GameDomainService(repository);
  const gameId = z.string().uuid();

  server.tool("list_games", "List games registered in the knowledge platform.", {}, async () => {
    try {
      return textResult({ games: await repository.listGames() });
    } catch (error) {
      return errorResultFrom(error, "list_games_failed", "Games could not be loaded");
    }
  });

  server.tool(
    "get_game_capabilities",
    "List capabilities enabled for a game.",
    { game_id: gameId },
    async ({ game_id }) => {
      try {
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
    { game_id: gameId, name: nameInput },
    async ({ game_id, name }) => {
      try {
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
    { game_id: gameId, name: nameInput },
    async ({ game_id, name }) => {
      try {
        const material = await gameDomain.findStructuredByName(game_id, "material", name);
        if (!material) return errorResult("material_not_found", `Material was not found: ${name}`);
        return textResult({ material });
      } catch (error) {
        return errorResultFrom(error, "get_material_failed", "Material could not be loaded");
      }
    },
  );

  server.tool(
    "resolve_entity",
    "Resolve a display name or alias to the canonical entity with confidence.",
    { game_id: gameId, query: z.string().trim().min(1).max(200) },
    async ({ game_id, query }) => {
      try {
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
      game_id: gameId,
      query: z.string().trim().min(1).max(500),
      limit: z.number().int().min(1).max(10).default(5),
    },
    async ({ game_id, query, limit }) => {
      try {
        await gameDomain.requireCapability(game_id, "lore_search");
        const revisionId = await gameDomain.requirePublicRevision(game_id);
        if (!repository.searchQuests)
          throw new DomainError("quest_tools_not_ready", "Quest search is not implemented");
        const quests = await repository.searchQuests(game_id, {
          query,
          limit,
          revisionId,
        });
        return textResult({
          hits: quests.slice(0, limit).map((quest) => ({
            quest: quest.title,
            questKey: quest.questKey,
            type: quest.type,
            documentId: quest.documentId,
            citation: {
              documentId: quest.documentId,
              locale: quest.locale,
              questKey: quest.questKey,
              revision: quest.revision,
            },
          })),
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
      game_id: gameId,
      query: z.string().min(1).max(500),
      entity_type: entityTypeSchema.optional(),
      limit: z.number().int().min(1).max(50).default(20),
    },
    async ({ game_id, query, entity_type, limit }) => {
      try {
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
        return result.revision
          ? textResult(result)
          : errorResult("index_not_ready", "No searchable Dataset Revision is ready");
      } catch (error) {
        return errorResultFrom(error, "search_failed", "Search failed");
      }
    },
  );

  server.tool(
    "get_entity",
    "[Deprecated] Prefer get_character for structured facts. Get entity details, relationships, documents and evidence claims.",
    { game_id: gameId, entity_id: entityIdSchema },
    async ({ game_id, entity_id }) => {
      try {
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
      game_id: gameId,
      query: z.string().min(1).max(500),
      document_type: documentTypeSchema.optional(),
      limit: z.number().int().min(1).max(50).default(20),
    },
    async ({ game_id, query, document_type, limit }) => {
      try {
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
        return result.revision
          ? textResult(result)
          : errorResult("index_not_ready", "No searchable Dataset Revision is ready");
      } catch (error) {
        return errorResultFrom(error, "search_failed", "Search failed");
      }
    },
  );

  server.tool(
    "search_quests",
    "Search published quest documents by quest title, body, type, locale and game version.",
    {
      game_id: gameId,
      query: z.string().min(1).max(500),
      quest_type: questTypeSchema.optional(),
      locale: z.string().min(1).max(40).default("zh-CN"),
      game_version: z.string().min(1).max(40).optional(),
      limit: z.number().int().min(1).max(50).default(20),
    },
    async ({ game_id, query, quest_type, locale, game_version, limit }) => {
      try {
        await domain.requireCapability(game_id, "lore_search");
        const revisionId = await requirePublicRevision(repository, game_id);
        if (!repository.searchQuests)
          throw new DomainError("quest_tools_not_ready", "Quest search is not implemented");
        return textResult({
          quests: await repository.searchQuests(game_id, {
            query,
            questTypes: quest_type ? [quest_type] : undefined,
            locale,
            gameVersion: game_version,
            limit,
            revisionId,
          }),
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
      game_id: gameId,
      quest_id: z.string().min(1).max(120),
      locale: z.string().min(1).max(40).default("zh-CN"),
      subquest_id: z.string().min(1).max(120).optional(),
      cursor: z.string().min(1).optional(),
      node_limit: z.number().int().min(1).max(300).default(100),
    },
    async ({ game_id, quest_id, locale, subquest_id, cursor, node_limit }) => {
      try {
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
      game_id: gameId,
      document_id: documentIdSchema,
      segment_id: segmentIdSchema.optional(),
      max_chars: z.number().int().min(100).max(20_000).default(8_000),
    },
    async ({ game_id, document_id, segment_id, max_chars }) => {
      try {
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
      game_id: gameId,
      entity_id: entityIdSchema,
      predicate: relationshipPredicateSchema.optional(),
      limit: z.number().int().min(1).max(100).default(50),
    },
    async ({ game_id, entity_id, predicate, limit }) => {
      try {
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
