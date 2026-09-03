import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { buildStarRailInventory } from "../packages/providers/src/starrail/source/inventory.js";
import { readStarRailSourceSnapshot } from "../packages/providers/src/starrail/source/snapshot.js";

const args = parseArgs(process.argv.slice(2));
const dataDir =
  args.source ??
  process.env.GAMESMCP_STARRAIL_DATA_DIR ??
  "data/games/starrail/turn-based-game-data/8cdb905dc2f8e6fffa9be4eb07af3e34435d6091";
const inventoryOutput = resolve(args.inventory ?? "artifacts/starrail-source-inventory.json");
const auditOutput = resolve(args.output ?? "artifacts/starrail-source-audit.json");

const snapshot = await readStarRailSourceSnapshot(dataDir);
const inventory = await buildStarRailInventory({
  dataDir: resolve(dataDir),
  sourceRef: snapshot.ref,
  output: inventoryOutput,
});

const families: Record<string, number> = {
  Config: 0,
  ExcelOutput: 0,
  Story: 0,
  TextMap: 0,
};

for (const item of inventory.items) {
  families[item.family] = (families[item.family] ?? 0) + 1;
}

const candidateDatasets = {
  mission: inventory.items
    .filter(
      (i) =>
        /ExcelOutput\/(?:MainMission|SubMission)\.json/iu.test(i.path) ||
        /Story\/Mission\//iu.test(i.path),
    )
    .map((i) => i.path),
  story: inventory.items
    .filter(
      (i) =>
        /Story\/(?:Discussion|BattlePerformance)\//iu.test(i.path) ||
        /ExcelOutput\/StoryAtlas\.json/iu.test(i.path),
    )
    .map((i) => i.path),
  message: inventory.items
    .filter((i) => /ExcelOutput\/Message(?:Section|Item|Contacts|Group)Config\.json/iu.test(i.path))
    .map((i) => i.path),
  trainVisitor: inventory.items
    .filter((i) => /ExcelOutput\/TrainVisitorConfig\.json/iu.test(i.path))
    .map((i) => i.path),
  book: inventory.items
    .filter((i) => /ExcelOutput\/(?:LocalbookConfig|BookSeriesConfig)\.json/iu.test(i.path))
    .map((i) => i.path),
  characterStory: inventory.items
    .filter((i) =>
      /ExcelOutput\/(?:StoryAtlas|StoryAtlasTextmap|AvatarConfig)\.json/iu.test(i.path),
    )
    .map((i) => i.path),
  voiceLine: inventory.items
    .filter((i) => /ExcelOutput\/(?:VoiceAtlas|AvatarConfig)\.json/iu.test(i.path))
    .map((i) => i.path),
  itemLore: inventory.items
    .filter((i) =>
      /ExcelOutput\/(?:ItemConfig|ItemConfigEquipment|ItemConfigRelic)\.json/iu.test(i.path),
    )
    .map((i) => i.path),
};

const auditReport = {
  sourceCommit: snapshot.ref,
  generatedAt: new Date().toISOString(),
  totals: inventory.totals,
  families,
  candidateDatasets,
};

await mkdir(dirname(auditOutput), { recursive: true });
await writeFile(auditOutput, JSON.stringify(auditReport, null, 2), "utf8");
console.log(JSON.stringify({ ok: true, inventoryOutput, auditOutput, families }));

function parseArgs(values: string[]): Record<string, string | undefined> {
  const parsed: Record<string, string | undefined> = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    parsed[value.slice(2)] = values[index + 1];
    index += 1;
  }
  return parsed;
}
