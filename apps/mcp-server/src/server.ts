import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KnowledgeRepository } from "@gip/domain";
import { DomainError, KnowledgeService } from "@gip/domain";
import {
  documentIdSchema,
  documentTypeSchema,
  entityIdSchema,
  entityTypeSchema,
  relationshipPredicateSchema,
  segmentIdSchema,
} from "@gip/contracts";
import { z } from "zod";

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

  server.tool(
    "search_entities",
    "Search entities by canonical name or alias.",
    {
      game_id: gameId,
      query: z.string().min(1).max(500),
      entity_type: entityTypeSchema.optional(),
      limit: z.number().int().min(1).max(50).default(20),
    },
    async ({ game_id, query, entity_type, limit }) => {
      try {
        await domain.requireCapability(game_id, "entity_search");
        const result = await repository.search(game_id, {
          query,
          types: ["entity"],
          entityTypes: entity_type ? [entity_type] : undefined,
          limit,
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
    "Get entity details, relationships, documents and evidence claims.",
    { game_id: gameId, entity_id: entityIdSchema },
    async ({ game_id, entity_id }) => {
      try {
        await domain.requireCapability(game_id, "entity_search");
        return textResult({ entity: await domain.getEntity(game_id, entity_id) });
      } catch (error) {
        return errorResultFrom(error, "entity_not_found", "Entity was not found");
      }
    },
  );

  server.tool(
    "search_lore",
    "Search published lore documents and evidence-bearing segments.",
    {
      game_id: gameId,
      query: z.string().min(1).max(500),
      document_type: documentTypeSchema.optional(),
      limit: z.number().int().min(1).max(50).default(20),
    },
    async ({ game_id, query, document_type, limit }) => {
      try {
        await domain.requireCapability(game_id, "lore_search");
        const result = await repository.search(game_id, {
          query,
          types: ["document", "segment"],
          documentTypes: document_type ? [document_type] : undefined,
          limit,
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
        const document = await domain.getDocument(game_id, document_id);
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
        await domain.getEntity(game_id, entity_id);
        return textResult({
          game_id,
          entity_id,
          relationships: await repository.getRelationships(game_id, entity_id, {
            predicate,
            limit,
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
        const game = await repository.getGame(id);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(game ?? { error: { code: "game_not_found" } }),
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
        const entity = await domain.getEntity(
          String(variables.game_id),
          String(variables.entity_id),
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
        const document = await domain.getDocument(
          String(variables.game_id),
          String(variables.document_id),
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
              text: JSON.stringify(revisions.find((revision) => revision.isCurrent) ?? null),
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
