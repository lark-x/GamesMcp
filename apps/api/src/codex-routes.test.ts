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
    listRevisions: async () => [
      {
        id: revisionId,
        gameId: genshinGameId,
        revisionNumber: 1,
        sourceBatchId: "00000000-0000-0000-0000-0000000000bb",
        releaseNote: null,
        lifecycleStatus: "published",
        indexStatus: "ready",
        publishedAt: new Date(),
        isCurrent: true,
        manifestId: "00000000-0000-0000-0000-0000000000cc",
      },
    ],
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
});
