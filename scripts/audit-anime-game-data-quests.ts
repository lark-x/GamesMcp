import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import {
  buildRecord,
  convertQuestSnapshot,
  DEFAULT_QUEST_UPSTREAM_DIR,
} from "./anime-game-data-quest-converter.ts";
import { runStoragePreflight } from "./check-data-storage.ts";

const execFileAsync = promisify(execFile);
const locales = ["zh-CN", "en"] as const;
type Locale = (typeof locales)[number];

function argValue(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function idText(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return undefined;
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort();
}

function nodeSourceFiles(record: ReturnType<typeof buildRecord>): string[] {
  return unique(
    (record.quest?.dialogueNodes ?? []).map((node) => {
      const value = node.metadata?.sourceFile;
      return typeof value === "string" ? value : undefined;
    }),
  );
}

async function upstreamMetadata(upstreamDir: string) {
  try {
    const { stdout } = await execFileAsync("git", ["log", "-1", "--format=%H%n%cI%n%s"], {
      cwd: upstreamDir,
    });
    const [commit = "unknown", commitDate = "unknown", subject = "unknown"] = stdout
      .trim()
      .split("\n");
    return { commit, commitDate, subject };
  } catch {
    return { commit: "unknown", commitDate: "unknown", subject: "unknown" };
  }
}

function sourcePathReason(record: ReturnType<typeof buildRecord>): string[] {
  const reasons: string[] = [];
  const quest = record.quest;
  if (!quest?.dialogueNodes.length) reasons.push("missing_dialogue_nodes");
  if (!quest?.subquests.length) reasons.push("missing_subquests");
  if (quest?.qualityCode === "speaker_unresolved") reasons.push("speaker_name_unresolved");
  if (record.metadata.titleResolutionMethod === "unresolved") reasons.push("title_unresolved");
  if (quest?.visibility !== "public") {
    reasons.push(`visibility_${quest?.visibility ?? "unknown"}`);
  }
  return reasons;
}

async function main() {
  const preflight = await runStoragePreflight();
  if (!preflight.ok) throw new Error(preflight.errors.join("; "));

  const upstreamDir = resolve(argValue("upstream") ?? DEFAULT_QUEST_UPSTREAM_DIR);
  const outputBase = resolve(argValue("output") ?? "reports/genshin-quest-audit");
  const git = await upstreamMetadata(upstreamDir);
  const result = await convertQuestSnapshot({
    upstreamDir,
    profile: process.argv.includes("--profile"),
    context: {
      upstreamCommit: git.commit,
      upstreamCommitDate: git.commitDate,
      gameVersion: argValue("game-version") ?? "audit",
      upstreamVersionLabel: git.subject,
    },
  });
  const inputs = result.auditInputs;
  const auditByMainLocale = new Map(
    result.auditRecords.flatMap((record) => {
      const mainId = record.quest?.mainQuestId;
      return mainId ? [[`${mainId}/${record.locale}`, record] as const] : [];
    }),
  );
  const publicKeys = new Set(
    result.records.map((record) => `${record.quest?.mainQuestId}/${record.locale}`),
  );
  const excludedByKey = new Map(result.manifest.excluded.map((item) => [item.sourceKey, item.reason]));
  const failureByKey = new Map(result.manifest.failures.map((item) => [item.sourceKey, item.reason]));

  const tasks = inputs.mainQuest.map((main) => {
    const mainId = idText(main.id ?? main.mainQuestId) ?? "unknown";
    const relations = inputs.mainQuestRelations.get(mainId) ?? [];
    const localesReport = Object.fromEntries(
      locales.map((locale) => {
        const record = auditByMainLocale.get(`${mainId}/${locale}`);
        if (!record) {
          const sourceKey = `quest/${mainId}/locale/${locale}`;
          return [
            locale,
            {
              status: "parser_failed",
              qualityCode: "parser_failed",
              reasons: [failureByKey.get(`quest/${mainId}/locale/${locale}`) ?? "record_not_built"],
            },
          ];
        }
        const quest = record.quest!;
        const sourceFiles = nodeSourceFiles(record);
        const sourceKey = record.sourceKey;
        return [
          locale,
          {
            status: publicKeys.has(`${mainId}/${locale}`)
              ? "public"
              : excludedByKey.get(sourceKey)
                ? "excluded"
                : "built",
            title: record.title,
            questType: quest.questType,
            regionId: quest.regionId,
            region: quest.regionName,
            chapterId: quest.chapterId,
            chapter: quest.chapterTitle,
            chapterOrder: quest.chapterOrder,
            seriesId: quest.seriesId,
            series: quest.seriesTitle,
            familyId: quest.storyFamilyId,
            family: quest.storyFamilyTitle,
            familyProvenance: quest.storyFamilyProvenance,
            familyOrder: quest.storyFamilyOrder,
            storyPosition: quest.storyPosition,
            relatedMainQuestIds: relations,
            subquestCount: quest.subquests.length,
            dialogueNodeCount: quest.dialogueNodes.length,
            dialogueEdgeCount: quest.dialogueEdges.length,
            speakerUnresolvedCount: quest.dialogueNodes.filter(
              (node) => Boolean(node.speakerKey) && !node.speakerName,
            ).length,
            qualityCode: quest.qualityCode,
            completeness: quest.completeness,
            completenessReasons: quest.completenessReasons,
            sourceFiles,
            dialogueLineage: record.metadata.provenance?.lineage?.dialogue,
            reasons: [
              ...sourcePathReason(record),
              ...(excludedByKey.has(sourceKey) ? [`excluded:${excludedByKey.get(sourceKey)}`] : []),
            ],
          },
        ];
      }),
    ) as Record<Locale, Record<string, unknown>>;
    const zh = localesReport["zh-CN"];
    return {
      mainQuestId: mainId,
      rawTitle: main.title,
      rawType: main.type ?? main.questType,
      directSeries: main.series,
      relationIds: relations,
      codexSourceFile: inputs.codexQuestByMainId.get(mainId)?.relativePath,
      explicitQuestRows: (inputs.questByMainId.get(mainId) ?? []).length,
      locales: localesReport,
      qualityCode: zh?.qualityCode,
      familyId: zh?.familyId,
      family: zh?.family,
      chapter: zh?.chapter,
      dialogueNodeCount: zh?.dialogueNodeCount ?? 0,
      sourceFiles: zh?.sourceFiles ?? [],
    };
  });

  const questTalkFiles = Object.keys(inputs.questTalkInputHashes).sort();
  const matchedQuestTalkFiles = new Set(
    result.auditRecords.flatMap((record) => nodeSourceFiles(record).filter((path) => path.startsWith("BinOutput/Talk/Quest/"))),
  );
  const questTalkFilesWithoutParsedNodes = questTalkFiles.filter((path) => !matchedQuestTalkFiles.has(path));
  const duplicateTitles = new Map<string, string[]>();
  for (const task of tasks) {
    const title = typeof task.locales["zh-CN"]?.title === "string" ? task.locales["zh-CN"].title : undefined;
    if (!title) continue;
    const list = duplicateTitles.get(title) ?? [];
    list.push(task.mainQuestId);
    duplicateTitles.set(title, list);
  }
  const duplicateTitleGroups = [...duplicateTitles.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([title, ids]) => ({ title, mainQuestIds: ids.sort() }));

  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    upstream: { directory: upstreamDir, ...git },
    summary: {
      mainQuests: inputs.mainQuest.length,
      auditLocaleRecords: result.auditRecords.length,
      publicLocaleRecords: result.records.length,
      excludedLocaleRecords: result.manifest.excluded.length,
      parserFailures: result.manifest.failures.length,
      metadataOnlyZh: tasks.filter((task) => task.qualityCode === "metadata_only").length,
      partialZh: tasks.filter((task) => task.qualityCode === "partial_dialogue").length,
      completeZh: tasks.filter((task) => task.qualityCode === "complete").length,
      unresolvedSpeakerZh: tasks.filter((task) => task.qualityCode === "speaker_unresolved").length,
      familyCount: new Set(tasks.map((task) => task.familyId).filter(Boolean)).size,
      duplicateTitleGroups: duplicateTitleGroups.length,
    },
    conversionManifest: result.manifest,
    sourceAudit: {
      questTalkFiles: questTalkFiles.length,
      questTalkRows: inputs.questTalkDialogRows.length,
      questTalkFilesWithParsedNodes: matchedQuestTalkFiles.size,
      questTalkFilesWithoutParsedNodes,
      questTalkFailures: inputs.questTalkFailures,
      codexFiles: inputs.codexQuest.length,
      codexFilesWithoutMainQuest: inputs.codexQuest
        .filter((item) => !inputs.mainQuestById.has(item.value.IMJHJGBNMMD as string))
        .map((item) => item.relativePath),
      duplicateTitleGroups,
    },
    focus: tasks.filter((task) =>
      ["74001", "74002", "74003", "74004", "74072", "74073", "74074", "74075", "74076", "74077", "74165", "74078", "74184", "74194", "74183", "74195", "74196", "76148", "76152"].includes(task.mainQuestId),
    ),
    tasks,
  };

  await mkdir(outputBase, { recursive: true });
  await writeFile(`${outputBase}.json`, JSON.stringify(report, null, 2) + "\n", "utf8");
  const problemTasks = tasks.filter((task) => task.qualityCode !== "complete");
  const markdown = [
    "# 原神任务解析审计",
    "",
    `- 上游：\`${upstreamDir}\``,
    `- Commit：\`${git.commit}\``,
    `- 主任务：${report.summary.mainQuests}`,
    `- 可发布双语记录：${report.summary.publicLocaleRecords}`,
    `- 完整/部分/仅元数据（中文）：${report.summary.completeZh}/${report.summary.partialZh}/${report.summary.metadataOnlyZh}`,
    `- 解析失败：${report.summary.parserFailures}`,
    `- 系列：${report.summary.familyCount}`,
    "",
    "## 重点核对",
    "",
    "| 主任务 | 标题 | 系列 | 章节 | 对白 | 状态 |",
    "| --- | --- | --- | --- | ---: | --- |",
    ...report.focus.map((task) => {
      const zh = task.locales["zh-CN"];
      return `| ${task.mainQuestId} | ${String(zh?.title ?? "")} | ${String(zh?.family ?? "")} | ${String(zh?.chapter ?? "")} | ${String(zh?.dialogueNodeCount ?? 0)} | ${String(zh?.qualityCode ?? "parser_failed")} |`;
    }),
    "",
    "## 非完整任务",
    "",
    ...problemTasks.slice(0, 200).map((task) => {
      const zh = task.locales["zh-CN"];
      return `- ${task.mainQuestId} ${String(zh?.title ?? task.rawTitle ?? "")}：${String(zh?.qualityCode ?? "parser_failed")}；${(Array.isArray(zh?.reasons) ? zh.reasons : []).join(", ")}`;
    }),
    problemTasks.length > 200 ? `- 其余 ${problemTasks.length - 200} 条见 JSON。` : "",
    "",
    "## 来源覆盖",
    "",
    `- Talk/Quest 文件：${report.sourceAudit.questTalkFiles}；有解析节点：${report.sourceAudit.questTalkFilesWithParsedNodes}；未被节点引用：${report.sourceAudit.questTalkFilesWithoutParsedNodes.length}`,
    `- CodexQuest 文件：${report.sourceAudit.codexFiles}`,
    "",
    "本报告只读取上游文件并在内存中运行转换，不写入数据库；可据此统一修复规则后再执行一次候选导入。",
  ].join("\n");
  await writeFile(`${outputBase}.md`, markdown + "\n", "utf8");
  console.log(
    JSON.stringify(
      {
        json: `${outputBase}.json`,
        markdown: `${outputBase}.md`,
        summary: report.summary,
      },
      null,
      2,
    ),
  );
}

if (process.argv[1]?.endsWith("audit-anime-game-data-quests.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
