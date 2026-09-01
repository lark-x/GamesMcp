import { describe, expect, it } from "vitest";
import {
  type GenshinCharacter,
  type GenshinMaterial,
  genshinAchievementSchema,
  genshinArtifactSchema,
  genshinArtifactSetSchema,
  genshinCharacterSchema,
  genshinEnemySchema,
  genshinMaterialSchema,
  genshinWeaponSchema,
} from "@gip/contracts";
import type { GameSummary } from "@gip/contracts";
import type { GenshinStructuredRepository, KnowledgeRepository } from "@gip/domain";
import { createApp } from "./app.js";
import { loadConfig } from "@gip/config";

const gameId = "00000000-0000-0000-0000-000000000001";
const revisionId = "00000000-0000-0000-0000-0000000000aa";

const game: GameSummary = {
  id: gameId,
  slug: "genshin-impact",
  name: "原神",
  status: "active",
  currentRevision: "r4",
};

const character: GenshinCharacter = {
  id: "00000000-0000-0000-0000-0000000000b1",
  gameId,
  revisionId,
  stableId: "char/hutao",
  sourceKey: "structured/char/hutao",
  name: "胡桃",
  locale: "zh-CN",
  provenance: {},
  profile: {},
  title: "往生堂堂主",
  rarity: 5,
  element: "pyro",
  weaponType: "polearm",
};

const material: GenshinMaterial = {
  id: "00000000-0000-0000-0000-0000000000c1",
  gameId,
  revisionId,
  stableId: "material/nichang",
  sourceKey: "structured/material/nichang",
  name: "霓裳花",
  locale: "zh-CN",
  provenance: {},
  category: "local_specialty",
  sources: [],
  usedBy: [],
};

const genshin: GenshinStructuredRepository = {
  upsertCharacter: async () => {
    throw new Error("not used");
  },
  getCharacter: async (_rev, stableId) => (stableId === "char/hutao" ? character : null),
  listCharacters: async () => [character],
  upsertWeapon: async () => {
    throw new Error("not used");
  },
  getWeapon: async () => null,
  listWeapons: async () => [],
  upsertArtifactSet: async () => {
    throw new Error("not used");
  },
  getArtifactSet: async () => null,
  listArtifactSets: async () => [],
  upsertArtifact: async () => {
    throw new Error("not used");
  },
  getArtifact: async () => null,
  listArtifacts: async () => [],
  upsertMaterial: async () => {
    throw new Error("not used");
  },
  getMaterial: async (_rev, stableId) => (stableId === "material/nichang" ? material : null),
  listMaterials: async () => [material],
  upsertAchievement: async () => {
    throw new Error("not used");
  },
  getAchievement: async () => null,
  listAchievements: async () => [],
  upsertEnemy: async () => {
    throw new Error("not used");
  },
  getEnemy: async () => null,
  listEnemies: async () => [],
};

const repository = {
  genshin,
  health: async () => ({ database: "up", currentRevision: "available", searchIndex: "ready" }),
  listGames: async () => [game],
  getGame: async (id: string) => (id === gameId ? game : null),
  getCapabilities: async () => [{ capability: "entity_search" as const, enabled: true }],
  listRevisions: async () => [
    {
      id: revisionId,
      gameId,
      revisionNumber: 4,
      sourceBatchId: "00000000-0000-0000-0000-0000000000bb",
      releaseNote: null,
      lifecycleStatus: "published",
      indexStatus: "ready",
      publishedAt: new Date(),
      isCurrent: true,
      manifestId: "00000000-0000-0000-0000-0000000000cc",
    },
  ],
  search: async () => ({
    entities: [],
    documents: [],
    segments: [],
    revision: "r4",
    indexStatus: "ready" as const,
  }),
} as unknown as KnowledgeRepository;

function app() {
  return createApp({ repository, config: loadConfig({ NODE_ENV: "test" }) });
}

describe("Genshin API contracts", () => {
  it("lists characters with Zod-validated response contracts", async () => {
    const instance = app();
    const response = await instance.inject({
      method: "GET",
      url: `/api/games/${gameId}/genshin/characters`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.characters).toHaveLength(1);
    expect(() => genshinCharacterSchema.parse(body.characters[0])).not.toThrow();
    await instance.close();
  });

  it("returns a single character by stableId and 404 for unknown ids", async () => {
    const instance = app();
    const found = await instance.inject({
      method: "GET",
      url: `/api/games/${gameId}/genshin/characters/char%2Fhutao`,
    });
    expect(found.statusCode).toBe(200);
    expect(() => genshinCharacterSchema.parse(found.json().character)).not.toThrow();
    const missing = await instance.inject({
      method: "GET",
      url: `/api/games/${gameId}/genshin/characters/char%2Fmissing`,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("character_not_found");
    await instance.close();
  });

  it("lists materials with the shared material contract", async () => {
    const instance = app();
    const response = await instance.inject({
      method: "GET",
      url: `/api/games/${gameId}/genshin/materials`,
    });
    expect(response.statusCode).toBe(200);
    expect(() => genshinMaterialSchema.parse(response.json().materials[0])).not.toThrow();
    await instance.close();
  });

  it("exposes weapons, artifacts, achievements, and enemies list contracts", async () => {
    const instance = app();
    for (const [url, schema] of [
      ["weapons", genshinWeaponSchema],
      ["artifacts", genshinArtifactSchema],
      ["achievements", genshinAchievementSchema],
      ["enemies", genshinEnemySchema],
    ] as const) {
      const response = await instance.inject({
        method: "GET",
        url: `/api/games/${gameId}/genshin/${url}`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      const list = body[url] ?? body.artifacts ?? body.enemies ?? [];
      for (const item of list) expect(() => schema.parse(item)).not.toThrow();
    }
    const artifactList = await instance.inject({
      method: "GET",
      url: `/api/games/${gameId}/genshin/artifacts`,
    });
    expect(Array.isArray(artifactList.json().artifactSets)).toBe(true);
    for (const set of artifactList.json().artifactSets)
      expect(() => genshinArtifactSetSchema.parse(set)).not.toThrow();
    await instance.close();
  });

  it("rejects invalid query and path inputs before reaching the service", async () => {
    const instance = app();
    const badLimit = await instance.inject({
      method: "GET",
      url: `/api/games/${gameId}/genshin/characters?limit=1000`,
    });
    expect(badLimit.statusCode).toBe(400);
    const badGame = await instance.inject({
      method: "GET",
      url: `/api/games/not-a-uuid/genshin/characters`,
    });
    expect(badGame.statusCode).toBe(400);
    await instance.close();
  });
});
