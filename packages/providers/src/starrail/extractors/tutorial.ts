import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseSourceJson } from "../source/json.js";
import { normalizeStarRailText, hasLikelyNarrativeText } from "../corpus/normalizer.js";
import { naturalId } from "../corpus/ids.js";
import type { ExtractorInput, ExtractorResult } from "./shared.js";
import { firstResolved } from "./shared.js";

/**
 * Tutorial and gameplay-guide text lives in dedicated tables rather than the
 * story corpus. Group rows carry the short label ("战技点") while the detail
 * rows carry the explanation, so both are joined into one readable entry.
 */
const TUTORIAL_SOURCES = {
  guideGroup: "ExcelOutput/TutorialGuideGroup.json",
  guideData: "ExcelOutput/TutorialGuideData.json",
  gameplayGuide: "ExcelOutput/GameplayGuideData.json",
  gameplayGuideTab: "ExcelOutput/GameplayGuideTab.json",
} as const;

async function loadTable(
  input: ExtractorInput,
  relativePath: string,
): Promise<Record<string, unknown>[]> {
  const item = input.inventory.items.find((candidate) => candidate.path === relativePath);
  if (!item) return [];
  const raw = await readFile(resolve(input.dataDir, relativePath), "utf8");
  const parsed = parseSourceJson<unknown>(raw);
  if (Array.isArray(parsed)) return parsed.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
  if (parsed && typeof parsed === "object") {
    return Object.values(parsed as Record<string, unknown>).filter(
      (row): row is Record<string, unknown> => Boolean(row) && typeof row === "object",
    );
  }
  return [];
}

export async function extractTutorialDocuments(input: ExtractorInput): Promise<ExtractorResult> {
  const result: ExtractorResult = { documents: [], issues: [], unresolvedText: 0 };
  const [groups, details, guides, tabs] = await Promise.all([
    loadTable(input, TUTORIAL_SOURCES.guideGroup),
    loadTable(input, TUTORIAL_SOURCES.guideData),
    loadTable(input, TUTORIAL_SOURCES.gameplayGuide),
    loadTable(input, TUTORIAL_SOURCES.gameplayGuideTab),
  ]);
  if (!groups.length && !details.length && !guides.length) return result;

  const detailById = new Map<string, Record<string, unknown>>();
  for (const row of details) {
    const id = String(row.ID ?? "");
    if (id) detailById.set(id, row);
  }

  const push = (
    id: number,
    title: string | undefined,
    body: string | undefined,
    sourcePath: string,
    metadata: Record<string, unknown>,
  ) => {
    const content = normalizeStarRailText(body ?? "");
    if (!content || !hasLikelyNarrativeText(content)) {
      result.issues.push({
        code: "empty_or_non_narrative_document",
        message: "Skipped tutorial row without readable body",
        sourcePath,
        sourceId: String(id),
      });
      return;
    }
    result.documents.push({
      category: "sr_tutorial",
      id,
      relativePath: `sr_tutorial/${id}.txt`,
      title: normalizeStarRailText(title ?? "") || `教程 ${id}`,
      content,
      sourceFiles: [sourcePath],
      sourceIds: [`TutorialID:${id}`],
      metadata: {
        source: "turn-based-game-data",
        sourceCommit: input.sourceRef,
        sourcePath,
        textKind: "tutorials",
        groupId: "tutorial/basic",
        groupName: "基础教程",
        ...metadata,
      },
      hierarchy: { parentId: "sr_tutorial", label: "Tutorial", order: id },
    });
  };

  for (const group of groups) {
    const groupId = Number(group.GroupID);
    if (!Number.isInteger(groupId)) continue;
    const title = firstResolved(group, ["MessageText"], {
      resolver: input.resolver,
      sourcePath: TUTORIAL_SOURCES.guideGroup,
      index: 0,
      issues: result.issues,
    });
    const ids = Array.isArray(group.TutorialGuideIDList) ? group.TutorialGuideIDList : [];
    const bodies: string[] = [];
    for (const rawId of ids) {
      const detail = detailById.get(String(rawId));
      if (!detail) continue;
      const text = firstResolved(detail, ["DescText"], {
        resolver: input.resolver,
        sourcePath: TUTORIAL_SOURCES.guideData,
        index: 0,
        issues: result.issues,
      });
      if (text) bodies.push(text);
    }
    push(groupId, title, bodies.join("\n\n"), TUTORIAL_SOURCES.guideGroup, {
      tutorialType: group.TutorialType ?? null,
      order: group.Order ?? groupId,
    });
  }

  for (const tab of tabs) {
    const id = naturalId(Number(tab.ID));
    if (!id) continue;
    const title = firstResolved(tab, ["Name"], {
      resolver: input.resolver,
      sourcePath: TUTORIAL_SOURCES.gameplayGuideTab,
      index: 0,
      issues: result.issues,
    });
    const body = firstResolved(tab, ["Desc"], {
      resolver: input.resolver,
      sourcePath: TUTORIAL_SOURCES.gameplayGuideTab,
      index: 0,
      issues: result.issues,
    });
    push(id, title, body, TUTORIAL_SOURCES.gameplayGuideTab, {
      guideType: tab.GuideType ?? null,
      textKind: "guides",
      groupId: "guide/gameplay",
      groupName: "引导指南",
    });
  }

  for (const guide of guides) {
    const id = naturalId(Number(guide.ID));
    if (!id) continue;
    const title = firstResolved(guide, ["Name"], {
      resolver: input.resolver,
      sourcePath: TUTORIAL_SOURCES.gameplayGuide,
      index: 0,
      issues: result.issues,
    });
    push(id + 1_000_000, title, title, TUTORIAL_SOURCES.gameplayGuide, {
      textKind: "guides",
      groupId: "guide/gameplay",
      groupName: "引导指南",
    });
  }

  return result;
}

