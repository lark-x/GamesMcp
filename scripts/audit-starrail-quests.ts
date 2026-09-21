import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildStarRailInventory } from "../packages/providers/src/starrail/source/inventory.js";
import { readStarRailSourceSnapshot } from "../packages/providers/src/starrail/source/snapshot.js";
import { StarRailTextMapResolver } from "../packages/providers/src/starrail/source/textmap.js";
import { StarRailWorldChapterResolver } from "../packages/providers/src/starrail/structured/world-chapter.js";
import { StarRailStoryResolver } from "../packages/providers/src/starrail/structured/story-resolver.js";
import type { StarRailStoryQuest } from "../packages/providers/src/starrail/structured/types.js";

type QuestAuditRow = {
  mainMissionId: number;
  title: string;
  type: string;
  visibility: string;
  completeness: string;
  qualityCode?: string;
  world?: string;
  chapter?: string;
  family?: string;
  familyId?: string;
  contentRole?: string;
  dialogueResolutionStatus?: string;
  storyOrder?: number;
  sourceBindingCount: number;
  relationEdgeCount: number;
  previousMissionIds: number[];
  nextMissionIds: number[];
  subMissionCount: number;
  dialogueNodeCount: number;
  dialogueSourceFiles: string[];
  reason: string;
};

function parseArgs(argv: string[]): { sourceDir: string; outputPrefix: string } {
  const sourceIndex = argv.indexOf("--source");
  const outputIndex = argv.indexOf("--output");
  const sourceFlag = argv.find((value) => value.startsWith("--source="));
  const outputFlag = argv.find((value) => value.startsWith("--output="));
  return {
    sourceDir: resolve(
      sourceFlag?.slice("--source=".length) ??
        (sourceIndex >= 0 ? argv[sourceIndex + 1] : undefined) ??
        "data/fixtures/starrail",
    ),
    outputPrefix:
      outputFlag?.slice("--output=".length) ??
      (outputIndex >= 0 ? argv[outputIndex + 1] : undefined) ??
      "reports/starrail-quest-audit-r2",
  };
}

function rawQuestRow(quest: StarRailStoryQuest): QuestAuditRow {
  const sourceFiles = Array.isArray(quest.provenance.dialogueSourceFiles)
    ? quest.provenance.dialogueSourceFiles.filter(
        (value): value is string => typeof value === "string",
      )
    : [...new Set(quest.dialogueNodes.map((node) => node.sourceFile))];
  const reason =
    quest.contentRole === "control"
      ? "Branch 控制/状态记录，不作为公开剧情对白"
      : quest.contentRole === "aggregate"
        ? "主任务聚合节点，本身没有对白来源"
        : quest.completeness === "complete"
          ? quest.qualityCode === "speaker_unresolved"
            ? "对白完整，但部分对白没有可确认的角色名"
            : "标题、章节和对白均有精确来源"
          : quest.completeness === "partial"
            ? "存在精确对白来源，但标题/章节/来源字段不完整"
            : quest.completeness === "metadata_only"
              ? "只有 MainMission/SubMission 元数据，没有精确对白节点"
              : quest.visibility === "internal"
                ? "Branch 内部状态记录，不作为公开剧情任务"
                : "没有标题、子任务或精确对白来源";
  return {
    mainMissionId: quest.mainMissionId,
    title: quest.title,
    type: quest.type,
    visibility: quest.visibility,
    completeness: quest.completeness,
    qualityCode: quest.qualityCode,
    world: quest.worldTitle,
    chapter: quest.chapterTitle,
    family: quest.storyFamilyTitle,
    familyId: quest.storyFamilyId,
    contentRole: quest.contentRole,
    dialogueResolutionStatus: quest.dialogueResolutionStatus,
    storyOrder: quest.topology?.storyOrder,
    sourceBindingCount: Array.isArray(quest.provenance.sourceBindings)
      ? quest.provenance.sourceBindings.length
      : 0,
    relationEdgeCount: quest.questRelationEdges?.length ?? 0,
    previousMissionIds: quest.previousMissionIds,
    nextMissionIds: quest.nextMissionIds,
    subMissionCount: quest.subMissions.length,
    dialogueNodeCount: quest.dialogueNodes.length,
    dialogueSourceFiles: sourceFiles,
    reason,
  };
}

