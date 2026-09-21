import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { ArchiveEmpty, ArchiveLoading } from "../ArchiveStates.js";
import { getQuestTypeOptions, questTypeLabel, questTypeOptions } from "../../shared.js";
import type { StoryCatalog as ApiStoryCatalog } from "../../api.js";
import type { StoryCatalogFilters, StoryEntry, StoryTreeNode } from "./story.types.js";

/**
 * Pure hierarchy builder:
 * Region / World
 * └─ Story family
 *    └─ Chapter
 *       └─ Quest
 * Fallback to Series -> Chapter -> Quest if catalog regions unavailable.
 */
export function buildStoryTree(
  entries: StoryEntry[],
  catalog?: ApiStoryCatalog | null,
  queryFilter?: string,
  isStarRail = false,
): StoryTreeNode[] {
  const query = (queryFilter || "").trim().toLowerCase();

  if (catalog && catalog.regions && catalog.regions.length > 0) {
    // The catalog carries the complete hierarchy, while the search endpoint
    // also searches dialogue bodies.  When a query is active, use its quest
    // keys as an additional allow-list so a hit inside a line of dialogue is
    // reflected in the final tree instead of being lost because the title or
    // chapter name did not match locally.
    const searchMatches = query && entries.length > 0
      ? new Set(entries.map((entry) => entry.questKey))
      : undefined;
    const result: StoryTreeNode[] = [];
    for (const region of catalog.regions) {
      const regionNode: StoryTreeNode = {
        id: `region:${region.id}`,
        type: "region",
        title: region.name,
        order: region.order,
        children: [],
      };
      const families = region.families?.length
        ? region.families
        : [
            {
              id: `legacy:${region.id}`,
              name: "散篇任务",
              order: 0,
              provenance: "fallback" as const,
              chapters: region.chapters,
            },
          ];
      for (const family of families) {
        const familyNode: StoryTreeNode = {
          id: `family:${region.id}:${family.id}`,
          type: "series",
          title: family.name,
          order: family.order,
          children: [],
        };
        for (const chapter of family.chapters) {
          const filteredQuests = chapter.quests.filter((q) => {
            if (!query) return true;
            const title = (q.displayTitle ?? q.title).toLowerCase();
            const localMatch =
              title.includes(query) ||
              q.title.toLowerCase().includes(query) ||
              chapter.name.toLowerCase().includes(query) ||
              family.name.toLowerCase().includes(query) ||
              region.name.toLowerCase().includes(query);
            return searchMatches?.has(q.questKey) || localMatch;
          });
          if (filteredQuests.length === 0) continue;

          familyNode.children!.push({
            id: `chapter:${region.id}:${family.id}:${chapter.id}`,
            type: "chapter",
            title: chapter.name,
            order: chapter.order,
            children: filteredQuests
              .sort(
                (a, b) =>
                  a.order - b.order ||
                  (a.displayTitle ?? a.title).localeCompare(b.displayTitle ?? b.title, "zh-Hans-CN") ||
                  a.questKey.localeCompare(b.questKey),
              )
              .map((q) => ({
                id: `quest:${q.questKey}`,
                type: "quest" as const,
                title: q.displayTitle ?? q.title,
                order: q.order,
                questKey: q.questKey,
              })),
          });
        }
        if (familyNode.children!.length > 0) regionNode.children!.push(familyNode);
      }
      if (regionNode.children!.length > 0) {
        result.push(regionNode);
      }
    }
    for (const region of result) {
      region.children?.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title, "zh-Hans-CN"));
      for (const family of region.children ?? []) {
        family.children?.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.title.localeCompare(b.title, "zh-Hans-CN"));
      }
    }
    if (result.length > 0) return result;
  }

  // Fallback to seriesMap from entries
  const seriesMap = new Map<string, Map<string, StoryEntry[]>>();
  for (const entry of entries) {
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

  function submit(event: FormEvent) {
    event.preventDefault();
    onFilters({ query: queryDraft });
  }

  const tree = useMemo(
    () => buildStoryTree(entries, catalog, filters.query, isStarRail),
    [entries, catalog, filters.query, isStarRail],
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

  const hasInitializedExpansionRef = useRef(false);

  // Reset expansion initialization when game or catalog changes
  useEffect(() => {
    hasInitializedExpansionRef.current = false;
  }, [isStarRail, catalog]);

  // Default expand first region ONCE when tree is first ready and no active quest
  useEffect(() => {
    if (hasInitializedExpansionRef.current) return;
    if (!activeQuestKey && tree.length > 0 && !isSearching) {
      setExpandedIds(new Set([tree[0].id]));
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

  function renderNode(node: StoryTreeNode): ReactNode {
    if (node.type === "quest") {
      const isActive = node.questKey === activeQuestKey;
      return (
        <button
          type="button"
          key={node.id}
          className={`story-tree-quest ${isActive ? "is-active" : ""}`}
          aria-current={isActive ? "page" : undefined}
          onClick={() =>
            node.questKey && onSelect({ questKey: node.questKey, title: node.title })
          }
        >
          <span>{node.title}</span>
        </button>
      );
    }

    const isExpanded = isSearching || expandedIds.has(node.id);
    const isChapter = node.type === "chapter";
    const containerClass = isChapter ? "story-tree-chapter" : "story-tree-series";
    const headerClass = isChapter
      ? "story-tree-header story-tree-chapter-header"
      : "story-tree-header story-tree-series-header";
    return (
      <section
        key={node.id}
        className={containerClass}
        role="treeitem"
        aria-expanded={isExpanded}
      >
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
          {isChapter ? <span>{node.title}</span> : <strong>{node.title}</strong>}
        </button>
        {isExpanded && node.children?.length ? (
          <div
            className={isChapter ? "story-tree-chapter-children" : "story-tree-series-children"}
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
      <form className="story-catalog-form" onSubmit={submit}>
        <input
          aria-label="搜索任务"
          placeholder="任务名、章节、台词…"
          value={queryDraft}
          onChange={(event) => setQueryDraft(event.target.value)}
        />
        <div className="story-catalog-filters">
          <select
            aria-label="任务类型"
            value={filters.type}
            onChange={(event) => onFilters({ type: event.target.value })}
          >
            {getQuestTypeOptions(isStarRail).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            aria-label="任务语言"
            value={filters.locale}
            onChange={(event) => onFilters({ locale: event.target.value })}
          >
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </div>
      </form>

      <div className="story-catalog-tree" role="tree" aria-label="剧情目录">
        {loading ? (
          <ArchiveLoading label="任务目录加载中" />
        ) : tree.length ? (
          tree.map(renderNode)
        ) : (
          <ArchiveEmpty
            title={isStarRail ? "暂无星铁开拓任务" : "没有任务结果"}
            detail={isStarRail ? "当前游戏星铁任务尚未载入，或可尝试调整筛选条件。" : "尝试切换语言、类型或缩短关键词。"}
          />
        )}
      </div>
    </div>
  );
}
