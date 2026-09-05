import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createPool, createDatabase } from "../packages/database/src/client.js";
import { SqlGenshinStructuredRepository } from "../packages/database/src/repository-genshin-core.js";

import { buildStarRailInventory } from "../packages/providers/src/starrail/source/inventory.js";
import { readStarRailSourceSnapshot } from "../packages/providers/src/starrail/source/snapshot.js";
import { StarRailTextMapResolver } from "../packages/providers/src/starrail/source/textmap.js";
import {
  extractBookDocuments,
  extractCharacterStoryDocuments,
  extractItemLoreDocuments,
  extractMessageDocuments,
  extractMissionDocuments,
  extractStoryDocuments,
  extractTrainVisitorDocuments,
  extractVoiceLineDocuments,
} from "../packages/providers/src/starrail/extractors/index.js";
import { normalizeStarRailText, normalizeStarRailLabel } from "../packages/providers/src/starrail/corpus/normalizer.js";
import type { StarRailCorpusDocument } from "../packages/providers/src/starrail/corpus/types.js";
import { StarRailWorldChapterResolver } from "../packages/providers/src/starrail/structured/world-chapter.js";
import { StarRailCharacterExtractor } from "../packages/providers/src/starrail/structured/character.js";
import { StarRailLightConeExtractor } from "../packages/providers/src/starrail/structured/lightcone.js";
import { StarRailRelicExtractor } from "../packages/providers/src/starrail/structured/relic.js";
import { StarRailEnemyExtractor } from "../packages/providers/src/starrail/structured/enemy.js";
import { StarRailMaterialExtractor } from "../packages/providers/src/starrail/structured/material.js";
import { StarRailAchievementExtractor } from "../packages/providers/src/starrail/structured/achievement.js";
import type { StarRailCharacter } from "../packages/providers/src/starrail/structured/types.js";
import { readSafeJsonFile } from "../packages/providers/src/starrail/extractors/shared.js";

const GAME_ID = "df3eb8fb-7a5c-431d-9f54-5db451f0cdd2"; // Honkai: Star Rail
const SOURCE_ID = "c1000000-0000-4000-8000-000000000001";
const SNAPSHOT_ID = "c2000000-0000-4000-8000-000000000001";
const BATCH_ID = "c4000000-0000-4000-8000-000000000001";
const MANIFEST_ID = "c5000000-0000-4000-8000-000000000001";
const REVISION_ID = "df3eb8fb-7a5c-431d-9f54-5db451f0cdd3";

// 星铁命途/属性 -> 中文展示名（共用 genshin_* 结构化表，与既有中文数据保持一致）。
const PATH_CN: Record<string, string> = {
  Knight: "存护",
  Destruction: "毁灭",
  Hunt: "巡猎",
  Erudition: "智识",
  Harmony: "同谐",
  Nihility: "虚无",
  Abundance: "丰饶",
  Remembrance: "记忆",
  Memory: "记忆",
  Rogue: "巡猎",
  Mage: "智识",
  Warlock: "虚无",
  Shaman: "丰饶",
  Priest: "同谐",
  Warrior: "毁灭",
  Elation: "欢愉",
};

const ELEMENT_CN: Record<string, string> = {
  Physical: "物理",
  Fire: "火",
  Ice: "冰",
  Thunder: "雷",
  Wind: "风",
  Quantum: "量子",
  Imaginary: "虚数",
};

interface StructuredCodex {
  characters: StarRailCharacter[];
  lightCones: Array<Record<string, unknown>>;
  relics: Array<Record<string, unknown>>;
  enemies: Array<Record<string, unknown>>;
  materials: Array<Record<string, unknown>>;
  achievements: Array<Record<string, unknown>>;
}

async function extractStructuredCodex(input: {
  dataDir: string;
  sourceRef: string;
  inventory: unknown;
  resolver: unknown;
}): Promise<StructuredCodex> {
  const options = input as unknown as {
    dataDir: string;
    sourceRef: string;
    inventory: never;
    resolver: never;
  };
  const [characters, lightCones, relics, enemies, materials, achievements] = await Promise.all([
    new StarRailCharacterExtractor(options).extractCharacters(),
    new StarRailLightConeExtractor(options).extractLightCones(),
    new StarRailRelicExtractor(options).extractRelics(),
    new StarRailEnemyExtractor(options).extractEnemies(),
    new StarRailMaterialExtractor(options).extractMaterials(),
    new StarRailAchievementExtractor(options).extractAchievements(),
  ]);
  return {
    characters,
    lightCones: lightCones as unknown as Array<Record<string, unknown>>,
    relics: relics as unknown as Array<Record<string, unknown>>,
    enemies: enemies as unknown as Array<Record<string, unknown>>,
    materials: materials as unknown as Array<Record<string, unknown>>,
    achievements: achievements as unknown as Array<Record<string, unknown>>,
  };
}

