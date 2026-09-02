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
  avatar: "ExcelBinOutput/AvatarExcelConfigData.json",
  weapon: "ExcelBinOutput/WeaponExcelConfigData.json",
  reliquarySet: "ExcelBinOutput/ReliquarySetExcelConfigData.json",
  reliquaryAffix: "ExcelBinOutput/ReliquaryAffixExcelConfigData.json",
  reliquary: "ExcelBinOutput/ReliquaryExcelConfigData.json",
  material: "ExcelBinOutput/MaterialExcelConfigData.json",
  achievementGoal: "ExcelBinOutput/AchievementGoalExcelConfigData.json",
  achievement: "ExcelBinOutput/AchievementExcelConfigData.json",
  monster: "ExcelBinOutput/MonsterExcelConfigData.json",
  avatarVoice: "ExcelBinOutput/AvatarVoiceExcelConfigData.json",
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
    failures: Array<{ kind: StructuredKind; upstreamId: string; reason: string }>;
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
  [Key in keyof typeof inputPaths]: SourceFile<Key extends "textMap" ? TextMap : unknown>;
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

async function readJson<T>(upstreamDir: string, relativePath: string): Promise<SourceFile<T>> {
  const raw = await readFile(resolve(upstreamDir, relativePath), "utf8");
  return {
    relativePath,
    raw,
    value: JSON.parse(raw) as T,
    fileHash: sha256(raw),
  };
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

function materialCategory(value: unknown): GenshinMaterial["category"] {
  const normalized = textValue(value)?.toLowerCase() ?? "";
  if (normalized.includes("avatar") || normalized.includes("character"))
    return "character_development";
  if (normalized.includes("weapon")) return "weapon_development";
  if (normalized.includes("currency")) return "currency";
  if (normalized.includes("food")) return "cooking";
  if (normalized.includes("quest")) return "quest_item";
  if (normalized.includes("furniture")) return "furnishing";
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
  const failures: StructuredAnimeGameDataResult["manifest"]["failures"] = [];

  const characters = asArray(inputs.avatar.value).flatMap((row): GenshinCharacter[] => {
    const upstreamId = idText(row.id);
    const name = textMapValue(textMap, row.nameTextMapHash);
    if (!upstreamId || !name) {
      failures.push({
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
      failures.push({
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
      failures.push({
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
      failures.push({
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

  const materials = asArray(inputs.material.value).flatMap((row): GenshinMaterial[] => {
    const upstreamId = idText(row.id);
    const name = textMapValue(textMap, row.nameTextMapHash);
    if (!upstreamId || !name) {
      failures.push({
        kind: "materials",
        upstreamId: upstreamId ?? "unknown",
        reason: "name_missing",
      });
      return [];
    }
    return [
      {
        ...baseRecord(options, "material", upstreamId, inputs.material, row, name),
        category: materialCategory(row.materialType ?? row.itemType),
        rarity: rarity(row.rankLevel),
        description: [
          textMapValue(textMap, row.descTextMapHash),
          textMapValue(textMap, row.specialDescTextMapHash),
        ]
          .filter(Boolean)
          .join("\n\n"),
        sources: [],
        usedBy: [],
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
      failures.push({
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
      failures.push({
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
      failures.push({
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

  const voices = asArray(inputs.avatarVoice.value).flatMap((row): AnimeGameDataVoiceLine[] => {
    const upstreamId = idText(row.id);
    const avatarId = idText(row.avatarId);
    const title = textMapValue(textMap, row.voiceTitleTextMapHash ?? row.titleTextMapHash);
    const body = textMapValue(textMap, row.voiceTextTextMapHash ?? row.textTextMapHash);
    if (!upstreamId || !avatarId || !title || !body) {
      failures.push({
        kind: "voices",
        upstreamId: upstreamId ?? "unknown",
        reason: "required_field_missing",
      });
      return [];
    }
    return [
      voiceLineRecord(
        options,
        inputs.avatarVoice,
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
    voices: asArray(inputs.avatarVoice.value).length,
  };
  const converted = Object.fromEntries(
    Object.entries(records).map(([kind, values]) => [kind, values.length]),
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
    failures: failures.sort(
      (left, right) =>
        left.kind.localeCompare(right.kind) || left.upstreamId.localeCompare(right.upstreamId),
    ),
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
