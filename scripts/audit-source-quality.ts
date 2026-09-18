import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildStarRailInventory } from "../packages/providers/src/starrail/source/inventory.js";
import { readStarRailSourceSnapshot } from "../packages/providers/src/starrail/source/snapshot.js";
import { StarRailTextMapResolver } from "../packages/providers/src/starrail/source/textmap.js";
import {
  StarRailCharacterExtractor,
  StarRailLightConeExtractor,
  StarRailRelicExtractor,
  StarRailEnemyExtractor,
  StarRailAchievementExtractor,
  StarRailMaterialExtractor,
} from "../packages/providers/src/starrail/structured/index.js";

const sourceDir = process.argv[2];
if (!sourceDir)
  throw new Error(
    "Usage: node --import tsx scripts/audit-source-quality.ts <sourceDir> [output.json]",
  );
const snapshot = await readStarRailSourceSnapshot(sourceDir);
const inventory = await buildStarRailInventory({ dataDir: sourceDir, sourceRef: snapshot.ref });
const resolver = new StarRailTextMapResolver({ dataDir: sourceDir, inventory });
const textMap = await resolver.load();
const options = { dataDir: sourceDir, sourceRef: snapshot.ref, inventory, resolver };
const [characters, cones, relics, enemies, achievements, materials] = await Promise.all([
  new StarRailCharacterExtractor(options).extractCharacters(),
  new StarRailLightConeExtractor(options).extractLightCones(),
  new StarRailRelicExtractor(options).extractRelics(),
  new StarRailEnemyExtractor(options).extractEnemies(),
  new StarRailAchievementExtractor(options).extractAchievements(),
  new StarRailMaterialExtractor(options).extractMaterials(),
]);
const report = {
  generatedAt: new Date().toISOString(),
  source: "https://github.com/DimbreathBot/TurnBasedGameData",
  sourceCommit: snapshot.ref,
  sourceFiles: inventory.items.length,
  textMapKeys: textMap.totalKeys,
  counts: {
    characters: characters.length,
    lightCones: cones.length,
    relics: relics.length,
    enemies: enemies.length,
    achievements: achievements.length,
    materials: materials.length,
  },
  checks: {
    missingCharacterStats: characters.filter(
      (c) => c.baseHp === null || c.baseAtk === null || c.baseDef === null,
    ).length,
    missingLightConeStats: cones.filter(
      (c) => c.baseHp === null || c.baseAtk === null || c.baseDef === null,
    ).length,
    lightConeRarities: [...new Set(cones.map((c) => c.rarity))].sort(),
    planarRelics: relics.filter((r) => r.slotType === "OBJECT" || r.slotType === "NECK").length,
    missingRelicBonuses: relics.filter((r) => !r.twoPieceBonus).length,
    unknownAchievementRewards: achievements.filter((a) => a.rewardJade === null).length,
  },
  samples: {
    character: characters.find((c) => c.id === 1001),
    lightCone: cones.find((c) => c.rarity === 5),
    planarRelic: relics.find((r) => r.slotType === "OBJECT"),
    enemy: enemies[0],
  },
};
const output = resolve(process.argv[3] ?? "artifacts/data-quality/structured-source-audit.json");
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify({
    output,
    sourceCommit: report.sourceCommit,
    counts: report.counts,
    checks: report.checks,
  }),
);