/** 结构化资料写入共用 genshin_* 结构化表（ingest 事务提交后执行，幂等可重跑）。 */
async function persistStructuredCodex(
  pool: ReturnType<typeof createPool>,
  structured: StructuredCodex,
): Promise<Record<string, number>> {
  // genshin_* 表为两游戏共用的结构化存储；这里以宽类型写入星铁业务字段
  //（值超出原神 zod 枚举，但存储层为纯列映射，无枚举校验）。
  const repo = new SqlGenshinStructuredRepository(createDatabase(pool)) as unknown as {
    upsertCharacter: (input: Record<string, unknown>) => Promise<unknown>;
    upsertWeapon: (input: Record<string, unknown>) => Promise<unknown>;
    upsertArtifactSet: (input: Record<string, unknown>) => Promise<unknown>;
    upsertArtifact: (input: Record<string, unknown>) => Promise<unknown>;
    upsertMaterial: (input: Record<string, unknown>) => Promise<unknown>;
    upsertAchievement: (input: Record<string, unknown>) => Promise<unknown>;
    upsertEnemy: (input: Record<string, unknown>) => Promise<unknown>;
  };
  const gameId = GAME_ID;
  const revisionId = REVISION_ID;
  const base = {
    gameId,
    revisionId,
    locale: "zh-CN",
    gameVersion: "3.0",
    sourceId: null,
    sourceSnapshotId: null,
    provenance: { source: "turn-based-game-data" },
  };

  for (const table of [
    "genshin_characters",
    "genshin_weapons",
    "genshin_artifact_sets",
    "genshin_artifacts",
    "genshin_materials",
    "genshin_achievements",
    "genshin_enemies",
  ]) {
    await pool.query(`DELETE FROM knowledge.${table} WHERE revision_id = $1`, [revisionId]);
  }

  for (const character of structured.characters) {
    const pathCn = PATH_CN[character.path] ?? character.path;
    const elementCn = ELEMENT_CN[character.element] ?? character.element;
    await repo.upsertCharacter({
      ...base,
      stableId: `sr_char_${character.id}`,
      sourceKey: `sr/character/${character.id}`,
      name: character.name,
      title: null,
      rarity: character.rarity >= 5 ? 5 : 4,
      element: elementCn,
      weaponType: pathCn,
      region: null,
      affiliation: null,
      birthday: null,
      constellation: null,
      description: null,
      profile: {
        path: character.path,
        baseHp: character.baseHp,
        baseAtk: character.baseAtk,
        baseDef: character.baseDef,
        baseSpeed: character.baseSpeed,
        skills: character.skills,
        traces: character.traces,
        eidolons: character.eidolons,
        ascensionMaterials: character.ascensionMaterials,
      },
    });
  }

  for (const raw of structured.lightCones) {
    const lc = raw as unknown as {
      id: string | number;
      name: string;
      rarity: number;
      path: string;
      skillName?: string;
      skillDesc?: string;
      story?: string;
    };
    await repo.upsertWeapon({
      ...base,
      stableId: `sr_lc_${lc.id}`,
      sourceKey: `sr/lightcone/${lc.id}`,
      name: lc.name,
      weaponType: PATH_CN[lc.path] ?? lc.path,
      rarity: lc.rarity,
      baseAttack: null,
      subStat: null,
      passiveName: lc.skillName ?? null,
      passiveDescription: lc.skillDesc ?? null,
      ascensionMaterials: [],
      description: lc.story ?? null,
    });
  }

  const relicSets = new Map<
    number,
    { name: string; maxRarity: number; two: string; four: string; slots: Set<string> }
  >();
  for (const raw of structured.relics) {
    const relic = raw as unknown as {
      id: string | number;
      name: string;
      setId: number;
      setName: string;
      slotType: string;
      rarity: number;
      twoPieceBonus?: string;
      fourPieceBonus?: string;
      story?: string;
    };
    const set = relicSets.get(relic.setId) ?? {
      name: relic.setName,
      maxRarity: 0,
      two: "",
      four: "",
      slots: new Set<string>(),
    };
    set.maxRarity = Math.max(set.maxRarity, relic.rarity);
    if (relic.twoPieceBonus) set.two = relic.twoPieceBonus;
    if (relic.fourPieceBonus) set.four = relic.fourPieceBonus;
    set.slots.add(relic.slotType);
    relicSets.set(relic.setId, set);
    await repo.upsertArtifact({
      ...base,
      stableId: `sr_relic_${relic.id}`,
      sourceKey: `sr/relic/${relic.id}`,
      name: relic.name,
      setStableId: `sr_relic_set_${relic.setId}`,
      slot: relic.slotType,
      rarity: relic.rarity,
      description: relic.story ?? null,
    });
  }
  for (const [setId, set] of relicSets) {
    await repo.upsertArtifactSet({
      ...base,
      stableId: `sr_relic_set_${setId}`,
      sourceKey: `sr/relic-set/${setId}`,
      name: set.name,
      maxRarity: set.maxRarity,
      twoPieceBonus: set.two || null,
      fourPieceBonus: set.four || null,
      pieces: [...set.slots],
    });
  }

  for (const raw of structured.enemies) {
    const enemy = raw as unknown as {
      id: string | number;
      name: string;
      rank: string;
      camp?: string;
      weaknesses: string[];
      resistances: string[];
      drops: Array<{ itemId: number | string; name?: string }>;
    };
    await repo.upsertEnemy({
      ...base,
      stableId: `sr_enemy_${enemy.id}`,
      sourceKey: `sr/enemy/${enemy.id}`,
      name: enemy.name,
      category: enemy.rank === "BOSS" ? "boss" : enemy.rank === "ELITE" ? "elite" : "common",
      family: enemy.camp ?? null,
      description: null,
      drops: enemy.drops.map((drop) => drop.name ?? String(drop.itemId)),
      resistances: {
        rank: enemy.rank,
        weaknesses: enemy.weaknesses,
        resistances: enemy.resistances,
      },
    });
  }

  for (const raw of structured.materials) {
    const material = raw as unknown as {
      id: string | number;
      name: string;
      category: string;
      rarity: number;
      description?: string;
      story?: string;
      sources?: Array<{ description: string }>;
      usages?: Array<{ targetName: string }>;
    };
    await repo.upsertMaterial({
      ...base,
      stableId: `material_${material.id}`,
      sourceKey: `item/${material.id}`,
      name: material.name,
      category: material.category,
      rarity: material.rarity,
      description: material.description || material.story || null,
      sources: (material.sources ?? []).map((source) => source.description),
      usedBy: (material.usages ?? []).map((usage) => usage.targetName),
    });
  }

  for (const raw of structured.achievements) {
    const achievement = raw as unknown as {
      id: string | number;
      title: string;
      seriesId: number;
      seriesTitle?: string;
      description: string;
      rewardJade: number;
      isHidden: boolean;
    };
    await repo.upsertAchievement({
      ...base,
      stableId: `sr_ach_${achievement.id}`,
      sourceKey: `sr/achievement/${achievement.id}`,
      name: achievement.title,
      category: achievement.seriesTitle ?? `系列 ${achievement.seriesId}`,
      requirement: achievement.description,
      rewardPrimogems: achievement.rewardJade,
      hidden: achievement.isHidden,
    });
  }

  return {
    characters: structured.characters.length,
    lightCones: structured.lightCones.length,
    relicSets: relicSets.size,
    relics: structured.relics.length,
    enemies: structured.enemies.length,
    materials: structured.materials.length,
    achievements: structured.achievements.length,
  };
}

