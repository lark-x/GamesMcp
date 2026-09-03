import type { FastifyInstance } from "fastify";
import { codexMaterialSchema } from "@gip/contracts";
import type { GameDomainService } from "@gip/domain";
import {
  decodeStableId,
  listQuerySchema,
  parseIdParams,
  parseQuery,
  stableIdParams,
} from "./route-utils.js";

export type CodexRoutesDependencies = {
  gameDomain: GameDomainService;
};

export function registerCodexRoutes(
  app: FastifyInstance,
  { gameDomain }: CodexRoutesDependencies,
): void {
  app.get("/api/games/:gameId/codex/materials", async (request) => {
    const { gameId } = parseIdParams(request);
    const query = listQuerySchema.parse(parseQuery(request));
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const materials = await gameDomain.listMaterials(gameId, query.revisionId, {
      query: query.q,
      limit,
      offset,
    });
    return {
      gameId,
      revisionId: query.revisionId ?? null,
      materials: materials.map((material) => codexMaterialSchema.parse(material)),
      limit,
      offset,
      nextOffset: materials.length === limit ? offset + materials.length : null,
    };
  });

  app.get("/api/games/:gameId/codex/materials/:stableId", async (request, reply) => {
    const params = stableIdParams.parse(request.params);
    const query = listQuerySchema.parse(parseQuery(request));
    try {
      const material = await gameDomain.getMaterial(
        params.gameId,
        decodeStableId(params.stableId),
        query.revisionId,
      );
      return { material: codexMaterialSchema.parse(material) };
    } catch (error) {
      if ((error as { code?: string }).code === "material_not_found")
        return reply.code(404).send({ error: { code: "material_not_found" } });
      throw error;
    }
  });
}