async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const snapshot = await readStarRailSourceSnapshot(options.sourceDir);
  const inventory = await buildStarRailInventory({
    dataDir: options.sourceDir,
    sourceRef: snapshot.ref,
  });
  const resolver = new StarRailTextMapResolver({
    dataDir: options.sourceDir,
    inventory,
    locale: "CHS",
  });
  await resolver.load();
  const worldChapterResolver = new StarRailWorldChapterResolver({
    dataDir: options.sourceDir,
    resolver,
  });
  const result = await new StarRailStoryResolver({
    dataDir: options.sourceDir,
    sourceRef: snapshot.ref,
    inventory,
    resolver,
    worldChapterResolver,
  }).resolveQuests();

  const rawMissions = JSON.parse(
    readFileSync(resolve(options.sourceDir, "ExcelOutput/MainMission.json"), "utf8"),
  ) as Array<Record<string, unknown>>;
  const typeCounts: Record<string, number> = {};
  for (const mission of rawMissions) {
    const type = String(mission.Type ?? "unknown");
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;
  }

  const quests = result.quests.map(rawQuestRow);
  const counts = (key: keyof QuestAuditRow): Record<string, number> => {
    const output: Record<string, number> = {};
    for (const quest of quests) {
      const value = String(quest[key] ?? "unknown");
      output[value] = (output[value] ?? 0) + 1;
    }
    return output;
  };
  const titleGroups = new Map<string, QuestAuditRow[]>();
  for (const quest of quests) {
    const list = titleGroups.get(quest.title) ?? [];
    list.push(quest);
    titleGroups.set(quest.title, list);
  }
  const duplicateTitles = [...titleGroups.entries()]
    .filter(([, rows]) => rows.length > 1 && rows.some((row) => row.visibility === "public"))
    .map(([title, rows]) => ({
      title,
      missions: rows.map((row) => ({
        id: row.mainMissionId,
        type: row.type,
        family: row.family,
        chapter: row.chapter,
        dialogueNodeCount: row.dialogueNodeCount,
      })),
    }))
    .sort((a, b) => a.title.localeCompare(b.title, "zh-Hans-CN"));

  const report = {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    source: {
      directory: options.sourceDir,
      commit: snapshot.ref,
      files: inventory.totals.files,
      storyMissionFiles: inventory.items.filter(
        (item) => item.path.startsWith("Story/Mission/") && item.path.endsWith(".json"),
      ).length,
      storyDiscussionFiles: inventory.items.filter(
        (item) => item.path.startsWith("Story/Discussion/") && item.path.endsWith(".json"),
      ).length,
    },
    summary: {
      mainMissions: rawMissions.length,
      resolvedMissions: result.stats.resolvedMissions,
      rawTypeCounts: typeCounts,
      completeness: counts("completeness"),
      quality: counts("qualityCode"),
      visibility: counts("visibility"),
      publicDialogueMissions: quests.filter(
        (quest) => quest.visibility === "public" && quest.dialogueNodeCount > 0,
      ).length,
      publicMetadataOnlyMissions: quests.filter(
        (quest) => quest.visibility === "public" && quest.dialogueNodeCount === 0,
      ).length,
      contentRoles: counts("contentRole"),
      dialogueResolution: counts("dialogueResolutionStatus"),
      sourceBoundMissions: quests.filter((quest) => quest.sourceBindingCount > 0).length,
      relationEdgeMissions: quests.filter((quest) => quest.relationEdgeCount > 0).length,
      dialogueNodes: quests.reduce((sum, quest) => sum + quest.dialogueNodeCount, 0),
      graphCycles: result.stats.graphCycles,
      orphanDiscussions: result.orphanDiscussions.length,
      orphanMissionSources: result.orphanMissionSources.length,
    },
    orphanDiscussions: result.orphanDiscussions,
    orphanMissionSources: result.orphanMissionSources,
    duplicateTitles,
    quests,
  };

  const jsonPath = resolve(`${options.outputPrefix}.json`);
  const markdownPath = resolve(`${options.outputPrefix}.md`);
  mkdirSync(resolve(markdownPath, ".."), { recursive: true });
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");

  const incomplete = quests
    .filter((quest) => quest.visibility === "public" && quest.completeness !== "complete")
    .slice(0, 120);
  const markdown = [
    "# 星铁任务解析审计报告",
    "",
    `- Source commit: \`${snapshot.ref}\``,
    `- MainMission: **${rawMissions.length}**`,
    `- Resolved: **${result.stats.resolvedMissions}**`,
    `- Dialogue nodes: **${report.summary.dialogueNodes}**`,
    `- Graph cycles: **${result.stats.graphCycles}**`,
    `- Orphan discussion files: **${result.orphanDiscussions.length}**`,
    `- Orphan mission source files: **${result.orphanMissionSources.length}**`,
    `- Missions with exact/validated source bindings: **${report.summary.sourceBoundMissions}**`,
    `- Missions with graph relation edges: **${report.summary.relationEdgeMissions}**`,
    "",
    "## 解析状态",
    "",
    "| 状态 | 数量 |",
    "| --- | ---: |",
    ...Object.entries(report.summary.completeness).map(([key, value]) => `| ${key} | ${value} |`),
    "",
    "## 类型",
    "",
    "| MainMission 类型 | 数量 |",
    "| --- | ---: |",
    ...Object.entries(typeCounts).map(([key, value]) => `| ${key} | ${value} |`),
    "",
    "## 公开目录中的不完整任务（前 120 条）",
    "",
    "| ID | 标题 | 类型 | 系列 | 章节 | 内容角色 | 对白 | 原因 |",
    "| ---: | --- | --- | --- | --- | --- | ---: | --- |",
    ...incomplete.map(
      (quest) =>
        `| ${quest.mainMissionId} | ${quest.title.replaceAll("|", "\\|")} | ${quest.type} | ${(quest.family ?? "").replaceAll("|", "\\|")} | ${(quest.chapter ?? "").replaceAll("|", "\\|")} | ${quest.contentRole ?? "unknown"} | ${quest.dialogueNodeCount} | ${quest.reason} |`,
    ),
    "",
    `完整任务明细和孤立来源列表见 \`${jsonPath}\`。`,
  ].join("\n");
  writeFileSync(markdownPath, markdown, "utf8");
  console.log(`Quest audit written to ${jsonPath} and ${markdownPath}`);
  console.log(JSON.stringify(report.summary));
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
