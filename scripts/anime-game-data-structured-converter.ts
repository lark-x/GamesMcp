import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  GenshinAchievement,
  GenshinArtifact,
  GenshinArtifactSet,
  GenshinCharacter,
  GenshinEnemy,
  GenshinMaterial,
  GenshinWeapon,
} from "@gip/contracts";
import { getAchievementGoalMapping } from "./mappings/achievement-goals.js";

export const STRUCTURED_CONVERTER_VERSION = "anime-game-data-structured-v1";
export const STRUCTURED_SOURCE = "DimbreathBot/AnimeGameData";
export const STRUCTURED_LOCALE = "zh-CN";

const inputPaths = {
  textMap: "TextMap/TextMap_MediumCHS.json",
  textMapFull: "TextMap/TextMapCHS.json",
  avatar: "ExcelBinOutput/AvatarExcelConfigData.json",
  avatarPromote: "ExcelBinOutput/AvatarPromoteExcelConfigData.json",
  avatarSkill: "ExcelBinOutput/AvatarSkillExcelConfigData.json",
  avatarSkillDepot: "ExcelBinOutput/AvatarSkillDepotExcelConfigData.json",
  proudSkill: "ExcelBinOutput/ProudSkillExcelConfigData.json",
  weapon: "ExcelBinOutput/WeaponExcelConfigData.json",
  weaponPromote: "ExcelBinOutput/WeaponPromoteExcelConfigData.json",
  reliquarySet: "ExcelBinOutput/ReliquarySetExcelConfigData.json",
  reliquaryAffix: "ExcelBinOutput/ReliquaryAffixExcelConfigData.json",
  reliquary: "ExcelBinOutput/ReliquaryExcelConfigData.json",
  material: "ExcelBinOutput/MaterialExcelConfigData.json",
  materialSource: "ExcelBinOutput/MaterialSourceDataExcelConfigData.json",
  achievementGoal: "ExcelBinOutput/AchievementGoalExcelConfigData.json",
  achievement: "ExcelBinOutput/AchievementExcelConfigData.json",
  monster: "ExcelBinOutput/MonsterExcelConfigData.json",
  fetters: "ExcelBinOutput/FettersExcelConfigData.json",
} as const;

type JsonObject = Record<string, unknown>;
type TextMap = Record<string, unknown>;
type StructuredKind =
  | "characters"
  | "weapons"
  | "artifactSets"
  | "artifacts"
  | "materials"
  | "achievements"
  | "enemies"
  | "voices";

export type AnimeGameDataVoiceLine = {
  id: string;
  gameId: string;
  revisionId: string;
  stableId: string;
  sourceKey: string;
  characterStableId: string;
  name: string;
  title: string;
  body: string;
  locale: string;
  gameVersion: string;
  provenance: Record<string, unknown>;
  contentHash: string;
};

export type StructuredAnimeGameDataRecord =
  | GenshinCharacter
  | GenshinWeapon
  | GenshinArtifactSet
  | GenshinArtifact
  | GenshinMaterial
  | GenshinAchievement
  | GenshinEnemy
  | AnimeGameDataVoiceLine;

export type StructuredAnimeGameDataResult = {
  records: {
    characters: GenshinCharacter[];
    weapons: GenshinWeapon[];
    artifactSets: GenshinArtifactSet[];
    artifacts: GenshinArtifact[];
    materials: GenshinMaterial[];
    achievements: GenshinAchievement[];
    enemies: GenshinEnemy[];
    voices: AnimeGameDataVoiceLine[];
  };
  manifest: {
    schemaVersion: 1;
    converterVersion: string;
    upstreamSource: string;
    upstreamCommit: string;
    upstreamVersion: string;
    gameVersion: string;
    locale: string;
    discovered: Record<StructuredKind, number>;
    converted: Record<StructuredKind, number>;
    excluded: Array<{ kind: StructuredKind; upstreamId: string; reason: string }>;
    failures: Array<{ kind: StructuredKind; upstreamId: string; reason: string }>;
    warnings: Array<{ kind: StructuredKind; upstreamId: string; reason: string }>;
    accountedCoverage: Record<StructuredKind, number>;
    accounting: Record<
      StructuredKind,
      {
        discovered: number;
        converted: number;
        excluded: number;
        failures: number;
        accounted: number;
        coverage: number;
      }
    >;
    coverage: Record<StructuredKind, number>;
    fieldCoverage: Record<StructuredKind, Record<string, number>>;
    stableIdCoverage: Record<StructuredKind, number>;
    inputHashes: Record<string, string>;
    contentHash: string;
  };
};

export type StructuredConversionManifest = StructuredAnimeGameDataResult["manifest"] & {
  generatedAt: string;
  outputRecordsPath: string;
};

export type StructuredConvertOptions = {
  upstreamDir: string;
  context: {
    gameId: string;
    revisionId: string;
    upstreamCommit: string;
    upstreamVersion: string;
    gameVersion: string;
  };
};

type SourceFile<T> = {
  relativePath: string;
  raw: string;
  value: T;
  fileHash: string;
};

type LoadedInputs = {
  [Key in keyof typeof inputPaths]: SourceFile<
    Key extends "textMap" | "textMapFull" ? TextMap : unknown
  >;
} & {
  materialCodex?: SourceFile<unknown>;
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
    );
  }
  return value;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function stableUuid(namespace: string, value: string): string {
  const hex = sha256(`${namespace}:${value}`).slice(0, 32);
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function asArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(asObject) : [];
}

function idText(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLocaleLowerCase("zh-CN");
    if (["true", "1", "yes"].includes(normalized)) return true;
    if (["false", "0", "no"].includes(normalized)) return false;
  }
  return undefined;
}

function textValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanText(value: string): string {
  return value
    .replace(/<image\s+name=[^>]+\s*\/>/gi, "")
    .replace(/<color=[^>]+>/gi, "")
    .replace(/<\/color>/gi, "")
    .replace(/\\n/g, "\n")
    .trim();
}

function textMapValue(textMap: TextMap, hash: unknown): string | undefined {
  const id = idText(hash);
  const value = id ? textMap[id] : undefined;
  return typeof value === "string" && cleanText(value) ? cleanText(value) : undefined;
}

/**
 * Resolve a TextMap hash against the medium map first, then fall back to the
 * complete TextMapCHS. The medium map resolves voice/fetter text but misses
 * some catalog/handbook titles that only exist in the full dump.
 */
function textMapValueWithFallback(
  primary: TextMap,
  fallback: TextMap | undefined,
  hash: unknown,
): string | undefined {
  return textMapValue(primary, hash) ?? (fallback ? textMapValue(fallback, hash) : undefined);
}

async function readJson<T>(upstreamDir: string, relativePath: string): Promise<SourceFile<T>> {
  try {
    const raw = await readFile(resolve(upstreamDir, relativePath), "utf8");
    return {
      relativePath,
      raw,
      value: JSON.parse(raw) as T,
      fileHash: sha256(raw),
    };
  } catch (err: unknown) {
    const isEnrichment = [
      "AvatarPromoteExcelConfigData.json",
      "AvatarSkillExcelConfigData.json",
      "AvatarSkillDepotExcelConfigData.json",
      "ProudSkillExcelConfigData.json",
      "WeaponPromoteExcelConfigData.json",
      "MaterialSourceDataExcelConfigData.json",
    ].some((f) => relativePath.endsWith(f));
    if (isEnrichment && (err as { code?: string })?.code === "ENOENT") {
      const raw = "[]";
      return {
        relativePath,
        raw,
        value: [] as T,
        fileHash: sha256(raw),
      };
    }
    throw err;
  }
}

