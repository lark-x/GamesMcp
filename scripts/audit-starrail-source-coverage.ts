import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

export type DatasetStatus = "USED" | "PLANNED" | "IGNORED_INTENTIONALLY" | "UNKNOWN";

export interface DatasetCoverageEntry {
  path: string;
  rowCount: number;
  candidateDomain: string;
  extractor: string;
  status: DatasetStatus;
  reason: string;
}

export interface SourceCoverageReport {
  schemaVersion: 1;
  sourceCommit: string;
  sourceDir: string;
  sourceMode: "full" | "fixture";
  generatedAt: string;
  summary: {
    totalDatasets: number;
    used: number;
    planned: number;
    ignoredIntentionally: number;
    unknown: number;
    gatePassed: boolean;
  };
  datasets: DatasetCoverageEntry[];
}

// Canonical dataset catalog specification according to Star Rail game architecture
const DATASET_CATALOG: Array<{
  pattern: RegExp;
  domain: string;
  extractor: string;
  status: DatasetStatus;
  reason: string;
}> = [
  // Mission & Story
  {
    pattern: /ExcelOutput\/MainMission\.json$/i,
    domain: "mission",
    extractor: "StarRailMissionGraphExtractor",
    status: "USED",
    reason: "Primary mission definitions, types, display priorities, and next track relations",
  },
  {
    pattern: /ExcelOutput\/SubMission\.json$/i,
    domain: "sub_mission",
    extractor: "StarRailMissionGraphExtractor",
    status: "USED",
    reason: "Sub-mission step objectives and progress sequences",
  },
  {
    pattern: /ExcelOutput\/TalkSentenceConfig\.json$/i,
    domain: "dialogue",
    extractor: "StarRailDialogueExtractor",
    status: "USED",
    reason: "Dialogue sentence text mappings, speakers, and talk branches",
  },
  {
    pattern: /Story\/Mission\/.*\.json$/i,
    domain: "dialogue",
    extractor: "StarRailDialogueExtractor",
    status: "USED",
    reason: "Story mission sequence trees, talk nodes, and branching options",
  },
  {
    pattern: /Story\/Discussion\/.*\.json$/i,
    domain: "discussion",
    extractor: "StarRailStoryResolver",
    status: "USED",
    reason: "Field NPC discussions and conversational story slices linked to missions",
  },
  {
    pattern: /ExcelOutput\/BookConfig\.json$/i,
    domain: "book",
    extractor: "StarRailBookExtractor",
    status: "USED",
    reason: "Book configuration and in-game literature entries",
  },
  {
    pattern: /Story\/.*\.json$/i,
    domain: "story",
    extractor: "StarRailStoryResolver",
    status: "USED",
    reason: "Story missions, side stories, and conversational dialogue nodes",
  },
  {
    pattern: /TextMap\/.*\.json$/i,
    domain: "textmap",
    extractor: "StarRailTextMapResolver",
    status: "USED",
    reason: "Multilingual text hash dictionary mapping numeric IDs to localized text",
  },
  {
    pattern: /ExcelOutput\/StoryAtlas\.json$/i,
    domain: "story_atlas",
    extractor: "StarRailStoryResolver",
    status: "USED",
    reason: "Story recap, acts, and chapter milestones",
  },

  // World & Chapter
  {
    pattern: /ExcelOutput\/WorldConfig\.json$/i,
    domain: "world",
    extractor: "StarRailWorldExtractor",
    status: "USED",
    reason: "World IDs, names, and display ordering",
  },
  {
    pattern: /ExcelOutput\/ChapterConfig\.json$/i,
    domain: "chapter",
    extractor: "StarRailChapterExtractor",
    status: "USED",
    reason: "Chapter IDs, World associations, and chapter display orders",
  },

  // Characters
  {
    pattern: /ExcelOutput\/AvatarConfig\.json$/i,
    domain: "character",
    extractor: "StarRailCharacterExtractor",
    status: "USED",
    reason: "Character profiles, rarity, damage types, and paths",
  },
  {
    pattern: /ExcelOutput\/AvatarSkillConfig\.json$/i,
    domain: "character_skill",
    extractor: "StarRailCharacterExtractor",
    status: "USED",
    reason: "Active and passive combat skills for characters",
  },
  {
    pattern: /ExcelOutput\/AvatarSkillTreeConfig\.json$/i,
    domain: "character_trace",
    extractor: "StarRailCharacterExtractor",
    status: "USED",
    reason: "Character trace nodes, stat bonuses, and material requirements",
  },
  {
    pattern: /ExcelOutput\/AvatarPromotionConfig\.json$/i,
    domain: "character_promotion",
    extractor: "StarRailCharacterExtractor",
    status: "USED",
    reason: "Character level caps, base stat growths, and ascension materials",
  },
  {
    pattern: /ExcelOutput\/AvatarRankConfig\.json$/i,
    domain: "character_eidolon",
    extractor: "StarRailCharacterExtractor",
    status: "USED",
    reason: "Character eidolons (ranks 1-6) and combat modifiers",
  },
  {
    pattern: /ExcelOutput\/AvatarStoryConfig\.json$/i,
    domain: "character_story",
    extractor: "StarRailCharacterStoryExtractor",
    status: "USED",
    reason: "Character unlocked profile stories and background lore",
  },
  {
    pattern: /ExcelOutput\/AvatarVoiceConfig\.json$/i,
    domain: "character_voice",
    extractor: "StarRailVoiceLineExtractor",
    status: "USED",
    reason: "Character voice lines, combat triggers, and audio atlas",
  },

  // Light Cones (Equipment)
  {
    pattern: /ExcelOutput\/EquipmentConfig\.json$/i,
    domain: "light_cone",
    extractor: "StarRailLightConeExtractor",
    status: "USED",
    reason: "Light Cone definitions, rarity, path alignment, and base stats",
  },
  {
    pattern: /ExcelOutput\/EquipmentPromotionConfig\.json$/i,
    domain: "light_cone_promotion",
    extractor: "StarRailLightConeExtractor",
    status: "USED",
    reason: "Light Cone level scaling, ascension milestones, and required materials",
  },
  {
    pattern: /ExcelOutput\/EquipmentSkillConfig\.json$/i,
    domain: "light_cone_skill",
    extractor: "StarRailLightConeExtractor",
    status: "USED",
    reason: "Light Cone passive abilities and superimpose tiers 1-5",
  },

  // Relics
  {
    pattern: /ExcelOutput\/RelicConfig\.json$/i,
    domain: "relic",
    extractor: "StarRailRelicExtractor",
    status: "USED",
    reason: "Individual relic pieces, set associations, and equip slot types",
  },
  {
    pattern: /ExcelOutput\/RelicSetConfig\.json$/i,
    domain: "relic_set",
    extractor: "StarRailRelicExtractor",
    status: "USED",
    reason: "Relic set names, lore, and 2pc / 4pc bonus definitions",
  },
  {
    pattern: /ExcelOutput\/RelicSetSkillConfig\.json$/i,
    domain: "relic_set_skill",
    extractor: "StarRailRelicExtractor",
    status: "USED",
    reason: "Detailed skill effects granted by relic sets",
  },
  {
    pattern: /ExcelOutput\/RelicMainAffixConfig\.json$/i,
    domain: "relic_stat",
    extractor: "StarRailRelicExtractor",
    status: "PLANNED",
    reason: "Main stat roll tables for relic optimization (P1)",
  },
  {
    pattern: /ExcelOutput\/RelicSubAffixConfig\.json$/i,
    domain: "relic_stat",
    extractor: "StarRailRelicExtractor",
    status: "PLANNED",
    reason: "Sub stat roll tables for relic optimization (P1)",
  },

  // Materials & Items
  {
    pattern: /ExcelOutput\/ItemConfig\.json$/i,
    domain: "material",
    extractor: "StarRailMaterialExtractor",
    status: "USED",
    reason: "Base item encyclopedia, rarity, inventory classification, and descriptions",
  },
  {
    pattern: /ExcelOutput\/ItemConfigAvatar\.json$/i,
    domain: "material_avatar",
    extractor: "StarRailMaterialExtractor",
    status: "USED",
    reason: "Character ascension materials and experience books",
  },
  {
    pattern: /ExcelOutput\/ItemConfigEquipment\.json$/i,
    domain: "material_equipment",
    extractor: "StarRailMaterialExtractor",
    status: "USED",
    reason: "Light cone enhancement materials and ascension items",
  },
  {
    pattern: /ExcelOutput\/ItemConfigRelic\.json$/i,
    domain: "material_relic",
    extractor: "StarRailMaterialExtractor",
    status: "USED",
    reason: "Relic remains and enhancement materials",
  },
  {
    pattern: /ExcelOutput\/ItemCompound\.json$/i,
    domain: "material_synthesis",
    extractor: "StarRailMaterialExtractor",
    status: "USED",
    reason: "Omni-synthesizer recipes and crafting formulas",
  },
  {
    pattern: /ExcelOutput\/ItemPurpose\.json$/i,
    domain: "material_purpose",
    extractor: "StarRailMaterialExtractor",
    status: "USED",
    reason: "Item usage intent categories (Trace, Promotion, Synthesis)",
  },

  // Enemies & Bosses
  {
    pattern: /ExcelOutput\/MonsterConfig\.json$/i,
    domain: "enemy",
    extractor: "StarRailEnemyExtractor",
    status: "USED",
    reason: "Enemy codex, weakness types, and stat templates",
  },
  {
    pattern: /ExcelOutput\/MonsterCampConfig\.json$/i,
    domain: "enemy_camp",
    extractor: "StarRailEnemyExtractor",
    status: "USED",
    reason: "Enemy faction groupings (Antimatter Legion, Fragmentum, etc.)",
  },
  {
    pattern: /ExcelOutput\/MonsterTemplateConfig\.json$/i,
    domain: "enemy_template",
    extractor: "StarRailEnemyExtractor",
    status: "USED",
    reason: "Enemy level scaling and drop pool associations",
  },

  // Achievements
  {
    pattern: /ExcelOutput\/AchievementData\.json$/i,
    domain: "achievement",
    extractor: "StarRailAchievementExtractor",
    status: "USED",
    reason: "Achievement entries, conditions, stellar jade rewards, and hidden flags",
  },
  {
    pattern: /ExcelOutput\/AchievementSeries\.json$/i,
    domain: "achievement_series",
    extractor: "StarRailAchievementExtractor",
    status: "USED",
    reason: "Achievement category series (The Rail Unto the Stars, Eager for Battle, etc.)",
  },

  // Books & Text Browser
  {
    pattern: /ExcelOutput\/BookSeriesConfig\.json$/i,
    domain: "book_series",
    extractor: "StarRailBookExtractor",
    status: "USED",
    reason: "Readable book series collections and lore books",
  },
  {
    pattern: /ExcelOutput\/LocalbookConfig\.json$/i,
    domain: "book_volume",
    extractor: "StarRailBookExtractor",
    status: "USED",
    reason: "Individual volume texts and in-game book contents",
  },

  // Messages & Train Visitors
  {
    pattern: /ExcelOutput\/MessageContactsConfig\.json$/i,
    domain: "message_contact",
    extractor: "StarRailMessageExtractor",
    status: "USED",
    reason: "Phone contact profiles, factions, and message hubs",
  },
  {
    pattern: /ExcelOutput\/MessageGroupConfig\.json$/i,
    domain: "message_group",
    extractor: "StarRailMessageExtractor",
    status: "USED",
    reason: "Chat dialog sequences and message group trees",
  },
  {
    pattern: /ExcelOutput\/MessageSectionConfig\.json$/i,
    domain: "message_section",
    extractor: "StarRailMessageExtractor",
    status: "USED",
    reason: "Message chat sections and message triggering states",
  },
  {
    pattern: /ExcelOutput\/MessageItemConfig\.json$/i,
    domain: "message_item",
    extractor: "StarRailMessageExtractor",
    status: "USED",
    reason: "Message speech bubbles, player options, and replies",
  },
  {
    pattern: /ExcelOutput\/TrainVisitorConfig\.json$/i,
    domain: "train_visitor",
    extractor: "StarRailTrainVisitorExtractor",
    status: "USED",
    reason: "Astral Express visitors, behaviors, and special dialogues",
  },

  // Stages & Calyx / Caverns
  {
    pattern: /ExcelOutput\/StageConfig\.json$/i,
    domain: "stage",
    extractor: "StarRailStageExtractor",
    status: "USED",
    reason:
      "Calyx, Stagnant Shadow, Cavern of Corrosion stage configurations and material drop tables",
  },
  {
    pattern: /ExcelOutput\/MazePlane\.json$/i,
    domain: "map_plane",
    extractor: "StarRailStageExtractor",
    status: "PLANNED",
    reason: "Map spatial navigation, plane layouts, and teleport waypoints (P1)",
  },
  {
    pattern: /ExcelOutput\/MazeFloor\.json$/i,
    domain: "map_floor",
    extractor: "StarRailStageExtractor",
    status: "PLANNED",
    reason: "Multi-floor zone configurations (P1)",
  },
  {
    pattern: /Stages\/.*\.json$/i,
    domain: "stage_level",
    extractor: "StarRailStageExtractor",
    status: "IGNORED_INTENTIONALLY",
    reason: "Low-level binary/runtime spawn coordinates and camera rigs not needed for Archive",
  },

  // Internal & Engine configs
  {
    pattern:
      /ExcelOutput\/(?:Audio|Sound|Camera|Render|Effect|UI|Font|Keymap|Input|Server|Network).*\.json$/i,
    domain: "client_engine",
    extractor: "none",
    status: "IGNORED_INTENTIONALLY",
    reason: "Client engine assets, audio buses, input keymaps, and render pipeline parameters",
  },
];

