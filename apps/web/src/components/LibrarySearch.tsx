import type { FormEvent } from "react";
import type { SearchResult } from "@gip/contracts";
import { Button } from "antd";

export function SearchCard({
  query,
  searching,
  disabled,
  onQueryChange,
  onSearch,
}: {
  query: string;
  searching: boolean;
  disabled: boolean;
  onQueryChange: (value: string) => void;
  onSearch: (event: FormEvent) => void;
}) {
  return (
    <section className="library-search-card" aria-labelledby="library-search-title">
      <div className="search-heading">
        <span className="eyebrow">ARCHIVE SEARCH</span>
        <h2 id="library-search-title">查找提瓦特资料</h2>
        <p>搜索角色、地区、书籍或剧情原文，结果会标明来源与数据版本。</p>
      </div>
      <form className="search-form" onSubmit={onSearch}>
        <span className="search-symbol" aria-hidden="true">
          ⌕
        </span>
        <input
          aria-label="搜索知识库"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="搜索角色、任务、地区或剧情关键词"
        />
        <Button type="primary" htmlType="submit" loading={searching} disabled={disabled}>
          检索
        </Button>
      </form>
    </section>
  );
}

export function ArchiveToolbar({
  search,
  query,
  visibleRevisionLabel,
}: {
  search: SearchResult | null;
  query: string;
  visibleRevisionLabel: string;
}) {
  return (
    <div className="archive-toolbar">
      <div>
        <span className="eyebrow">{search ? "SEARCH RESULTS" : "ARCHIVE HOME"}</span>
        <h2>{search ? `“${query}”的检索结果` : "资料总览"}</h2>
      </div>
      {search ? (
        <div className="result-summary" aria-label="检索结果统计">
          <span>{search.entities.length} 实体</span>
          <span>{search.documents.length} 文档</span>
          <span>{search.segments.length} 片段</span>
        </div>
      ) : (
        <span className="archive-revision">{visibleRevisionLabel}</span>
      )}
    </div>
  );
}
