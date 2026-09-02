import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../packages/config/src/index.ts";
import { createPool } from "../packages/database/src/index.ts";
import { runStoragePreflight } from "./check-data-storage.js";

type QuestDocumentRow = {
  id: string;
  sourceKey: string;
  type: string;
  locale: string;
  title: string;
  body: string;
  gameVersion: string | null;
  metadata: Record<string, unknown>;
  contentHash: string | null;
};

type QuestNodeRow = {
  documentId: string;
  nodeKey: string;
  nodeType: string;
  speakerName: string | null;
  body: string;
  ordinal: number;
  variants: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

type ChecklistCase = {
  reason: string;
  document: QuestDocumentRow;
  node: QuestNodeRow | null;
};

const questTypes = [
  "archon_quest",
  "story_quest",
  "world_quest",
  "event_quest",
  "commission",
  "hangout",
  "other",
] as const;
const typeLabels: Record<string, string> = {
  archon_quest: "魔神任务",
  story_quest: "传说任务",
  world_quest: "世界任务",
  event_quest: "活动任务",
  commission: "委托",
  hangout: "邀约任务",
  other: "其他任务",
};
const completenessLabels: Record<string, string> = {
  complete: "完整",
  partial: "部分缺失",
  metadata_only: "仅元数据",
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableRank(seed: string, ...parts: Array<string | number | null | undefined>): string {
  return sha256([seed, ...parts.map((part) => String(part ?? ""))].join("\u0000"));
}

function provenance(document: QuestDocumentRow): Record<string, unknown> {
  return asRecord(document.metadata.provenance);
}

function questPayload(document: QuestDocumentRow): Record<string, unknown> {
  return asRecord(document.metadata.questPayload);
}

function questCompleteness(document: QuestDocumentRow): string {
  return asString(questPayload(document).completeness) ?? "unknown";
}

function sourceFiles(document: QuestDocumentRow): string {
  const files = provenance(document).sourceFiles;
  return Array.isArray(files)
    ? files.filter((file): file is string => typeof file === "string").join(", ")
    : "—";
}

function textMapHash(node: QuestNodeRow | null): string {
  return asString(node?.metadata.textMapHash) ?? "—";
}

function firstUsefulNode(nodes: QuestNodeRow[]): QuestNodeRow | null {
  return (
    nodes.find((node) => node.body.trim() && node.nodeType === "dialogue") ??
    nodes.find((node) => node.body.trim()) ??
    nodes[0] ??
    null
  );
}

function chooseCases(
  documents: QuestDocumentRow[],
  nodesByDocument: Map<string, QuestNodeRow[]>,
  seed: string,
): ChecklistCase[] {
  const cases: ChecklistCase[] = [];
  const seen = new Set<string>();
  const addCase = (reason: string, document: QuestDocumentRow, node: QuestNodeRow | null) => {
    const key = [reason, document.sourceKey, node?.nodeKey ?? "document"].join("\u0000");
    if (seen.has(key)) return;
    seen.add(key);
    cases.push({ reason, document, node });
  };

  for (const type of questTypes) {
    const typedDocuments = documents
      .filter((document) => document.type === type)
      .sort((left, right) =>
        stableRank(seed, "type", type, left.sourceKey).localeCompare(
          stableRank(seed, "type", type, right.sourceKey),
        ),
      )
      .slice(0, 2);
    for (const document of typedDocuments) {
      addCase(
        `任务类型覆盖：${typeLabels[type]}`,
        document,
        firstUsefulNode(nodesByDocument.get(document.id) ?? []),
      );
    }
  }

  const addFirstMatchingNode = (
    reason: string,
    predicate: (document: QuestDocumentRow, node: QuestNodeRow) => boolean,
  ) => {
    const matches = documents
      .flatMap((document) =>
        (nodesByDocument.get(document.id) ?? [])
          .filter((node) => predicate(document, node))
          .map((node) => ({ document, node })),
      )
      .sort((left, right) =>
        stableRank(seed, reason, left.document.sourceKey, left.node.nodeKey).localeCompare(
          stableRank(seed, reason, right.document.sourceKey, right.node.nodeKey),
        ),
      );
    const match = matches[0];
    if (match) addCase(reason, match.document, match.node);
  };

  addFirstMatchingNode(
    "风险覆盖：玩家选项",
    (_document, node) => node.nodeType === "player_choice",
  );
  addFirstMatchingNode(
    "风险覆盖：动态变量/男女变体",
    (_document, node) => Object.keys(node.variants).length > 0,
  );
  addFirstMatchingNode("风险覆盖：长台词", (_document, node) => node.body.length >= 120);

  for (const completeness of ["partial", "metadata_only"]) {
    const document = documents
      .filter((candidate) => questCompleteness(candidate) === completeness)
      .sort((left, right) =>
        stableRank(seed, "completeness", completeness, left.sourceKey).localeCompare(
          stableRank(seed, "completeness", completeness, right.sourceKey),
        ),
      )[0];
    if (document)
      addCase(
        `完整率覆盖：${completenessLabels[completeness] ?? completeness}`,
        document,
        firstUsefulNode(nodesByDocument.get(document.id) ?? []),
      );
  }

  return cases.sort((left, right) =>
    `${left.document.type}:${left.document.title}:${left.node?.ordinal ?? -1}`.localeCompare(
      `${right.document.type}:${right.document.title}:${right.node?.ordinal ?? -1}`,
      "zh-CN",
    ),
  );
}

function renderCase(item: ChecklistCase, index: number): string {
  const { document, node } = item;
  const documentProvenance = provenance(document);
  const body = node?.body.trim() || document.body.trim() || "（该任务没有可核验正文节点）";
  return [
    `## ${index}. ${document.title}`,
    "",
    `- 核验原因：${item.reason}`,
    `- 任务类型：${typeLabels[document.type] ?? document.type}`,
    `- 完整率：${completenessLabels[questCompleteness(document)] ?? questCompleteness(document)}`,
    `- 任务键：\`${document.sourceKey}\``,
    `- 节点键：\`${node?.nodeKey ?? "—"}\``,
    `- 节点类型：\`${node?.nodeType ?? "—"}\``,
    `- 说话人：${node?.speakerName ?? "—"}`,
    `- TextMap Hash：\`${textMapHash(node)}\``,
    `- 文档内容哈希：\`${document.contentHash ?? "—"}\``,
    `- 上游 Commit：\`${asString(documentProvenance.upstreamCommit) ?? "—"}\``,
    `- 版本标签：\`${asString(documentProvenance.upstreamVersionLabel) ?? "—"}\``,
    `- 源文件：${sourceFiles(document)}`,
    "",
    "核验记录：",
    "",
    "- [ ] 游戏内可见",
    "- [ ] 逐字一致",
    "- [ ] 仅格式差异",
    "- [ ] 内容不一致（需截图）",
    "- [ ] 版本不一致（需截图）",
    "- [ ] 未解锁/不可访问（需截图或备注）",
    "- 客户端版本：",
    "- 客户端语言：",
    "- 截图文件：",
    "- 备注：",
    "",
    "<details>",
    `<summary>待核验文本（${body.length} 字符）</summary>`,
    "",
    "~~~text",
    body,
    "~~~",
    "",
    "</details>",
    "",
  ].join("\n");
}

function renderChecklist(input: {
  revisionNumber: number;
  revisionId: string;
  manifestRootHash: string | null;
  upstreamCommit: string;
  expectedGameVersion: string;
  locale: string;
  seed: string;
  cases: ChecklistCase[];
}): string {
  return [
    "# 《原神》剧情任务节点核验清单",
    "",
    `- Dataset Revision：\`r${input.revisionNumber}\``,
    `- Revision ID：\`${input.revisionId}\``,
    `- Manifest Root Hash：\`${input.manifestRootHash ?? "—"}\``,
    `- 上游 Commit：\`${input.upstreamCommit}\``,
    `- 预期游戏版本/语言：\`${input.expectedGameVersion}\` / \`${input.locale}\``,
    `- 固定抽样种子：\`${input.seed}\``,
    `- 导出时间：${new Date().toISOString()}`,
    `- 核验点数量：${input.cases.length}`,
    "",
    "> 这个清单核验的是具体剧情节点，不是要求完整通读整个任务。请在同版本、同语言客户端中核对待核验文本。内容不一致、版本不一致、未解锁/不可访问时需要保存截图到 data/verification/。",
    "",
    ...input.cases.map((item, index) => renderCase(item, index + 1)),
  ].join("\n");
}

async function exportQuestVerificationChecklist(locale = "zh-CN") {
  const config = loadConfig();
  const preflight = await runStoragePreflight();
  if (!preflight.ok) throw new Error(preflight.errors.join("; "));
  const pool = createPool(config.databaseUrl);
  try {
    const [revision] = (
      await pool.query<{
        id: string;
        revisionNumber: number;
        manifestRootHash: string | null;
      }>(
        `select dr.id, dr.revision_number as "revisionNumber", dm.root_hash as "manifestRootHash"
           from knowledge.dataset_revisions dr
           left join knowledge.dataset_manifests dm on dm.id = dr.manifest_id
          where dr.is_current = true
          order by dr.revision_number desc
          limit 1`,
      )
    ).rows;
    if (!revision) throw new Error("No current Dataset Revision exists");

    const documents = (
      await pool.query<QuestDocumentRow>(
        `select id, source_key as "sourceKey", type, locale, title, body,
                game_version as "gameVersion", metadata,
                metadata->'provenance'->>'normalizedContentHash' as "contentHash"
           from knowledge.documents
          where revision_id = $1
            and locale = $2
            and type = any($3::text[])
          order by type, source_key`,
        [revision.id, locale, questTypes],
      )
    ).rows;
    if (!documents.length)
      throw new Error(`No ${locale} quest documents found in current revision`);

    const nodes = (
      await pool.query<QuestNodeRow>(
        `select document_id as "documentId", node_key as "nodeKey", node_type as "nodeType",
                speaker_name as "speakerName", body, ordinal, variants, metadata
           from knowledge.quest_dialogue_nodes
          where document_id = any($1::uuid[])
          order by document_id, ordinal`,
        [documents.map((document) => document.id)],
      )
    ).rows;
    const nodesByDocument = new Map<string, QuestNodeRow[]>();
    for (const node of nodes)
      nodesByDocument.set(node.documentId, [...(nodesByDocument.get(node.documentId) ?? []), node]);

    const firstProvenance = provenance(documents[0]!);
    const upstreamCommit = asString(firstProvenance.upstreamCommit) ?? "unknown";
    const expectedGameVersion = documents[0]?.gameVersion ?? "unknown";
    const seed = `${upstreamCommit}:quest-node-verification:${locale}`;
    const cases = chooseCases(documents, nodesByDocument, seed);
    const markdown = renderChecklist({
      revisionNumber: revision.revisionNumber,
      revisionId: revision.id,
      manifestRootHash: revision.manifestRootHash,
      upstreamCommit,
      expectedGameVersion,
      locale,
      seed,
      cases,
    });
    const outputRoot = resolve(config.dataDir, "verification", "checklists");
    await mkdir(outputRoot, { recursive: true });
    const outputPath = join(
      outputRoot,
      `quest-node-verification-r${revision.revisionNumber}-${locale}.md`,
    );
    await writeFile(outputPath, `${markdown}\n`, "utf8");
    return {
      revision: `r${revision.revisionNumber}`,
      revisionId: revision.id,
      locale,
      cases: cases.length,
      outputPath: relative(config.dataDir, outputPath),
    };
  } finally {
    await pool.end();
  }
}

const invokedScript = process.argv[1] ? resolve(process.argv[1]) : undefined;
if (invokedScript === fileURLToPath(import.meta.url)) {
  try {
    const localeArgument = process.argv.find((argument) => argument.startsWith("--locale="));
    const locale = localeArgument?.slice("--locale=".length) || "zh-CN";
    console.log(JSON.stringify(await exportQuestVerificationChecklist(locale), null, 2));
  } catch (error) {
    console.error(
      `Quest verification checklist export failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exitCode = 1;
  }
}

export { chooseCases, exportQuestVerificationChecklist };
