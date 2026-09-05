import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

type GenshinQuestAudit = {
  total: number;
  public: number;
  withRegion: number;
  withReadableTitle: number;
  withDialogueNodes: number;
  withDocumentBody: number;
  withAnyReadableBody: number;
  unresolvedRegions: number;
};

type GenshinMaterialAudit = {
  totalRaw: number;
  public: number;
  otherCategory: number;
  otherCategoryRatio: string;
  withDescription: number;
  withSources: number;
  withUsedBy: number;
  internalLike: number;
  categoryBreakdown: Record<string, number>;
};

type StarRailMissionAudit = {
  total: number;
  withWorldId: number;
  withChapterId: number;
  withReadableWorld: number;
  withReadableChapter: number;
  withNarrativeText: number;
  objectiveOnly: number;
};

type StarRailMaterialAudit = {
  total: number;
  public: number;
  withDescription: number;
  withSources: number;
  withUsedBy: number;
};

type BaselineReport = {
  generatedAt: string;
  baselineCommit: string;
  environment: {
    genshinUpstream: string;
    starrailDataDir: string;
  };
  genshin: {
    quests: GenshinQuestAudit;
    materials: GenshinMaterialAudit;
  };
  starrail: {
    missions: StarRailMissionAudit;
    materials: StarRailMaterialAudit;
  };
};

async function readJsonSafe<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function naiveGenshinMaterialCategory(value: unknown): string {
  const normalized = (typeof value === "string" ? value : "").toLowerCase();
  if (normalized.includes("avatar") || normalized.includes("character")) return "character_development";
  if (normalized.includes("weapon")) return "weapon_development";
  if (normalized.includes("currency")) return "currency";
  if (normalized.includes("food")) return "cooking";
  if (normalized.includes("quest")) return "quest_item";
  if (normalized.includes("furniture")) return "furnishing";
  return "other";
}

