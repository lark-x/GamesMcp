import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

/**
 * Generate the raw upstream story/text/mechanism baseline.
 *
 * Counts intentionally use source rows or explicitly declared references;
 * they are not estimates of successfully converted or published records.
 * Domains that have no corresponding source in the pinned snapshot remain 0.
 */

const execFile = promisify(execFileCallback);
const REPO_ROOT = resolve(process.cwd());
const UPSTREAM_DIR = resolve(REPO_ROOT, "data/upstream/AnimeGameData");
const OUTPUT_PATH = resolve(REPO_ROOT, "data/evaluation/genshin/story-baseline.json");
const PINNED_COMMIT = "26df1dfbdf05a82bbb1d97506859f3e1c40718d8";

const SOURCE = "DimbreathBot/AnimeGameData";
const LOCALE = "zh-CN";

type JsonObject = Record<string, unknown>;
type JsonValue = unknown;

const files = {
  textMap: "TextMap/TextMapCHS.json",
  textMapMedium: "TextMap/TextMap_MediumCHS.json",
  mainQuest: "ExcelBinOutput/MainQuestExcelConfigData.json",
  quest: "ExcelBinOutput/QuestExcelConfigData.json",
  talk0: "ExcelBinOutput/TalkExcelConfigData_0.json",
  talk1: "ExcelBinOutput/TalkExcelConfigData_1.json",
  dialog: "ExcelBinOutput/DialogExcelConfigData.json",
  books: "ExcelBinOutput/BooksCodexExcelConfigData.json",
  documents: "ExcelBinOutput/DocumentExcelConfigData.json",
  fetterStory: "ExcelBinOutput/FetterStoryExcelConfigData.json",
  material: "ExcelBinOutput/MaterialExcelConfigData.json",
  npc: "ExcelBinOutput/NpcExcelConfigData.json",
} as const;

const absentDomains = {
  voiceLines: ["ExcelBinOutput/AvatarVoiceExcelConfigData.json"],
  achievements: [
    "ExcelBinOutput/AchievementExcelConfigData.json",
    "ExcelBinOutput/AchievementGoalExcelConfigData.json",
  ],
  tutorials: [],
  mechanisms: [],
  segments: [],
} as const;

function isObject(value: JsonValue): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function rows(value: JsonValue): JsonObject[] {
  if (Array.isArray(value)) return value.filter(isObject);
  return isObject(value) ? Object.values(value).filter(isObject) : [];
}

function idKey(value: JsonValue): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function refKey(value: JsonValue): string | undefined {
  return idKey(value);
}

function resolveText(map: JsonObject, value: JsonValue): boolean {
  const key = refKey(value);
  if (!key) return false;
  const text = map[key];
  return typeof text === "string" && text.trim().length > 0;
}

async function readJson(relativePath: string): Promise<JsonValue> {
  return JSON.parse(await readFile(join(UPSTREAM_DIR, relativePath), "utf8")) as JsonValue;
}

async function gitOutput(args: string[]): Promise<string> {
  const result = await execFile("git", ["-C", UPSTREAM_DIR, ...args], { encoding: "utf8" });
  return String(result.stdout).trim();
}

async function readableFileCount(): Promise<number> {
  const root = join(UPSTREAM_DIR, "Readable", "CHS");
  const entries = await readdir(root, { withFileTypes: true });
  return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".txt")).length;
}

