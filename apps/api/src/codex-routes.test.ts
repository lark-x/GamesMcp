import { describe, expect, it } from "vitest";
import { type CodexMaterial, type GameSummary, codexMaterialSchema } from "@gip/contracts";
import type { GenshinStructuredRepository, KnowledgeRepository } from "@gip/domain";
import { createApp } from "./app.js";
import { loadConfig } from "@gip/config";

const genshinGameId = "00000000-0000-0000-0000-000000000001";
const starRailGameId = "00000000-0000-0000-0000-000000000002";
const revisionId = "00000000-0000-0000-0000-0000000000aa";

const genshinGame: GameSummary = {
  id: genshinGameId,
  slug: "genshin-impact",
  name: "原神",
  status: "active",
  currentRevision: "r1",
};

const starRailGame: GameSummary = {
  id: starRailGameId,
  slug: "honkai-star-rail",
  name: "崩坏：星穹铁道",
  status: "active",
  currentRevision: "r1",
};

const genshinMaterial: CodexMaterial = {
  id: "00000000-0000-0000-0000-0000000000c1",
  gameId: genshinGameId,
  revisionId,
  stableId: "material/nichang",
  sourceKey: "structured/material/nichang",
  name: "霓裳花",
  locale: "zh-CN",
  category: "local_specialty",
  sources: ["璃月港"],
  usedBy: ["行秋", "胡桃"],
};

// StarRail fixture includes non-Genshin material category to prove the generic contract
const starRailMaterial: CodexMaterial = {
  id: "00000000-0000-0000-0000-0000000000e1",
  gameId: starRailGameId,
  revisionId,
  stableId: "material/trace-destiny",
  sourceKey: "structured/material/trace-destiny",
  name: "命运的足迹",
  locale: "zh-CN",
  category: "trace_material", // Not in genshinMaterialCategorySchema!
  rarity: 5,
  description: "高级行迹升级材料",
  sources: ["历战余响", "模拟宇宙"],
  usedBy: ["开拓者", "三月七", "丹恒"],
};

function createTestApp() {
  const repository = {
    getGame: async (id: string) => {
      if (id === genshinGameId) return genshinGame;
      if (id === starRailGameId) return starRailGame;
      return null;
    },
    listGames: async () => [genshinGame, starRailGame],
    getCapabilities: async () => [{ capability: "entity_search" as const, enabled: true }],
    listRevisions: async (gameId?: string) => {
      const all = [
        {
          id: revisionId,
          gameId: genshinGameId,
          revisionNumber: 1,
          sourceBatchId: "00000000-0000-0000-0000-0000000000bb",
          releaseNote: null,
          lifecycleStatus: "published" as const,
          indexStatus: "ready" as const,
          publishedAt: new Date(),
          isCurrent: true,
          manifestId: "00000000-0000-0000-0000-0000000000cc",
        },
        {
          id: "00000000-0000-0000-0000-0000000000ab",
          gameId: starRailGameId,
          revisionNumber: 1,
          sourceBatchId: "00000000-0000-0000-0000-0000000000bc",
          releaseNote: null,
          lifecycleStatus: "published" as const,
          indexStatus: "ready" as const,
          publishedAt: new Date(),
          isCurrent: true,
          manifestId: "00000000-0000-0000-0000-0000000000cd",
        },
      ];
      return gameId ? all.filter((r) => r.gameId === gameId) : all;
    },
    genshin: {
      listMaterials: async (options: { limit: number; offset?: number }) => {
        // Return matching materials based on limit/offset
        const all = [genshinMaterial, starRailMaterial];
        const offset = options.offset ?? 0;
        return all.slice(offset, offset + options.limit);
      },
      getMaterial: async (_rev: string, stableId: string) => {
        if (stableId === "material/nichang") return genshinMaterial;
        if (stableId === "material/trace-destiny") return starRailMaterial;
        return null;
      },
      listCharacters: async () => [
        {
          gameId: starRailGameId,
          revisionId,
          stableId: "char_1001",
          sourceKey: "sr/character/1001",
          name: "三月七",
          locale: "zh-CN",
          rarity: 4,
          element: "冰",
          weaponType: "存护",
          affiliation: "星穹列车",
          profile: {},
        },
      ],
      getCharacter: async (_rev: string, stableId: string) =>
        stableId === "char_1001"
          ? {
              gameId: starRailGameId,
              revisionId,
              stableId: "char_1001",
              sourceKey: "sr/character/1001",
              name: "三月七",
              locale: "zh-CN",
              rarity: 4,
              element: "冰",
              weaponType: "存护",
              profile: {},
            }
          : null,
      listWeapons: async () => [
        {
          gameId: starRailGameId,
          revisionId,
          stableId: "lc_21001",
          sourceKey: "sr/lightcone/21001",
          name: "无可取代的东西",
          locale: "zh-CN",
          rarity: 5,
          weaponType: "毁灭",
          passiveName: "家人",
          passiveDescription: "使装备者的攻击力提高24%。",
        },
      ],
      getWeapon: async (_rev: string, stableId: string) =>
        stableId === "lc_21001"
          ? {
              gameId: starRailGameId,
              revisionId,
              stableId: "lc_21001",
              sourceKey: "sr/lightcone/21001",
              name: "无可取代的东西",
              locale: "zh-CN",
              rarity: 5,
              weaponType: "毁灭",
              passiveName: "家人",
            }
          : null,
      listArtifactSets: async () => [],
      getArtifactSet: async () => null,
      listEnemies: async () => [],
      getEnemy: async () => null,
      listAchievements: async () => [
        {
          gameId: starRailGameId,
          revisionId,
          stableId: "ach_4040101",
          sourceKey: "sr/achievement/4040101",
          name: "通往群星的轨道",
          locale: "zh-CN",
          category: "通往群星的轨道",
          requirement: "登上「星穹列车」，踏上开拓的旅程。",
          rewardPrimogems: 10,
          hidden: false,
        },
      ],
      getAchievement: async (_rev: string, stableId: string) =>
        stableId === "ach_4040101"
          ? {
              gameId: starRailGameId,
              revisionId,
              stableId: "ach_4040101",
              sourceKey: "sr/achievement/4040101",
              name: "通往群星的轨道",
              locale: "zh-CN",
              category: "通往群星的轨道",
              requirement: "登上「星穹列车」，踏上开拓的旅程。",
              rewardPrimogems: 10,
              hidden: false,
            }
          : null,
    } as unknown as GenshinStructuredRepository,
  } as unknown as KnowledgeRepository;

  return createApp({ repository, config: loadConfig({ NODE_ENV: "test" }) });
}

