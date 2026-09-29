import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ArchiveEmpty, ArchiveLoading } from "../ArchiveStates.js";
import { questTypeLabel } from "../../shared.js";
import type { StoryCatalog as ApiStoryCatalog } from "../../api.js";
import type { StoryCatalogFilters, StoryEntry, StoryTreeNode } from "./story.types.js";

type CatalogFamily = ApiStoryCatalog["regions"][number]["families"][number];
type CatalogSubSeries = NonNullable<CatalogFamily["subseries"]>[number];
type CatalogContainer = CatalogFamily | CatalogSubSeries;
type CatalogQuestEntry = NonNullable<CatalogFamily["quests"]>[number];

export function isForbiddenStoryTitle(title?: string): boolean {
  if (!title) return false;
  return (
    /[（(]\s*(?:test|hide|debug)\s*[)）]/iu.test(title) ||
    /^[（(]\s*test/iu.test(title) ||
    /\$(?:UNRELEASED|HIDDEN|TEST|DEBUG)\$?/iu.test(title) ||
    /【已废弃】|\[已废弃\]/u.test(title)
  );
}

const GENSHIN_TYPE_ORDER: Record<string, { label: string; order: number; icon: string }> = {
  archon_quest: { label: "魔神任务", order: 1, icon: "⚔️" },
  story_quest: { label: "传说任务", order: 2, icon: "👤" },
  world_quest: { label: "世界任务", order: 3, icon: "🌍" },
  event_quest: { label: "活动任务", order: 4, icon: "🎪" },
  hangout: { label: "邀约事件", order: 5, icon: "💌" },
  commission: { label: "每日委托", order: 6, icon: "📜" },
  other: { label: "其他任务", order: 99, icon: "📦" },
};

const STARRAIL_TYPE_ORDER: Record<string, { label: string; order: number; icon: string }> = {
  trailblaze_mission: { label: "开拓任务", order: 1, icon: "🚂" },
  companion_mission: { label: "同行任务", order: 2, icon: "👤" },
  trailblaze_continuation: { label: "开拓续闻", order: 3, icon: "🛤️" },
  adventure_quest: { label: "冒险任务", order: 4, icon: "🌍" },
  daily_mission: { label: "日常任务", order: 5, icon: "📜" },
  event_quest: { label: "活动任务", order: 6, icon: "🎪" },
  other: { label: "其他任务", order: 99, icon: "📦" },
};

function matchesQuestType(
  candidateType: string | undefined,
  filterType: string | undefined,
  isStarRail: boolean,
): boolean {
  if (!filterType) return true;
  if (!candidateType) return true;
  if (candidateType === filterType) return true;
  if (isStarRail) {
    if (
      filterType === "trailblaze_mission" &&
      (candidateType === "archon_quest" || candidateType === "main")
    )
      return true;
    if (filterType === "companion_mission" && candidateType === "story_quest") return true;
    if (filterType === "adventure_quest" && candidateType === "world_quest") return true;
  } else {
    if (
      filterType === "archon_quest" &&
      (candidateType === "main" || candidateType === "trailblaze_mission")
    )
      return true;
    if (filterType === "story_quest" && candidateType === "companion_mission") return true;
    if (filterType === "world_quest" && candidateType === "adventure_quest") return true;
  }
  return false;
}

function getQuestTypeMeta(rawType: string | undefined, isStarRail: boolean) {
  const norm = (rawType ?? "other").toLowerCase();
  const map = isStarRail ? STARRAIL_TYPE_ORDER : GENSHIN_TYPE_ORDER;
  if (map[norm]) return map[norm];
  if (isStarRail) {
    if (norm === "archon_quest" || norm === "main") return STARRAIL_TYPE_ORDER.trailblaze_mission;
    if (norm === "story_quest") return STARRAIL_TYPE_ORDER.companion_mission;
    if (norm === "world_quest") return STARRAIL_TYPE_ORDER.adventure_quest;
  } else {
    if (norm === "trailblaze_mission" || norm === "main") return GENSHIN_TYPE_ORDER.archon_quest;
    if (norm === "companion_mission") return GENSHIN_TYPE_ORDER.story_quest;
    if (norm === "adventure_quest") return GENSHIN_TYPE_ORDER.world_quest;
  }
  return { label: questTypeLabel(norm, isStarRail) || "其他任务", order: 99, icon: "📂" };
}

export function parseStoryOrder(title: string | undefined): number {
  if (!title) return 999999;
  let score = 0;
  let hasSpecific = false;

  const chineseDigits: Record<string, number> = {
    零: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
    十: 10,
  };

  const parseNumber = (raw: string): number => {
    if (!raw) return 0;
    if (/^\d+$/u.test(raw)) return Number(raw);
    if (raw === "十") return 10;
    if (raw.startsWith("十")) return 10 + (chineseDigits[raw[1]] ?? 0);
    if (raw.endsWith("十")) return (chineseDigits[raw[0]] ?? 1) * 10;
    if (raw.includes("十")) {
      const parts = raw.split("十");
      return (chineseDigits[parts[0]] ?? 1) * 10 + (chineseDigits[parts[1]] ?? 0);
    }
    return chineseDigits[raw] ?? 0;
  };

  // 1. Chapter matching (章 / 部 / 篇 / chapter / part)
  const chapMatch =
    title.match(/第\s*([一二三四五六七八九十零\d]+)\s*(?:章|部|篇)/u) ??
    title.match(/\b(?:chapter|part|volume)\s+(\d+|[ivxlcdm]+)\b/iu);
  if (chapMatch?.[1]) {
    score += parseNumber(chapMatch[1]) * 10000;
    hasSpecific = true;
  } else if (/序\s*章|\bprologue\b/iu.test(title)) {
    score += 5000;
    hasSpecific = true;
  } else if (/终\s*章|\b(?:finale|epilogue)\b/iu.test(title)) {
    score += 900000;
    hasSpecific = true;
  }

  // 2. Act matching (幕 / 奏 / act)
  const actMatch =
    title.match(/第\s*([一二三四五六七八九十零\d]+)\s*幕/u) ??
    title.match(/\bact\s+(\d+|[ivxlcdm]+)\b/iu);
  if (actMatch?.[1]) {
    score += parseNumber(actMatch[1]) * 100;
    hasSpecific = true;
  } else if (/序\s*幕|序\s*奏|序\s*曲|\bprelude\b/iu.test(title)) {
    score += 50;
    hasSpecific = true;
  } else if (/幕\s*间|\binterlude\b/iu.test(title)) {
    score += 550;
    hasSpecific = true;
  } else if (/终\s*幕/u.test(title)) {
    score += 9000;
    hasSpecific = true;
  }

  // 3. Section matching (节 / section / part / scene)
  const secMatch =
    title.match(/第\s*([一二三四五六七八九十零\d]+)\s*节/u) ??
    title.match(/\b(?:section|scene)\s+(\d+|[ivxlcdm]+)\b/iu);
  if (secMatch?.[1]) {
    score += parseNumber(secMatch[1]);
    hasSpecific = true;
  }

  const qiMatch = title.match(/其\s*([一二三四五六七八九十\d]+)/u);
  if (qiMatch?.[1]) {
    score += parseNumber(qiMatch[1]);
    hasSpecific = true;
  }
  if (/·上|[•·]上$|\(上\)|（上）/u.test(title)) {
    score += 1;
    hasSpecific = true;
  } else if (/·中|[•·]中$|\(中\)|（中）/u.test(title)) {
    score += 2;
    hasSpecific = true;
  } else if (/·下|[•·]下$|\(下\)|（下）/u.test(title)) {
    score += 3;
    hasSpecific = true;
  }

  if (/终\s*末|\bepilogue\b/iu.test(title)) {
    score += 90;
    hasSpecific = true;
  } else if (/尾\s*声/u.test(title)) {
    score += 95;
    hasSpecific = true;
  }

  if (/续\s*闻/u.test(title)) {
    score += 50000;
    hasSpecific = true;
  }

  return hasSpecific ? score : 999999;
}

export function parseActOrder(title: string | undefined): number {
  return parseStoryOrder(title);
}

export function compareChapterOrder(
  a: { name?: string; title?: string; order?: number },
  b: { name?: string; title?: string; order?: number },
): number {
  const nameA = a.name ?? a.title ?? "";
  const nameB = b.name ?? b.title ?? "";
  const naturalA = parseStoryOrder(nameA);
  const naturalB = parseStoryOrder(nameB);

  if (naturalA !== 999999 && naturalB !== 999999) {
    if (naturalA !== naturalB) return naturalA - naturalB;
  } else if (naturalA !== 999999) {
    return -1;
  } else if (naturalB !== 999999) {
    return 1;
  }

  return (a.order ?? 0) - (b.order ?? 0) || nameA.localeCompare(nameB, "zh-Hans-CN");
}

/**
 * Pure hierarchy builder:
 * Region / World
 * └─ (Type / Category if available)
 *    └─ Story family
 *       └─ Chapter
 *          └─ Quest
 * Fallback to Series -> Chapter -> Quest if catalog regions unavailable.
 */
export function buildStoryTree(
  entries: StoryEntry[],
  catalog?: ApiStoryCatalog | null,
  queryFilter?: string,
  isStarRail = false,
  typeFilter?: string,
  regionFilter?: string,
): StoryTreeNode[] {
  const query = (queryFilter || "").trim().toLowerCase();

  if (catalog && catalog.regions && catalog.regions.length > 0) {
    const searchMatches =
      query && entries.length > 0 ? new Set(entries.map((entry) => entry.questKey)) : undefined;
    const result: StoryTreeNode[] = [];
    for (const region of catalog.regions) {
      if (regionFilter && region.id !== regionFilter) continue;
      const regionNode: StoryTreeNode = {
        id: `region:${region.id}`,
        type: "region",
        title: region.name,
        order: region.order,
        children: [],
      };
      const regionEntries: CatalogQuestEntry[] = [
        ...(region.quests ?? []),
        ...(region.collections ?? []),
      ];
      const regionKeys = (id: string): string[] => [
        id,
        `quest/${id}`,
        `mission/${id}`,
        id.replace(/^(?:quest|mission)\//u, ""),
      ];
      const nestedRegionKeys = new Set(
        regionEntries
          .filter((entry) => entry.entryType === "collection" || entry.entryType === "aggregate")
          .flatMap((entry) => (entry.aggregateChildQuestIds ?? []).flatMap(regionKeys)),
      );
      const isForbiddenEntry = (entry: CatalogQuestEntry): boolean =>
        entry.questKey === "quest/5003" ||
        entry.questKey === "mission/5003" ||
        entry.questKey === "5003" ||
        isForbiddenStoryTitle(entry.title) ||
        isForbiddenStoryTitle(entry.displayTitle);

      const regionMatches = (entry: CatalogQuestEntry) => {
        if (isForbiddenEntry(entry)) return false;
        if (typeFilter && !matchesQuestType(entry.questType, typeFilter, isStarRail)) return false;
        return (
          !query ||
          searchMatches?.has(entry.questKey) ||
          (entry.displayTitle ?? entry.title).toLowerCase().includes(query) ||
          entry.title.toLowerCase().includes(query) ||
          region.name.toLowerCase().includes(query)
        );
      };
      const regionQuestNode = (entry: CatalogQuestEntry): StoryTreeNode => ({
        id: `quest:${entry.questKey}`,
        type: "quest",
        title: entry.displayTitle ?? entry.title,
        order: entry.order,
        questKey: entry.questKey,
      });

      const directChildren: Array<{ node: StoryTreeNode; questType?: string; order: number }> = [];

      for (const collection of (region.collections ?? [])
        .filter(regionMatches)
        .sort((a, b) => a.order - b.order || a.questKey.localeCompare(b.questKey))) {
        const childKeys = new Set((collection.aggregateChildQuestIds ?? []).flatMap(regionKeys));
        const collectionNode: StoryTreeNode = {
          id: `collection:${collection.questKey}`,
          type: "collection",
          title: collection.displayTitle ?? collection.title,
          order: collection.order,
          children: (region.quests ?? [])
            .filter(
              (candidate) =>
                !["collection", "aggregate"].includes(candidate.entryType ?? "quest") &&
                (childKeys.has(candidate.questKey) ||
                  candidate.parentQuestId === collection.questKey ||
                  candidate.parentQuestId === collection.questKey.replace(/^quest\//u, "")),
            )
            .filter(regionMatches)
            .map(regionQuestNode),
        };
        directChildren.push({
          node: collectionNode,
          questType: collection.questType,
          order: collection.order,
        });
      }

      for (const entry of (region.quests ?? [])
        .filter((entry) => !nestedRegionKeys.has(entry.questKey) && regionMatches(entry))
        .sort((a, b) => a.order - b.order || a.questKey.localeCompare(b.questKey))) {
        directChildren.push({
          node: regionQuestNode(entry),
          questType: entry.questType,
          order: entry.order,
        });
      }

      const families = region.families?.length
        ? region.families
        : [
            {
              id: `legacy:${region.id}`,
              name: "其他独立任务",
              order: 0,
              provenance: "fallback" as const,
              chapters: region.chapters,
            },
          ];

      const familyChildren: Array<{ node: StoryTreeNode; questType?: string; order: number }> = [];

      // Merge families with the same name in the same region to eliminate duplicate folders
      const mergedFamilies: CatalogFamily[] = [];
      const familyByTitle = new Map<string, CatalogFamily>();
      for (const family of families) {
        if (isForbiddenStoryTitle(family.name)) continue;
        const normalizedTitle = family.name.trim();
        const existing = familyByTitle.get(normalizedTitle);
        if (!existing) {
          const clone: CatalogFamily = {
            ...family,
            chapters: [...family.chapters],
            quests: family.quests ? [...family.quests] : [],
            collections: family.collections ? [...family.collections] : [],
            subseries: family.subseries ? [...family.subseries] : [],
          };
          familyByTitle.set(normalizedTitle, clone);
          mergedFamilies.push(clone);
        } else {
          existing.order = Math.min(existing.order, family.order);
          if (family.quests) existing.quests = [...(existing.quests ?? []), ...family.quests];
          if (family.collections)
            existing.collections = [...(existing.collections ?? []), ...family.collections];
          for (const chapter of family.chapters) {
            const existingChap = existing.chapters.find(
              (c) => c.name === chapter.name || c.id === chapter.id,
            );
            if (!existingChap) {
              existing.chapters.push(chapter);
            } else {
              existingChap.order = Math.min(existingChap.order, chapter.order);
              existingChap.quests = [...existingChap.quests, ...chapter.quests];
              if (chapter.collections) {
                existingChap.collections = [
                  ...(existingChap.collections ?? []),
                  ...chapter.collections,
                ];
              }
            }
          }
          for (const sub of family.subseries ?? []) {
            existing.subseries ??= [];
            const existingSub = existing.subseries.find(
              (s) => s.name === sub.name || s.id === sub.id,
            );
            if (!existingSub) {
              existing.subseries.push(sub);
            } else {
              existingSub.order = Math.min(existingSub.order, sub.order);
              if (sub.quests) existingSub.quests = [...(existingSub.quests ?? []), ...sub.quests];
              if (sub.collections)
                existingSub.collections = [...(existingSub.collections ?? []), ...sub.collections];
              for (const chapter of sub.chapters) {
                const existingChap = existingSub.chapters.find(
                  (c) => c.name === chapter.name || c.id === chapter.id,
                );
                if (!existingChap) {
                  existingSub.chapters.push(chapter);
                } else {
                  existingChap.order = Math.min(existingChap.order, chapter.order);
                  existingChap.quests = [...existingChap.quests, ...chapter.quests];
                  if (chapter.collections) {
                    existingChap.collections = [
                      ...(existingChap.collections ?? []),
                      ...chapter.collections,
                    ];
                  }
                }
              }
            }
          }
        }
      }

      for (const family of mergedFamilies) {
        family.chapters.sort(compareChapterOrder);
        for (const sub of family.subseries ?? []) {
          sub.chapters.sort(compareChapterOrder);
        }
      }
      mergedFamilies.sort(compareChapterOrder);

      for (const family of mergedFamilies) {
        const familyNode: StoryTreeNode = {
          id: `family:${region.id}:${family.id}`,
          type: "series",
          title: family.name,
          order: family.order,
          children: [],
        };
        const containerEntries = (container: CatalogContainer): CatalogQuestEntry[] => [
          ...(container.quests ?? []),
          ...(container.collections ?? []),
          ...container.chapters.flatMap((chapter) => [
            ...chapter.quests,
            ...(chapter.collections ?? []),
          ]),
        ];
        const allFamilyEntries = [
          ...containerEntries(family),
          ...(family.subseries ?? []).flatMap(containerEntries),
        ];

        const matchingEntry = allFamilyEntries.find(
          (e) =>
            Boolean(e.questType) &&
            (!typeFilter || matchesQuestType(e.questType, typeFilter, isStarRail)),
        );
        const familyQuestType =
          matchingEntry?.questType ??
          allFamilyEntries.find((e) => Boolean(e.questType))?.questType;
        if (
          typeFilter &&
          !matchesQuestType(familyQuestType, typeFilter, isStarRail) &&
          !allFamilyEntries.some((e) => matchesQuestType(e.questType, typeFilter, isStarRail))
        ) {
          continue;
        }

        const normalizedQuestKeys = (id: string): string[] => [
          id,
          `quest/${id}`,
          `mission/${id}`,
          id.replace(/^(?:quest|mission)\//u, ""),
        ];
        const nestedQuestKeys = new Set(
          allFamilyEntries
            .filter((entry) => entry.entryType === "collection" || entry.entryType === "aggregate")
            .flatMap((entry) => (entry.aggregateChildQuestIds ?? []).flatMap(normalizedQuestKeys)),
        );
        const matchesEntry = (q: CatalogQuestEntry, contextTitle?: string) => {
          if (isForbiddenEntry(q)) return false;
          if (typeFilter && !matchesQuestType(q.questType, typeFilter, isStarRail)) return false;
          if (!query) return true;
          const title = (q.displayTitle ?? q.title).toLowerCase();
          const localMatch =
            title.includes(query) ||
            q.title.toLowerCase().includes(query) ||
            (contextTitle ?? "").toLowerCase().includes(query) ||
            family.name.toLowerCase().includes(query) ||
            region.name.toLowerCase().includes(query);
          return searchMatches?.has(q.questKey) || localMatch;
        };
        const questNode = (q: CatalogQuestEntry): StoryTreeNode => ({
          id: `quest:${q.questKey}`,
          type: "quest",
          title: q.displayTitle ?? q.title,
          order: q.order,
          questKey: q.questKey,
        });
        const collectionNode = (q: CatalogQuestEntry): StoryTreeNode => {
          const childIds = new Set((q.aggregateChildQuestIds ?? []).flatMap(normalizedQuestKeys));
          const children = allFamilyEntries
            .filter(
              (candidate) =>
                candidate.entryType !== "collection" &&
                candidate.entryType !== "aggregate" &&
                (childIds.has(candidate.questKey) ||
                  candidate.parentQuestId === q.questKey ||
                  candidate.parentQuestId === q.questKey.replace(/^(?:quest|mission)\//u, "") ||
                  candidate.parentQuestId === q.questKey.replace(/^quest\//u, "")),
            )
            .filter((candidate) => matchesEntry(candidate, q.title))
            .sort((a, b) => a.order - b.order || a.questKey.localeCompare(b.questKey))
            .map(questNode);
          return {
            id: `collection:${q.questKey}`,
            type: "collection",
            title: q.displayTitle ?? q.title,
            order: q.order,
            children,
          };
        };
        const isNested = (q: CatalogQuestEntry): boolean =>
          normalizedQuestKeys(q.questKey).some((key) => nestedQuestKeys.has(key));
        const appendContainer = (
          parent: StoryTreeNode,
          container: CatalogContainer,
          scopeId: string,
          contextTitle: string,
        ): void => {
          const direct = container.quests ?? [];
          const collections = (container.collections ?? [])
            .filter((entry) => matchesEntry(entry, contextTitle))
            .sort((a, b) => a.order - b.order || a.questKey.localeCompare(b.questKey));
          const directEntries = direct
            .filter((entry) => !isNested(entry) && matchesEntry(entry, contextTitle))
            .sort((a, b) => a.order - b.order || a.questKey.localeCompare(b.questKey));
          parent.children!.push(
            ...collections.map(collectionNode),
            ...directEntries.map(questNode),
          );
          const sortedChapters = [...container.chapters].sort(compareChapterOrder);
          for (const chapter of sortedChapters) {
            if (isForbiddenStoryTitle(chapter.name)) continue;
            const chapterCollections = (chapter.collections ?? [])
              .filter((entry) => matchesEntry(entry, chapter.name))
              .sort((a, b) => a.order - b.order || a.questKey.localeCompare(b.questKey));
            const chapterQuests = chapter.quests
              .filter((entry) => !isNested(entry) && matchesEntry(entry, chapter.name))
              .sort(
                (a, b) =>
                  compareChapterOrder(
                    { title: a.displayTitle ?? a.title, order: a.order },
                    { title: b.displayTitle ?? b.title, order: b.order },
                  ) || a.questKey.localeCompare(b.questKey),
              );
            if (chapterCollections.length === 0 && chapterQuests.length === 0) continue;
            parent.children!.push({
              id: `chapter:${scopeId}:${chapter.id}`,
              type: "chapter",
              title: chapter.name,
              order: parseStoryOrder(chapter.name) !== 999999 ? parseStoryOrder(chapter.name) : (chapter.order ?? 999999),
              children: [
                ...chapterCollections.map(collectionNode),
                ...chapterQuests.map(questNode),
              ],
            });
          }
          parent.children!.sort(compareChapterOrder);
        };
        appendContainer(familyNode, family, `${region.id}:${family.id}`, family.name);
        for (const subseries of family.subseries ?? []) {
          if (isForbiddenStoryTitle(subseries.name)) continue;
          const subseriesNode: StoryTreeNode = {
            id: `subseries:${region.id}:${family.id}:${subseries.id}`,
            type: "subseries",
            title: subseries.name,
            order: subseries.order,
            children: [],
          };
          appendContainer(
            subseriesNode,
            subseries,
            `${region.id}:${family.id}:${subseries.id}`,
            subseries.name,
          );
          if (subseriesNode.children!.length > 0) familyNode.children!.push(subseriesNode);
        }
        familyNode.children!.sort(compareChapterOrder);
        if (familyNode.children!.length > 0) {
          familyChildren.push({
            node: familyNode,
            questType: familyQuestType,
            order: family.order,
          });
        }
      }

      const allRegionChildren = [...directChildren, ...familyChildren];

      if (typeFilter) {
        regionNode.children = allRegionChildren.map((item) => item.node);
        regionNode.children.sort(compareChapterOrder);
      } else {
        const hasTypeInfo = allRegionChildren.some((item) => Boolean(item.questType));
        if (hasTypeInfo) {
          const typeGroups = new Map<string, StoryTreeNode>();
          for (const item of allRegionChildren) {
            const meta = getQuestTypeMeta(item.questType, isStarRail);
            let typeGroup = typeGroups.get(meta.label);
            if (!typeGroup) {
              typeGroup = {
                id: `type:${region.id}:${meta.label}`,
                type: "type",
                title: meta.label,
                order: meta.order,
                children: [],
              };
              typeGroups.set(meta.label, typeGroup);
            }
            typeGroup.children!.push(item.node);
          }
          for (const typeGroup of typeGroups.values()) {
            typeGroup.children?.sort(compareChapterOrder);
          }
          regionNode.children = [...typeGroups.values()].sort(
            (a, b) =>
              (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title, "zh-Hans-CN"),
          );
        } else {
          regionNode.children = allRegionChildren.map((item) => item.node);
          regionNode.children.sort(compareChapterOrder);
        }
      }

      if (regionNode.children.length > 0) {
        result.push(regionNode);
      }
    }
    for (const region of result) {
      region.children?.sort(
        (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title, "zh-Hans-CN"),
      );
      for (const child of region.children ?? []) {
        child.children?.sort(compareChapterOrder);
      }
    }
    result.sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title, "zh-Hans-CN"),
    );
    if (result.length > 0) return result;
  }

  // Fallback to seriesMap from entries
  const seriesMap = new Map<string, Map<string, StoryEntry[]>>();
  for (const entry of entries) {
    if (
      entry.questKey === "quest/5003" ||
      entry.questKey === "mission/5003" ||
      entry.questKey === "5003" ||
      isForbiddenStoryTitle(entry.title) ||
      isForbiddenStoryTitle(entry.chapter) ||
      isForbiddenStoryTitle(entry.series)
    ) {
      continue;
    }
    if (typeFilter && !matchesQuestType(entry.type, typeFilter, isStarRail)) {
      continue;
    }
    if (
      query &&
      !entry.title.toLowerCase().includes(query) &&
      !(entry.chapter || "").toLowerCase().includes(query) &&
      !(entry.series || "").toLowerCase().includes(query)
    ) {
      continue;
    }
    const rawSeries = entry.series?.trim();
    const isPureNumericSeries = rawSeries && /^\d+$/.test(rawSeries);
    const seriesTitle =
      (!isPureNumericSeries && rawSeries) ||
      questTypeLabel(entry.type, isStarRail) ||
      (isStarRail ? "开拓篇章" : "其他任务");

    const rawChapter = entry.chapter?.trim() || "";
    const isPureNumericChapter = /^\d+$/.test(rawChapter);
    const chapterTitle = !isPureNumericChapter ? rawChapter : "";

    if (!seriesMap.has(seriesTitle)) {
      seriesMap.set(seriesTitle, new Map());
    }
    const chapterMap = seriesMap.get(seriesTitle)!;
    if (!chapterMap.has(chapterTitle)) {
      chapterMap.set(chapterTitle, []);
    }
    chapterMap.get(chapterTitle)!.push(entry);
  }

  const seriesOrder: Record<string, number> = isStarRail
    ? {
        开拓任务: 1,
        同行任务: 2,
        开拓续闻: 3,
        冒险任务: 4,
        日常任务: 5,
        活动任务: 6,
        散篇剧情: 7,
        其他任务: 99,
      }
    : {
        魔神任务: 1,
        传说任务: 2,
        世界任务: 3,
        活动任务: 4,
        每日委托: 5,
        邀约事件: 6,
        其他任务: 99,
      };

  const result: StoryTreeNode[] = [];
  for (const [seriesTitle, chapterMap] of seriesMap) {
    const seriesNode: StoryTreeNode = {
      id: `series:${seriesTitle}`,
      type: "series",
      title: seriesTitle,
      children: [],
    };

    for (const [chapterTitle, chapterEntries] of chapterMap) {
      const questNodes: StoryTreeNode[] = chapterEntries.map((entry) => ({
        id: `quest:${entry.questKey}`,
        type: "quest",
        title: entry.title,
        questKey: entry.questKey,
      }));

      if (chapterTitle) {
        seriesNode.children!.push({
          id: `chapter:${seriesTitle}:${chapterTitle}`,
          type: "chapter",
          title: chapterTitle,
          children: questNodes,
        });
      } else {
        seriesNode.children!.push(...questNodes);
      }
    }
    result.push(seriesNode);
  }

  result.sort((a, b) => (seriesOrder[a.title] ?? 50) - (seriesOrder[b.title] ?? 50));
  return result;
}

export function flattenStoryTreeQuests(
  nodes: StoryTreeNode[],
): Array<{ questKey: string; title: string }> {
  const result: Array<{ questKey: string; title: string }> = [];
  for (const node of nodes) {
    if (node.type === "quest" && node.questKey) {
      result.push({ questKey: node.questKey, title: node.title });
    }
    if (node.children?.length) {
      result.push(...flattenStoryTreeQuests(node.children));
    }
  }
  return result;
}

export function StoryCatalog({
  filters,
  entries,
  catalog,
  loading,
  activeQuestKey,
  isStarRail = false,
  onFilters,
  onSelect,
}: {
  filters: StoryCatalogFilters;
  entries: StoryEntry[];
  catalog?: ApiStoryCatalog | null;
  loading: boolean;
  activeQuestKey?: string;
  isStarRail?: boolean;
  onFilters: (next: Partial<StoryCatalogFilters>) => void;
  onSelect: (entry: { questKey: string; title: string }) => void;
}) {
  const [queryDraft, setQueryDraft] = useState(filters.query);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Keep draft in sync if external filters change
  useEffect(() => {
    setQueryDraft(filters.query);
  }, [filters.query]);

  const tree = useMemo(
    () => buildStoryTree(entries, catalog, filters.query, isStarRail, filters.type, filters.region),
    [entries, catalog, filters.query, isStarRail, filters.type, filters.region],
  );

  const isSearching = Boolean(filters.query?.trim());

  // Automatically expand path to activeQuestKey
  useEffect(() => {
    if (!activeQuestKey || !tree.length) return;
    setExpandedIds((prev) => {
      const next = new Set(prev);
      const visit = (node: StoryTreeNode): boolean => {
        if (node.questKey === activeQuestKey) return true;
        const childHasActive = node.children?.some(visit) ?? false;
        if (childHasActive) next.add(node.id);
        return childHasActive;
      };
      tree.forEach(visit);
      return next;
    });
  }, [activeQuestKey, tree]);

  // When filtering by a specific region, auto expand the region and its immediate series
  useEffect(() => {
    if (filters.region && tree.length > 0) {
      setExpandedIds((prev) => {
        const next = new Set(prev);
        for (const node of tree) {
          next.add(node.id);
          for (const child of node.children ?? []) {
            next.add(child.id);
          }
        }
        return next;
      });
    }
  }, [filters.region, tree]);

  const hasInitializedExpansionRef = useRef(false);

  // Reset expansion initialization when game or catalog changes
  useEffect(() => {
    hasInitializedExpansionRef.current = false;
  }, [isStarRail, catalog]);

  // Default expand first region and its first child ONCE when tree is first ready and no active quest
  useEffect(() => {
    if (hasInitializedExpansionRef.current) return;
    if (!activeQuestKey && tree.length > 0 && !isSearching) {
      const initial = new Set<string>([tree[0].id]);
      if (tree[0].children?.[0]) {
        initial.add(tree[0].children[0].id);
        if (tree[0].children[0].type === "type" && tree[0].children[0].children?.[0]) {
          initial.add(tree[0].children[0].children[0].id);
        }
      }
      setExpandedIds(initial);
      hasInitializedExpansionRef.current = true;
    }
  }, [activeQuestKey, tree, isSearching]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expandAll() {
    const all = new Set<string>();
    const collect = (node: StoryTreeNode) => {
      all.add(node.id);
      node.children?.forEach(collect);
    };
    tree.forEach(collect);
    setExpandedIds(all);
  }

  function collapseAll() {
    setExpandedIds(new Set());
  }


  const regionChips = useMemo(() => {
    const list: Array<{ id: string; label: string }> = [
      { id: "", label: isStarRail ? "全部星区" : "全部大区" },
    ];
    if (catalog?.regions?.length) {
      for (const r of catalog.regions) {
        list.push({ id: r.id, label: r.name });
      }
    } else if (isStarRail) {
      list.push(
        { id: "herta_space_station", label: "黑塔空间站" },
        { id: "jarilo_vi", label: "雅利洛-VI" },
        { id: "xianzhou_luofu", label: "仙舟「罗浮」" },
        { id: "penacony", label: "匹诺康尼" },
        { id: "amphoreus", label: "翁法罗斯" },
      );
    } else {
      list.push(
        { id: "mondstadt", label: "蒙德" },
        { id: "liyue", label: "璃月" },
        { id: "inazuma", label: "稻妻" },
        { id: "sumeru", label: "须弥" },
        { id: "fontaine", label: "枫丹" },
        { id: "natlan", label: "纳塔" },
        { id: "nod_krai", label: "诺德卡莱" },
        { id: "snezhnaya", label: "至冬" },
        { id: "the_chasm_underground", label: "层岩地下" },
        { id: "enkanomiya", label: "渊下宫" },
        { id: "sea_of_bygone_eras", label: "旧日之海" },
        { id: "simulanka", label: "限时世界" },
        { id: "system_guidance", label: "系统引导" },
      );
    }
    return list;
  }, [catalog?.regions, isStarRail]);

  const typeSegments = useMemo(() => {
    if (isStarRail) {
      return [
        { value: "", label: "全部" },
        { value: "trailblaze_mission", label: "开拓" },
        { value: "companion_mission", label: "同行" },
        { value: "trailblaze_continuation", label: "续闻" },
        { value: "adventure_quest", label: "冒险" },
      ];
    }
    return [
      { value: "", label: "全部" },
      { value: "archon_quest", label: "魔神" },
      { value: "story_quest", label: "传说" },
      { value: "world_quest", label: "世界" },
      { value: "event_quest", label: "活动" },
    ];
  }, [isStarRail]);

  function getTypeSemanticIcon(title: string): string {
    if (/魔神|开拓/u.test(title)) return "⚔️";
    if (/传说|同行/u.test(title)) return "👤";
    if (/世界|冒险/u.test(title)) return "🌍";
    if (/活动/u.test(title)) return "🎪";
    if (/邀约/u.test(title)) return "💌";
    if (/委托|日常/u.test(title)) return "📜";
    if (/开拓续闻/u.test(title)) return "🛤️";
    return "📂";
  }

  function renderNode(node: StoryTreeNode): ReactNode {
    if (node.type === "quest") {
      const isActive = node.questKey === activeQuestKey;
      return (
        <button
          type="button"
          key={node.id}
          className={`story-tree-quest ${isActive ? "is-active" : ""}`}
          aria-current={isActive ? "page" : undefined}
          onClick={() => node.questKey && onSelect({ questKey: node.questKey, title: node.title })}
        >
          <span className="story-tree-bullet-icon" aria-hidden="true">
            ·
          </span>
          <span className="story-tree-title-text">{node.title}</span>
        </button>
      );
    }

    const isExpanded = isSearching || expandedIds.has(node.id);
    const isRegion = node.type === "region";
    const isType = node.type === "type";
    const isSeries = node.type === "series";
    const isSubseries = node.type === "subseries";
    const isChapter = node.type === "chapter";
    const isCollection = node.type === "collection";

    const semanticIcon = isRegion
      ? "🌐"
      : isType
        ? getTypeSemanticIcon(node.title)
        : isSeries
          ? "📖"
          : isSubseries
            ? "📂"
            : isChapter
              ? "🔖"
              : isCollection
                ? "📦"
                : "";

    const containerClass = `story-tree-node story-tree-${node.type}`;
    const headerClass = `story-tree-header story-tree-${node.type}-header`;

    return (
      <section key={node.id} className={containerClass} role="treeitem" aria-expanded={isExpanded}>
        <button
          type="button"
          className={headerClass}
          aria-expanded={isExpanded}
          onClick={() => {
            toggleExpand(node.id);
            if (!isExpanded && isChapter && node.children?.[0]?.questKey) {
              const firstQuest = node.children[0];
              onSelect({ questKey: firstQuest.questKey!, title: firstQuest.title });
            }
          }}
        >
          <span className="story-tree-toggle-icon" aria-hidden="true">
            {isExpanded ? "▾" : "▸"}
          </span>
          {semanticIcon ? (
            <span className="story-tree-semantic-icon" aria-hidden="true">
              {semanticIcon}
            </span>
          ) : null}
          {isRegion || isType ? (
            <strong className="story-tree-title-primary">{node.title}</strong>
          ) : isSeries ? (
            <strong className="story-tree-title-series">{node.title}</strong>
          ) : (
            <span className="story-tree-title-detail">{node.title}</span>
          )}
        </button>
        {isExpanded && node.children?.length ? (
          <div
            className={`story-tree-children story-tree-${node.type}-children`}
            role="group"
          >
            {node.children.map(renderNode)}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <div className="story-catalog">
      <div className="story-catalog-topbar">
        <div className="story-search-box">
          <span className="story-search-icon" aria-hidden="true">
            🔍
          </span>
          <input
            aria-label="搜索任务"
            placeholder="搜索任务、章节、台词..."
            value={queryDraft}
            onChange={(event) => {
              setQueryDraft(event.target.value);
              onFilters({ query: event.target.value });
            }}
          />
          {queryDraft ? (
            <button
              type="button"
              className="story-search-clear"
              aria-label="清除搜索"
              onClick={() => {
                setQueryDraft("");
                onFilters({ query: "" });
              }}
            >
              ✕
            </button>
          ) : null}
        </div>
        <div className="story-catalog-tools">
          <button
            type="button"
            className="story-tool-btn"
            title="全部折叠"
            onClick={collapseAll}
            aria-label="全部折叠"
          >
            折叠
          </button>
          <button
            type="button"
            className="story-tool-btn"
            title="全部展开"
            onClick={expandAll}
            aria-label="全部展开"
          >
            展开
          </button>
          <button
            type="button"
            className="story-locale-toggle"
            title="切换任务语言（中/英）"
            onClick={() => onFilters({ locale: filters.locale === "en" ? "zh-CN" : "en" })}
          >
            {filters.locale === "en" ? "🇬🇧 EN" : "🇨🇳 中"}
          </button>
        </div>
      </div>

      <div className="story-chips-wrapper" role="radiogroup" aria-label="大区筛选">
        {regionChips.map((chip) => {
          const isActive = (filters.region ?? "") === chip.id;
          return (
            <button
              key={chip.id || "all"}
              type="button"
              className={`story-chip ${isActive ? "is-active" : ""}`}
              aria-checked={isActive}
              onClick={() => onFilters({ region: isActive && chip.id ? "" : chip.id })}
            >
              {chip.label}
            </button>
          );
        })}
      </div>

      <div className="story-type-segmented" role="radiogroup" aria-label="类型筛选">
        {typeSegments.map((seg) => {
          const isActive = (filters.type ?? "") === seg.value;
          return (
            <button
              key={seg.value || "all"}
              type="button"
              className={`story-type-btn ${isActive ? "is-active" : ""}`}
              aria-checked={isActive}
              onClick={() => onFilters({ type: seg.value })}
            >
              {seg.label}
            </button>
          );
        })}
      </div>

      <div className="story-catalog-tree" role="tree" aria-label="剧情目录">
        {loading ? (
          <ArchiveLoading label="任务目录加载中" />
        ) : tree.length ? (
          tree.map(renderNode)
        ) : (
          <ArchiveEmpty
            title={isStarRail ? "暂无星铁开拓任务" : "没有任务结果"}
            detail={
              isStarRail
                ? "当前筛选条件下暂无任务，可尝试调整大区或类型。"
                : "尝试切换大区、类型或清除搜索关键词。"
            }
          />
        )}
      </div>
    </div>
  );
}