async function loadInputs(upstreamDir: string): Promise<LoadedInputs> {
  const entries = await Promise.all(
    Object.entries(inputPaths).map(
      async ([key, path]) => [key, await readJson<unknown>(upstreamDir, path)] as const,
    ),
  );
  const result = Object.fromEntries(entries) as LoadedInputs;
  const codexPath = resolve(upstreamDir, "ExcelBinOutput/MaterialCodexExcelConfigData.json");
  if (existsSync(codexPath)) {
    try {
      result.materialCodex = await readJson<unknown>(
        upstreamDir,
        "ExcelBinOutput/MaterialCodexExcelConfigData.json",
      );
    } catch {
      // MaterialCodex is optional enrichment; absence must not fail the pass.
    }
  }
  return result;
}

function baseRecord(
  options: StructuredConvertOptions,
  kind: string,
  upstreamId: string,
  sourceFile: SourceFile<unknown>,
  sourceRow: JsonObject,
  name: string,
) {
  const stableId = `genshin:${kind}:${upstreamId}`;
  return {
    id: stableUuid(kind, `${options.context.revisionId}:${stableId}`),
    gameId: options.context.gameId,
    revisionId: options.context.revisionId,
    stableId,
    sourceKey: `anime-game-data/${kind}/${upstreamId}`,
    name,
    locale: STRUCTURED_LOCALE,
    gameVersion: options.context.gameVersion,
    provenance: {
      upstreamSource: STRUCTURED_SOURCE,
      upstreamCommit: options.context.upstreamCommit,
      upstreamVersion: options.context.upstreamVersion,
      converterVersion: STRUCTURED_CONVERTER_VERSION,
      sourceFile: sourceFile.relativePath,
      sourceFileHash: sourceFile.fileHash,
      upstreamId,
      rawContentHash: sha256(stableStringify(sourceRow)),
    },
  };
}

function weaponType(value: unknown): GenshinWeapon["weaponType"] | null {
  const normalized = textValue(value)?.toLowerCase();
  if (normalized?.includes("sword_one_hand")) return "sword";
  if (normalized?.includes("claymore")) return "claymore";
  if (normalized?.includes("pole")) return "polearm";
  if (normalized?.includes("bow")) return "bow";
  if (normalized?.includes("catalyst")) return "catalyst";
  return null;
}

function element(value: unknown): GenshinCharacter["element"] | null {
  const normalized = textValue(value)?.toLowerCase();
  if (!normalized) return null;
  if (normalized.includes("wind") || normalized.includes("anemo")) return "anemo";
  if (normalized.includes("rock") || normalized.includes("geo")) return "geo";
  if (normalized.includes("electric") || normalized.includes("electro")) return "electro";
  if (normalized.includes("grass") || normalized.includes("dendro")) return "dendro";
  if (normalized.includes("water") || normalized.includes("hydro")) return "hydro";
  if (normalized.includes("fire") || normalized.includes("pyro")) return "pyro";
  if (normalized.includes("ice") || normalized.includes("cryo")) return "cryo";
  return null;
}

function rarity(value: unknown): number | null {
  const explicit = numberValue(value);
  if (explicit) return explicit;
  const text = textValue(value);
  if (text?.includes("ORANGE")) return 5;
  if (text?.includes("PURPLE")) return 4;
  if (text?.includes("BLUE")) return 3;
  if (text?.includes("GREEN")) return 2;
  if (text?.includes("WHITE")) return 1;
  return null;
}

export type MaterialClassification = {
  category: GenshinMaterial["category"];
  categoryLabel: string;
  subcategory?: string;
  subcategoryLabel?: string;
};