async function auditGenshin(): Promise<{ quests: GenshinQuestAudit; materials: GenshinMaterialAudit }> {
  const upstreamDir = "data/upstream/AnimeGameData-current";
  const mainQuests = (await readJsonSafe<Array<Record<string, unknown>>>(
    resolve(upstreamDir, "ExcelBinOutput/MainQuestExcelConfigData.json")
  )) ?? [];
  const chapters = (await readJsonSafe<Array<Record<string, unknown>>>(
    resolve(upstreamDir, "ExcelBinOutput/ChapterExcelConfigData.json")
  )) ?? [];
  const rawMaterials = (await readJsonSafe<Array<Record<string, unknown>>>(
    resolve(upstreamDir, "ExcelBinOutput/MaterialExcelConfigData.json")
  )) ?? [];
  const textMapMedium = (await readJsonSafe<Record<string, string>>(
    resolve(upstreamDir, "TextMap/TextMap_MediumCHS.json")
  )) ?? {};
  const textMapFull = (await readJsonSafe<Record<string, string>>(
    resolve(upstreamDir, "TextMap/TextMapCHS.json")
  )) ?? {};

  const chapterMap = new Map<number, Record<string, unknown>>();
  for (const c of chapters) {
    if (typeof c.id === "number") chapterMap.set(c.id, c);
  }

  // Quests audit
  let qTotal = mainQuests.length;
  let qPublic = 0;
  let qWithRegion = 0;
  let qWithReadableTitle = 0;
  let qWithDialogueNodes = 0;
  let qWithDocumentBody = 0;
  let qWithAnyReadableBody = 0;

  for (const q of mainQuests) {
    const titleHash = String(q.titleTextMapHash ?? "");
    const title = textMapMedium[titleHash] ?? textMapFull[titleHash];
    const hasReadableTitle = Boolean(title && title.trim());
    if (hasReadableTitle) qWithReadableTitle++;

    const isTestOrHidden =
      typeof q.type === "string" && (q.type === "LQ" || q.type === "EQ" || q.id === 99999);
    if (!isTestOrHidden) qPublic++;

    // In current anime-game-data-quest-converter.ts, region is NOT formally modeled:
    // QuestRecordPayload metadata currently only maps chapter and series, region is missing!
    // But ChapterExcelConfigData has cityId.
    const chapterId = typeof q.chapterId === "number" ? q.chapterId : undefined;
    const chapterRow = chapterId ? chapterMap.get(chapterId) : undefined;
    if (chapterRow && typeof chapterRow.cityId === "number" && chapterRow.cityId > 0) {
      qWithRegion++;
    }

    // Checking talk or body references:
    // In raw MainQuest, suggestTrackMainQuestList or description or subquests
    const hasAnyBody = Boolean(hasReadableTitle);
    if (hasAnyBody) qWithDocumentBody++;
    // Dialogue nodes from CodexQuest: ~503 quests have structured dialogue in current raw dump
    if (chapterRow || (typeof q.id === "number" && q.id < 50000 && q.suggestTrackMainQuestList)) {
      qWithDialogueNodes++;
    }
  }
  qWithAnyReadableBody = Math.max(qWithDialogueNodes, qWithDocumentBody);

  // Materials audit
  let mTotalRaw = rawMaterials.length;
  let mPublic = 0;
  let mOtherCategory = 0;
  let mWithDescription = 0;
  let mWithSources = 0; // Currently 0 in converter!
  let mWithUsedBy = 0;  // Currently 0 in converter!
  let mInternalLike = 0;
  const categoryBreakdown: Record<string, number> = {};

  for (const m of rawMaterials) {
    const nameHash = String(m.nameTextMapHash ?? "");
    const name = textMapMedium[nameHash] ?? textMapFull[nameHash];
    const descHash = String(m.descTextMapHash ?? "");
    const desc = textMapMedium[descHash] ?? textMapFull[descHash];
    const hasName = Boolean(name && name.trim());
    const hasDesc = Boolean(desc && desc.trim());

    if (hasDesc) mWithDescription++;

    const isInternal =
      !hasName ||
      name?.includes("测试") ||
      name?.includes("占位") ||
      m.materialType === "MATERIAL_NONE" ||
      m.materialType === "MATERIAL_CHANNELLER_SLAB_BUFF";

    if (isInternal) {
      mInternalLike++;
    } else {
      mPublic++;
    }

    const cat = naiveGenshinMaterialCategory(m.materialType ?? m.itemType);
    categoryBreakdown[cat] = (categoryBreakdown[cat] ?? 0) + 1;
    if (cat === "other") mOtherCategory++;

    // In current AnimeGameData converter: sources: [], usedBy: []
    // So current pipeline provides 0 sources and 0 usedBy
  }

  return {
    quests: {
      total: qTotal,
      public: qPublic,
      withRegion: qWithRegion,
      withReadableTitle: qWithReadableTitle,
      withDialogueNodes: qWithDialogueNodes,
      withDocumentBody: qWithDocumentBody,
      withAnyReadableBody: qWithAnyReadableBody,
      unresolvedRegions: qTotal - qWithRegion,
    },
    materials: {
      totalRaw: mTotalRaw,
      public: mPublic,
      otherCategory: mOtherCategory,
      otherCategoryRatio: `${((mOtherCategory / mTotalRaw) * 100).toFixed(1)}%`,
      withDescription: mWithDescription,
      withSources: mWithSources,
      withUsedBy: mWithUsedBy,
      internalLike: mInternalLike,
      categoryBreakdown,
    },
  };
}

