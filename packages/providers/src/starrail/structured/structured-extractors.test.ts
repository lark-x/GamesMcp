import { describe, expect, it } from "vitest";
import {
  StarRailCharacterExtractor,
  StarRailLightConeExtractor,
  StarRailRelicExtractor,
  StarRailMaterialExtractor,
  StarRailEnemyExtractor,
  StarRailAchievementExtractor,
} from "./index.js";
import type { StarRailSourceInventory } from "../source/inventory.js";
import type { StarRailTextMapResolver } from "../source/textmap.js";

describe("StarRail Structured Domain Extractors (Phase 4 ~ 9)", () => {
  const mockInventory: StarRailSourceInventory = {
    schemaVersion: 1,
    source: "turn-based-game-data",
    root: "data/fixtures/starrail",
    sourceRef: "test-ref",
    generatedAt: new Date().toISOString(),
    totals: { files: 0, bytes: 0 },
    items: [],
  };

  const mockResolver: StarRailTextMapResolver = {
    resolve: (id: string | number) => String(id),
  } as unknown as StarRailTextMapResolver;

  it("extracts characters with baseline or config data in fixture mode", async () => {
    const extractor = new StarRailCharacterExtractor({
      dataDir: "data/fixtures/starrail",
      inventory: mockInventory,
      resolver: mockResolver,
      fixture: true,
    });
    const characters = await extractor.extractCharacters();
    expect(characters.length).toBeGreaterThan(0);
    expect(characters.some((c) => c.name === "三月七")).toBe(true);
    expect(characters.every((c) => c.rarity === 4 || c.rarity === 5)).toBe(true);
  });

  it("extracts light cones with path and baseline stats in fixture mode", async () => {
    const extractor = new StarRailLightConeExtractor({
      dataDir: "data/fixtures/starrail",
      inventory: mockInventory,
      resolver: mockResolver,
      fixture: true,
    });
    const lightCones = await extractor.extractLightCones();
    expect(lightCones.length).toBeGreaterThan(0);
    expect(lightCones.some((l) => l.name === "无可取代的东西")).toBe(true);
    expect(lightCones.every((l) => Boolean(l.path))).toBe(true);
  });

  it("extracts relics with 2pc and 4pc set bonuses in fixture mode", async () => {
    const extractor = new StarRailRelicExtractor({
      dataDir: "data/fixtures/starrail",
      inventory: mockInventory,
      resolver: mockResolver,
      fixture: true,
    });
    const relics = await extractor.extractRelics();
    expect(relics.length).toBeGreaterThan(0);
    expect(relics.some((r) => r.setName === "野穗伴行的快枪手")).toBe(true);
  });

  it("extracts materials with real classification and usage/source links in fixture mode", async () => {
    const extractor = new StarRailMaterialExtractor({
      dataDir: "data/fixtures/starrail",
      sourceRef: "test-ref",
      inventory: mockInventory,
      resolver: mockResolver,
      fixture: true,
    });
    const materials = await extractor.extractMaterials();
    expect(materials.length).toBeGreaterThan(0);
    expect(
      materials.some((m) => m.name === "暴风之眼" && m.category === "character_ascension"),
    ).toBe(true);
    expect(materials.some((m) => m.name === "信用点" && m.category === "currency")).toBe(true);
    expect(materials.every((m) => m.sources.length > 0)).toBe(true);
  });

  it("extracts enemies with weaknesses and ranks in fixture mode", async () => {
    const extractor = new StarRailEnemyExtractor({
      dataDir: "data/fixtures/starrail",
      inventory: mockInventory,
      resolver: mockResolver,
      fixture: true,
    });
    const enemies = await extractor.extractEnemies();
    expect(enemies.length).toBeGreaterThan(0);
    expect(enemies.some((e) => e.rank === "BOSS")).toBe(true);
  });

  it("extracts achievements with categories and jade rewards in fixture mode", async () => {
    const extractor = new StarRailAchievementExtractor({
      dataDir: "data/fixtures/starrail",
      inventory: mockInventory,
      resolver: mockResolver,
      fixture: true,
    });
    const achievements = await extractor.extractAchievements();
    expect(achievements.length).toBeGreaterThan(0);
    expect(achievements.some((a) => a.title === "通往群星的轨道")).toBe(true);
    expect(achievements.every((a) => a.rewardJade !== null && a.rewardJade > 0)).toBe(true);
  });

  it("strictly forbids baseline fallbacks in production mode when files are missing", async () => {
    const charExtractor = new StarRailCharacterExtractor({
      dataDir: "data/fixtures/starrail",
      inventory: mockInventory,
      resolver: mockResolver,
      fixture: false,
    });
    expect(await charExtractor.extractCharacters()).toEqual([]);

    const lcExtractor = new StarRailLightConeExtractor({
      dataDir: "data/fixtures/starrail",
      inventory: mockInventory,
      resolver: mockResolver,
      fixture: false,
    });
    expect(await lcExtractor.extractLightCones()).toEqual([]);

    const relicExtractor = new StarRailRelicExtractor({
      dataDir: "data/fixtures/starrail",
      inventory: mockInventory,
      resolver: mockResolver,
      fixture: false,
    });
    expect(await relicExtractor.extractRelics()).toEqual([]);

    const matExtractor = new StarRailMaterialExtractor({
      dataDir: "data/fixtures/starrail",
      sourceRef: "test-ref",
      inventory: mockInventory,
      resolver: mockResolver,
      fixture: false,
    });
    expect(await matExtractor.extractMaterials()).toEqual([]);

    const enemyExtractor = new StarRailEnemyExtractor({
      dataDir: "data/fixtures/starrail",
      inventory: mockInventory,
      resolver: mockResolver,
      fixture: false,
    });
    expect(await enemyExtractor.extractEnemies()).toEqual([]);

    const achExtractor = new StarRailAchievementExtractor({
      dataDir: "data/fixtures/starrail",
      inventory: mockInventory,
      resolver: mockResolver,
      fixture: false,
    });
    expect(await achExtractor.extractAchievements()).toEqual([]);
  });
});