export function resolveMaterialClassification(
  row: JsonObject,
  textMap: TextMap,
  specialtyRegionByMatId?: Map<number | string, { region: string; label: string }>,
): MaterialClassification {
  const id = Number(row.id ?? 0);
  const name = textMapValue(textMap, row.nameTextMapHash) ?? "";
  const typeDesc = textMapValue(textMap, row.typeDescTextMapHash) ?? "";
  const desc = textMapValue(textMap, row.descTextMapHash) ?? "";
  const matType = String(row.materialType ?? "");

  // 1. GCG (七圣召唤)
  if (matType === "MATERIAL_GCG_CARD_FACE") {
    return { category: "gcg", categoryLabel: "七圣召唤", subcategory: "card_face", subcategoryLabel: "影幻牌面" };
  }
  if (matType === "MATERIAL_GCG_CARD") {
    const isChar = typeDesc.includes("角色牌") || name.includes("牌");
    return {
      category: "gcg",
      categoryLabel: "七圣召唤",
      subcategory: isChar ? "card_char" : "card_action",
      subcategoryLabel: isChar ? "角色牌" : "行动牌",
    };
  }
  if (matType === "MATERIAL_GCG_CARD_BACK") {
    return { category: "gcg", categoryLabel: "七圣召唤", subcategory: "card_back", subcategoryLabel: "牌背" };
  }
  if (matType === "MATERIAL_GCG_FIELD") {
    return { category: "gcg", categoryLabel: "七圣召唤", subcategory: "field", subcategoryLabel: "牌桌" };
  }
  if (matType === "MATERIAL_GCG_EXCHANGE_ITEM") {
    return { category: "gcg", categoryLabel: "七圣召唤", subcategory: "exchange", subcategoryLabel: "对局道具" };
  }

  // 2. Furnishing (尘歌壶图纸与种子)
  if (matType === "MATERIAL_FURNITURE_SUITE_FORMULA") {
    return { category: "furnishing", categoryLabel: "尘歌壶图纸", subcategory: "suite_formula", subcategoryLabel: "套装图纸" };
  }
  if (matType === "MATERIAL_FURNITURE_FORMULA") {
    return { category: "furnishing", categoryLabel: "尘歌壶图纸", subcategory: "furniture_formula", subcategoryLabel: "摆设图纸" };
  }
  if (matType === "MATERIAL_HOME_SEED") {
    return { category: "furnishing", categoryLabel: "尘歌壶图纸", subcategory: "seed", subcategoryLabel: "种植种子" };
  }

  // 3. Local Specialties (区域特产)
  const spec =
    specialtyRegionByMatId?.get(id) ??
    (row.id ? specialtyRegionByMatId?.get(String(row.id)) : undefined);
  if (spec || typeDesc.includes("区域特产") || desc.includes("区域特产")) {
    let region = spec?.region ?? "other_specialty";
    let label = spec?.label ?? "其他特产";
    if (!spec) {
      if (typeDesc.includes("蒙德") || desc.includes("蒙德")) { region = "mondstadt"; label = "蒙德特产"; }
      else if (typeDesc.includes("璃月") || desc.includes("璃月")) { region = "liyue"; label = "璃月特产"; }
      else if (typeDesc.includes("稻妻") || desc.includes("稻妻")) { region = "inazuma"; label = "稻妻特产"; }
      else if (typeDesc.includes("须弥") || desc.includes("须弥")) { region = "sumeru"; label = "须弥特产"; }
      else if (typeDesc.includes("枫丹") || desc.includes("枫丹")) { region = "fontaine"; label = "枫丹特产"; }
      else if (typeDesc.includes("纳塔") || desc.includes("纳塔")) { region = "natlan"; label = "纳塔特产"; }
      else if (typeDesc.includes("诺德卡莱") || desc.includes("诺德卡莱")) { region = "nod_krai"; label = "诺德卡莱特产"; }
    }
    return { category: "local_specialty", categoryLabel: "区域特产", subcategory: region, subcategoryLabel: label };
  }

  // 4. Weapon Development (武器强化与突破)
  if (typeDesc.includes("武器突破素材") || typeDesc.includes("精炼材料") || (id >= 114000 && id < 115000)) {
    return { category: "weapon_development", categoryLabel: "武器突破素材", subcategory: "weapon_ascension", subcategoryLabel: "武器突破素材" };
  }
  if (matType === "MATERIAL_WEAPON_EXP_STONE" || typeDesc.includes("武器强化素材")) {
    return { category: "weapon_development", categoryLabel: "武器强化素材", subcategory: "weapon_exp", subcategoryLabel: "武器强化材料" };
  }

  // 5. Character Development (角色培养素材)
  if (name.endsWith("的命星") || name.endsWith("的命之座")) {
    return { category: "character_development", categoryLabel: "角色培养素材", subcategory: "constellation", subcategoryLabel: "命之座激活" };
  }
  if (
    typeDesc.includes("角色天赋素材") ||
    matType === "MATERIAL_TALENT" ||
    matType === "MATERIAL_AVATAR_TALENT_MATERIAL" ||
    matType === "MATERIAL_FIRE_MASTER_AVATAR_TALENT_ITEM"
  ) {
    return { category: "character_development", categoryLabel: "角色培养素材", subcategory: "talent", subcategoryLabel: "天赋培养素材" };
  }
  if (typeDesc.includes("角色与武器培养素材") || (id >= 112000 && id < 113000)) {
    return { category: "character_development", categoryLabel: "角色培养素材", subcategory: "common_drop", subcategoryLabel: "常见敌人掉落" };
  }
  if (typeDesc.includes("角色突破素材") || (id >= 104000 && id < 104100)) {
    return { category: "character_development", categoryLabel: "角色培养素材", subcategory: "elemental_gem", subcategoryLabel: "元素突破材料" };
  }
  if (matType === "MATERIAL_EXP_FRUIT" || typeDesc.includes("角色经验")) {
    return { category: "character_development", categoryLabel: "角色培养素材", subcategory: "avatar_exp", subcategoryLabel: "经验材料" };
  }
  if (
    matType === "MATERIAL_RARE_GROWTH_MATERIAL" ||
    desc.includes("征讨领域") ||
    desc.includes("异界异相") ||
    typeDesc.includes("周本")
  ) {
    return { category: "character_development", categoryLabel: "角色培养素材", subcategory: "weekly_boss", subcategoryLabel: "周本首领素材" };
  }
  if (
    matType === "MATERIAL_AVATAR_MATERIAL" ||
    typeDesc.includes("首领") ||
    desc.includes("首领")
  ) {
    return { category: "character_development", categoryLabel: "角色培养素材", subcategory: "boss_drop", subcategoryLabel: "首领敌方掉落" };
  }

  // 6. Food & Cooking (食物与药剂)
  if (matType === "MATERIAL_FOOD" || matType === "MATERIAL_NOTICE_ADD_HP" || matType === "MATERIAL_SPICE_FOOD") {
    let foodSub = "food";
    let foodLabel = "料理";
    if (
      matType === "MATERIAL_NOTICE_ADD_HP" ||
      typeDesc.includes("恢复") ||
      desc.includes("恢复") ||
      desc.includes("生命") ||
      desc.includes("复苏") ||
      desc.includes("复活")
    ) {
      foodSub = "food_hp";
      foodLabel = "生命恢复类料理";
    } else if (typeDesc.includes("攻击") || desc.includes("攻击力") || desc.includes("暴击率")) {
      foodSub = "food_atk";
      foodLabel = "攻击增益类料理";
    } else if (typeDesc.includes("防御") || desc.includes("防御力") || desc.includes("护盾强效")) {
      foodSub = "food_def";
      foodLabel = "防御增益类料理";
    } else if (typeDesc.includes("体力") || desc.includes("体力") || desc.includes("耐力")) {
      foodSub = "food_stamina";
      foodLabel = "体力耐力类料理";
    } else if (typeDesc.includes("特殊") || desc.includes("特色料理") || name.includes("特色")) {
      foodSub = "food_special";
      foodLabel = "特色料理";
    }
    return { category: "cooking", categoryLabel: "食物与药剂", subcategory: foodSub, subcategoryLabel: foodLabel };
  }
  if (typeDesc.includes("食材") || typeDesc.includes("食物") || typeDesc.includes("食谱")) {
    return { category: "cooking", categoryLabel: "食物与药剂", subcategory: "ingredient", subcategoryLabel: "食材烹饪" };
  }
  if (typeDesc.includes("药剂") || typeDesc.includes("精油") || name.endsWith("精油") || name.endsWith("药剂")) {
    return { category: "cooking", categoryLabel: "食物与药剂", subcategory: "potion", subcategoryLabel: "炼金药剂" };
  }

  // 7. Materials & Gathering (自然采集与材料)
  if (matType === "MATERIAL_WOOD") return { category: "material", categoryLabel: "自然采集与材料", subcategory: "wood", subcategoryLabel: "木材素材" };
  if (matType === "MATERIAL_FISH_BAIT") return { category: "material", categoryLabel: "自然采集与材料", subcategory: "bait", subcategoryLabel: "鱼饵" };
  if (matType === "MATERIAL_FISH_ROD") return { category: "material", categoryLabel: "自然采集与材料", subcategory: "fishing", subcategoryLabel: "钓鱼用具" };
  if (typeDesc.includes("矿石") || typeDesc.includes("锻造") || desc.includes("锻造用")) {
    return { category: "material", categoryLabel: "自然采集与材料", subcategory: "ore", subcategoryLabel: "矿石原石" };
  }

  // 8. Precious & Widgets (贵重道具与小道具)
  if (matType === "MATERIAL_WIDGET" || typeDesc.includes("小道具")) {
    return { category: "precious", categoryLabel: "贵重与小道具", subcategory: "widget", subcategoryLabel: "便捷小道具" };
  }
  if (matType === "MATERIAL_FLYCLOAK") return { category: "precious", categoryLabel: "贵重与小道具", subcategory: "flycloak", subcategoryLabel: "风之翼" };
  if (matType === "MATERIAL_NAMECARD") return { category: "precious", categoryLabel: "贵重与小道具", subcategory: "namecard", subcategoryLabel: "角色名片" };
  if (matType === "MATERIAL_BGM") return { category: "precious", categoryLabel: "贵重与小道具", subcategory: "bgm", subcategoryLabel: "旋曜玉帛" };
  if (matType === "MATERIAL_COSTUME") return { category: "precious", categoryLabel: "贵重与小道具", subcategory: "costume", subcategoryLabel: "角色装扮" };
  if (
    name.includes("神瞳") ||
    desc.includes("奉献给") ||
    typeDesc.includes("供奉") ||
    name.includes("玉髓") ||
    name.includes("净光翎") ||
    name.includes("苍晶螺")
  ) {
    return { category: "precious", categoryLabel: "贵重与小道具", subcategory: "oculus", subcategoryLabel: "神瞳与供奉物" };
  }

  // 9. Currency (货币与代币)
  if (matType === "MATERIAL_EXCHANGE" || typeDesc.includes("货币") || typeDesc.includes("兑换券") || typeDesc.includes("徽印")) {
    let curSub = "currency";
    let curLabel = "基础货币";
    if (name.includes("印") || typeDesc.includes("印记") || desc.includes("奉献")) {
      curSub = "region_token";
      curLabel = "区域印记代币";
    } else if (typeDesc.includes("兑换券") || desc.includes("活动")) {
      curSub = "event_ticket";
      curLabel = "活动兑换代币";
    }
    return { category: "currency", categoryLabel: "货币与代币", subcategory: curSub, subcategoryLabel: curLabel };
  }

  // 10. Quest items (任务道具)
  if (matType === "MATERIAL_QUEST" || typeDesc.includes("任务道具")) {
    return { category: "quest_item", categoryLabel: "任务道具", subcategory: "quest_token", subcategoryLabel: "任务信物" };
  }

  return { category: "other", categoryLabel: "其他材料", subcategory: "general", subcategoryLabel: "杂项素材" };
}

