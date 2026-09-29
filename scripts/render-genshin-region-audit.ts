import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

type AuditTask = {
  mainQuestId: string;
  locales?: Record<string, Record<string, unknown>>;
};

const inputPath = process.argv[2];
if (!inputPath) throw new Error("usage: render-genshin-region-audit <audit.json> [output.md]");

const resolvedInput = resolve(inputPath);
const outputPath = resolve(process.argv[3] ?? "reports/genshin-world-quest-region-audit-r14.md");
const audit = JSON.parse(await readFile(resolvedInput, "utf8")) as {
  upstream?: Record<string, unknown>;
  summary?: Record<string, unknown>;
  tasks?: AuditTask[];
};
const tasks = audit.tasks ?? [];
const publicWorldTasks = tasks
  .map((task) => ({ task, zh: task.locales?.["zh-CN"] ?? {} }))
  .filter(
    ({ zh }) =>
      zh.status === "public" &&
      zh.questType === "world_quest" &&
      ["story", "story_and_control"].includes(String(zh.contentRole)),
  )
  .sort((left, right) =>
    left.task.mainQuestId.localeCompare(right.task.mainQuestId, "en", { numeric: true }),
  );
const unresolved = publicWorldTasks.filter(({ zh }) => zh.taskRegionId === "other");
const countBy = (items: Array<Record<string, unknown>>, field: string) => {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = String(item[field] ?? "unresolved");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([left], [right]) => left.localeCompare(right));
};
const escapeCell = (value: unknown) =>
  String(value ?? "—")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ");
const rows = unresolved.map(({ task, zh }) => {
  const evidence = Array.isArray(zh.taskRegionEvidence) ? zh.taskRegionEvidence.join("<br>") : "";
  const conflicts = Array.isArray(zh.taskRegionConflicts)
    ? zh.taskRegionConflicts.join("<br>")
    : "";
  return `| ${task.mainQuestId} | ${escapeCell(zh.title)} | ${escapeCell(zh.family)} | ${escapeCell(zh.chapter)} | ${escapeCell(zh.taskRegionReason)} | ${escapeCell(evidence)} | ${escapeCell(conflicts)} |`;
});
const sourceCommit = String(audit.upstream?.commit ?? "not recorded");
const markdown = [
  "# 原神公开世界任务地区证据审计",
  "",
  `- 输入审计：\`${basename(resolvedInput)}\``,
  `- 上游 commit：\`${sourceCommit}\``,
  "- 上游版本：项目固定的 AnimeGameData 7.0.0 快照",
  `- 公开世界任务叙事：${publicWorldTasks.length}`,
  `- 缺少可验证任务地区、当前投影到“其他地区”：${unresolved.length}`,
  "",
  "## 地区来源分布",
  "",
  "| 采用地区来源 | 数量 |",
  "| --- | ---: |",
  ...countBy(
    publicWorldTasks.map(({ zh }) => zh),
    "taskRegionSource",
  ).map(([source, count]) => `| ${source} | ${count} |`),
  "",
  "## 未能直接归区的任务",
  "",
  "以下任务没有可直接采用的唯一地区证据。证据列记录精确源字段或任务对白配置路径；冲突列记录被拒绝的矛盾证据。不得仅凭标题或任务 ID 猜地区。可依据可靠的大型系列继承，或经 Wiki 核验后加入版本化任务 ID 映射；不改变对白来源。",
  "",
  "| 主任务 ID | 标题 | 系列 | 章节 | 原因 | 源证据 | 冲突 |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...rows,
  "",
].join("\n");

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${markdown}\n`, "utf8");
console.log(
  JSON.stringify({
    outputPath,
    publicWorldQuestNarrativeCount: publicWorldTasks.length,
    unresolvedRegionCount: unresolved.length,
  }),
);
