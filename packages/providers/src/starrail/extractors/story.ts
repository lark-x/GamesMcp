import { basename, resolve } from "node:path";
import { normalizeStarRailText, hasLikelyNarrativeText } from "../corpus/normalizer.js";
import { deterministicCorpusId, naturalId } from "../corpus/ids.js";
import type { ExtractorInput, ExtractorResult } from "./shared.js";
import {
  extractRecordDocuments,
  firstResolved,
  formatConversation,
  readSafeJsonFile,
} from "./shared.js";

export async function extractStoryDocuments(input: ExtractorInput): Promise<ExtractorResult> {
  const talkItem = input.inventory.items.find(
    (i) => i.path === "ExcelOutput/TalkSentenceConfig.json",
  );
  const discussionItems = input.inventory.items.filter(
    (i) =>
      i.path.startsWith("Story/Discussion/") &&
      i.path.endsWith(".json") &&
      !i.path.includes(".layout."),
  );

  if (talkItem && discussionItems.length > 0) {
    const talkSentences = await readSafeJsonFile<Array<Record<string, unknown>>>(
      resolve(input.dataDir, talkItem.path),
    );
    const sentenceMap = new Map<number, { speaker: string; text: string }>();

    if (Array.isArray(talkSentences)) {
      for (const s of talkSentences) {
        const sId = Number(s.TalkSentenceID);
        if (!Number.isInteger(sId)) continue;

        const resolveHash = (val: unknown): string | null => {
          if (!val || typeof val !== "object") return null;
          const hash = (val as Record<string, unknown>).Hash;
          return hash ? input.resolver.resolve(hash as string | number) : null;
        };

        const speaker = resolveHash(s.TextmapTalkSentenceName) ?? "";
        const text = resolveHash(s.TalkSentenceText) ?? "";
        if (text) {
          sentenceMap.set(sId, { speaker, text });
        }
      }
    }

    const result: ExtractorResult = { documents: [], issues: [], unresolvedText: 0 };

    for (const item of discussionItems) {
      const parsed = await readSafeJsonFile<unknown>(resolve(input.dataDir, item.path));
      if (!parsed) continue;

      const lines: string[] = [];
      const walk = (obj: unknown): void => {
        if (!obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) {
          for (const it of obj) walk(it);
          return;
        }
        const record = obj as Record<string, unknown>;
        if (record.TalkSentenceID) {
          const sId = Number(record.TalkSentenceID);
          const entry = sentenceMap.get(sId);
          if (entry) {
            lines.push(entry.speaker ? `${entry.speaker}：${entry.text}` : entry.text);
          }
        }
        for (const val of Object.values(record)) {
          walk(val);
        }
      };

      walk(parsed);

      const rawDigits = basename(item.path, ".json").replace(/\D/gu, "");
      const parsedId = rawDigits ? Number(rawDigits) : undefined;
      const id =
        naturalId(parsedId) ??
        deterministicCorpusId({
          category: "sr_story",
          identity: item.path,
        });

      const snippet = lines[0] ? ` · ${lines[0].replace(/^[^\s：:]+[：:]/u, "").slice(0, 16).trim()}` : "";
      const title = `剧情片段 ${rawDigits || basename(item.path, ".json")}${snippet}`;
      const fullContent = normalizeStarRailText([`# ${title}`, "", ...lines].join("\n"));

      if (!hasLikelyNarrativeText(fullContent) || lines.length === 0) {
        result.issues.push({
          code: "empty_or_non_narrative_document",
          message: `Skipped non-narrative story discussion file`,
          sourcePath: item.path,
          sourceId: String(id),
        });
        continue;
      }

      result.documents.push({
        category: "sr_story",
        id,
        relativePath: `sr_story/${id}.txt`,
        title,
        content: fullContent,
        sourceFiles: [item.path, talkItem.path],
        sourceIds: [`StoryID:${id}`],
        metadata: {
          source: "turn-based-game-data",
          sourceCommit: input.sourceRef,
          sourcePath: item.path,
        },
        hierarchy: {
          parentId: "sr_story",
          label: "Story",
          order: id,
        },
      });
    }

    if (result.documents.length > 0) {
      return result;
    }
  }

  // Fallback for fixture
  return extractRecordDocuments({
    extractor: input,
    category: "sr_story",
    matchPath: (path) => /(?:^|\/)Story\//iu.test(path) && !/(?:^|\/)Story\/Mission\//iu.test(path),
    naturalIdKeys: ["StoryID", "SectionID", "TalkSentenceID"],
    titleKeys: ["TitleTextMapHash", "StoryNameTextMapHash", "NameTextMapHash", "Title", "Name"],
    bodyKeys: ["ContentTextMapHash", "TextMapHash", "DescTextMapHash", "Content", "Text", "Desc"],
    sourceIdPrefix: "StoryID",
    relativePathFor: (id) => `sr_story/${id}.txt`,
    format: (record, context) =>
      formatConversation({
        title: firstResolved(record, ["TitleTextMapHash", "Title", "Name"], context) ?? "剧情片段",
        record,
        context,
        containers: ["Talks", "Dialogues", "Dialogs", "Sentences", "Sections", "Lines"],
      }),
    hierarchy: (id) => ({ parentId: "sr_story", label: "Story", order: id }),
  });
}