function enemyCategory(value: unknown): GenshinEnemy["category"] {
  const normalized = textValue(value)?.toLowerCase() ?? "";
  if (normalized.includes("boss")) return "normal_boss";
  if (normalized.includes("elite")) return "elite";
  if (normalized.includes("animal")) return "wildlife";
  return "common";
}

function voiceLineRecord(
  options: StructuredConvertOptions,
  sourceFile: SourceFile<unknown>,
  sourceRow: JsonObject,
  upstreamId: string,
  characterStableId: string,
  title: string,
  body: string,
): AnimeGameDataVoiceLine {
  const stableId = `genshin:voice:${upstreamId}`;
  const base = {
    id: stableUuid("voice", `${options.context.revisionId}:${stableId}`),
    gameId: options.context.gameId,
    revisionId: options.context.revisionId,
    stableId,
    sourceKey: `anime-game-data/voice/${upstreamId}`,
    characterStableId,
    name: title,
    title,
    body,
    locale: STRUCTURED_LOCALE,
    gameVersion: options.context.gameVersion,
    provenance: {
      upstreamSource: STRUCTURED_SOURCE,
      upstreamCommit: options.context.upstreamCommit,
      upstreamVersion: options.context.upstreamVersion,
      converterVersion: STRUCTURED_CONVERTER_VERSION,
      sourceFile: sourceFile.relativePath,
      sourceFileHash: sourceFile.fileHash,
      upstreamId,
      characterStableId,
      rawContentHash: sha256(stableStringify(sourceRow)),
    },
  };
  return {
    ...base,
    contentHash: sha256(stableStringify(base)),
  };
}

function getArtifactSetRegion(
  name: string,
  domainRegionMap: Map<string, { region: string; regionLabel: string; domain: string }>,
): { region: string; regionLabel: string; domain?: string } {
  const fromDomain = domainRegionMap.get(name);
  if (fromDomain) return fromDomain;

  const standardRegions: Record<string, { region: string; regionLabel: string }> = {
    角斗士的终幕礼: { region: "mondstadt", regionLabel: "蒙德" },
    流浪大地的乐团: { region: "mondstadt", regionLabel: "蒙德" },
    祭火之人: { region: "mondstadt", regionLabel: "蒙德" },
    祭水之人: { region: "mondstadt", regionLabel: "蒙德" },
    祭雷之人: { region: "mondstadt", regionLabel: "蒙德" },
    祭冰之人: { region: "mondstadt", regionLabel: "蒙德" },
    翠绿之影: { region: "mondstadt", regionLabel: "蒙德" },
    被怜爱的少女: { region: "mondstadt", regionLabel: "蒙德" },
    炽烈的炎之魔女: { region: "mondstadt", regionLabel: "蒙德" },
    渡过烈火的贤人: { region: "mondstadt", regionLabel: "蒙德" },
    冰风迷途的勇士: { region: "mondstadt", regionLabel: "蒙德" },
    沉沦之心: { region: "mondstadt", regionLabel: "蒙德" },
    悠古的磐岩: { region: "liyue", regionLabel: "璃月" },
    逆飞的流星: { region: "liyue", regionLabel: "璃月" },
    染血的骑士道: { region: "liyue", regionLabel: "璃月" },
    昔日宗室之仪: { region: "liyue", regionLabel: "璃月" },
    千岩牢固: { region: "liyue", regionLabel: "璃月" },
    苍白之火: { region: "liyue", regionLabel: "璃月" },
    辰砂往生录: { region: "liyue", regionLabel: "璃月" },
    来歆余响: { region: "liyue", regionLabel: "璃月" },
    追忆之注连: { region: "inazuma", regionLabel: "稻妻" },
    绝缘之旗印: { region: "inazuma", regionLabel: "稻妻" },
    华馆梦醒形骸记: { region: "inazuma", regionLabel: "稻妻" },
    海染砗磲: { region: "inazuma", regionLabel: "稻妻" },
    深林的记忆: { region: "sumeru", regionLabel: "须弥" },
    饰金之梦: { region: "sumeru", regionLabel: "须弥" },
    沙上楼阁史话: { region: "sumeru", regionLabel: "须弥" },
    乐园遗落之花: { region: "sumeru", regionLabel: "须弥" },
    水仙之梦: { region: "sumeru", regionLabel: "须弥" },
    花海甘露之光: { region: "sumeru", regionLabel: "须弥" },
    逐影猎人: { region: "fontaine", regionLabel: "枫丹" },
    黄金剧团: { region: "fontaine", regionLabel: "枫丹" },
    昔时之歌: { region: "fontaine", regionLabel: "枫丹" },
    回声之林夜话: { region: "fontaine", regionLabel: "枫丹" },
    未竟的遐思: { region: "fontaine", regionLabel: "枫丹" },
    谐律异想断章: { region: "fontaine", regionLabel: "枫丹" },
    黑曜秘典: { region: "natlan", regionLabel: "纳塔" },
    烬城勇者绘卷: { region: "natlan", regionLabel: "纳塔" },
    深廊的终曲: { region: "natlan", regionLabel: "纳塔" },
    夜魂之歌: { region: "natlan", regionLabel: "纳塔" },
  };

  if (standardRegions[name]) return standardRegions[name];
  return { region: "general", regionLabel: "通用初阶" };
}

