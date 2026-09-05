import { createHash } from "node:crypto";
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
  return Object.fromEntries(entries) as LoadedInputs;
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

function resolveMaterialCategory(
  materialType: unknown,
  itemType: unknown,
  typeDesc?: string | null,
): GenshinMaterial["category"] {
  const desc = typeDesc?.trim() ?? "";
  if (desc.includes("区域特产")) return "local_specialty";
  if (
    desc.includes("角色培养素材") ||
    desc.includes("角色天赋素材") ||
    desc.includes("角色突破素材") ||
    desc.includes("角色与武器培养素材") ||
    desc.includes("角色经验素材") ||
    desc.includes("命之座") ||
    desc.includes("角色解锁") ||
    desc.includes("角色成长") ||
    desc.includes("好感成长")
  ) {
    return "character_development";
  }
  if (
    desc.includes("武器突破素材") ||
    desc.includes("武器强化素材") ||
    desc.includes("精炼材料")
  ) {
    return "weapon_development";
  }
  if (
    desc.includes("食物") ||
    desc.includes("食谱") ||
    desc.includes("食材") ||
    desc.includes("药剂") ||
    desc.includes("鱼饵")
  ) {
    return "cooking";
  }
  if (desc.includes("矿石") || desc.includes("锻造")) {
    return "forging";
  }
  if (desc.includes("摆设") || desc.includes("家具")) {
    return "furnishing";
  }
  if (
    desc.includes("任务") ||
    desc.includes("道具") ||
    desc.includes("凭证") ||
    desc.includes("贵重")
  ) {
    return "quest_item";
  }
  if (desc.includes("货币") || desc.includes("兑换券") || desc.includes("祈愿") || desc.includes("徽印")) {
    return "currency";
  }
  if (desc.includes("消耗品") || desc.includes("素材") || desc.includes("礼包") || desc.includes("宝箱")) {
    return "consumable";
  }

  // Fallback to materialType / itemType enum
  const rawType = String(materialType ?? itemType ?? "").toUpperCase();
  if (
    rawType.includes("TALENT") ||
    rawType.includes("AVATAR") ||
    rawType.includes("ELEM_GEM")
  ) {
    return "character_development";
  }
  if (rawType.includes("WEAPON")) return "weapon_development";
  if (rawType.includes("FOOD")) return "cooking";
  if (rawType.includes("WOOD")) return "forging";
  if (rawType.includes("FURNITURE")) return "furnishing";
  if (rawType.includes("QUEST")) return "quest_item";
  if (rawType.includes("CURRENCY") || rawType.includes("EXCHANGE")) return "currency";
  if (rawType.includes("CONSUME")) return "consumable";

  return "other";
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

  const artifactSets = asArray(inputs.reliquarySet.value).flatMap((row): GenshinArtifactSet[] => {
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
    if (!name || name.includes("测试") || name.includes("废弃") || name.includes("【弃用】") || name.startsWith("test_")) continue;
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
    if (!name || name.includes("测试") || name.includes("废弃") || name.includes("【弃用】") || name.startsWith("test_")) continue;
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
    const allSkillIds = [...skillsList, d.energySkill, ...subSkillsList].map(idText).filter(Boolean);
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
      name.startsWith("$") ||
      name.startsWith("test_") ||
      name.startsWith("DEBUG_") ||
      name.startsWith("TEMP_") ||
      name.includes("测试用") ||
      name.includes("【弃用】")
    ) {
      excluded.push({
        kind: "materials",
        upstreamId,
        reason: "internal_or_placeholder",
      });
      return [];
    }

    const typeDesc = textMapValue(textMap, row.typeDescTextMapHash);
    const category = resolveMaterialCategory(row.materialType, row.itemType, typeDesc);
    const sources = sourcesMap.get(upstreamId) ?? [];
    const usedBy = Array.from(usedByMap.get(upstreamId) ?? []);

    return [
      {
        ...baseRecord(options, "material", upstreamId, inputs.material, row, name),
        category,
        rarity: rarity(row.rankLevel),
        description: [
          textMapValue(textMap, row.descTextMapHash),
          textMapValue(textMap, row.specialDescTextMapHash),
        ]
          .filter(Boolean)
          .join("\n\n"),
        sources,
        usedBy,
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

  const enemies = asArray(inputs.monster.value).flatMap((row): GenshinEnemy[] => {
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
    artifactSets: asArray(inputs.reliquarySet.value).length,
    artifacts: asArray(inputs.reliquary.value).length,
    materials: asArray(inputs.material.value).length,
    achievements: asArray(inputs.achievement.value).length,
    enemies: asArray(inputs.monster.value).length,
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
}