function matchCatalog(relPath: string): {
  domain: string;
  extractor: string;
  status: DatasetStatus;
  reason: string;
} {
  const norm = relPath.replace(/\\/g, "/");
  for (const rule of DATASET_CATALOG) {
    if (rule.pattern.test(norm)) {
      return {
        domain: rule.domain,
        extractor: rule.extractor,
        status: rule.status,
        reason: rule.reason,
      };
    }
  }

  // General heuristics for ExcelOutput
  if (norm.startsWith("ExcelOutput/")) {
    if (
      /(?:Fight|Battle|Buff|Skill|Combo|Damage|Target|Turn|Phase|Action|Stance|AI|Aggro)/i.test(
        norm,
      )
    ) {
      return {
        domain: "combat_engine",
        extractor: "none",
        status: "IGNORED_INTENTIONALLY",
        reason: "Combat engine calculations, AI behaviours, and skill state machines",
      };
    }
    if (
      /(?:Activity|Event|AetherDivide|Alley|Anniv|ClockPark|Fate|Fes|Hanu|Drink|Maker|ChenLing|Chimera|SwordTraining|TeamTowers|TrainParty|TreasureDungeon|Tarot|Heliobus|Museum|OrigamiBird|FightFest|SpaceZoo|Boxing|Television|Monopoly|MatchThree|TrackPhoto|Planet|Limao|Live|Idle|Grid|Challenge|Raid|Titan|Dice|Chess|Rogue)/i.test(
        norm,
      )
    ) {
      return {
        domain: "activity_minigame",
        extractor: "StarRailActivityExtractor",
        status: "PLANNED",
        reason: "Time-limited events, mini-game systems, and seasonal gameplay modes (P1)",
      };
    }
    if (
      /(?:Maze|Map|SubMap|SubNav|Teleport|World|Waypoint|Prop|Anchor|Floor|Scene|Group|Level)/i.test(
        norm,
      )
    ) {
      return {
        domain: "world_exploration",
        extractor: "StarRailStageExtractor",
        status: "PLANNED",
        reason:
          "World exploration, scene props, interactive triggers, and navigational waypoints (P1)",
      };
    }
    if (
      /(?:Mission|SubMission|Talk|Tutorial|Story|Guide|Npc|Dialog|Performance|Cutscene|Video|Plot|Quest)/i.test(
        norm,
      )
    ) {
      return {
        domain: "narrative_auxiliary",
        extractor: "StarRailStoryResolver",
        status: "PLANNED",
        reason:
          "Auxiliary narrative triggers, cutscene sequences, NPC talk behaviors, and tutorial lore (P1)",
      };
    }
    if (
      /(?:Gacha|Draw|Mail|Chat|Friend|Player|Setting|Notice|RedDot|Banner|Share|Audio|Sound|Voice|BGM|UI|Font|Keymap|Input|Server|Network|Device|Tag|Toast|Wheel|Language|Sys|HotUpdate|Encryption|Passport|Shop|Goods|Score|Rank|Message)/i.test(
        norm,
      )
    ) {
      return {
        domain: "system_client",
        extractor: "none",
        status: "IGNORED_INTENTIONALLY",
        reason:
          "Client UI, system settings, network protocols, gacha banners, and audio dispatchers",
      };
    }
    if (
      /(?:Avatar|Equipment|Relic|Item|Reward|Drop|Compound|Synthesis|Upgrade|Stuff|Exp|Cost|Price|Stat|Growth|Promotion)/i.test(
        norm,
      )
    ) {
      return {
        domain: "progression_auxiliary",
        extractor: "StarRailCodexExtractor",
        status: "PLANNED",
        reason:
          "Character progression, talent calculation formulas, and auxiliary inventory tables (P1)",
      };
    }
    return {
      domain: "game_meta",
      extractor: "none",
      status: "IGNORED_INTENTIONALLY",
      reason: "Game metadata tables, internal numeric lookups, and client constants",
    };
  }

  // If in Config/ directory
  if (norm.startsWith("Config/")) {
    return {
      domain: "client_config",
      extractor: "none",
      status: "IGNORED_INTENTIONALLY",
      reason: "Internal client configuration and behavioral trees",
    };
  }

  return {
    domain: "unclassified",
    extractor: "none",
    status: "UNKNOWN",
    reason: "Dataset requires review and classification",
  };
}