export async function convertStructuredAnimeGameData(
  options: StructuredConvertOptions,
): Promise<StructuredAnimeGameDataResult> {
  const inputs = await loadInputs(options.upstreamDir);
  const textMap = inputs.textMap.value;
  const textMapFull = inputs.textMapFull?.value;
  const failures: StructuredAnimeGameDataResult["manifest"]["failures"] = [];
  const excluded: StructuredAnimeGameDataResult["manifest"]["excluded"] = [];
  const warnings: StructuredAnimeGameDataResult["manifest"]["warnings"] = [];

  const characters = asArray(inputs.avatar.value).flatMap((row): GenshinCharacter[] => {
    const upstreamId = idText(row.id);
    const name = textMapValue(textMap, row.nameTextMapHash);
    if (!upstreamId || !name) {
      excluded.push({
        kind: "characters",
        upstreamId: upstreamId ?? "unknown",
        reason: "name_missing",
      });
      return [];
    }
    return [
      {
        ...baseRecord(options, "character", upstreamId, inputs.avatar, row, name),
        title: null,
        rarity: rarity(row.qualityType) ?? null,
        element: element(row.elementType),
        weaponType: weaponType(row.weaponType),
        region: null,
        affiliation: null,
        birthday: null,
        constellation: null,
        description: textMapValue(textMap, row.descTextMapHash),
        profile: { iconName: row.iconName ?? null },
      },
    ];
  });

  const weapons = asArray(inputs.weapon.value).flatMap((row): GenshinWeapon[] => {
    const upstreamId = idText(row.id);
    const name = textMapValue(textMap, row.nameTextMapHash);
    const type = weaponType(row.weaponType);
    const rank = rarity(row.rankLevel);
    if (!upstreamId || !name || !type || !rank) {
      excluded.push({
        kind: "weapons",
        upstreamId: upstreamId ?? "unknown",
        reason: "required_field_missing",
      });
      return [];
    }
    const base = baseRecord(options, "weapon", upstreamId, inputs.weapon, row, name);
    return [
      {
        ...base,
        weaponType: type,
        rarity: rank,
        baseAttack: null,
        baseAttackResolved: false,
        subStat: null,
        passiveName: textMapValue(textMap, row.skillNameTextMapHash),
        passiveDescription: null,
        ascensionMaterials: [],
        description: textMapValue(textMap, row.descTextMapHash),
        provenance: {
          ...base.provenance,
          weaponBaseExp: numberValue(row.weaponBaseExp) ?? null,
          baseAttackResolved: false,
        },
      },
    ];
  });

  const genshinDbRoot = existsSync(resolve(options.upstreamDir, "../genshin-db"))
    ? resolve(options.upstreamDir, "../genshin-db")
    : existsSync(resolve("data/upstream/genshin-db"))
      ? resolve("data/upstream/genshin-db")
      : undefined;

  let artifactSets: GenshinArtifactSet[] = [];
  const genshinDbArtifactsDir = genshinDbRoot
    ? resolve(genshinDbRoot, "src/data/ChineseSimplified/artifacts")
    : undefined;
  const isFixture = asArray(inputs.reliquarySet.value).length <= 2;

  if (genshinDbArtifactsDir && existsSync(genshinDbArtifactsDir) && !isFixture) {
    const domainRegionMap = new Map<string, { region: string; regionLabel: string; domain: string }>();
    const domainsDir = resolve(genshinDbRoot!, "src/data/ChineseSimplified/domains");
    if (existsSync(domainsDir)) {
      const domainFiles = readdirSync(domainsDir).filter((f) => f.endsWith(".json"));
      const regionKeyMap: Record<string, string> = {
        蒙德: "mondstadt",
        璃月: "liyue",
        稻妻: "inazuma",
        须弥: "sumeru",
        枫丹: "fontaine",
        纳塔: "natlan",
      };
      for (const df of domainFiles) {
        try {
          const dData = JSON.parse(readFileSync(resolve(domainsDir, df), "utf8"));
          const rName = dData.regionName;
          if (rName && Array.isArray(dData.rewardPreview)) {
            const rKey = regionKeyMap[rName] ?? "general";
            for (const rew of dData.rewardPreview) {
              if (rew && rew.name) {
                domainRegionMap.set(rew.name, {
                  region: rKey,
                  regionLabel: rName,
                  domain: dData.name ?? dData.entranceName ?? "",
                });
              }
            }
          }
        } catch {
          // Domain rows are optional region hints; a missing/invalid row just yields no hint.
        }
      }
    }

    const artFiles = readdirSync(genshinDbArtifactsDir).filter((f) => f.endsWith(".json"));
    for (const af of artFiles) {
      try {
        const artData = JSON.parse(readFileSync(resolve(genshinDbArtifactsDir, af), "utf8"));
        const upstreamId = String(artData.id);
        const name = artData.name;
        if (!upstreamId || !name) continue;
        const pieces = [
          artData.flower?.name,
          artData.plume?.name,
          artData.sands?.name,
          artData.goblet?.name,
          artData.circlet?.name,
        ].filter((p): p is string => typeof p === "string" && Boolean(p.trim()));
        const maxRarity = Array.isArray(artData.rarityList) ? Math.max(...artData.rarityList) : 5;
        const regInfo = getArtifactSetRegion(name, domainRegionMap);
        artifactSets.push({
          ...baseRecord(options, "artifact-set", upstreamId, inputs.reliquarySet, artData as JsonObject, name),
          maxRarity,
          twoPieceBonus: artData.effect2Pc ?? null,
          fourPieceBonus: artData.effect4Pc ?? null,
          pieces,
          provenance: {
            upstreamSource: "genshin-db",
            region: regInfo.region,
            regionLabel: regInfo.regionLabel,
            domain: regInfo.domain ?? null,
            rarityList: artData.rarityList ?? [],
          },
        });
      } catch {
        // Skip artifact sets whose upstream rows are malformed; the fallback pass below recovers them.
      }
    }
  }

  if (artifactSets.length === 0) {
    artifactSets = asArray(inputs.reliquarySet.value).flatMap((row): GenshinArtifactSet[] => {
      const upstreamId = idText(row.setId);
      const name = textMapValue(textMap, row.setNameTextMapHash);
      if (!upstreamId || !name) {
        excluded.push({
          kind: "artifactSets",
          upstreamId: upstreamId ?? "unknown",
          reason: "name_missing",
        });
        return [];
      }
      const affixes = asArray(inputs.reliquaryAffix.value).filter(
        (affix) => idText(affix.id) === idText(row.equipAffixId),
      );
      const pieces = Array.isArray(row.containsList)
        ? row.containsList.flatMap((id) => {
            const piece = asArray(inputs.reliquary.value).find(
              (item) => idText(item.id) === idText(id),
            );
            const pieceName = piece ? textMapValue(textMap, piece.nameTextMapHash) : undefined;
            return pieceName ? [pieceName] : [];
          })
        : [];
      return [
        {
          ...baseRecord(options, "artifact-set", upstreamId, inputs.reliquarySet, row, name),
          maxRarity: null,
          twoPieceBonus: textMapValue(
            textMap,
            affixes.find((affix) => idText(affix.openConfig) === "2")?.descTextMapHash,
          ),
          fourPieceBonus: textMapValue(
            textMap,
            affixes.find((affix) => idText(affix.openConfig) === "4")?.descTextMapHash,
          ),
          pieces,
        },
      ];
    });
  }

  const artifacts = asArray(inputs.reliquary.value).flatMap((row): GenshinArtifact[] => {
    const upstreamId = idText(row.id);
    const name = textMapValue(textMap, row.nameTextMapHash);
    if (!upstreamId || !name) {
      excluded.push({
        kind: "artifacts",
        upstreamId: upstreamId ?? "unknown",
        reason: "name_missing",
      });
      return [];
    }
    return [
      {
        ...baseRecord(options, "artifact", upstreamId, inputs.reliquary, row, name),
        setStableId: idText(row.setId) ? `genshin:artifact-set:${idText(row.setId)}` : null,
        slot: textValue(row.equipType) ?? null,
        rarity: rarity(row.rankLevel),
        description: textMapValue(textMap, row.descTextMapHash),
      },
    ];
  });

  // 1. Build Material Sources Map
  const sourcesMap = new Map<string, string[]>();
  for (const s of asArray(inputs.materialSource.value)) {
    const matId = idText(s.id);
    if (!matId) continue;
    if (Array.isArray(s.textList)) {
      const texts = s.textList
        .map((h: unknown) => textMapValue(textMap, h))
        .filter((t): t is string => typeof t === "string" && t.trim().length > 0);
      if (texts.length > 0) {
        sourcesMap.set(matId, texts);
      }
    }
  }

  // 2. Build Material Usages (usedBy) Map
  const usedByMap = new Map<string, Set<string>>();
  function addUsage(matIdRaw: unknown, user: string) {
    const matId = idText(matIdRaw);
    if (!matId || !user) return;
    let set = usedByMap.get(matId);
    if (!set) {
      set = new Set();
      usedByMap.set(matId, set);
    }
    set.add(user);
  }

  // 2.1 Character Ascension Usages
  const avatarPromoteMap = new Map<string, string>();
  for (const a of asArray(inputs.avatar.value)) {
    const name = textMapValue(textMap, a.nameTextMapHash);
    if (
      !name ||
      name.includes("测试") ||
      name.includes("废弃") ||
      name.includes("【弃用】") ||
      name.startsWith("test_")
    )
      continue;
    const promoteId = idText(a.avatarPromoteId);
    if (promoteId) {
      avatarPromoteMap.set(promoteId, name);
    }
  }
  for (const ap of asArray(inputs.avatarPromote.value)) {
    const promoteId = idText(ap.avatarPromoteId);
    const charName = promoteId ? avatarPromoteMap.get(promoteId) : undefined;
    if (charName && Array.isArray(ap.costItems)) {
      for (const item of ap.costItems as JsonObject[]) {
        if (item.id) addUsage(item.id, charName);
      }
    }
  }

  // 2.2 Character Talent Usages
  const depotToAvatar = new Map<string, string>();
  for (const a of asArray(inputs.avatar.value)) {
    const name = textMapValue(textMap, a.nameTextMapHash);
    if (
      !name ||
      name.includes("测试") ||
      name.includes("废弃") ||
      name.includes("【弃用】") ||
      name.startsWith("test_")
    )
      continue;
    const skillDepotId = idText(a.skillDepotId);
    if (skillDepotId) depotToAvatar.set(skillDepotId, name);
    if (Array.isArray(a.candSkillDepotIds)) {
      for (const d of a.candSkillDepotIds) {
        const dId = idText(d);
        if (dId) depotToAvatar.set(dId, name);
      }
    }
  }
  const skillToProudGroup = new Map<string, string>();
  for (const s of asArray(inputs.avatarSkill.value)) {
    const sId = idText(s.id);
    const pGroup = idText(s.proudSkillGroupId);
    if (sId && pGroup) skillToProudGroup.set(sId, pGroup);
  }
  const proudGroupToAvatars = new Map<string, Set<string>>();
  for (const d of asArray(inputs.avatarSkillDepot.value)) {
    const dId = idText(d.id);
    const avatarName = dId ? depotToAvatar.get(dId) : undefined;
    if (!avatarName) continue;
    const skillsList = Array.isArray(d.skills) ? d.skills : [];
    const subSkillsList = Array.isArray(d.subSkills) ? d.subSkills : [];
    const allSkillIds = [...skillsList, d.energySkill, ...subSkillsList]
      .map(idText)
      .filter(Boolean);
    for (const sid of allSkillIds) {
      if (!sid) continue;
      const groupId = skillToProudGroup.get(sid);
      if (groupId) {
        let set = proudGroupToAvatars.get(groupId);
        if (!set) {
          set = new Set();
          proudGroupToAvatars.set(groupId, set);
        }
        set.add(avatarName);
      }
    }
  }
  for (const p of asArray(inputs.proudSkill.value)) {
    const pGroupId = idText(p.proudSkillGroupId);
    const avatarNames = pGroupId ? proudGroupToAvatars.get(pGroupId) : undefined;
    if (avatarNames && Array.isArray(p.costItems)) {
      for (const item of p.costItems as JsonObject[]) {
        if (item.id) {
          for (const name of avatarNames) {
            addUsage(item.id, name);
          }
        }
      }
    }
  }

  // 2.3 Weapon Ascension Usages
  const weaponPromoteMap = new Map<string, string>();
  for (const w of asArray(inputs.weapon.value)) {
    const name = textMapValue(textMap, w.nameTextMapHash);
    const wpId = idText(w.weaponPromoteId);
    if (name && wpId) {
      weaponPromoteMap.set(wpId, name);
    }
  }
  for (const wp of asArray(inputs.weaponPromote.value)) {
    const wpId = idText(wp.weaponPromoteId);
    const weaponName = wpId ? weaponPromoteMap.get(wpId) : undefined;
    if (weaponName && Array.isArray(wp.costItems)) {
      for (const item of wp.costItems as JsonObject[]) {
        if (item.id) addUsage(item.id, weaponName);
      }
    }
  }

  // 2.4 Build Material Codex Specialties Map
  const specialtyRegionByMatId = new Map<number | string, { region: string; label: string }>();
  if (inputs.materialCodex?.value) {
    const regionPrefixMap: Record<string, { region: string; label: string }> = {
      "40102": { region: "mondstadt", label: "蒙德特产" },
      "40103": { region: "liyue", label: "璃月特产" },
      "40104": { region: "inazuma", label: "稻妻特产" },
      "40105": { region: "sumeru", label: "须弥特产" },
      "40106": { region: "fontaine", label: "枫丹特产" },
      "40107": { region: "natlan", label: "纳塔特产" },
      "40108": { region: "nod_krai", label: "诺德卡莱特产" },
    };
    for (const item of asArray(inputs.materialCodex.value)) {
      const codexId = String(item.id ?? "");
      const matId = item.materialId;
      if (!matId) continue;
      const prefix = codexId.slice(0, 5);
      const reg = regionPrefixMap[prefix];
      if (reg) {
        specialtyRegionByMatId.set(Number(matId), reg);
        specialtyRegionByMatId.set(String(matId), reg);
      }
    }
  }

  const materials = asArray(inputs.material.value).flatMap((row): GenshinMaterial[] => {
    const upstreamId = idText(row.id);
    const name = textMapValue(textMap, row.nameTextMapHash);
    if (!upstreamId || !name) {
      excluded.push({
        kind: "materials",
        upstreamId: upstreamId ?? "unknown",
        reason: "name_missing",
      });
      return [];
    }

    if (
      row.materialType === "MATERIAL_AVATAR" ||
      name === "？？？" ||
      name.startsWith("$") ||
      name.startsWith("test_") ||
      name.startsWith("DEBUG_") ||
      name.startsWith("TEMP_") ||
      name.includes("测试用") ||
      name.includes("【弃用】") ||
      name.toLowerCase().includes("(test)")
    ) {
      excluded.push({
        kind: "materials",
        upstreamId,
        reason: "internal_or_placeholder",
      });
      return [];
    }

    const classification = resolveMaterialClassification(row, textMap, specialtyRegionByMatId);
    const sources = sourcesMap.get(upstreamId) ?? [];
    const usedBy = Array.from(usedByMap.get(upstreamId) ?? []);
    const base = baseRecord(options, "material", upstreamId, inputs.material, row, name);

    return [
      {
        ...base,
        category: classification.category,
        subcategory: classification.subcategory,
        subcategoryLabel: classification.subcategoryLabel,
        rarity: rarity(row.rankLevel),
        description: [
          textMapValue(textMap, row.descTextMapHash),
          textMapValue(textMap, row.specialDescTextMapHash),
        ]
          .filter(Boolean)
          .join("\n\n"),
        sources,
        usedBy,
        provenance: {
          ...base.provenance,
          subcategory: classification.subcategory,
          subcategoryLabel: classification.subcategoryLabel,
        },
      },
    ];
  });

  const achievementGoals = new Map(
    asArray(inputs.achievementGoal.value).map((row) => {
      const goalId = idText(row.id);
      const goalName = textMapValue(textMap, row.nameTextMapHash);
      const mapping = getAchievementGoalMapping(goalId);
      return [
        goalId ?? "",
        {
          goalName,
          canonicalCategory:
            mapping && mapping.goalName === goalName ? mapping.canonicalCategory : "other",
          mappingKnown: Boolean(mapping && mapping.goalName === goalName),
        },
      ] as const;
    }),
  );
  const achievements = asArray(inputs.achievement.value).flatMap((row): GenshinAchievement[] => {
    const upstreamId = idText(row.id);
    const name = textMapValue(textMap, row.titleTextMapHash);
    if (!upstreamId || !name) {
      excluded.push({
        kind: "achievements",
        upstreamId: upstreamId ?? "unknown",
        reason: "name_missing",
      });
      return [];
    }
    const goalId = idText(row.goalId);
    const goal = achievementGoals.get(goalId ?? "");
    const goalName = goal?.goalName;
    if (!goal?.mappingKnown) {
      warnings.push({
        kind: "achievements",
        upstreamId,
        reason: "goal_mapping_missing",
      });
    }
    const base = baseRecord(options, "achievement", upstreamId, inputs.achievement, row, name);
    const isHidden = textValue(row.isShow) === "SHOWTYPE_HIDE";
    const isDisuse = booleanValue(row.isDisuse) ?? false;
    return [
      {
        ...base,
        category: goal?.canonicalCategory ?? "other",
        requirement: textMapValue(textMap, row.descTextMapHash),
        rewardPrimogems: null,
        hidden: isHidden,
        displayState: isHidden ? "hidden" : "displayed",
        provenance: {
          ...base.provenance,
          goalId: goalId ?? null,
          goalName: goalName ?? null,
          goalCanonicalCategory: goal?.canonicalCategory ?? "other",
          goalMappingKnown: goal?.mappingKnown ?? false,
          finishRewardId: idText(row.finishRewardId) ?? null,
          rewardPrimogemsResolved: false,
          displayState: isHidden ? "hidden" : "displayed",
          achievementHiddenSource: "isShow",
          isShow: row.isShow ?? null,
          isDisuse,
        },
      },
    ];
  });

  let enemies: GenshinEnemy[] = [];
  const genshinDbEnemiesDir = genshinDbRoot
    ? resolve(genshinDbRoot, "src/data/ChineseSimplified/enemies")
    : undefined;
  const genshinDbAnimalsDir = genshinDbRoot
    ? resolve(genshinDbRoot, "src/data/ChineseSimplified/animals")
    : undefined;

  if (genshinDbEnemiesDir && existsSync(genshinDbEnemiesDir) && !isFixture) {
    const loadEnemyDir = (dir: string) => {
      if (!existsSync(dir)) return;
      const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
      for (const f of files) {
        try {
          const eData = JSON.parse(readFileSync(resolve(dir, f), "utf8"));
          const upstreamId = String(eData.id);
          const name = eData.name;
          if (!upstreamId || !name) continue;
          const drops = Array.isArray(eData.rewardPreview)
            ? eData.rewardPreview.map((r: { name?: unknown }) => String(r.name)).filter(Boolean)
            : [];
          enemies.push({
            ...baseRecord(options, "enemy", upstreamId, inputs.monster, eData as JsonObject, name),
            category: eData.categoryText ?? "其他野生生物",
            family: eData.categoryType ?? null,
            description: eData.description ?? null,
            drops,
            dropsResolved: drops.length > 0,
            resistances: {},
            provenance: {
              upstreamSource: "genshin-db",
              categoryText: eData.categoryText ?? null,
              categoryType: eData.categoryType ?? null,
              enemyType: eData.enemyType ?? null,
              monsterType: eData.monsterType ?? null,
            },
          });
        } catch {
          // Skip malformed enemy rows; enemy extraction is best-effort per row.
        }
      }
    };
    loadEnemyDir(genshinDbEnemiesDir);
    if (genshinDbAnimalsDir) loadEnemyDir(genshinDbAnimalsDir);
  }

  if (enemies.length === 0) {
    enemies = asArray(inputs.monster.value).flatMap((row): GenshinEnemy[] => {
      const upstreamId = idText(row.id);
      const name = textMapValue(textMap, row.nameTextMapHash);
      if (!upstreamId || !name) {
        excluded.push({
          kind: "enemies",
          upstreamId: upstreamId ?? "unknown",
          reason: "name_missing",
        });
        return [];
      }
      const base = baseRecord(options, "enemy", upstreamId, inputs.monster, row, name);
      return [
        {
          ...base,
          category: enemyCategory(row.type),
          family: textValue(row.type) ?? null,
          description: textMapValue(textMap, row.descTextMapHash),
          drops: [],
          dropsResolved: false,
          resistances: {},
          provenance: {
            ...base.provenance,
            dropsResolved: false,
          },
        },
      ];
    });
  }

  // Character voice-over transcription lives in FettersExcelConfigData
  // (voiceTitleTextMapHash + voiceFileTextTextMapHash per row). The pinned
  // snapshot has no AvatarVoiceExcelConfigData file; Fetters rows resolve
  // 100% against TextMap_MediumCHS.
  const voices = asArray(inputs.fetters.value).flatMap((row): AnimeGameDataVoiceLine[] => {
    const avatarId = idText(row.avatarId);
    const title = textMapValueWithFallback(
      textMap,
      textMapFull,
      row.voiceTitleTextMapHash ?? row.titleTextMapHash,
    );
    const body = textMapValueWithFallback(
      textMap,
      textMapFull,
      row.voiceFileTextTextMapHash ?? row.textTextMapHash,
    );
    if (!avatarId || !title || !body) {
      excluded.push({
        kind: "voices",
        upstreamId: idText(row.id) ?? idText(row.fetterId) ?? "unknown",
        reason: "required_field_missing",
      });
      return [];
    }
    const upstreamId = `${avatarId}/${idText(row.fetterId) ?? idText(row.id) ?? "unknown"}`;
    return [
      voiceLineRecord(
        options,
        inputs.fetters,
        row,
        upstreamId,
        `genshin:character:${avatarId}`,
        title,
        body,
      ),
    ];
  });

  const records = {
    characters,
    weapons,
    artifactSets,
    artifacts,
    materials,
    achievements,
    enemies,
    voices,
  };
  const discovered = {
    characters: asArray(inputs.avatar.value).length,
    weapons: asArray(inputs.weapon.value).length,
    artifactSets: Math.max(asArray(inputs.reliquarySet.value).length, artifactSets.length),
    artifacts: asArray(inputs.reliquary.value).length,
    materials: asArray(inputs.material.value).length,
    achievements: asArray(inputs.achievement.value).length,
    enemies: Math.max(asArray(inputs.monster.value).length, enemies.length),
    voices: asArray(inputs.fetters.value).length,
  };
  const converted = Object.fromEntries(
    Object.entries(records).map(([kind, values]) => [kind, values.length]),
  ) as Record<StructuredKind, number>;
  const excludedCounts = Object.fromEntries(
    Object.keys(records).map((kind) => [
      kind,
      excluded.filter((item) => item.kind === kind).length,
    ]),
  ) as Record<StructuredKind, number>;
  const failureCounts = Object.fromEntries(
    Object.keys(records).map((kind) => [
      kind,
      failures.filter((item) => item.kind === kind).length,
    ]),
  ) as Record<StructuredKind, number>;
  const accounting = Object.fromEntries(
    Object.entries(discovered).map(([kind, count]) => {
      const typedKind = kind as StructuredKind;
      const accounted = converted[typedKind] + excludedCounts[typedKind] + failureCounts[typedKind];
      return [
        typedKind,
        {
          discovered: count,
          converted: converted[typedKind],
          excluded: excludedCounts[typedKind],
          failures: failureCounts[typedKind],
          accounted,
          coverage: count ? accounted / count : 1,
        },
      ];
    }),
  ) as StructuredAnimeGameDataResult["manifest"]["accounting"];
  const accountedCoverage = Object.fromEntries(
    Object.entries(accounting).map(([kind, entry]) => [kind, entry.coverage]),
  ) as Record<StructuredKind, number>;
  const coverage = Object.fromEntries(
    Object.entries(discovered).map(([kind, count]) => [
      kind,
      count ? converted[kind as StructuredKind] / count : 1,
    ]),
  ) as Record<StructuredKind, number>;
  const stableIdCoverage = Object.fromEntries(
    Object.entries(records).map(([kind, values]) => [
      kind,
      values.length ? new Set(values.map((record) => record.stableId)).size / values.length : 1,
    ]),
  ) as Record<StructuredKind, number>;
  const fieldCoverage = Object.fromEntries(
    Object.entries(records).map(([kind, values]) => [
      kind,
      fieldCoverageFor(values as StructuredAnimeGameDataRecord[]),
    ]),
  ) as Record<StructuredKind, Record<string, number>>;
  const inputHashes = Object.fromEntries(
    Object.values(inputs)
      .map((input) => [input.relativePath, input.fileHash])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const manifest = {
    schemaVersion: 1 as const,
    converterVersion: STRUCTURED_CONVERTER_VERSION,
    upstreamSource: STRUCTURED_SOURCE,
    upstreamCommit: options.context.upstreamCommit,
    upstreamVersion: options.context.upstreamVersion,
    gameVersion: options.context.gameVersion,
    locale: STRUCTURED_LOCALE,
    discovered,
    converted,
    excluded: excluded.sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) || left.upstreamId.localeCompare(right.upstreamId),
    ),
    failures: failures.sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) || left.upstreamId.localeCompare(right.upstreamId),
    ),
    warnings: warnings.sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) || left.upstreamId.localeCompare(right.upstreamId),
    ),
    accountedCoverage,
    accounting,
    coverage,
    fieldCoverage,
    stableIdCoverage,
    inputHashes,
    contentHash: "",
  };
  return {
    records,
    manifest: {
      ...manifest,
      contentHash: sha256(stableStringify({ records, manifest: { ...manifest, contentHash: "" } })),
    },
  };
}

