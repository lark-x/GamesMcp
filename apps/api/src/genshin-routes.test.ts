import { beforeEach, describe, expect, it } from "vitest";
import {
  type GenshinArtifactSet,
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

const artifactSet: GenshinArtifactSet = {
  id: "00000000-0000-0000-0000-0000000000d1",
  gameId,
  revisionId,
  stableId: "artifact-set/adventurer",
  sourceKey: "structured/artifact-set/adventurer",
  name: "冒险家",
  locale: "zh-CN",
  provenance: {},
  pieces: [],
};

const calls: string[] = [];

const genshin: GenshinStructuredRepository = {
  upsertCharacter: async () => {
    throw new Error("not used");
  },
  getCharacter: async (_rev, stableId) => (stableId === "char/hutao" ? character : null),
  listCharacters: async (options) => {
    calls.push(`characters:${options.query ?? ""}:${options.limit}:${options.offset ?? 0}`);
    return [character];
  },
  upsertWeapon: async () => {
    throw new Error("not used");
  },
  getWeapon: async () => null,
  listWeapons: async (options) => {
    calls.push(`weapons:${options.query ?? ""}:${options.limit}:${options.offset ?? 0}`);
    return [];
  },
  upsertArtifactSet: async () => {
    throw new Error("not used");
  },
  getArtifactSet: async (_rev, stableId) =>
    stableId === "artifact-set/adventurer" ? artifactSet : null,
  listArtifactSets: async (options) => {
    calls.push(`artifactSets:${options.query ?? ""}:${options.limit}:${options.offset ?? 0}`);
    return [artifactSet];
  },
  upsertArtifact: async () => {
    throw new Error("not used");
  },
  getArtifact: async () => null,
  listArtifacts: async (options) => {
    calls.push(`artifacts:${options.query ?? ""}:${options.limit}:${options.offset ?? 0}`);
    return [];
  },
  upsertMaterial: async () => {
    throw new Error("not used");
  },
  getMaterial: async (_rev, stableId) => (stableId === "material/nichang" ? material : null),
  listMaterials: async (options) => {
    calls.push(`materials:${options.query ?? ""}:${options.limit}:${options.offset ?? 0}`);
    return [material];
  },
  upsertAchievement: async () => {
    throw new Error("not used");
  },
  getAchievement: async () => null,
  listAchievements: async (options) => {
    calls.push(`achievements:${options.query ?? ""}:${options.limit}:${options.offset ?? 0}`);
    return [];
  },
  upsertEnemy: async () => {
    throw new Error("not used");
  },
  findCharacterByNormalizedName: async () => null,
  findWeaponByNormalizedName: async () => null,
  findArtifactByNormalizedName: async () => null,
  findArtifactSetByNormalizedName: async () => null,
  findMaterialByNormalizedName: async () => null,
  findAchievementByNormalizedName: async () => null,
  findEnemyByNormalizedName: async () => null,
  getEnemy: async () => null,
  listEnemies: async (options) => {
    calls.push(`enemies:${options.query ?? ""}:${options.limit}:${options.offset ?? 0}`);
    return [];
  },
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
  beforeEach(() => {
    calls.length = 0;
  });

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
    expect(calls).toEqual(["characters::20:0"]);
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

  it("exposes artifact set list and detail routes", async () => {
    const instance = app();
    const list = await instance.inject({
      method: "GET",
      url: `/api/games/${gameId}/genshin/artifactSets?q=冒险&limit=7&offset=3`,
    });
    expect(list.statusCode).toBe(200);
    expect(() => genshinArtifactSetSchema.parse(list.json().artifactSets[0])).not.toThrow();
    expect(calls).toContain("artifactSets:冒险:7:3");
    const found = await instance.inject({
      method: "GET",
      url: `/api/games/${gameId}/genshin/artifactSets/artifact-set%2Fadventurer?revisionId=${revisionId}`,
    });
    expect(found.statusCode).toBe(200);
    expect(() => genshinArtifactSetSchema.parse(found.json().artifactSet)).not.toThrow();
    const missing = await instance.inject({
      method: "GET",
      url: `/api/games/${gameId}/genshin/artifactSets/artifact-set%2Fmissing`,
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("artifact_set_not_found");
    await instance.close();
  });

  it("passes list pagination and query parameters to every structured category", async () => {
    const instance = app();
    for (const path of ["weapons", "artifacts", "achievements", "enemies"]) {
      const response = await instance.inject({
        method: "GET",
        url: `/api/games/${gameId}/genshin/${path}?q=测试&limit=11&offset=5`,
      });
      expect(response.statusCode).toBe(200);
    }
    expect(calls).toEqual([
      "weapons:测试:11:5",
      "artifacts:测试:11:5",
      "artifactSets:测试:11:5",
      "achievements:测试:11:5",
      "enemies:测试:11:5",
    ]);
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
