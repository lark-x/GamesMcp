import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ArchiveEmpty, ArchiveLoading } from "../ArchiveStates.js";
import { getQuestTypeOptions, questTypeLabel, questTypeOptions } from "../../shared.js";
import type { StoryCatalog as ApiStoryCatalog } from "../../api.js";
import type { StoryCatalogFilters, StoryEntry, StoryTreeNode } from "./story.types.js";

/**
 * Pure hierarchy builder:
 * Region / World
 * └─ Chapter
 *    └─ Quest
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
    const result: StoryTreeNode[] = [];
    for (const region of catalog.regions) {
      const regionNode: StoryTreeNode = {
        id: `region:${region.id}`,
        type: "region",
        title: region.name,
        children: [],
      };
      for (const chapter of region.chapters) {
        const filteredQuests = chapter.quests.filter((q) => {
          if (!query) return true;
          return (
            q.title.toLowerCase().includes(query) ||
            chapter.name.toLowerCase().includes(query) ||
            region.name.toLowerCase().includes(query)
          );
        });
        if (filteredQuests.length === 0) continue;

        const questNodes: StoryTreeNode[] = filteredQuests.map((q) => ({
          id: `quest:${q.questKey}`,
          type: "quest",
          title: q.title,
          questKey: q.questKey,
        }));

        regionNode.children!.push({
          id: `chapter:${region.id}:${chapter.id}`,
          type: "chapter",
          title: chapter.name,
          children: questNodes,
        });
      }
      if (regionNode.children!.length > 0) {
        result.push(regionNode);
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
      for (const topNode of tree) {
        let topHasActive = false;
        if (topNode.children) {
          for (const child of topNode.children) {
            let childHasActive = false;
            if (child.type === "chapter" && child.children) {
              for (const q of child.children) {
                if (q.questKey === activeQuestKey) {
                  childHasActive = true;
                  break;
                }
              }
            } else if (child.questKey === activeQuestKey) {
              topHasActive = true;
            }
            if (childHasActive) {
              next.add(child.id);
              topHasActive = true;
            }
          }
        }
        if (topHasActive) {
          next.add(topNode.id);
        }
      }
      return next;
    });
  }, [activeQuestKey, tree]);

  // Default expand first region if empty and no active quest
  useEffect(() => {
    if (!activeQuestKey && tree.length > 0 && expandedIds.size === 0 && !isSearching) {
      setExpandedIds(new Set([tree[0].id]));
    }
  }, [activeQuestKey, tree, expandedIds.size, isSearching]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
          tree.map((topNode) => {
            const isTopExpanded = isSearching || expandedIds.has(topNode.id);
            return (
              <section
                key={topNode.id}
                className="story-tree-series"
                role="treeitem"
                aria-expanded={isTopExpanded}
              >
                <button
                  type="button"
                  className="story-tree-header story-tree-series-header"
                  aria-expanded={isTopExpanded}
                  onClick={() => toggleExpand(topNode.id)}
                >
                  <span className="story-tree-toggle-icon" aria-hidden="true">
                    {isTopExpanded ? "▾" : "▸"}
                  </span>
                  <strong>{topNode.title}</strong>
                </button>

                {isTopExpanded && topNode.children ? (
                  <div className="story-tree-series-children" role="group">
                    {topNode.children.map((child) => {
                      if (child.type === "chapter") {
                        const isChapterExpanded = isSearching || expandedIds.has(child.id);
                        return (
                          <div
                            key={child.id}
                            className="story-tree-chapter"
                            role="treeitem"
                            aria-expanded={isChapterExpanded}
                          >
                            <button
                              type="button"
                              className="story-tree-header story-tree-chapter-header"
                              aria-expanded={isChapterExpanded}
                              onClick={() => toggleExpand(child.id)}
                            >
                              <span className="story-tree-toggle-icon" aria-hidden="true">
                                {isChapterExpanded ? "▾" : "▸"}
                              </span>
                              <span>{child.title}</span>
                            </button>
                            {isChapterExpanded && child.children ? (
                              <div className="story-tree-chapter-children" role="group">
                                {child.children.map((questNode) => {
                                  const isActive = questNode.questKey === activeQuestKey;
                                  return (
                                    <button
                                      type="button"
                                      key={questNode.id}
                                      className={`story-tree-quest ${isActive ? "is-active" : ""}`}
                                      aria-current={isActive ? "page" : undefined}
                                      onClick={() =>
                                        questNode.questKey &&
                                        onSelect({
                                          questKey: questNode.questKey,
                                          title: questNode.title,
                                        })
                                      }
                                    >
                                      <span>{questNode.title}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            ) : null}
                          </div>
                        );
                      }

                      // Quest directly under region / series
                      const isActive = child.questKey === activeQuestKey;
                      return (
                        <button
                          type="button"
                          key={child.id}
                          className={`story-tree-quest ${isActive ? "is-active" : ""}`}
                          aria-current={isActive ? "page" : undefined}
                          onClick={() =>
                            child.questKey &&
                            onSelect({
                              questKey: child.questKey,
                              title: child.title,
                            })
                          }
                        >
                          <span>{child.title}</span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </section>
            );
          })
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