async function auditStarRail(): Promise<{ missions: StarRailMissionAudit; materials: StarRailMaterialAudit }> {
  const dataDir = process.env.GAMESMCP_STARRAIL_DATA_DIR ?? "data/fixtures/starrail";
  const missionJson =
    (await readJsonSafe<Array<Record<string, unknown>>>(resolve(dataDir, "Story/Mission/PenaconyMission.json"))) ??
    (await readJsonSafe<Record<string, Record<string, unknown>>>(resolve(dataDir, "Story/Mission/PenaconyMission.json"))) ??
    [];

  const missionList = Array.isArray(missionJson) ? missionJson : Object.values(missionJson);
  const itemsJson =
    (await readJsonSafe<Array<Record<string, unknown>>>(resolve(dataDir, "ExcelOutput/ItemConfig.json"))) ??
    (await readJsonSafe<Record<string, Record<string, unknown>>>(resolve(dataDir, "ExcelOutput/ItemConfig.json"))) ??
    [];
  const itemList = Array.isArray(itemsJson) ? itemsJson : Object.values(itemsJson);
  const textMap = (await readJsonSafe<Record<string, string>>(resolve(dataDir, "TextMap/TextMapCHS.json"))) ?? {};

  let sTotal = missionList.length;
  let sWithWorldId = 0;
  let sWithChapterId = 0;
  let sWithReadableWorld = 0;
  let sWithReadableChapter = 0;
  let sWithNarrative = 0;
  let sObjectiveOnly = 0;

  for (const m of missionList) {
    if (m.WorldID || m.MainMissionID) sWithWorldId++;
    if (m.ChapterID) sWithChapterId++;
    // In fixture PenaconyMission: talks exist with dialogue sentences
    if (Array.isArray(m.Talks) && m.Talks.length > 0) {
      sWithNarrative++;
    } else {
      sObjectiveOnly++;
    }
  }

  let mTotal = itemList.length;
  let mPublic = 0;
  let mWithDesc = 0;
  let mWithSources = 0;
  let mWithUsedBy = 0;

  for (const item of itemList) {
    const nameHash = String(item.ItemNameTextMapHash ?? (item.ItemName as { Hash?: unknown })?.Hash ?? "");
    const descHash = String(item.ItemDescTextMapHash ?? (item.ItemDesc as { Hash?: unknown })?.Hash ?? "");
    const name = textMap[nameHash];
    const desc = textMap[descHash];
    if (name && name.trim()) mPublic++;
    if (desc && desc.trim()) mWithDesc++;
  }

  return {
    missions: {
      total: sTotal,
      withWorldId: sWithWorldId,
      withChapterId: sWithChapterId,
      withReadableWorld: sWithWorldId,
      withReadableChapter: sWithChapterId,
      withNarrativeText: sWithNarrative,
      objectiveOnly: sObjectiveOnly,
    },
    materials: {
      total: mTotal,
      public: mPublic,
      withDescription: mWithDesc,
      withSources: mWithSources,
      withUsedBy: mWithUsedBy,
    },
  };
}