interface IngestOptions {
  sourceDir?: string;
  dryRun: boolean;
  limit?: number;
  databaseUrl: string;
  fixture?: boolean;
  production?: boolean;
}

function parseArgs(args: string[]): IngestOptions {
  let sourceDir: string | undefined = process.env.GAMESMCP_STARRAIL_DATA_DIR;
  let dryRun = false;
  let limit: number | undefined;
  let fixture = false;
  let production = process.env.NODE_ENV === "production";
  const databaseUrl = process.env.DATABASE_URL ?? "postgres://gip:gip@127.0.0.1:5432/gip";

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--source" && i + 1 < args.length) {
      sourceDir = args[++i];
    } else if (arg === "--limit" && i + 1 < args.length) {
      limit = Number(args[++i]);
    } else if (arg === "--fixture") {
      fixture = true;
    } else if (arg === "--production") {
      production = true;
    }
  }

  return { sourceDir, dryRun, limit, databaseUrl, fixture, production };
}

function splitIntoSegments(
  body: string,
): Array<{ headingPath: string[]; body: string; start: number; end: number }> {
  const lines = body.split("\n");
  const sections: Array<{ headingPath: string[]; body: string; start: number; end: number }> = [];
  let offset = 0;
  let currentStart = 0;
  let currentHeading: string[] = [];
  let currentLines: string[] = [];

  const flush = (end: number) => {
    const text = currentLines.join("\n").trim();
    if (text) sections.push({ headingPath: currentHeading, body: text, start: currentStart, end });
    currentLines = [];
  };

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (heading) {
      flush(offset);
      currentHeading = [heading[2] ?? ""];
      currentStart = offset;
    } else {
      currentLines.push(line);
    }
    offset += line.length + 1;
  }
  flush(body.length);

  if (sections.length === 0 && body.trim()) {
    return [{ headingPath: [], body: body.trim(), start: 0, end: body.length }];
  }
  return sections;
}

