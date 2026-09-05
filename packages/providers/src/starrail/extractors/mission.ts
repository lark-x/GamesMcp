import { resolve } from "node:path";
import { normalizeStarRailText, hasLikelyNarrativeText } from "../corpus/normalizer.js";
import type { ExtractorInput, ExtractorResult } from "./shared.js";
import {
  extractRecordDocuments,
  firstResolved,
  formatConversation,
  readSafeJsonFile,
} from "./shared.js";

export async function extractMissionDocuments(input: ExtractorInput): Promise<ExtractorResult> {
  const mainMissionItem = input.inventory.items.find(
    (i) => i.path === "ExcelOutput/MainMission.json",
  );

  if (mainMissionItem) {
    const subMissionItem = input.inventory.items.find(
      (i) => i.path === "ExcelOutput/SubMission.json",
    );
    const subMap = new Map<number, Array<Record<string, unknown>>>();

    if (subMissionItem) {
      const subMissions = await readSafeJsonFile<Array<Record<string, unknown>>>(
        resolve(input.dataDir, subMissionItem.path),
      );
      if (Array.isArray(subMissions)) {
        for (const sub of subMissions) {
          const subId = Number(sub.SubMissionID);
          if (!Number.isInteger(subId)) continue;
          const mainId = Math.floor(subId / 100);
          const list = subMap.get(mainId) ?? [];
          list.push(sub);
          subMap.set(mainId, list);
        }
      }
    }

    // Load talk sentences for dialogue resolution if available
    const talkItem = input.inventory.items.find(
      (i) => i.path === "ExcelOutput/TalkSentenceConfig.json",
    );
    const sentenceMap = new Map<number, { speaker: string; text: string }>();
    if (talkItem) {
      const talkSentences = await readSafeJsonFile<Array<Record<string, unknown>>>(
        resolve(input.dataDir, talkItem.path),
      );
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
    }

    // Index story mission dialogue files
    const storyMissionFiles = input.inventory.items.filter(
      (i) =>
        i.path.startsWith("Story/Mission/") &&
        i.path.endsWith(".json") &&
        !i.path.includes(".layout."),
    );
    const missionDialogMap = new Map<number, string[]>();
    const missionStoryFiles = new Map<number, string[]>();

    for (const sFile of storyMissionFiles) {
      // Determine MainMissionID from path e.g. Story/Mission/1000101/... or digits
      const match = sFile.path.match(/Story\/Mission\/(\d+)/u);
      let guessedMainId = match ? Number(match[1]) : undefined;

      const parsed = await readSafeJsonFile<unknown>(resolve(input.dataDir, sFile.path));
      if (!parsed) continue;

      const lines: string[] = [];
      const walk = (obj: unknown): void => {
        if (!obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) {
          for (const it of obj) walk(it);
          return;
        }
        const record = obj as Record<string, unknown>;
        if (record.MainMissionID && !guessedMainId) {
          guessedMainId = Number(record.MainMissionID);
        }
        if (record.TalkSentenceID) {
          const sId = Number(record.TalkSentenceID);
          const entry = sentenceMap.get(sId);
          if (entry) {
            lines.push(entry.speaker ? `${entry.speaker}：${entry.text}` : entry.text);
          }
        }
        if (record.Options && Array.isArray(record.Options)) {
          for (const opt of record.Options) {
            if (typeof opt === "object" && opt !== null) {
              const optHash = (opt as Record<string, unknown>).TextMapHash;
              const optText = optHash ? input.resolver.resolve(optHash as string | number) : null;
              if (optText) lines.push(`[选项] ${optText}`);
            }
          }
        }
        for (const val of Object.values(record)) {
          walk(val);
        }
      };

      walk(parsed);

      if (guessedMainId && lines.length > 0) {
        const existing = missionDialogMap.get(guessedMainId) ?? [];
        existing.push(...lines);
        missionDialogMap.set(guessedMainId, existing);

        const existingFiles = missionStoryFiles.get(guessedMainId) ?? [];
        existingFiles.push(sFile.path);
        missionStoryFiles.set(guessedMainId, existingFiles);
      }
    }

    const mainMissions = await readSafeJsonFile<Array<Record<string, unknown>>>(
      resolve(input.dataDir, mainMissionItem.path),
    );
    if (Array.isArray(mainMissions)) {
      const result: ExtractorResult = { documents: [], issues: [], unresolvedText: 0 };

      for (const m of mainMissions) {
        const id = Number(m.MainMissionID);
        if (!Number.isInteger(id)) continue;

        const resolveHash = (val: unknown): string | null => {
          if (!val) return null;
          if (typeof val === "number" || typeof val === "string")
            return input.resolver.resolve(val);
          if (typeof val === "object") {
            const hash =
              (val as Record<string, unknown>).Hash ?? (val as Record<string, unknown>).hash;
            return hash ? input.resolver.resolve(hash as string | number) : null;
          }
          return null;
        };

        const title = resolveHash(m.Name) ?? `任务 ${id}`;
        const lines = [`# ${title}`, "", `MainMissionID：${id}`];
        if (m.Type) lines.push(`类型：${m.Type}`);
        if (m.ChapterID) lines.push(`章节：${m.ChapterID}`);
        lines.push("");

        const subs = subMap.get(id) ?? [];
        for (const s of subs) {
          const target = resolveHash(s.TargetText);
          const desc = resolveHash(s.DescrptionText);
          if (target || desc) {
            if (target) lines.push(`### 阶段目标：${target}`);
            if (desc) lines.push(desc);
            lines.push("");
          }
        }

        const dialogues = missionDialogMap.get(id);
        if (dialogues && dialogues.length > 0) {
          lines.push("## 剧情对白", "");
          lines.push(...dialogues);
          lines.push("");
        }

        const content = normalizeStarRailText(lines.join("\n"));
        if (!hasLikelyNarrativeText(content)) {
          result.issues.push({
            code: "empty_or_non_narrative_document",
            message: `Skipped non-narrative mission`,
            sourcePath: mainMissionItem.path,
            sourceId: String(id),
          });
          continue;
        }

        const sourceFiles = [mainMissionItem.path];
        if (subMissionItem) sourceFiles.push(subMissionItem.path);
        if (talkItem && dialogues && dialogues.length > 0) sourceFiles.push(talkItem.path);
        const storyFiles = missionStoryFiles.get(id);
        if (storyFiles) sourceFiles.push(...storyFiles);

        result.documents.push({
          category: "sr_mission",
          id,
          relativePath: `sr_mission/${id}.txt`,
          title,
          content,
          sourceFiles,
          sourceIds: [`MainMissionID:${id}`],
          metadata: {
            source: "turn-based-game-data",
            sourceCommit: input.sourceRef,
            sourcePath: mainMissionItem.path,
          },
          hierarchy: {
            parentId: m.ChapterID ? `sr_chapter:${m.ChapterID}` : "sr_mission",
            label: "Mission",
            order: id,
          },
        });
      }

      if (result.documents.length > 0) {
        return result;
      }
    }
  }

  // Fallback for fixture
  return extractRecordDocuments({
    extractor: input,
    category: "sr_mission",
    matchPath: (path) => /(?:^|\/)Story\/Mission\//iu.test(path),
    naturalIdKeys: ["MissionID", "MainMissionID"],
    titleKeys: ["TitleTextMapHash", "MissionNameTextMapHash", "NameTextMapHash", "Title", "Name"],
    bodyKeys: ["DescTextMapHash", "ContentTextMapHash", "TextMapHash", "Desc", "Content"],
    sourceIdPrefix: "MissionID",
    relativePathFor: (id) => `sr_mission/${id}.txt`,
    format: (record, context) =>
      formatConversation({
        title: firstResolved(record, ["TitleTextMapHash", "Title", "Name"], context) ?? "任务",
        subtitle: `MissionID：${String(record.MissionID ?? record.MainMissionID ?? "unknown")}`,
        record,
        context,
        containers: ["Talks", "Dialogues", "Dialogs", "Sentences", "Sections"],
      }),
    hierarchy: (id) => ({ parentId: "sr_mission", label: "Mission", order: id }),
  });
}
