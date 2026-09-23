import { resolve } from "node:path";
import { normalizeStarRailText, hasLikelyNarrativeText } from "../corpus/normalizer.js";
import type { ExtractorInput, ExtractorResult } from "./shared.js";
import { readSafeJsonFile } from "./shared.js";

export async function extractStoryAtlasDocuments(input: ExtractorInput): Promise<ExtractorResult> {
  const result: ExtractorResult = { documents: [], issues: [], unresolvedText: 0 };

  const chronicleItem = input.inventory.items.find(
    (i) => i.path === "ExcelOutput/ChronicleConclusion.json",
  );
  const actItem = input.inventory.items.find((i) => i.path === "ExcelOutput/MainStoryActView.json");
  const missionItem = input.inventory.items.find((i) => i.path === "ExcelOutput/MainMission.json");
  const nounItem = input.inventory.items.find((i) => i.path === "ExcelOutput/NounAtlas.json");

  if (!chronicleItem && !nounItem) {
    return result;
  }

  const resolveHash = (val: unknown): string | null => {
    if (!val) return null;
    if (typeof val === "number" || typeof val === "string") return input.resolver.resolve(val);
    if (typeof val === "object") {
      const hash = (val as Record<string, unknown>).Hash ?? (val as Record<string, unknown>).hash;
      return hash ? input.resolver.resolve(hash as string | number) : null;
    }
    return null;
  };

  const actMap = new Map<number, string>();
  if (actItem) {
    const acts = await readSafeJsonFile<Array<Record<string, unknown>>>(
      resolve(input.dataDir, actItem.path),
    );
    if (Array.isArray(acts)) {
      for (const act of acts) {
        const id = Number(act.ID);
        const name = resolveHash(act.Name) || resolveHash(act.ChronicleChapterName);
        if (id && name) actMap.set(id, name);
      }
    }
  }

  const missionMap = new Map<number, Record<string, unknown>>();
  if (missionItem) {
    const missions = await readSafeJsonFile<Array<Record<string, unknown>>>(
      resolve(input.dataDir, missionItem.path),
    );
    if (Array.isArray(missions)) {
      for (const m of missions) {
        const id = Number(m.MainMissionID ?? m.ID);
        if (Number.isInteger(id)) missionMap.set(id, m);
      }
    }
  }

  // 1. ChronicleConclusion (Chapter Story Recap)
  if (chronicleItem) {
    const chronicleRows = await readSafeJsonFile<Array<Record<string, unknown>>>(
      resolve(input.dataDir, chronicleItem.path),
    );
    if (Array.isArray(chronicleRows)) {
      for (const row of chronicleRows) {
        const missionId = Number(row.MissionID);
        if (!Number.isInteger(missionId)) continue;

        const rawConclusion = resolveHash(row.MissionConclusion);
        if (!rawConclusion || !rawConclusion.trim()) continue;

        const mission = missionMap.get(missionId);
        const rawMissionName = mission ? resolveHash(mission.Name) : null;
        const missionName = rawMissionName || `任务 ${missionId}`;

        const worldId = mission?.WorldID ? Number(mission.WorldID) : undefined;
        const chapterName = (worldId ? actMap.get(worldId) : null) || "编年史回顾";

        const title = `${chapterName} · ${missionName}`;
        const content = normalizeStarRailText(`# ${title}\n\n${rawConclusion.trim()}`);

        if (!hasLikelyNarrativeText(content)) {
          result.issues.push({
            code: "empty_or_non_narrative_document",
            message: `Skipped non-narrative chronicle conclusion`,
            sourcePath: chronicleItem.path,
            sourceId: String(missionId),
          });
          continue;
        }

        result.documents.push({
          category: "sr_story_atlas",
          id: missionId,
          relativePath: `sr_story_atlas/${missionId}.txt`,
          title,
          content,
          sourceFiles: [chronicleItem.path],
          sourceIds: [`MissionID:${missionId}`],
          metadata: {
            source: "turn-based-game-data",
            sourceCommit: input.sourceRef,
            sourcePath: chronicleItem.path,
            groupId: `chapter_${worldId ?? 0}`,
            groupName: chapterName,
            textKind: "story-atlas",
          },
          hierarchy: {
            parentId: "sr_story_atlas",
            label: chapterName,
            order: missionId,
          },
        });
      }
    }
  }

  // 2. NounAtlas (Data Bank Lore Entries)
  if (nounItem) {
    const nounRows = await readSafeJsonFile<Array<Record<string, unknown>>>(
      resolve(input.dataDir, nounItem.path),
    );
    if (Array.isArray(nounRows)) {
      let nounSeq = 1;
      for (const row of nounRows) {
        const title = resolveHash(row.NounTitle);
        const desc = resolveHash(row.NounDesc);
        if (!title || !desc || !desc.trim()) continue;

        const content = normalizeStarRailText(`# ${title}\n\n${desc.trim()}`);
        if (!hasLikelyNarrativeText(content)) continue;

        const id = 9000000 + nounSeq++;
        result.documents.push({
          category: "sr_story_atlas",
          id,
          relativePath: `sr_story_atlas/${id}.txt`,
          title,
          content,
          sourceFiles: [nounItem.path],
          sourceIds: [`NounID:${id}`],
          metadata: {
            source: "turn-based-game-data",
            sourceCommit: input.sourceRef,
            sourcePath: nounItem.path,
            groupId: "noun_atlas",
            groupName: "智库名词",
            textKind: "story-atlas",
          },
          hierarchy: {
            parentId: "sr_story_atlas",
            label: "智库名词",
            order: id,
          },
        });
      }
    }
  }

  return result;
}
