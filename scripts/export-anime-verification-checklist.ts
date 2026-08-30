import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { loadConfig } from "../packages/config/src/index.ts";
import {
  createDatabase,
  createPool,
  SqlKnowledgeRepository,
} from "../packages/database/src/index.ts";
import type {
  DocumentProvenance,
  VerificationItem,
  VerificationRun,
} from "../packages/domain/src/index.ts";
import { runStoragePreflight } from "./check-data-storage.js";

const config = loadConfig();
const preflight = await runStoragePreflight();
if (!preflight.ok) throw new Error(preflight.errors.join("; "));

const pool = createPool(config.databaseUrl);
const repository = new SqlKnowledgeRepository(createDatabase(pool), config.dataDir);

function formatValue(value: unknown): string {
  if (value === undefined || value === null) return "—";
  return JSON.stringify(value);
}

function provenanceLine(provenance: DocumentProvenance | undefined): string {
  if (!provenance) return "—";
  const files = provenance.sourceFiles?.join(", ") || "—";
  const ids = formatValue(provenance.upstreamIds);
  const hashes = `raw ${provenance.rawContentHash ?? "—"}; normalized ${provenance.normalizedContentHash ?? "—"}`;
  return `Commit ${provenance.upstreamCommit ?? "—"}; 版本标签 ${provenance.upstreamVersionLabel ?? "—"}; 文件 ${files}; 上游 ID ${ids}; ${hashes}`;
}

function categoryTitle(category: VerificationItem["category"]): string {
  return {
    book: "书籍",
    character_story: "角色故事",
    item_description: "物品描述",
  }[category];
}

function itemMarkdown(item: VerificationItem, index: number, run: VerificationRun): string {
  const provenance = item.provenance;
  const body = item.body?.trim() || "（来源观察未提供正文）";
  return [
    `### ${index}. ${item.title}`,
    "",
    `- [${item.status === "not_checked" ? " " : "x"}] 核验状态：${item.status}`,
    `- canonical key：\`${item.canonicalKey}\``,
    `- 预期版本/语言：\`${run.expectedGameVersion}\` / \`${run.expectedLocale}\``,
    `- 实际客户端版本：${item.checkedGameVersion ?? ""}`,
    `- 实际核验语言：${item.checkedLocale ?? ""}`,
    `- 核验渠道：${item.channel === "hoyowiki" ? "HoYoWiki 辅助" : "游戏客户端"}`,
    `- 截图数量：${item.screenshotCount}`,
    `- Source Snapshot：\`${item.sourceSnapshotId ?? "—"}\``,
    `- 出处：${provenanceLine(provenance)}`,
    `- 字段映射：${formatValue(provenance?.lineage)}`,
    `- TextMap Hash：${formatValue(provenance?.textMapHashes)}`,
    `- 转换步骤：${provenance?.transforms?.join("；") || "—"}`,
    `- 人工备注：${item.note ?? ""}`,
    "",
    "<details>",
    `<summary>正文（${body.length} 字符）</summary>`,
    "",
    "~~~text",
    body,
    "~~~",
    "",
    "</details>",
    "",
  ].join("\n");
}

function renderChecklist(run: VerificationRun): string {
  const categories = [...new Set(run.items.map((item) => item.category))];
  const sections = categories.map((category) => {
    const items = run.items.filter((item) => item.category === category);
    return [
      `## ${categoryTitle(category)}（${items.length} 条）`,
      "",
      ...items.map((item, index) => itemMarkdown(item, index + 1, run)),
    ].join("\n");
  });
  return [
    "# 《原神》数据核验清单",
    "",
    `- Batch ID：\`${run.batchId}\``,
    `- Verification Run：\`${run.id}\``,
    `- Dataset Revision：${run.datasetRevision ?? "待发布"}`,
    `- 上游 Commit：\`${run.upstreamCommit}\``,
    `- 预期游戏版本/语言：\`${run.expectedGameVersion}\` / \`${run.expectedLocale}\``,
    `- 固定抽样种子：\`${run.seed}\``,
    `- 导出时间：${new Date().toISOString()}`,
    "",
    "> 逐条在同版本简体中文客户端中比对标题和正文。状态使用 exact_match、formatting_only、mismatch、unavailable_due_unlock、version_mismatch 或 not_checked。异常项必须附截图；尚未解锁时需回到管理页面等待固定种子补抽替代项。",
    "",
    ...sections,
  ].join("\n");
}

try {
  const game = (await repository.listGames()).find(
    (candidate) => candidate.slug === "genshin-impact",
  );
  if (!game)
    throw new Error("Seed the genshin-impact game before exporting verification checklists");
  const batches = (await repository.listImports(game.id)).filter(
    (batch) => batch.status !== "published" && batch.status !== "cancelled",
  );
  const outputRoot = resolve(config.dataDir, "verification", "checklists");
  await mkdir(outputRoot, { recursive: true });
  const outputs: Array<{ batchId: string; path: string; items: number }> = [];
  for (const batch of batches) {
    const run = await repository.getVerificationRun?.(batch.id);
    if (!run) continue;
    const outputPath = join(outputRoot, `verification-${batch.id}.md`);
    await writeFile(outputPath, `${renderChecklist(run)}\n`, "utf8");
    outputs.push({
      batchId: batch.id,
      path: relative(config.dataDir, outputPath),
      items: run.items.length,
    });
  }
  console.log(
    JSON.stringify(
      { outputRoot: relative(config.dataDir, outputRoot), checklists: outputs },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
