import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GameProviderError, type GameProviderRegistry, normalizeGameSlug } from "@gip/providers";
import { DEFAULT_MCP_RESPONSE_BUDGET, shapeForBudget } from "@gip/search";
import { z } from "zod";

const gameInput = z.string().trim().min(1).max(64);
const queryInput = z.string().trim().min(1).max(500);
const documentIdInput = z.string().trim().min(1).max(512);

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

function errorResult(code: string, message: string) {
  return {
    isError: true,
    content: [{ type: "text" as const, text: JSON.stringify({ error: { code, message } }) }],
  };
}

export function registerGameProviderTools(
  server: McpServer,
  registry: GameProviderRegistry | undefined,
) {
  server.tool(
    "search_game_knowledge",
    "Search external game knowledge providers through the GamesMcp gateway.",
    {
      game: gameInput,
      query: queryInput,
      mode: z.enum(["hybrid", "keyword"]).default("hybrid"),
      intent: z.enum(["balanced", "context", "variety", "lookup"]).default("balanced"),
      limit: z.number().int().min(1).max(10).default(5),
    },
    async ({ game, query, mode, intent, limit }) => {
      try {
        const provider = requireProvider(registry, game, "knowledge_search");
        if (mode === "keyword" && !provider.capabilities.includes("keyword_search"))
          throw new GameProviderError("provider_not_supported");
        const response = await provider.search({ game, query, mode, intent, limit });
        const shaped = shapeForBudget(response.hits, {
          ...DEFAULT_MCP_RESPONSE_BUDGET,
          maxItems: limit,
        });
        const normalizedGame = normalizeGameSlug(game);
        return textResult({
          game: normalizedGame,
          provider: response.provider,
          mode: response.mode,
          hits: shaped.items.map((hit) => ({ ...hit, game: normalizedGame })),
          returnedCount: shaped.items.length,
          truncated: response.truncated || shaped.truncated,
          estimatedBytes: shaped.estimatedBytes,
        });
      } catch (error) {
        return providerErrorResult(error, "Game knowledge provider is currently unavailable.");
      }
    },
  );

  server.tool(
    "get_game_document",
    "Read a provider document page by document id.",
    {
      game: gameInput,
      document_id: documentIdInput,
      cursor: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(100).default(20),
    },
    async ({ game, document_id, cursor, limit }) => {
      try {
        const provider = requireProvider(registry, game, "document_read");
        const response = await provider.getDocument({
          game,
          documentId: document_id,
          cursor,
          limit,
        });
        const content =
          response.content.length > 12_000
            ? response.content.slice(0, 11_999) + "…"
            : response.content;
        return textResult({
          ...response,
          game: normalizeGameSlug(game),
          content,
          truncated: response.truncated || content.length < response.content.length,
          estimatedBytes: Buffer.byteLength(JSON.stringify({ ...response, content }), "utf8"),
        });
      } catch (error) {
        return providerErrorResult(error, "Game document could not be loaded.");
      }
    },
  );

  server.tool(
    "get_game_document_hierarchy",
    "Read the hierarchy for a provider document.",
    { game: gameInput, document_id: documentIdInput },
    async ({ game, document_id }) => {
      try {
        const provider = requireProvider(registry, game, "document_hierarchy");
        if (!provider.getHierarchy) throw new GameProviderError("provider_not_supported");
        const response = await provider.getHierarchy({ game, documentId: document_id });
        const payload = {
          ...response,
          game: normalizeGameSlug(game),
        };
        return textResult({
          ...payload,
          estimatedBytes: Buffer.byteLength(JSON.stringify(payload), "utf8"),
        });
      } catch (error) {
        return providerErrorResult(error, "Game document hierarchy could not be loaded.");
      }
    },
  );

  server.tool(
    "get_game_provider_status",
    "Show external provider health for a game.",
    { game: gameInput.optional() },
    async ({ game }) => {
      try {
        return textResult({
          game: game ? normalizeGameSlug(game) : undefined,
          providers: await (registry?.health(game) ?? []),
        });
      } catch (error) {
        return providerErrorResult(error, "Game provider status could not be loaded.");
      }
    },
  );
}

function requireProvider(
  registry: GameProviderRegistry | undefined,
  game: string,
  capability: "knowledge_search" | "document_read" | "document_hierarchy",
) {
  if (!registry) throw new GameProviderError("game_provider_not_found");
  return registry.requireCapability(game, capability);
}

function providerErrorResult(error: unknown, fallbackMessage: string) {
  const providerError =
    error instanceof GameProviderError ? error : new GameProviderError("provider_unavailable");
  return errorResult(providerError.code, providerError.message || fallbackMessage);
}
