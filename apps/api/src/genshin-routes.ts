import type { FastifyInstance } from "fastify";
import {
  genshinCharacterSchema,
  genshinAchievementSchema,
  genshinArtifactSchema,
  genshinArtifactSetSchema,
  genshinEnemySchema,
  genshinMaterialSchema,
  genshinWeaponSchema,
} from "@gip/contracts";
import type { GameDomainService } from "@gip/domain";
import {
  decodeStableId,
  listQuerySchema,
  parseIdParams,
  parsePositive,
  parseQuery,
  stableIdParams,
} from "./route-utils.js";

export type GenshinRoutesDependencies = {
  gameDomain: GameDomainService;
};

/**
 * Non-versioned Genshin structured routes for the Game Codex API. Responses
 * are validated against the shared Zod contracts (OpenAPI-like contract
 * tests assert these shapes without generating OpenAPI files).
 */
export function registerGenshinRoutes(
  app: FastifyInstance,
  { gameDomain }: GenshinRoutesDependencies,
): void {
  app.get("/api/games/:gameId/genshin/characters", async (request) => {
    const { gameId } = parseIdParams(request);
    const query = listQuerySchema.parse(parseQuery(request));
    const characters = await gameDomain.listCharacters(gameId, query.revisionId, {
      query: query.q,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    });
    return {
      gameId,
      revisionId: query.revisionId ?? null,
      characters: characters.map((character) => genshinCharacterSchema.parse(character)),
    };
  });

  app.get("/api/games/:gameId/genshin/characters/:stableId", async (request, reply) => {
    const params = stableIdParams.parse(request.params);
    const query = listQuerySchema.parse(parseQuery(request));
    try {
      const character = await gameDomain.getCharacter(
        params.gameId,
        decodeStableId(params.stableId),
        query.revisionId,
      );
      return { character: genshinCharacterSchema.parse(character) };
    } catch (error) {
      if ((error as { code?: string }).code === "character_not_found")
        return reply.code(404).send({ error: { code: "character_not_found" } });
      throw error;
    }
  });

  app.get("/api/games/:gameId/genshin/materials", async (request) => {
    const { gameId } = parseIdParams(request);
    const query = listQuerySchema.parse(parseQuery(request));
    const materials = await gameDomain.listMaterials(gameId, query.revisionId, {
      query: query.q,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    });
    return {
      gameId,
      revisionId: query.revisionId ?? null,
      materials: materials.map((material) => genshinMaterialSchema.parse(material)),
    };
  });

  app.get("/api/games/:gameId/genshin/materials/:stableId", async (request, reply) => {
    const params = stableIdParams.parse(request.params);
    const query = listQuerySchema.parse(parseQuery(request));
    try {
      const material = await gameDomain.getMaterial(
        params.gameId,
        decodeStableId(params.stableId),
        query.revisionId,
      );
      return { material: genshinMaterialSchema.parse(material) };
    } catch (error) {
      if ((error as { code?: string }).code === "material_not_found")
        return reply.code(404).send({ error: { code: "material_not_found" } });
      throw error;
    }
  });

  app.get("/api/games/:gameId/genshin/weapons", async (request) => {
    const { gameId } = parseIdParams(request);
    const query = listQuerySchema.parse(parseQuery(request));
    const weapons = await gameDomain.listWeapons(gameId, query.revisionId, {
      query: query.q,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    });
    return {
      gameId,
      revisionId: query.revisionId ?? null,
      weapons: weapons.map((weapon) => genshinWeaponSchema.parse(weapon)),
    };
  });

  app.get("/api/games/:gameId/genshin/weapons/:stableId", async (request, reply) => {
    const params = stableIdParams.parse(request.params);
    const query = listQuerySchema.parse(parseQuery(request));
    try {
      const weapon = await gameDomain.getWeapon(
        params.gameId,
        decodeStableId(params.stableId),
        query.revisionId,
      );
      return { weapon: genshinWeaponSchema.parse(weapon) };
    } catch (error) {
      if ((error as { code?: string }).code === "weapon_not_found")
        return reply.code(404).send({ error: { code: "weapon_not_found" } });
      throw error;
    }
  });

  app.get("/api/games/:gameId/genshin/artifacts", async (request) => {
    const { gameId } = parseIdParams(request);
    const query = listQuerySchema.parse(parseQuery(request));
    const [artifacts, artifactSets] = await Promise.all([
      gameDomain.listArtifacts(gameId, query.revisionId, {
        query: query.q,
        limit: query.limit ?? 20,
        offset: query.offset ?? 0,
      }),
      gameDomain.listArtifactSets(gameId, query.revisionId, {
        query: query.q,
        limit: query.limit ?? 20,
        offset: query.offset ?? 0,
      }),
    ]);
    return {
      gameId,
      revisionId: query.revisionId ?? null,
      artifacts: artifacts.map((artifact) => genshinArtifactSchema.parse(artifact)),
      artifactSets: artifactSets.map((set) => genshinArtifactSetSchema.parse(set)),
    };
  });

  app.get("/api/games/:gameId/genshin/artifacts/:stableId", async (request, reply) => {
    const params = stableIdParams.parse(request.params);
    const query = listQuerySchema.parse(parseQuery(request));
    try {
      const artifact = await gameDomain.getArtifact(
        params.gameId,
        decodeStableId(params.stableId),
        query.revisionId,
      );
      return { artifact: genshinArtifactSchema.parse(artifact) };
    } catch (error) {
      if ((error as { code?: string }).code === "artifact_not_found")
        return reply.code(404).send({ error: { code: "artifact_not_found" } });
      throw error;
    }
  });

  app.get("/api/games/:gameId/genshin/artifactSets", async (request) => {
    const { gameId } = parseIdParams(request);
    const query = listQuerySchema.parse(parseQuery(request));
    const artifactSets = await gameDomain.listArtifactSets(gameId, query.revisionId, {
      query: query.q,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    });
    return {
      gameId,
      revisionId: query.revisionId ?? null,
      artifactSets: artifactSets.map((set) => genshinArtifactSetSchema.parse(set)),
    };
  });

  app.get("/api/games/:gameId/genshin/artifactSets/:stableId", async (request, reply) => {
    const params = stableIdParams.parse(request.params);
    const query = listQuerySchema.parse(parseQuery(request));
    try {
      const artifactSet = await gameDomain.getArtifactSet(
        params.gameId,
        decodeStableId(params.stableId),
        query.revisionId,
      );
      return { artifactSet: genshinArtifactSetSchema.parse(artifactSet) };
    } catch (error) {
      if ((error as { code?: string }).code === "artifact_set_not_found")
        return reply.code(404).send({ error: { code: "artifact_set_not_found" } });
      throw error;
    }
  });

  app.get("/api/games/:gameId/genshin/achievements", async (request) => {
    const { gameId } = parseIdParams(request);
    const query = listQuerySchema.parse(parseQuery(request));
    const achievements = await gameDomain.listAchievements(gameId, query.revisionId, {
      query: query.q,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    });
    return {
      gameId,
      revisionId: query.revisionId ?? null,
      achievements: achievements.map((achievement) => genshinAchievementSchema.parse(achievement)),
    };
  });

  app.get("/api/games/:gameId/genshin/achievements/:stableId", async (request, reply) => {
    const params = stableIdParams.parse(request.params);
    const query = listQuerySchema.parse(parseQuery(request));
    try {
      const achievement = await gameDomain.getAchievement(
        params.gameId,
        decodeStableId(params.stableId),
        query.revisionId,
      );
      return { achievement: genshinAchievementSchema.parse(achievement) };
    } catch (error) {
      if ((error as { code?: string }).code === "achievement_not_found")
        return reply.code(404).send({ error: { code: "achievement_not_found" } });
      throw error;
    }
  });

  app.get("/api/games/:gameId/genshin/enemies", async (request) => {
    const { gameId } = parseIdParams(request);
    const query = listQuerySchema.parse(parseQuery(request));
    const enemies = await gameDomain.listEnemies(gameId, query.revisionId, {
      query: query.q,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    });
    return {
      gameId,
      revisionId: query.revisionId ?? null,
      enemies: enemies.map((enemy) => genshinEnemySchema.parse(enemy)),
    };
  });

  app.get("/api/games/:gameId/genshin/enemies/:stableId", async (request, reply) => {
    const params = stableIdParams.parse(request.params);
    const query = listQuerySchema.parse(parseQuery(request));
    try {
      const enemy = await gameDomain.getEnemy(
        params.gameId,
        decodeStableId(params.stableId),
        query.revisionId,
      );
      return { enemy: genshinEnemySchema.parse(enemy) };
    } catch (error) {
      if ((error as { code?: string }).code === "enemy_not_found")
        return reply.code(404).send({ error: { code: "enemy_not_found" } });
      throw error;
    }
  });
}

export const genshinListLimit = (query: Record<string, unknown>) =>
  parsePositive(query.limit, 20, 100);