async function main(): Promise<void> {
  const upstreamCommit = await gitOutput(["rev-parse", "HEAD"]);
  if (upstreamCommit !== PINNED_COMMIT) {
    throw new Error(
      `Unexpected AnimeGameData commit: ${upstreamCommit}; expected ${PINNED_COMMIT}`,
    );
  }

  const [
    textMap,
    textMapMedium,
    mainQuestValue,
    questValue,
    talk0Value,
    talk1Value,
    dialogValue,
    booksValue,
    documentsValue,
    fetterStoryValue,
    materialValue,
    npcValue,
  ] = await Promise.all(Object.values(files).map(readJson));

  const text = {
    ...((isObject(textMap) && textMap) || {}),
    ...((isObject(textMapMedium) && textMapMedium) || {}),
  };
  const mainQuestRows = rows(mainQuestValue);
  const questRows = rows(questValue);
  const talkRows = [...rows(talk0Value), ...rows(talk1Value)];
  const dialogRows = rows(dialogValue);
  const bookRows = rows(booksValue);
  const documentRows = rows(documentsValue);
  const fetterStoryRows = rows(fetterStoryValue);
  const materialRows = rows(materialValue);
  const npcRows = rows(npcValue);

  const subquestMainIds = new Set(
    questRows.flatMap((row) => {
      const id = idKey(row.mainId ?? row.mainQuestId);
      return id ? [id] : [];
    }),
  );
  const talkQuestIds = new Set(
    talkRows.flatMap((row) => {
      const id = idKey(row.questId);
      return id ? [id] : [];
    }),
  );

  const codexDirectory = join(UPSTREAM_DIR, "BinOutput", "CodexQuest");
  const codexFiles = (await readdir(codexDirectory))
    .filter((name) => name.endsWith(".json"))
    .sort();
  const codexMainIds = new Set<string>();
  for (const name of codexFiles) {
    const value = JSON.parse(await readFile(join(codexDirectory, name), "utf8")) as JsonValue;
    if (!isObject(value)) continue;
    const id = idKey(value.IMJHJGBNMMD ?? value.mainQuestId ?? value.mainId ?? value.id);
    if (id) codexMainIds.add(id);
  }

  const npcById = new Map(
    npcRows.flatMap((row) => {
      const id = idKey(row.id ?? row.npcId);
      return id ? [[id, row] as const] : [];
    }),
  );

  // A title is unresolved when the primary zh-CN TextMap cannot resolve the
  // MainQuest.titleTextMapHash. This matches the quest converter's primary
  // locale and counts source rows, not distinct hash values.
  const unresolvedTitles = mainQuestRows.filter(
    (row) => !resolveText(text, row.titleTextMapHash),
  ).length;

  // A speaker is unresolved after the available exact fallback: first the
  // dialog role-name hash, then Npc.id -> Npc.nameTextMapHash for NPC roles.
  const unresolvedSpeakers = dialogRows.filter((row) => {
    if (resolveText(text, row.talkRoleNameTextMapHash)) return false;
    const role = isObject(row.talkRole) ? row.talkRole : {};
    if (role.type !== "TALK_ROLE_NPC") return true;
    const npcId = idKey(role.id);
    const npc = npcId ? npcById.get(npcId) : undefined;
    return !npc || !resolveText(text, npc.nameTextMapHash ?? npc.nameHash);
  }).length;

  // "metadata-only" means no subquest row, CodexQuest dialogue source, or
  // explicit TalkExcelConfigData quest relation exists for this main quest.
  const metadataOnlyQuests = mainQuestRows.filter((row) => {
    const id = idKey(row.id ?? row.mainQuestId);
    return Boolean(
      id && !subquestMainIds.has(id) && !codexMainIds.has(id) && !talkQuestIds.has(id),
    );
  }).length;

  let dialogueEdges = 0;
  let danglingDialogueEdges = 0;
  const dialogueIds = new Set(
    dialogRows.flatMap((row) => {
      const id = idKey(row.GFLDJMJKIKE ?? row.id ?? row.dialogId);
      return id ? [id] : [];
    }),
  );
  for (const row of dialogRows) {
    const nextDialogs = Array.isArray(row.nextDialogs) ? row.nextDialogs : [];
    dialogueEdges += nextDialogs.length;
    danglingDialogueEdges += nextDialogs.filter(
      (target) => !dialogueIds.has(String(target)),
    ).length;
  }

  const readableFiles = await readableFileCount();
  const upstreamDate = await gitOutput(["show", "-s", "--format=%cI", upstreamCommit]);
  const upstreamVersion = await gitOutput(["show", "-s", "--format=%s", upstreamCommit]);

  const baseline = {
    schemaVersion: 1,
    description: "Raw Story/Text/Mechanism baseline from the pinned AnimeGameData snapshot.",
    generatedAt: new Date().toISOString(),
    upstreamSource: SOURCE,
    upstreamCommit,
    upstreamDate,
    upstreamVersion,
    locale: LOCALE,
    counts: {
      quests: mainQuestRows.length,
      subquests: questRows.length,
      dialogueNodes: dialogRows.length,
      dialogueEdges,
      books: bookRows.length,
      documents: documentRows.length,
      // AnimeGameData has raw Readable files but no explicit segment table.
      segments: 0,
      characterStories: fetterStoryRows.length,
      voiceLines: 0,
      items: materialRows.length,
      materials: materialRows.filter((row) => row.itemType === "ITEM_MATERIAL").length,
      achievements: 0,
      tutorials: 0,
      mechanisms: 0,
      unresolvedTitles,
      unresolvedSpeakers,
      metadataOnlyQuests,
    },
    sources: {
      quests: {
        files: [files.mainQuest],
        field: "row count; MainQuest.id is the quest key",
        rows: mainQuestRows.length,
      },
      subquests: {
        files: [files.quest],
        field: "row count; Quest.subId is the subquest key",
        rows: questRows.length,
      },
      dialogueNodes: {
        files: [files.dialog],
        field: "row count; Dialog.GFLDJMJKIKE is the dialogue node key",
        rows: dialogRows.length,
      },
      dialogueEdges: {
        files: [files.dialog],
        field:
          "sum of nextDialogs array lengths; declared source references, including dangling targets",
        declared: dialogueEdges,
        danglingTargets: danglingDialogueEdges,
      },
      books: {
        files: [files.books],
        field: "row count; BooksCodex catalog rows",
        rows: bookRows.length,
      },
      documents: {
        files: [files.documents],
        field: "row count; Document metadata rows",
        rows: documentRows.length,
      },
      segments: {
        files: [],
        field:
          "0: no explicit segment table in this snapshot; Readable/CHS/*.txt are raw unsegmented bodies",
        rawReadableFiles: readableFiles,
      },
      characterStories: {
        files: [files.fetterStory],
        field: "row count; (avatarId, fetterId) story rows",
        rows: fetterStoryRows.length,
      },
      voiceLines: {
        files: [...absentDomains.voiceLines],
        field: "0: source file absent in pinned snapshot",
      },
      items: {
        files: [files.material],
        field: "row count; MaterialExcelConfigData is the available item catalog source",
        rows: materialRows.length,
      },
      materials: {
        files: [files.material],
        field: "rows where itemType == ITEM_MATERIAL",
        rows: materialRows.filter((row) => row.itemType === "ITEM_MATERIAL").length,
      },
      achievements: {
        files: [...absentDomains.achievements],
        field: "0: achievement source files absent in pinned snapshot",
      },
      tutorials: {
        files: [],
        field: "0: no canonical tutorial/help source table identified in pinned snapshot",
      },
      mechanisms: {
        files: [],
        field: "0: no canonical mechanism/help source table identified in pinned snapshot",
      },
      unresolvedTitles: {
        files: [files.mainQuest, files.textMap, files.textMapMedium],
        field: "MainQuest.titleTextMapHash absent or blank in merged zh-CN TextMap",
        rows: unresolvedTitles,
      },
      unresolvedSpeakers: {
        files: [files.dialog, files.npc, files.textMap, files.textMapMedium],
        field:
          "Dialog.talkRoleNameTextMapHash unresolved, with exact NPC name fallback for TALK_ROLE_NPC",
        rows: unresolvedSpeakers,
      },
      metadataOnlyQuests: {
        files: [
          files.mainQuest,
          files.quest,
          files.talk0,
          files.talk1,
          ...codexFiles.map((name) => `BinOutput/CodexQuest/${name}`),
        ],
        field: "MainQuest rows with no Quest.mainId, CodexQuest main id, or Talk.questId relation",
        rows: metadataOnlyQuests,
      },
    },
    notes: [
      "Counts are raw upstream inventory counts, not converted/published coverage.",
      "Text resolution uses merged TextMapCHS.json and TextMap_MediumCHS.json for the zh-CN baseline locale.",
      "TalkExcelConfigData_0 and _1 are both read; dialogue node/edge counts come from the single DialogExcelConfigData table.",
      "Weapon, achievement, voice-line, tutorial/help, mechanism/help, and explicit segment tables are absent or not represented in this snapshot; those required domains remain 0.",
    ],
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  const formatted = await format(JSON.stringify(baseline, null, 2), { filepath: OUTPUT_PATH });
  await writeFile(OUTPUT_PATH, formatted, "utf8");
  console.log(`Wrote ${OUTPUT_PATH}`);
}

await main();