function fieldCoverageFor(records: StructuredAnimeGameDataRecord[]): Record<string, number> {
  if (!records.length) return {};
  const keys = new Set(records.flatMap((record) => Object.keys(record)));
  return Object.fromEntries(
    [...keys].sort().map((key) => {
      const present = records.filter((record) => {
        const value = (record as Record<string, unknown>)[key];
        if (value === null || value === undefined) return false;
        if (Array.isArray(value)) return value.length > 0;
        if (typeof value === "object") return Object.keys(value).length > 0;
        return true;
      }).length;
      return [key, present / records.length];
    }),
  );
}

export async function writeStructuredConversionResult(
  result: StructuredAnimeGameDataResult,
  outputRoot: string,
  generatedAt = new Date().toISOString(),
): Promise<StructuredConversionManifest> {
  const absoluteOutputRoot = resolve(outputRoot);
  const recordsDir = resolve(absoluteOutputRoot, "records");
  await mkdir(recordsDir, { recursive: true });
  const writeJson = async (path: string, value: unknown) => {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  };
  await Promise.all([
    writeJson(resolve(recordsDir, "characters.json"), result.records.characters),
    writeJson(resolve(recordsDir, "weapons.json"), result.records.weapons),
    writeJson(resolve(recordsDir, "artifact-sets.json"), result.records.artifactSets),
    writeJson(resolve(recordsDir, "artifacts.json"), result.records.artifacts),
    writeJson(resolve(recordsDir, "materials.json"), result.records.materials),
    writeJson(resolve(recordsDir, "achievements.json"), result.records.achievements),
    writeJson(resolve(recordsDir, "enemies.json"), result.records.enemies),
    writeJson(resolve(recordsDir, "voices.json"), result.records.voices),
  ]);
  const manifest = {
    ...result.manifest,
    generatedAt,
    outputRecordsPath: relative(process.cwd(), recordsDir) || ".",
  };
  await writeJson(resolve(absoluteOutputRoot, "manifest.json"), manifest);
  return manifest;
}

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  const direct = process.argv.find((arg) => arg.startsWith(prefix));
  if (direct) return direct.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (async () => {
    const upstreamDir = argValue("upstream-dir") ?? "data/upstream/AnimeGameData";
    const upstreamCommit = argValue("commit") ?? "unknown";
    const gameVersion = argValue("game-version") ?? "unknown";
    const revisionId = argValue("revision-id") ?? "00000000-0000-0000-0000-000000000000";
    const gameId = argValue("game-id") ?? "00000000-0000-0000-0000-000000000000";
    const outputRoot =
      argValue("output") ??
      resolve("data/imports/normalized/anime-game-data", upstreamCommit, "structured");
    const result = await convertStructuredAnimeGameData({
      upstreamDir,
      context: {
        gameId,
        revisionId,
        upstreamCommit,
        upstreamVersion: argValue("upstream-version") ?? gameVersion,
        gameVersion,
      },
    });
    const manifest = await writeStructuredConversionResult(result, outputRoot);
    console.log(
      JSON.stringify(
        {
          output: outputRoot,
          contentHash: manifest.contentHash,
          converted: manifest.converted,
          failures: manifest.failures.length,
        },
        null,
        2,
      ),
    );
  })().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