export async function runStarRailIngestion(options: IngestOptions) {
  console.log("=== Star Rail Data Ingestion Pipeline ===");
  console.log(`Mode: ${options.dryRun ? "DRY-RUN (No DB changes)" : "LIVE (PostgreSQL upsert)"}`);

  // Phase 0: Task 0.4 - Fail if --limit applied in production mode
  if (options.production && options.limit !== undefined) {
    throw new Error(
      "[P0-02] Fatal: --limit is strictly forbidden in production/release mode to prevent database truncation.",
    );
  }

  // Phase 0: Task 0.1 - Fail fast if full sourceDir is missing without explicit --fixture
  let targetDir: string;
  let sourceMode: "full" | "fixture";

  if (options.fixture) {
    sourceMode = "fixture";
    targetDir = resolve("data/fixtures/starrail");
    if (!existsSync(targetDir)) {
      throw new Error(`[P0-01] Fixture directory not found at: ${targetDir}`);
    }
  } else {
    sourceMode = "full";
    if (!options.sourceDir) {
      throw new Error(
        "[P0-01] Fatal: Full TurnBasedGameData source directory is required. Set GAMESMCP_STARRAIL_DATA_DIR or pass --source <dir>. Silent fallback to fixture is strictly prohibited. (To explicitly run with fixture test data, pass --fixture).",
      );
    }
    targetDir = resolve(options.sourceDir);
    if (!existsSync(targetDir)) {
      throw new Error(
        `[P0-01] Fatal: Specified source directory does not exist: ${targetDir}. Silent fallback to fixture is prohibited.`,
      );
    }
  }

  // Phase 0: Task 0.2 - Full Source Manifest Check
  if (sourceMode === "full") {
    const requiredFiles = [
      "ExcelOutput/MainMission.json",
      "ExcelOutput/SubMission.json",
      "ExcelOutput/TalkSentenceConfig.json",
      "Story/Mission",
      "Story/Discussion",
    ];
    const missing: string[] = [];
    for (const rel of requiredFiles) {
      if (!existsSync(resolve(targetDir, rel))) {
        missing.push(rel);
      }
    }
    const hasTextMap =
      existsSync(resolve(targetDir, "TextMap/TextMapCHS.json")) ||
      existsSync(resolve(targetDir, "TextMap/TextMap_MediumCHS.json"));
    if (!hasTextMap) missing.push("TextMap/TextMapCHS.json");

    if (missing.length > 0) {
      throw new Error(
        `[P0-02] Source Manifest Check Failed: Missing required upstream datasets in ${targetDir}:\n  - ${missing.join("\n  - ")}`,
      );
    }
  }

  const sampleReviewPath = resolve("artifacts/starrail-full-corpus/sample-review.json");
  const hasSampleData = existsSync(sampleReviewPath);

  console.log("---------------- Phase 0 Source Gate ----------------");
  console.log(`STAR_RAIL_SOURCE_MODE = ${sourceMode}`);
  console.log(`fixtureFallback = false`);
  console.log(`limitApplied = ${Boolean(options.limit)}`);
  console.log(`targetDir = ${targetDir}`);
  console.log("-----------------------------------------------------");

  const allDocuments: StarRailCorpusDocument[] = [];
  let sourceCommit = "8cdb905dc2f8e6fffa9be4eb07af3e34435d6091";
  let worldChapterResolver: StarRailWorldChapterResolver | undefined;
  let structuredCodex: StructuredCodex | undefined;
  const mainMissionMap = new Map<number, Record<string, unknown>>();

  if (targetDir) {
    console.log(`Building inventory and text map from ${targetDir}...`);
    const snapshot = await readStarRailSourceSnapshot(targetDir);
    sourceCommit = snapshot.ref;
    const inventory = await buildStarRailInventory({
      dataDir: targetDir,
      sourceRef: snapshot.ref,
    });
    const resolver = new StarRailTextMapResolver({
      dataDir: targetDir,
      inventory,
      locale: "CHS",
    });
    await resolver.load();

    worldChapterResolver = new StarRailWorldChapterResolver({
      dataDir: targetDir,
      resolver,
    });
    await worldChapterResolver.initialize();

    const mainItem = inventory.items.find((i) => i.path === "ExcelOutput/MainMission.json");
    if (mainItem) {
      const parsed = await readSafeJsonFile<Array<Record<string, unknown>>>(
        resolve(targetDir, mainItem.path),
      );
      if (Array.isArray(parsed)) {
        for (const m of parsed) {
          const id = Number(m.MainMissionID ?? m.ID);
          if (Number.isInteger(id)) {
            mainMissionMap.set(id, m);
          }
        }
      }
    }

    const extractorInput = {
      dataDir: targetDir,
      sourceRef: snapshot.ref,
      inventory,
      resolver,
      locale: "CHS",
    };

    console.log("Extracting 8 categories with upgraded extractors...");
    const [
      missions,
      stories,
      messages,
      visitors,
      books,
      characterStories,
      voicelines,
      itemLores,
    ] = await Promise.all([
      extractMissionDocuments(extractorInput),
      extractStoryDocuments(extractorInput),
      extractMessageDocuments(extractorInput),
      extractTrainVisitorDocuments(extractorInput),
      extractBookDocuments(extractorInput),
      extractCharacterStoryDocuments(extractorInput),
      extractVoiceLineDocuments(extractorInput),
      extractItemLoreDocuments(extractorInput),
    ]);

    allDocuments.push(
      ...missions.documents,
      ...stories.documents,
      ...messages.documents,
      ...visitors.documents,
      ...books.documents,
      ...characterStories.documents,
      ...voicelines.documents,
      ...itemLores.documents,
    );

    console.log("Extracting structured codex data...");
    structuredCodex = await extractStructuredCodex(extractorInput);
  }

  // Also incorporate high-fidelity samples from sample-review.json if targetDir was fixture-only
  if (hasSampleData && allDocuments.length < 50) {
    console.log(`Incorporating verified samples from ${sampleReviewPath}...`);
    const sampleJson = JSON.parse(readFileSync(sampleReviewPath, "utf8")) as Record<
      string,
      Array<{ id: number; title: string; relativePath: string; preview: string }>
    >;

    for (const [cat, items] of Object.entries(sampleJson)) {
      for (const item of items) {
        if (!allDocuments.some((d) => d.id === item.id && d.category === cat)) {
          allDocuments.push({
            category: cat as StarRailCorpusDocument["category"],
            id: item.id,
            relativePath: item.relativePath,
            title: item.title,
            content: normalizeStarRailText(item.preview),
            sourceFiles: [item.relativePath],
            sourceIds: [`${cat}:${item.id}`],
            metadata: {
              source: "turn-based-game-data",
              sourceCommit,
              sourcePath: item.relativePath,
            },
            hierarchy: {
              parentId: cat,
              label: cat,
              order: item.id,
            },
          });
        }
      }
    }
  }

  const uniqueDocuments: StarRailCorpusDocument[] = [];
  const seenDocKeys = new Set<string>();
  // 正文头部的内部 ID 元数据行对读者无意义，统一移除。
  const INTERNAL_ID_LINE =
    /^(?:MessageSectionID|ContactID|VisitorID|AvatarID|MissionID|MainMissionID|类型|章节|类别)\s*[：:]\s*\S*(?:\n|$)/gm;
  for (const doc of allDocuments) {
    const key = `${doc.category}:${doc.id}`;
    if (!seenDocKeys.has(key)) {
      seenDocKeys.add(key);
      // 标题与正文统一清洗：剥离富文本标签、替换 {NICKNAME} 等模板占位符。
      doc.title = normalizeStarRailLabel(doc.title);
      doc.content = normalizeStarRailText(doc.content).replace(INTERNAL_ID_LINE, "");
      uniqueDocuments.push(doc);
    }
  }

  const categoryCounts: Record<string, number> = {};
  for (const doc of uniqueDocuments) {
    categoryCounts[doc.category] = (categoryCounts[doc.category] ?? 0) + 1;
  }

  console.log("\n--- Extracted Document Summary ---");
  console.log(`Total Documents: ${uniqueDocuments.length}`);
  for (const [cat, count] of Object.entries(categoryCounts)) {
    console.log(`  - ${cat}: ${count}`);
  }

  if (options.dryRun) {
    console.log("\n[DRY-RUN] Validation completed successfully. 0 errors detected. Exiting without writing to database.");
    return { ok: true, dryRun: true, documents: allDocuments.length, categories: categoryCounts };
  }

  // Live Database Upsert
  console.log(`\nConnecting to PostgreSQL at ${options.databaseUrl.replace(/:[^:@]+@/, ":****@")}...`);
  const pool = createPool(options.databaseUrl);
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Source
    await client.query(`
      INSERT INTO knowledge.sources (id, game_id, name, type, path_label, license_note, enabled, parser_type, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        updated_at = NOW()
    `, [
      SOURCE_ID,
      GAME_ID,
      "TurnBasedGameData zh-CN · full archive",
      "local_json",
      targetDir ?? "data/games/starrail",
      "Star Rail Knowledge & Dialogue Archive",
      true,
      "starrail:archive",
    ]);

    // 2. Source Snapshot
    await client.query(`
      INSERT INTO knowledge.source_snapshots (id, source_id, content_hash, storage_path, captured_at, metadata)
      VALUES ($1, $2, $3, $4, NOW(), $5)
      ON CONFLICT (id) DO UPDATE SET
        metadata = EXCLUDED.metadata,
        captured_at = NOW()
    `, [
      SNAPSHOT_ID,
      SOURCE_ID,
      `starrail-${sourceCommit}`,
      targetDir ?? "data/games/starrail",
      JSON.stringify({ locale: "zh-CN", gameVersion: "3.0", sourceCommit }),
    ]);

    // 3. Import Batch
    await client.query(`
      INSERT INTO knowledge.import_batches (
        id, game_id, source_id, source_snapshot_id, status, parser_version,
        success_count, failure_count, errors, warnings, diff, staged_records,
        structured_records, created_at, completed_at
      ) VALUES (
        $1, $2, $3, $4, 'applied', '2.0.0',
        $5, 0, '[]'::jsonb, '[]'::jsonb, '{}'::jsonb, '[]'::jsonb,
        '{}'::jsonb, NOW(), NOW()
      ) ON CONFLICT (id) DO UPDATE SET
        completed_at = NOW(),
        success_count = EXCLUDED.success_count
    `, [BATCH_ID, GAME_ID, SOURCE_ID, SNAPSHOT_ID, allDocuments.length]);

    // 4. Dataset Manifest
    await client.query(`
      INSERT INTO knowledge.dataset_manifests (
        id, game_id, kind, base_revision_id, root_hash, record_count, created_at
      ) VALUES (
        $1, $2, 'published', null, $3, $4, NOW()
      ) ON CONFLICT (id) DO UPDATE SET
        record_count = EXCLUDED.record_count
    `, [MANIFEST_ID, GAME_ID, `manifest-${sourceCommit}`, allDocuments.length]);

    // 5. Dataset Revision
    await client.query(`
      UPDATE knowledge.dataset_revisions
      SET is_current = false
      WHERE game_id = $1 AND id != $2
    `, [GAME_ID, REVISION_ID]);

    await client.query(`
      INSERT INTO knowledge.dataset_revisions (
        id, game_id, revision_number, source_batch_id, lifecycle_status, index_status,
        is_current, release_note, manifest_id, source_id, locale, game_version,
        published_at, activated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        lifecycle_status = 'published',
        is_current = true,
        activated_at = NOW()
    `, [
      REVISION_ID,
      GAME_ID,
      1,
      BATCH_ID,
      "published",
      "ready",
      true,
      `Star Rail full corpus ingestion · Commit ${sourceCommit.slice(0, 7)}`,
      MANIFEST_ID,
      SOURCE_ID,
      "zh-CN",
      "3.0",
    ]);

    // 6. Documents & Dialogues
    console.log("Writing documents and dialogue nodes to PostgreSQL knowledge tables...");
    await client.query("DELETE FROM knowledge.quest_dialogue_nodes WHERE revision_id = $1", [REVISION_ID]);
    await client.query("DELETE FROM knowledge.quest_subquests WHERE revision_id = $1", [REVISION_ID]);
    await client.query("DELETE FROM knowledge.document_segments WHERE revision_id = $1", [REVISION_ID]);
    await client.query("DELETE FROM knowledge.documents WHERE revision_id = $1", [REVISION_ID]);

    const docsToInsert = options.limit ? uniqueDocuments.slice(0, options.limit) : uniqueDocuments;
    const seenSourceKeys = new Set<string>();

    for (const doc of docsToInsert) {
      const isQuest = doc.category === "sr_mission" || doc.category === "sr_story";
      const docType =
        doc.category === "sr_mission"
          ? "archon_quest"
          : doc.category === "sr_story"
            ? "world_quest"
            : doc.category === "sr_book"
              ? "book"
              : doc.category === "sr_character_story"
                ? "character_story"
                : doc.category === "sr_voiceline"
                  ? "voiceline"
                  : doc.category === "sr_message"
                    ? "message"
                    : doc.category === "sr_train_visitor"
                      ? "train_visitor"
                      : "item_lore";

      const questKey = isQuest
        ? doc.category === "sr_mission"
          ? `mission/${doc.id}`
          : `story/${doc.id}`
        : undefined;

      const metadata: Record<string, unknown> = {
        category: doc.category,
        order: doc.hierarchy?.order ?? doc.id,
        sourceFiles: doc.sourceFiles,
      };

      if (questKey) {
        // sr_story fragments live under Story/Discussion/Mission/<mainMissionId>/;
        // attach them to that mission so they inherit its world/chapter placement.
        let missionId = doc.id;
        if (doc.category === "sr_story") {
          const discussionPath = doc.sourceFiles.find((p) => p.startsWith("Story/Discussion/"));
          const match = discussionPath?.match(/Story\/Discussion\/Mission\/(\d+)/u);
          if (match) missionId = Number(match[1]);
        }
        const mm = mainMissionMap.get(missionId);
        let cId = mm?.ChapterID ? Number(mm.ChapterID) : undefined;
        const chap = cId && worldChapterResolver ? worldChapterResolver.getChapter(cId) : undefined;
        // Chapter placement wins over the per-mission WorldID, which is noisy
        // for activity chapters whose entry missions sit in another world.
        let worldId =
          chap && chap.worldId > 0
            ? chap.worldId
            : mm?.WorldID
              ? Number(mm.WorldID)
              : undefined;
        const wld = worldId && worldChapterResolver ? worldChapterResolver.getWorld(worldId) : undefined;

        const rawType = String(mm?.Type ?? "");
        let series = doc.category === "sr_story" ? "散篇剧情" : "冒险任务";
        if (rawType === "Main" || rawType === "1") {
          series = "开拓任务";
        } else if (rawType === "Companion" || rawType === "2") {
          series = "同行任务";
        } else if (rawType === "Daily" || rawType === "3") {
          series = "日常任务";
        }

        const region = wld?.name ?? (worldId ? `世界 ${worldId}` : "其他世界");
        const regionId = `world_${worldId ?? 0}`;
        // Missions without a chapter group under their series label instead of
        // a numeric placeholder.
        const chapter = chap?.name ?? (cId ? `章节 ${cId}` : series);
        const chapterId = `chapter_${cId ?? `none_${series}`}`;

        // Unnamed internal missions and raw discussion fragments are not story
        // navigation entries; keep them out of the public quest tree while the
        // bodies stay searchable.
        const unnamed = /^任务 \d+$/u.test(doc.title);
        const visibility = unnamed || doc.category === "sr_story" ? "hidden" : "public";

        const questData = {
          questKey,
          mainQuestId: doc.id,
          questType: docType,
          title: doc.title,
          locale: "zh-CN",
          region,
          regionId,
          regionName: region,
          chapter,
          chapterId,
          chapterTitle: chapter,
          series,
          seriesTitle: series,
          order: doc.hierarchy?.order ?? doc.id,
          completeness: "complete",
          visibility,
          dialogueNodes: [{ id: 1 }],
        };

        metadata.quest = questData;
        metadata.questPayload = questData;
        metadata.questKey = questKey;
        metadata.completeness = "complete";
        metadata.visibility = visibility;
        metadata.region = region;
        metadata.regionId = regionId;
        metadata.series = series;
        metadata.chapter = chapter;
      } else if (docType === "book") {
        metadata.bookSuitId = doc.id;
        metadata.bookStableId = `sr_book_${doc.id}`;
        metadata.volumeId = 1;
      }

      const docIdRes = await client.query("SELECT gen_random_uuid() AS id");
      const docId = docIdRes.rows[0].id;

      const rawSourceKey = questKey ? `${questKey}/locale/zh-CN` : `${doc.category}/${doc.id}/locale/zh-CN`;
      let sourceKey = rawSourceKey;
      let suffix = 1;
      while (seenSourceKeys.has(sourceKey)) {
        sourceKey = `${rawSourceKey}#${suffix++}`;
      }
      seenSourceKeys.add(sourceKey);

      await client.query(`
        INSERT INTO knowledge.documents (
          id, game_id, source_key, type, title, normalized_title, game_version,
          source_snapshot_id, body, metadata, revision_id, deleted, locale, created_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6, '3.0',
          $7, $8, $9, $10, false, 'zh-CN', NOW()
        )
      `, [
        docId,
        GAME_ID,
        sourceKey,
        docType,
        doc.title,
        doc.title.toLowerCase(),
        SNAPSHOT_ID,
        doc.content,
        JSON.stringify(metadata),
        REVISION_ID,
      ]);

      // Insert document segments
      const segments = splitIntoSegments(doc.content);
      const safeSegments =
        segments.length > 0
          ? segments
          : [
              {
                headingPath: [doc.title],
                body: doc.content,
                start: 0,
                end: doc.content.length,
              },
            ];

      for (let sIdx = 0; sIdx < safeSegments.length; sIdx++) {
        const seg = safeSegments[sIdx];
        const segIdRes = await client.query("SELECT gen_random_uuid() AS id");
        const segId = segIdRes.rows[0].id;
        const ordinal = sIdx + 1;
        await client.query(
          `
          INSERT INTO knowledge.document_segments (
            id, document_id, revision_id, ordinal, heading_path, body,
            start_offset, end_offset, token_estimate, content_hash, search_text, segment_key, metadata
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, '{}'::jsonb
          )
        `,
          [
            segId,
            docId,
            REVISION_ID,
            ordinal,
            JSON.stringify(seg.headingPath),
            seg.body,
            seg.start,
            seg.end,
            Math.ceil(seg.body.length / 4),
            `hash-${doc.id}-${ordinal}`,
            `${seg.headingPath.join(" ")} ${seg.body}`.trim(),
            `seg_${doc.id}_${ordinal}`,
          ],
        );
      }

      // If quest, also create subquests and dialogue nodes
      if (questKey) {
        const subIdRes = await client.query("SELECT gen_random_uuid() AS id");
        const subId = subIdRes.rows[0].id;
        const subKey = `${questKey}/subquest/1`;

        await client.query(`
          INSERT INTO knowledge.quest_subquests (
            id, document_id, revision_id, quest_key, subquest_key, subquest_id,
            ordinal, title, objective, completeness, metadata
          ) VALUES ($1, $2, $3, $4, $5, 1, 1, $6, $7, 'complete', '{}'::jsonb)
        `, [subId, docId, REVISION_ID, questKey, subKey, doc.title, "完成剧情推进"]);

        // Parse conversation lines from content
        const lines = doc.content.split("\n");
        let ordinal = 1;
        for (const line of lines) {
          const trimmed = line.trim();
          if (
            !trimmed ||
            trimmed.startsWith("#") ||
            trimmed.startsWith("MainMissionID") ||
            trimmed.startsWith("类型：") ||
            trimmed.startsWith("章节：")
          ) {
            continue;
          }
          let speakerName: string | null = null;
          let body = trimmed;
          if (trimmed.includes("：") && !trimmed.startsWith("###")) {
            const parts = trimmed.split("：");
            speakerName = parts[0].trim();
            body = parts.slice(1).join("：").trim();
          }

          if (body) {
            await client.query(`
              INSERT INTO knowledge.quest_dialogue_nodes (
                id, document_id, revision_id, quest_key, subquest_key,
                node_key, node_id, node_type, speaker_key, speaker_name,
                body, ordinal, variants, metadata
              ) VALUES (
                gen_random_uuid(), $1, $2, $3, $4,
                $5, $6, 'dialogue', $7, $8,
                $9, $10, '[]'::jsonb, '{}'::jsonb
              )
            `, [
              docId,
              REVISION_ID,
              questKey,
              subKey,
              `${questKey}/node/${ordinal}`,
              ordinal,
              speakerName ? `speaker_${speakerName}` : null,
              speakerName,
              body,
              ordinal++,
            ]);
          }
        }
      }
    }

    await client.query("COMMIT");
    console.log(`\nSuccessfully ingested ${docsToInsert.length} documents into PostgreSQL!`);

    // 结构化资料（角色/光锥/遗器/敌人/材料/成就）在主事务提交后写入，
    // 失败不影响已提交的文档数据，且可幂等重跑。
    if (structuredCodex) {
      try {
        const stats = await persistStructuredCodex(pool, structuredCodex);
        console.log("Structured codex upserted:", JSON.stringify(stats));
      } catch (error) {
        console.error("Structured codex persistence failed:", error);
      }
    }
    return { ok: true, documents: docsToInsert.length, revisionId: REVISION_ID };
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Ingestion failed, rolled back:", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

// Direct execution
const isMain = process.argv[1]?.endsWith("ingest-starrail-full.ts");
if (isMain) {
  const options = parseArgs(process.argv.slice(2));
  runStarRailIngestion(options).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
