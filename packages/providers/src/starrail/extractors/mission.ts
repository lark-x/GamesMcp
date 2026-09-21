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
    const mainMissions = await readSafeJsonFile<Array<Record<string, unknown>>>(
      resolve(input.dataDir, mainMissionItem.path),
    );
    const mainMissionIds = new Set(
      (Array.isArray(mainMissions) ? mainMissions : [])
        .map((mission) => Number(mission.MainMissionID ?? mission.ID))
        .filter((id): id is number => Number.isInteger(id)),
    );
    const subMissionItem = input.inventory.items.find(
      (i) => i.path === "ExcelOutput/SubMission.json",
    );
    const subMap = new Map<number, Array<Record<string, unknown>>>();
    const subMissionToMain = new Map<number, number>();

    if (subMissionItem) {
      const subMissions = await readSafeJsonFile<Array<Record<string, unknown>>>(
        resolve(input.dataDir, subMissionItem.path),
      );
      if (Array.isArray(subMissions)) {
        for (const sub of subMissions) {
          const subId = Number(sub.SubMissionID);
          if (!Number.isInteger(subId)) continue;
          const mainId = Math.floor(subId / 100);
          if (!mainMissionIds.has(mainId)) continue;
          subMissionToMain.set(subId, mainId);
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
    // 台词按演出块分组：floor(TalkSentenceID / 100) 同属一段演出对白。
    // 性能脚本只显式引用其中的选项句，其余台词是时间线正文，需整块提取。
    const blockSentences = new Map<number, Array<{ id: number; speaker: string; text: string }>>();
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
            const block = Math.floor(sId / 100);
            const list = blockSentences.get(block) ?? [];
            list.push({ id: sId, speaker, text });
            blockSentences.set(block, list);
          }
        }
      }
    }

    // Index story mission dialogue files (cinematic Story/Mission scripts plus
    // branching Story/Discussion/Mission performances, both named by mission id)
    const storyMissionFiles = input.inventory.items.filter(
      (i) =>
        (i.path.startsWith("Story/Mission/") || i.path.startsWith("Story/Discussion/Mission/")) &&
        i.path.endsWith(".json") &&
        !i.path.includes(".layout."),
    );
    const missionDialogMap = new Map<number, string[]>();
    const missionStoryFiles = new Map<number, string[]>();
    // 演出块 -> 所属任务；同一块若被多个任务精确引用，则完整保留给每个任务
    const blockOwners = new Map<number, Set<number>>();
    const missionOptionIds = new Map<number, Set<number>>();

    const missionIdFromPath = (filePath: string): number | undefined => {
      const match = filePath.match(/Story\/(?:Discussion\/)?Mission\/(\d+)/u);
      if (!match) return undefined;
      const directoryId = Number(match[1]);
      if (mainMissionIds.has(directoryId)) return directoryId;
      return subMissionToMain.get(directoryId);
    };

    const explicitMissionId = (value: unknown): number | undefined => {
      if (!value || typeof value !== "object") return undefined;
      if (Array.isArray(value)) {
        for (const item of value) {
          const nested = explicitMissionId(item);
          if (nested !== undefined) return nested;
        }
        return undefined;
      }
      const record = value as Record<string, unknown>;
      for (const key of ["MainMissionID", "MainMissionId", "MissionID", "MissionId"]) {
        const id = Number(record[key]);
        if (Number.isInteger(id) && mainMissionIds.has(id)) return id;
      }
      return undefined;
    };

    for (const sFile of storyMissionFiles) {
      // Determine MainMissionID from an exact MainMissionID/SubMissionID path.
      let guessedMainId = missionIdFromPath(sFile.path);

      const parsed = await readSafeJsonFile<unknown>(resolve(input.dataDir, sFile.path));
      if (!parsed) continue;

      const blockIds = new Set<number>();
      const optionIds = new Set<number>();
      const walk = (obj: unknown): void => {
        if (!obj || typeof obj !== "object") return;
        if (Array.isArray(obj)) {
          for (const it of obj) walk(it);
          return;
        }
        const record = obj as Record<string, unknown>;
        if (!guessedMainId) guessedMainId = explicitMissionId(record);
        if (record.TalkSentenceID) {
          const sId = Number(record.TalkSentenceID);
          blockIds.add(Math.floor(sId / 100));
          const isOption =
            String(record.$type ?? "").includes("OptionTalkInfo") ||
            record.OptionIconType !== undefined;
          if (isOption) optionIds.add(sId);
        }
        for (const val of Object.values(record)) {
          walk(val);
        }
      };

      walk(parsed);

      if (guessedMainId && blockIds.size > 0) {
        for (const block of blockIds) {
          const owners = blockOwners.get(block) ?? new Set<number>();
          owners.add(guessedMainId);
          blockOwners.set(block, owners);
        }
        const existingOptions = missionOptionIds.get(guessedMainId) ?? new Set<number>();
        for (const optionId of optionIds) existingOptions.add(optionId);
        missionOptionIds.set(guessedMainId, existingOptions);

        const existingFiles = missionStoryFiles.get(guessedMainId) ?? [];
        existingFiles.push(sFile.path);
        missionStoryFiles.set(guessedMainId, existingFiles);
      }
    }

    // 由演出块还原每段任务的完整对白（含选项句），按台词顺序输出
    for (const block of [...blockOwners.keys()].sort((a, b) => a - b)) {
      const sentences = (blockSentences.get(block) ?? []).sort((a, b) => a.id - b.id);
      for (const mainId of [...(blockOwners.get(block) ?? [])].sort((a, b) => a - b)) {
        const optionIds = missionOptionIds.get(mainId) ?? new Set<number>();
        const existing = missionDialogMap.get(mainId) ?? [];
        const seen = new Set(existing);
        for (const sentence of sentences) {
          let line: string;
          if (optionIds.has(sentence.id) && !sentence.speaker) {
            // 玩家选择肢：无名台词，按选项节点渲染
            line = `[选项] ${sentence.text}`;
          } else {
            line = sentence.speaker ? `${sentence.speaker}：${sentence.text}` : sentence.text;
          }
          if (!seen.has(line)) {
            existing.push(line);
            seen.add(line);
          }
        }
        missionDialogMap.set(mainId, existing);
      }
    }

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
        // Upstream repeats the chapter blurb verbatim on every sub-mission and
        // reuses targets across steps; emit each target change once and each
        // distinct description once so the body does not repeat itself.
        let lastTarget: string | null = null;
        const seenDescs = new Set<string>();
        for (const s of subs) {
          const target = resolveHash(s.TargetText);
          const desc = resolveHash(s.DescrptionText);
          if (!target && !desc) continue;
          if (target && target !== lastTarget) {
            lines.push(`### 阶段目标：${target}`);
            lastTarget = target;
          }
          if (desc && !seenDescs.has(desc)) {
            seenDescs.add(desc);
            lines.push(desc);
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
        // Placeholder rows (same title, no targets/description/dialogue) are
        // duplicates of the real mission and only pollute the quest tree.
        const hasStoryContent = seenDescs.size > 0 || (dialogues?.length ?? 0) > 0;
        if (!hasLikelyNarrativeText(content) || !hasStoryContent) {
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