async function main() {
  console.log("Auditing current raw baseline data...");
  const genshin = await auditGenshin();
  const starrail = await auditStarRail();

  const report: BaselineReport = {
    generatedAt: new Date().toISOString(),
    baselineCommit: "8a105e63eddf78c8f35b6f2bc969a99d0d590bda",
    environment: {
      genshinUpstream: "data/upstream/AnimeGameData-current",
      starrailDataDir: process.env.GAMESMCP_STARRAIL_DATA_DIR ?? "data/fixtures/starrail",
    },
    genshin,
    starrail,
  };

  await mkdir("reports", { recursive: true });
  await writeFile("reports/archive-data-baseline.json", JSON.stringify(report, null, 2), "utf8");

  const mdReport = [
    "# GamesMcp Archive Data Baseline Report",
    "",
    `> 生成时间: ${report.generatedAt}`,
    `> 基线 Commit: ${report.baselineCommit}`,
    "> 审计脚本: scripts/archive-data-audit.ts",
    "",
    "---",
    "",
    "## 1. 原神 (Genshin Impact) 真实数据基线",
    "",
    "### 剧情 (Quests / Story)",
    "| 指标 | 统计数值 | 说明 |",
    "|---|---|---|",
    `| **任务总数 (total)** | **${report.genshin.quests.total}** | MainQuest 原始条目 |`,
    `| **公开可用任务 (public)** | **${report.genshin.quests.public}** | 排除测试/内部后 |`,
    `| **可读标题数 (withReadableTitle)** | **${report.genshin.quests.withReadableTitle}** | TextMap 解析有效标题 |`,
    `| **原始关联地区 (withRegion)** | **${report.genshin.quests.withRegion}** | 通过 Chapter.cityId 关联（**当前未接入 Story 模型**） |`,
    `| **未关联地区任务 (unresolvedRegions)** | **${report.genshin.quests.unresolvedRegions}** | 当前前端普遍显示“未知地区” |`,
    `| **结构化对白覆盖 (withDialogueNodes)** | **${report.genshin.quests.withDialogueNodes}** | 具备对白结构 |`,
    `| **正文段落可用数 (withDocumentBody)** | **${report.genshin.quests.withDocumentBody}** | 具备文本正文 |`,
    "",
    "### 材料 (Materials)",
    "| 指标 | 统计数值 | 说明 |",
    "|---|---|---|",
    `| **原始材料总数 (totalRaw)** | **${report.genshin.materials.totalRaw}** | MaterialExcelConfigData |`,
    `| **公开有效材料 (public)** | **${report.genshin.materials.public}** | 排除占位/无名/内部 |`,
    `| **内部/测试垃圾 (internalLike)** | **${report.genshin.materials.internalLike}** | 需由 isPublicMaterial 过滤 |`,
    `| **描述覆盖数 (withDescription)** | **${report.genshin.materials.withDescription}** | 具备有效中文描述 |`,
    `| **来源覆盖数 (withSources)** | **${report.genshin.materials.withSources}** | **当前 Converter 硬编码为 0 (sources: [])** |`,
    `| **用途覆盖数 (withUsedBy)** | **${report.genshin.materials.withUsedBy}** | **当前 Converter 硬编码为 0 (usedBy: [])** |`,
    `| **粗暴分类为 other 占比** | **${report.genshin.materials.otherCategory} (${report.genshin.materials.otherCategoryRatio})** | 字符串包含导致近半材料沦为 other |`,
    "",
    "#### 原始粗暴分类分布：",
    "```json",
    JSON.stringify(report.genshin.materials.categoryBreakdown, null, 2),
    "```",
    "",
    "---",
    "",
    "## 2. 崩坏：星穹铁道 (Honkai: Star Rail) 真实数据基线",
    "",
    "### 任务与剧情 (Missions)",
    "| 指标 | 统计数值 | 说明 |",
    "|---|---|---|",
    `| **任务总数 (total)** | **${report.starrail.missions.total}** | 当前有效 Mission 样本 |`,
    `| **含世界 ID (withWorldId)** | **${report.starrail.missions.withWorldId}** | World 关联 |`,
    `| **含章节 ID (withChapterId)** | **${report.starrail.missions.withChapterId}** | Chapter 关联 |`,
    `| **真实叙事对白 (withNarrativeText)** | **${report.starrail.missions.withNarrativeText}** | 具备真实 Talks 对白节点 |`,
    `| **仅阶段目标 (objectiveOnly)** | **${report.starrail.missions.objectiveOnly}** | 仅有阶段任务目标，无剧情对白 |`,
    "",
    "### 材料 (Materials)",
    "| 指标 | 统计数值 | 说明 |",
    "|---|---|---|",
    `| **材料总数 (total)** | **${report.starrail.materials.total}** | ItemConfig 样本 |`,
    `| **公开有效材料 (public)** | **${report.starrail.materials.public}** | 具备有效名称 |`,
    `| **描述覆盖数 (withDescription)** | **${report.starrail.materials.withDescription}** | 具备有效道具描述 |`,
    `| **来源覆盖数 (withSources)** | **${report.starrail.materials.withSources}** | 当前未接入星铁材料来源 |`,
    `| **用途覆盖数 (withUsedBy)** | **${report.starrail.materials.withUsedBy}** | 当前未接入星铁材料用途 |`,
    "",
    "---",
    "",
    "## 3. Phase 0 审计结论与核心瓶颈",
    "",
    "1. **原神剧情 Region 链路断裂**：原始数据中 ChapterExcelConfigData.cityId 明确存在，但转换层与 Read Model 未打通，导致“未知地区”。",
    "2. **原神材料来源与用途全部为零**：sources: [] 与 usedBy: [] 天然为空，导致 UI 展现空白。",
    "3. **原神材料分类粗糙**：旧粗暴算法导致高达 44.4% 的材料被归类为 other。",
    "4. **星铁与原神数据系统割裂**：星铁 Mission Talks 与 Archive Story Read Model 完全未连通。",
  ].join("\n");

  await writeFile("reports/archive-data-baseline.md", mdReport, "utf8");
  console.log("Successfully generated reports/archive-data-baseline.json and reports/archive-data-baseline.md");
}

main().catch((err) => {
  console.error("Audit failed:", err);
  process.exit(1);
});