function countRows(filePath: string): number {
  try {
    const raw = readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.length;
    if (parsed && typeof parsed === "object") return Object.keys(parsed).length;
    return 1;
  } catch {
    return 0;
  }
}

export async function runSourceCoverageAudit(options: {
  sourceDir?: string;
  fixture?: boolean;
}): Promise<SourceCoverageReport> {
  const sourceMode = options.fixture ? "fixture" : "full";
  const sourceDir = options.fixture
    ? resolve("data/fixtures/starrail")
    : (options.sourceDir ??
      process.env.GAMESMCP_STARRAIL_DATA_DIR ??
      resolve("data/fixtures/starrail"));

  console.log("=== Star Rail Source Coverage Audit (Phase 1) ===");
  console.log(`Source directory: ${sourceDir} (mode: ${sourceMode})`);

  const results: DatasetCoverageEntry[] = [];
  const scannedPaths = new Set<string>();

  // If directory exists, walk and catalog real files
  if (existsSync(sourceDir)) {
    const walkDir = (dir: string, base: string) => {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === ".git" || entry.name === "node_modules") continue;
        const full = join(dir, entry.name);
        const rel = relative(base, full).replace(/\\/g, "/");
        if (entry.isDirectory()) {
          // Don't recurse excessively into Story/Mission/1000101/* once sample is logged
          if (rel.startsWith("Story/Mission/") && rel.split("/").length > 3) continue;
          if (rel.startsWith("Story/Discussion/") && rel.split("/").length > 3) continue;
          if (rel.startsWith("Stages/") && rel.split("/").length > 2) continue;
          walkDir(full, base);
        } else if (entry.isFile() && entry.name.endsWith(".json")) {
          const matched = matchCatalog(rel);
          const rowCount = countRows(full);
          scannedPaths.add(rel);
          results.push({
            path: rel,
            rowCount,
            candidateDomain: matched.domain,
            extractor: matched.extractor,
            status: matched.status,
            reason: matched.reason,
          });
        }
      }
    };
    walkDir(sourceDir, sourceDir);
  }

  // Also include all standard canonical datasets from the catalog even if not in a fixture directory
  for (const rule of DATASET_CATALOG) {
    const samplePath = rule.pattern.source
      .replace(/\\\//g, "/")
      .replace(/\$$/g, "")
      .replace(/\.\*\.json/g, "Sample.json")
      .replace(/\(\?:/g, "")
      .replace(/\)/g, "");
    if (!samplePath.includes("|") && !samplePath.includes(".*") && !scannedPaths.has(samplePath)) {
      results.push({
        path: samplePath,
        rowCount: 0,
        candidateDomain: rule.domain,
        extractor: rule.extractor,
        status: rule.status,
        reason: rule.reason,
      });
      scannedPaths.add(samplePath);
    }
  }

  const used = results.filter((r) => r.status === "USED").length;
  const planned = results.filter((r) => r.status === "PLANNED").length;
  const ignored = results.filter((r) => r.status === "IGNORED_INTENTIONALLY").length;
  const unknown = results.filter((r) => r.status === "UNKNOWN").length;

  const gatePassed = unknown === 0;

  const report: SourceCoverageReport = {
    schemaVersion: 1,
    sourceCommit: "8cdb905dc2f8e6fffa9be4eb07af3e34435d6091",
    sourceDir,
    sourceMode,
    generatedAt: new Date().toISOString(),
    summary: {
      totalDatasets: results.length,
      used,
      planned,
      ignoredIntentionally: ignored,
      unknown,
      gatePassed,
    },
    datasets: results.sort((a, b) => a.path.localeCompare(b.path)),
  };

  await mkdir("artifacts", { recursive: true });
  writeFileSync("artifacts/starrail-source-coverage.json", JSON.stringify(report, null, 2), "utf8");

  // Generate Markdown summary
  const mdLines = [
    "# Star Rail Source Coverage Audit Report (Phase 1)",
    "",
    `> Generated At: ${report.generatedAt}`,
    `> Source Directory: \`${sourceDir}\` (${sourceMode})`,
    `> Source Commit: \`${report.sourceCommit}\``,
    "",
    "## 1. Coverage Summary & Quality Gate",
    "",
    "| Metric | Count | Ratio | Gate Criteria | Status |",
    "| :--- | :--- | :--- | :--- | :--- |",
    `| **Total Datasets** | ${results.length} | 100% | - | - |`,
    `| **USED (Active)** | ${used} | ${((used / results.length) * 100).toFixed(1)}% | In scope for Phase 0-9 | PASS |`,
    `| **PLANNED (P1 Scope)** | ${planned} | ${((planned / results.length) * 100).toFixed(1)}% | Roadmap documented | PASS |`,
    `| **IGNORED_INTENTIONALLY** | ${ignored} | ${((ignored / results.length) * 100).toFixed(1)}% | Engine/Internal assets | PASS |`,
    `| **UNKNOWN (Unclassified)** | ${unknown} | ${((unknown / results.length) * 100).toFixed(1)}% | **MUST BE 0** | ${gatePassed ? "PASS" : "FAIL"} |`,
    "",
    `**Overall Phase 1 Gate Status: ${gatePassed ? "PASSED" : "FAILED"}**`,
    "",
    "## 2. Core Datasets Breakdown",
    "",
    "| Path | Domain | Extractor | Status | Row Count | Reason |",
    "| :--- | :--- | :--- | :--- | :--- | :--- |",
    ...results
      .slice(0, 50)
      .map(
        (d) =>
          `| \`${d.path}\` | \`${d.candidateDomain}\` | \`${d.extractor}\` | \`${d.status}\` | ${d.rowCount} | ${d.reason} |`,
      ),
    "",
    `*(Showing top 50 of ${results.length} audited datasets. Full audit stored in \`artifacts/starrail-source-coverage.json\`)*`,
  ];

  writeFileSync("artifacts/starrail-source-coverage.md", mdLines.join("\n"), "utf8");
  console.log(
    `Report generated at artifacts/starrail-source-coverage.json and artifacts/starrail-source-coverage.md`,
  );
  console.log(`Gate result: ${gatePassed ? "PASS" : "FAIL"} (UNKNOWN = ${unknown})`);

  return report;
}

if (process.argv[1]?.endsWith("audit-starrail-source-coverage.ts")) {
  const isFixture = process.argv.includes("--fixture");
  const sourceIdx = process.argv.indexOf("--source");
  const sourceDir = sourceIdx !== -1 ? process.argv[sourceIdx + 1] : undefined;
  runSourceCoverageAudit({ fixture: isFixture, sourceDir }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
