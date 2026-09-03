import { useState } from "react";
import type { FormEvent } from "react";
import { ArchiveEmpty, ArchiveLoading } from "../ArchiveStates.js";
import { questTypeLabel, completenessLabel, questTypeOptions } from "../../shared.js";
import type { StoryCatalogFilters, StoryEntry } from "./story.types.js";

export function StoryCatalog({
  filters,
  entries,
  loading,
  activeQuestKey,
  onFilters,
  onSearch,
  onSelect,
}: {
  filters: StoryCatalogFilters;
  entries: StoryEntry[];
  loading: boolean;
  activeQuestKey?: string;
  onFilters: (next: Partial<StoryCatalogFilters>) => void;
  onSearch: () => void;
  onSelect: (entry: StoryEntry) => void;
}) {
  const [queryDraft, setQueryDraft] = useState(filters.query);
  function submit(event: FormEvent) {
    event.preventDefault();
    onFilters({ query: queryDraft });
    onSearch();
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
      <div className="story-catalog-list" role="list">
        {loading ? (
          <ArchiveLoading label="任务目录加载中" />
        ) : entries.length ? (
          entries.map((entry) => (
            <button
              type="button"
              role="listitem"
              key={entry.questKey + ":" + entry.locale}
              className={entry.questKey === activeQuestKey ? "is-active" : ""}
              aria-current={entry.questKey === activeQuestKey ? "true" : undefined}
              onClick={() => onSelect(entry)}
            >
              <strong>{entry.title}</strong>
              <small>
                {questTypeLabel(entry.type)} · {completenessLabel(entry.completeness)}
              </small>
            </button>
          ))
        ) : (
          <ArchiveEmpty title="没有任务结果" detail="尝试切换语言、类型或缩短关键词。" />
        )}
      </div>
    </div>
  );
}
