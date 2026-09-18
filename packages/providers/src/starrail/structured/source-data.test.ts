import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { buildStarRailInventory } from "../source/inventory.js";
import { StarRailTextMapResolver } from "../source/textmap.js";
import { StarRailCharacterExtractor } from "./character.js";
import { StarRailLightConeExtractor } from "./lightcone.js";
import { StarRailRelicExtractor } from "./relic.js";
import { StarRailEnemyExtractor } from "./enemy.js";
import { StarRailAchievementExtractor } from "./achievement.js";
import { formatConfigText } from "./values.js";

it("joins source tables for stats, rarity, relic slots and seven-digit monster IDs", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "sr-structured-quality-"));
  await mkdir(join(dataDir, "ExcelOutput"));
  await mkdir(join(dataDir, "TextMap"));
  const files: Record<string, unknown> = {
    "TextMap/TextMapCHS.json": {
      "1": "三月七",
      "2": "光锥",
      "3": "套装",
      "4": "位面球",
      "5": "敌人",
      "6": "提高#1[i]%",
    },
    "ExcelOutput/AvatarConfig.json": [
      {
        AvatarID: 1001,
        Release: true,
        AvatarName: { Hash: 1 },
        Rarity: "CombatPowerAvatarRarityType4",
      },
      { AvatarID: 1002, Release: false },
    ],
    "ExcelOutput/AvatarPromotionConfig.json": [
      {
        AvatarID: 1001,
        HPBase: { Value: 144 },
        AttackBase: { Value: 69.6 },
        DefenceBase: { Value: 78 },
        SpeedBase: { Value: 101 },
      },
      { AvatarID: 1001, Promotion: 1, HPBase: { Value: 201.6 } },
    ],
    "ExcelOutput/EquipmentConfig.json": [
      {
        EquipmentID: 23000,
        Release: true,
        EquipmentName: { Hash: 2 },
        Rarity: "CombatPowerLightconeRarity5",
        SkillID: 23000,
      },
    ],
    "ExcelOutput/EquipmentPromotionConfig.json": [
      {
        EquipmentID: 23000,
        BaseHP: { Value: 48 },
        BaseAttack: { Value: 24 },
        BaseDefence: { Value: 18 },
      },
    ],
    "ExcelOutput/EquipmentSkillConfig.json": [
      { SkillID: 23000, Level: 1, SkillDesc: { Hash: 6 }, ParamList: [{ Value: 0.12 }] },
      { SkillID: 23000, Level: 5, SkillDesc: { Hash: 6 }, ParamList: [{ Value: 0.24 }] },
    ],
    "ExcelOutput/RelicSetConfig.json": [{ SetID: 301, Release: true, SetName: { Hash: 3 } }],
    "ExcelOutput/RelicConfig.json": [
      { ID: 63015, SetID: 301, Type: "OBJECT", Rarity: "CombatPowerRelicRarity5" },
    ],
    "ExcelOutput/ItemConfigRelic.json": [{ ID: 63015, ItemName: { Hash: 4 } }],
    "ExcelOutput/MonsterConfig.json": [
      {
        MonsterID: 1002011,
        MonsterTemplateID: 1002011,
        MonsterName: { Hash: 5 },
        StanceWeakList: ["Fire"],
        DamageTypeResistance: [{ DamageType: "Ice", Value: { Value: 0.2 } }],
      },
    ],
    "ExcelOutput/MonsterTemplateConfig.json": [
      { MonsterTemplateID: 1002011, Rank: "BigBoss", HPBase: { Value: 69.75 } },
    ],
    "ExcelOutput/AchievementData.json": [
      { AchievementID: 4010101, QuestID: 4010101, AchievementTitle: { Hash: 1 } },
    ],
    "ExcelOutput/QuestData.json": [{ QuestID: 4010101, RewardID: 113002 }],
    "ExcelOutput/RewardData.json": [{ RewardID: 113002, Hcoin: 20 }],
  };
  for (const [file, value] of Object.entries(files))
    await writeFile(join(dataDir, file), JSON.stringify(value));
  const inventory = await buildStarRailInventory({ dataDir, sourceRef: "test" });
  const resolver = new StarRailTextMapResolver({ dataDir, inventory });
  await resolver.load();
  const options = { dataDir, inventory, resolver };
  const characters = await new StarRailCharacterExtractor(options).extractCharacters();
  expect(characters).toHaveLength(1);
  expect(characters[0]).toMatchObject({ baseHp: 144, baseAtk: 69.6, baseDef: 78, baseSpeed: 101 });
  const cones = await new StarRailLightConeExtractor(options).extractLightCones();
  expect(cones[0]).toMatchObject({ rarity: 5, baseAtk: 24, skillDesc: "提高12%" });
  const relics = await new StarRailRelicExtractor(options).extractRelics();
  expect(relics).toHaveLength(1);
  expect(relics[0]).toMatchObject({ id: 63015, name: "位面球", slotType: "OBJECT" });
  const enemies = await new StarRailEnemyExtractor(options).extractEnemies();
  expect(
    (await new StarRailAchievementExtractor(options).extractAchievements())[0]?.rewardJade,
  ).toBe(20);
  expect(enemies[0]).toMatchObject({
    id: 1002011,
    rank: "BOSS",
    weaknesses: ["Fire"],
    resistances: ["Ice"],
    baseHp: 69.75,
  });
});

it("preserves unresolved skill parameters and formats known percentages", () => {
  expect(formatConfigText("#1[i]% / #2[i] / #3[f1]", [{ Value: 0.12 }, { Value: 3 }])).toBe(
    "12% / 3 / #3[f1]",
  );
});
