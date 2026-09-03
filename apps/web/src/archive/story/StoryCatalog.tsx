import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { ArchiveEmpty, ArchiveLoading } from "../ArchiveStates.js";
import { questTypeLabel, questTypeOptions } from "../../shared.js";
import type { StoryCatalogFilters, StoryEntry, StoryTreeNode } from "./story.types.js";

/**
 * Pure hierarchy builder:
 * Series
 * └─ Chapter
 *    └─ Quest
 * Universal for any game data (no game-specific branching).
 */
export function buildStoryTree(entries: StoryEntry[]): StoryTreeNode[] {
  const seriesMap = new Map<string, Map<string, StoryEntry[]>>();

  for (const entry of entries) {
    const seriesTitle = entry.series?.trim() || questTypeLabel(entry.type) || "其他任务";
    const chapterTitle = entry.chapter?.trim() || "";

    if (!seriesMap.has(seriesTitle)) {
      seriesMap.set(seriesTitle, new Map());
    }
    const chapterMap = seriesMap.get(seriesTitle)!;
    if (!chapterMap.has(chapterTitle)) {
      chapterMap.set(chapterTitle, []);
    }
    chapterMap.get(chapterTitle)!.push(entry);
  }

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
  loading,
  activeQuestKey,
  onFilters,
  onSelect,
}: {
  filters: StoryCatalogFilters;
  entries: StoryEntry[];
  loading: boolean;
  activeQuestKey?: string;
  onFilters: (next: Partial<StoryCatalogFilters>) => void;
  onSelect: (entry: StoryEntry) => void;
}) {
  const [queryDraft, setQueryDraft] = useState(filters.query);
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(new Set());

  // Keep draft in sync if external filters change
  useEffect(() => {
    setQueryDraft(filters.query);
  }, [filters.query]);

  function submit(event: FormEvent) {
    event.preventDefault();
    onFilters({ query: queryDraft });
  }

  function toggleCollapse(id: string) {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const tree = useMemo(() => buildStoryTree(entries), [entries]);
  const entryMap = useMemo(() => {
    const map = new Map<string, StoryEntry>();
    for (const entry of entries) {
      map.set(entry.questKey, entry);
    }
    return map;
  }, [entries]);

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
            {questTypeOptions.map(([value, label]) => (
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
          tree.map((series) => {
            const isSeriesCollapsed = collapsedIds.has(series.id);
            return (
              <section
                key={series.id}
                className="story-tree-series"
                role="treeitem"
                aria-expanded={!isSeriesCollapsed}
              >
                <button
                  type="button"
                  className="story-tree-header story-tree-series-header"
                  aria-expanded={!isSeriesCollapsed}
                  onClick={() => toggleCollapse(series.id)}
                >
                  <span className="story-tree-toggle-icon" aria-hidden="true">
                    {isSeriesCollapsed ? "▸" : "▾"}
                  </span>
                  <strong>{series.title}</strong>
                </button>

                {!isSeriesCollapsed && series.children ? (
                  <div className="story-tree-series-children" role="group">
                    {series.children.map((child) => {
                      if (child.type === "chapter") {
                        const isChapterCollapsed = collapsedIds.has(child.id);
                        return (
                          <div
                            key={child.id}
                            className="story-tree-chapter"
                            role="treeitem"
                            aria-expanded={!isChapterCollapsed}
                          >
                            <button
                              type="button"
                              className="story-tree-header story-tree-chapter-header"
                              aria-expanded={!isChapterCollapsed}
                              onClick={() => toggleCollapse(child.id)}
                            >
                              <span className="story-tree-toggle-icon" aria-hidden="true">
                                {isChapterCollapsed ? "▸" : "▾"}
                              </span>
                              <span>{child.title}</span>
                            </button>
                            {!isChapterCollapsed && child.children ? (
                              <div className="story-tree-chapter-children" role="group">
                                {child.children.map((questNode) => {
                                  const entry = questNode.questKey
                                    ? entryMap.get(questNode.questKey)
                                    : undefined;
                                  const isActive = questNode.questKey === activeQuestKey;
                                  return (
                                    <button
                                      type="button"
                                      key={questNode.id}
                                      className={`story-tree-quest ${isActive ? "is-active" : ""}`}
                                      aria-current={isActive ? "page" : undefined}
                                      onClick={() => entry && onSelect(entry)}
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

                      // Quest directly under series
                      const entry = child.questKey ? entryMap.get(child.questKey) : undefined;
                      const isActive = child.questKey === activeQuestKey;
                      return (
                        <button
                          type="button"
                          key={child.id}
                          className={`story-tree-quest ${isActive ? "is-active" : ""}`}
                          aria-current={isActive ? "page" : undefined}
                          onClick={() => entry && onSelect(entry)}
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
          <ArchiveEmpty title="没有任务结果" detail="尝试切换语言、类型或缩短关键词。" />
        )}
      </div>
    </div>
  );
}
