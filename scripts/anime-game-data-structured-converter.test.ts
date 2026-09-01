import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  genshinAchievementSchema,
  genshinArtifactSchema,
  genshinArtifactSetSchema,
  genshinCharacterSchema,
  genshinEnemySchema,
  genshinMaterialSchema,
  genshinWeaponSchema,
} from "@gip/contracts";
import {
  convertStructuredAnimeGameData,
  writeStructuredConversionResult,
} from "./anime-game-data-structured-converter.js";

const fixtureDir = fileURLToPath(new URL("../data/fixtures/anime-game-data", import.meta.url));
const context = {
  gameId: "00000000-0000-0000-0000-000000000001",
  revisionId: "00000000-0000-0000-0000-000000000002",
  upstreamCommit: "fixture-commit",
  upstreamVersion: "CNRELWin7.0.0_fixture",
  gameVersion: "7.0.0",
};
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("AnimeGameData structured converter", () => {
  it("extracts P0 and P1 Genshin structured records with provenance", async () => {
    const result = await convertStructuredAnimeGameData({ upstreamDir: fixtureDir, context });

    expect(result.manifest.discovered).toEqual({
      characters: 1,
      weapons: 1,
      artifactSets: 1,
      artifacts: 1,
      materials: 2,
      achievements: 1,
      enemies: 1,
      voices: 1,
    });
    expect(result.manifest.converted).toEqual({
      characters: 1,
      weapons: 1,
      artifactSets: 1,
      artifacts: 1,
      materials: 2,
      achievements: 1,
      enemies: 1,
      voices: 1,
    });
    expect(result.manifest.failures).toEqual([]);
    expect(result.records.characters[0]).toMatchObject({
      stableId: "genshin:character:10001",
      sourceKey: "anime-game-data/character/10001",
      name: "星海旅人",
      weaponType: "sword",
      rarity: 4,
      description: "角色简介",
    });
    expect(result.records.weapons[0]).toMatchObject({
      stableId: "genshin:weapon:11001",
      name: "测试单手剑",
      weaponType: "sword",
      rarity: 4,
      baseAttack: null,
      baseAttackResolved: false,
      passiveName: "剑之秘传",
      provenance: {
        weaponBaseExp: 42,
        baseAttackResolved: false,
      },
    });
    expect(result.records.artifactSets[0]).toMatchObject({
      stableId: "genshin:artifact-set:12001",
      name: "测试圣遗物套装",
      twoPieceBonus: "二件套效果",
      fourPieceBonus: "四件套效果",
      pieces: ["测试生之花"],
    });
    expect(result.records.artifacts[0]).toMatchObject({
      stableId: "genshin:artifact:12011",
      setStableId: "genshin:artifact-set:12001",
      slot: "EQUIP_BRACER",
      rarity: 5,
    });
    expect(result.records.materials[0]).toMatchObject({
      stableId: "genshin:material:20001",
      name: "测试材料",
      rarity: 2,
      description: "材料描述\n\n材料特殊效果",
    });
    expect(result.records.achievements[0]).toMatchObject({
      stableId: "genshin:achievement:13011",
      name: "测试成就",
      category: "wonders_of_the_world",
      requirement: "完成测试条件",
      rewardPrimogems: null,
      hidden: true,
      displayState: "hidden",
      provenance: {
        goalId: "13001",
        goalName: "天地万象",
        finishRewardId: "5",
        rewardPrimogemsResolved: false,
      },
    });
    expect(result.records.enemies[0]).toMatchObject({
      stableId: "genshin:enemy:14001",
      name: "测试丘丘人",
      category: "common",
      description: "敌人描述",
      drops: [],
      dropsResolved: false,
      provenance: {
        dropsResolved: false,
      },
    });
    expect(result.records.voices[0]).toMatchObject({
      stableId: "genshin:voice:15001",
      sourceKey: "anime-game-data/voice/15001",
      characterStableId: "genshin:character:10001",
      title: "初次见面…",
      body: "你好，我是星海旅人。",
    });
    expect(result.records.characters[0]?.provenance).toMatchObject({
      upstreamSource: "DimbreathBot/AnimeGameData",
      upstreamCommit: "fixture-commit",
      converterVersion: "anime-game-data-structured-v1",
      sourceFile: "ExcelBinOutput/AvatarExcelConfigData.json",
      rawContentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(result.manifest.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("produces records accepted by the structured contracts", async () => {
    const result = await convertStructuredAnimeGameData({ upstreamDir: fixtureDir, context });

    expect(() => genshinCharacterSchema.parse(result.records.characters[0])).not.toThrow();
    expect(() => genshinWeaponSchema.parse(result.records.weapons[0])).not.toThrow();
    expect(() => genshinArtifactSetSchema.parse(result.records.artifactSets[0])).not.toThrow();
    expect(() => genshinArtifactSchema.parse(result.records.artifacts[0])).not.toThrow();
    expect(() => genshinMaterialSchema.parse(result.records.materials[0])).not.toThrow();
    expect(() => genshinAchievementSchema.parse(result.records.achievements[0])).not.toThrow();
    expect(() => genshinEnemySchema.parse(result.records.enemies[0])).not.toThrow();
  });

  it("does not serialize unresolved upstream fields as gameplay facts", async () => {
    const result = await convertStructuredAnimeGameData({ upstreamDir: fixtureDir, context });
    const weapon = result.records.weapons[0];
    const achievement = result.records.achievements[0];
    const enemy = result.records.enemies[0];

    expect(weapon?.provenance.weaponBaseExp).toBe(42);
    expect(weapon?.baseAttack).toBeNull();
    expect(weapon?.baseAttack).not.toBe(weapon?.provenance.weaponBaseExp);
    expect(achievement?.provenance.finishRewardId).toBe("5");
    expect(achievement?.rewardPrimogems).toBeNull();
    expect(achievement?.rewardPrimogems).not.toBe(Number(achievement?.provenance.finishRewardId));
    expect(enemy?.drops).toEqual([]);
    expect(enemy?.drops.length).not.toBe(result.records.materials.length);
  });

  it("is deterministic and reports full stable id coverage for fixture rows", async () => {
    const first = await convertStructuredAnimeGameData({ upstreamDir: fixtureDir, context });
    const second = await convertStructuredAnimeGameData({ upstreamDir: fixtureDir, context });

    expect(first).toEqual(second);
    expect(first.manifest.stableIdCoverage).toEqual({
      characters: 1,
      weapons: 1,
      artifactSets: 1,
      artifacts: 1,
      materials: 1,
      achievements: 1,
      enemies: 1,
      voices: 1,
    });
    expect(first.manifest.coverage).toEqual({
      characters: 1,
      weapons: 1,
      artifactSets: 1,
      artifacts: 1,
      materials: 1,
      achievements: 1,
      enemies: 1,
      voices: 1,
    });
    expect(first.manifest.fieldCoverage.characters.name).toBe(1);
    expect(first.manifest.fieldCoverage.weapons.weaponType).toBe(1);
    expect(first.manifest.fieldCoverage.achievements.requirement).toBe(1);
    expect(first.manifest.fieldCoverage.voices.characterStableId).toBe(1);
  });

  it("writes dry-run records and manifest to the normalized import layout", async () => {
    const result = await convertStructuredAnimeGameData({ upstreamDir: fixtureDir, context });
    const outputRoot = await mkdtemp(join(tmpdir(), "gip-structured-etl-"));
    tempDirs.push(outputRoot);

    const manifest = await writeStructuredConversionResult(
      result,
      outputRoot,
      "2026-09-01T00:00:00.000Z",
    );

    expect(manifest.outputRecordsPath).toContain("records");
    expect(JSON.parse(await readFile(join(outputRoot, "manifest.json"), "utf8"))).toMatchObject({
      generatedAt: "2026-09-01T00:00:00.000Z",
      contentHash: result.manifest.contentHash,
      converted: { characters: 1, achievements: 1 },
    });
    await expect(
      readFile(join(outputRoot, "records", "characters.json"), "utf8"),
    ).resolves.toContain("genshin:character:10001");
    await expect(
      readFile(join(outputRoot, "records", "artifact-sets.json"), "utf8"),
    ).resolves.toContain("genshin:artifact-set:12001");
    await expect(readFile(join(outputRoot, "records", "enemies.json"), "utf8")).resolves.toContain(
      "genshin:enemy:14001",
    );
    await expect(readFile(join(outputRoot, "records", "voices.json"), "utf8")).resolves.toContain(
      "genshin:voice:15001",
    );
  });
});