describe("Codex materials API", () => {
  it("exposes generic codex materials list supporting Genshin materials", async () => {
    const app = createTestApp();
    const response = await app.inject({
      method: "GET",
      url: `/api/games/${genshinGameId}/codex/materials`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.gameId).toBe(genshinGameId);
    expect(Array.isArray(body.materials)).toBe(true);
    expect(() => codexMaterialSchema.parse(body.materials[0])).not.toThrow();
    expect(body.materials[0].stableId).toBe("material/nichang");
    await app.close();
  });

  it("exposes generic codex materials supporting StarRail non-Genshin categories", async () => {
    const app = createTestApp();
    const response = await app.inject({
      method: "GET",
      url: `/api/games/${starRailGameId}/codex/materials`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.gameId).toBe(starRailGameId);
    // Find the StarRail material with trace_material category
    const found = body.materials.find(
      (m: CodexMaterial) => m.stableId === "material/trace-destiny",
    );
    expect(found).toBeDefined();
    expect(found.category).toBe("trace_material");
    expect(() => codexMaterialSchema.parse(found)).not.toThrow();

    const detail = await app.inject({
      method: "GET",
      url: `/api/games/${starRailGameId}/codex/materials/material%2Ftrace-destiny`,
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().material.category).toBe("trace_material");
    expect(() => codexMaterialSchema.parse(detail.json().material)).not.toThrow();
    await app.close();
  });

  it("handles 404 for missing material", async () => {
    const app = createTestApp();
    const response = await app.inject({
      method: "GET",
      url: `/api/games/${genshinGameId}/codex/materials/material%2Fmissing`,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("material_not_found");
    await app.close();
  });

  it("supports limit and offset pagination parameters", async () => {
    const app = createTestApp();
    const response = await app.inject({
      method: "GET",
      url: `/api/games/${genshinGameId}/codex/materials?limit=1&offset=1`,
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(1);
    expect(body.materials.length).toBe(1);
    expect(body.materials[0].stableId).toBe("material/trace-destiny");
    await app.close();
  });

  it("returns appropriate game terminology for Genshin and StarRail", async () => {
    const app = createTestApp();
    const genshinResp = await app.inject({
      method: "GET",
      url: `/api/games/${genshinGameId}/codex/terminology`,
    });
    expect(genshinResp.statusCode).toBe(200);
    expect(genshinResp.json().terminology).toEqual({
      characterLabel: "角色",
      weaponLabel: "武器",
      artifactLabel: "圣遗物",
      materialLabel: "材料",
    });

    const starRailResp = await app.inject({
      method: "GET",
      url: `/api/games/${starRailGameId}/codex/terminology`,
    });
    expect(starRailResp.statusCode).toBe(200);
    expect(starRailResp.json().terminology).toEqual({
      characterLabel: "角色",
      weaponLabel: "光锥",
      artifactLabel: "遗器",
      materialLabel: "材料",
    });
    await app.close();
  });

  it("exposes characters and weapons for StarRail without Genshin schema violations", async () => {
    const app = createTestApp();
    const charResp = await app.inject({
      method: "GET",
      url: `/api/games/${starRailGameId}/codex/characters`,
    });
    expect(charResp.statusCode).toBe(200);
    const charBody = charResp.json();
    expect(Array.isArray(charBody.characters)).toBe(true);
    expect(charBody.characters.length).toBeGreaterThan(0);
    expect(charBody.characters[0].name).toBe("三月七");

    const weaponResp = await app.inject({
      method: "GET",
      url: `/api/games/${starRailGameId}/codex/weapons`,
    });
    expect(weaponResp.statusCode).toBe(200);
    const weaponBody = weaponResp.json();
    expect(Array.isArray(weaponBody.weapons)).toBe(true);
    expect(weaponBody.weapons.length).toBeGreaterThan(0);
    await app.close();
  });
});
