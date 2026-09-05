import type { FastifyInstance } from "fastify";
import {
  codexMaterialSchema,
  genshinAchievementSchema,
  genshinCharacterSchema,
  genshinEnemySchema,
  genshinWeaponSchema,
} from "@gip/contracts";
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
  // Terminology
  app.get("/api/games/:gameId/codex/terminology", async (request) => {
    const { gameId } = parseIdParams(request);
    const adapter = await gameDomain.getArchiveAdapter(gameId);
    return {
      gameId,
      terminology: adapter.getTerminology(),
    };
  });

  // Materials
  app.get("/api/games/:gameId/codex/materials", async (request) => {
    const { gameId } = parseIdParams(request);
    const rawQuery = parseQuery(request);
    const query = listQuerySchema.parse(rawQuery);
    const category =
      typeof rawQuery.category === "string" && rawQuery.category.trim()
        ? rawQuery.category.trim()
        : undefined;
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;
    const [materials, total, categories] = await Promise.all([
      gameDomain.listMaterials(gameId, query.revisionId, {
        query: query.q,
        category,
        limit,
        offset,
      }),
      gameDomain.countMaterials(gameId, query.revisionId, {
        query: query.q,
        category,
      }),
      gameDomain.aggregateMaterialCategories(gameId, query.revisionId, query.q),
    ]);
    return {
      gameId,
      revisionId: query.revisionId ?? null,
      materials: materials.map((material) => codexMaterialSchema.parse(material)),
      total,
      categories,
      limit,
      offset,
      nextOffset: offset + materials.length < total ? offset + materials.length : null,
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

  // Characters
  app.get("/api/games/:gameId/codex/characters", async (request) => {
    const { gameId } = parseIdParams(request);
    const query = listQuerySchema.parse(parseQuery(request));
    const [adapter, characters] = await Promise.all([
      gameDomain.getArchiveAdapter(gameId),
      gameDomain.listCharacters(gameId, query.revisionId, {
        query: query.q,
        limit: query.limit ?? 20,
        offset: query.offset ?? 0,
      }),
    ]);
    const isGenshin = adapter.gameSlug === "genshin-impact";
    return {
      gameId,
      revisionId: query.revisionId ?? null,
      characters: characters.map((character) =>
        isGenshin ? genshinCharacterSchema.parse(character) : character,
      ),
    };
  });

  app.get("/api/games/:gameId/codex/characters/:stableId", async (request, reply) => {
    const params = stableIdParams.parse(request.params);
    const query = listQuerySchema.parse(parseQuery(request));
    try {
      const [adapter, character] = await Promise.all([
        gameDomain.getArchiveAdapter(params.gameId),
        gameDomain.getCharacter(
          params.gameId,
          decodeStableId(params.stableId),
          query.revisionId,
        ),
      ]);
      const isGenshin = adapter.gameSlug === "genshin-impact";
      return {
        character: isGenshin ? genshinCharacterSchema.parse(character) : character,
      };
    } catch (error) {
      if ((error as { code?: string }).code === "character_not_found")
        return reply.code(404).send({ error: { code: "character_not_found" } });
      throw error;
    }
  });

  // Weapons
  app.get("/api/games/:gameId/codex/weapons", async (request) => {
    const { gameId } = parseIdParams(request);
    const query = listQuerySchema.parse(parseQuery(request));
    const [adapter, weapons] = await Promise.all([
      gameDomain.getArchiveAdapter(gameId),
      gameDomain.listWeapons(gameId, query.revisionId, {
        query: query.q,
        limit: query.limit ?? 20,
        offset: query.offset ?? 0,
      }),
    ]);
    const isGenshin = adapter.gameSlug === "genshin-impact";
    return {
      gameId,
      revisionId: query.revisionId ?? null,
      weapons: weapons.map((weapon) =>
        isGenshin ? genshinWeaponSchema.parse(weapon) : weapon,
      ),
    };
  });

  app.get("/api/games/:gameId/codex/weapons/:stableId", async (request, reply) => {
    const params = stableIdParams.parse(request.params);
    const query = listQuerySchema.parse(parseQuery(request));
    try {
      const [adapter, weapon] = await Promise.all([
        gameDomain.getArchiveAdapter(params.gameId),
        gameDomain.getWeapon(
          params.gameId,
          decodeStableId(params.stableId),
          query.revisionId,
        ),
      ]);
      const isGenshin = adapter.gameSlug === "genshin-impact";
      return { weapon: isGenshin ? genshinWeaponSchema.parse(weapon) : weapon };
    } catch (error) {
      if ((error as { code?: string }).code === "weapon_not_found")
        return reply.code(404).send({ error: { code: "weapon_not_found" } });
      throw error;
    }
  });

  // Artifacts
  app.get("/api/games/:gameId/codex/artifacts", async (request) => {
    const { gameId } = parseIdParams(request);
    const query = listQuerySchema.parse(parseQuery(request));
    const sets = await gameDomain.listArtifactSets(gameId, query.revisionId, {
      query: query.q,
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
    });
    return {
      gameId,
      revisionId: query.revisionId ?? null,
      sets,
    };
  });

  app.get("/api/games/:gameId/codex/artifacts/:stableId", async (request, reply) => {
    const params = stableIdParams.parse(request.params);
    const query = listQuerySchema.parse(parseQuery(request));
    try {
      const set = await gameDomain.getArtifactSet(
        params.gameId,
        decodeStableId(params.stableId),
        query.revisionId,
      );
      return { set };
    } catch (error) {
      if ((error as { code?: string }).code === "artifact_set_not_found")
        return reply.code(404).send({ error: { code: "artifact_set_not_found" } });
      throw error;
    }
  });

  // Enemies
  app.get("/api/games/:gameId/codex/enemies", async (request) => {
    const { gameId } = parseIdParams(request);
    const query = listQuerySchema.parse(parseQuery(request));
    const [adapter, enemies] = await Promise.all([
      gameDomain.getArchiveAdapter(gameId),
      gameDomain.listEnemies(gameId, query.revisionId, {
        query: query.q,
        limit: query.limit ?? 20,
        offset: query.offset ?? 0,
      }),
    ]);
    const isGenshin = adapter.gameSlug === "genshin-impact";
    return {
      gameId,
      revisionId: query.revisionId ?? null,
      enemies: enemies.map((enemy) =>
        isGenshin ? genshinEnemySchema.parse(enemy) : enemy,
      ),
    };
  });

  app.get("/api/games/:gameId/codex/enemies/:stableId", async (request, reply) => {
    const params = stableIdParams.parse(request.params);
    const query = listQuerySchema.parse(parseQuery(request));
    try {
      const [adapter, enemy] = await Promise.all([
        gameDomain.getArchiveAdapter(params.gameId),
        gameDomain.getEnemy(
          params.gameId,
          decodeStableId(params.stableId),
          query.revisionId,
        ),
      ]);
      const isGenshin = adapter.gameSlug === "genshin-impact";
      return { enemy: isGenshin ? genshinEnemySchema.parse(enemy) : enemy };
    } catch (error) {
      if ((error as { code?: string }).code === "enemy_not_found")
        return reply.code(404).send({ error: { code: "enemy_not_found" } });
      throw error;
    }
  });

  // Achievements
  app.get("/api/games/:gameId/codex/achievements", async (request) => {
    const { gameId } = parseIdParams(request);
    const query = listQuerySchema.parse(parseQuery(request));
    const [adapter, achievements] = await Promise.all([
      gameDomain.getArchiveAdapter(gameId),
      gameDomain.listAchievements(gameId, query.revisionId, {
        query: query.q,
        limit: query.limit ?? 20,
        offset: query.offset ?? 0,
      }),
    ]);
    const isGenshin = adapter.gameSlug === "genshin-impact";
    return {
      gameId,
      revisionId: query.revisionId ?? null,
      achievements: achievements.map((achievement) =>
        isGenshin ? genshinAchievementSchema.parse(achievement) : achievement,
      ),
    };
  });

  app.get("/api/games/:gameId/codex/achievements/:stableId", async (request, reply) => {
    const params = stableIdParams.parse(request.params);
    const query = listQuerySchema.parse(parseQuery(request));
    try {
      const [adapter, achievement] = await Promise.all([
        gameDomain.getArchiveAdapter(params.gameId),
        gameDomain.getAchievement(
          params.gameId,
          decodeStableId(params.stableId),
          query.revisionId,
        ),
      ]);
      const isGenshin = adapter.gameSlug === "genshin-impact";
      return {
        achievement: isGenshin ? genshinAchievementSchema.parse(achievement) : achievement,
      };
    } catch (error) {
      if ((error as { code?: string }).code === "achievement_not_found")
        return reply.code(404).send({ error: { code: "achievement_not_found" } });
      throw error;
    }
  });
}
