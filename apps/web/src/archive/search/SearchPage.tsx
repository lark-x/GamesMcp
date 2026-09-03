import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "../../api.js";
import { ArchiveGlobalNav } from "../ArchiveGlobalNav.js";
import { ArchiveLayout } from "../ArchiveLayout.js";
import { ArchiveEmpty, ArchiveError, ArchiveLoading } from "../ArchiveStates.js";

type SearchFilter = "all" | "story" | "data" | "text";

interface SearchResultItem {
  id: string;
  type: "story" | "data" | "text";
  categoryLabel: string;
  title: string;
  snippet?: string;
  targetHash: string;
  score?: number;
}

type UnknownRecord = Record<string, unknown>;

export function SearchPage({
  gameId,
  selectedRevision,
  initialQuery = "",
}: {
  gameId: string;
  selectedRevision?: string;
  initialQuery?: string;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [filter, setFilter] = useState<SearchFilter>("all");
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hasSearched, setHasSearched] = useState(false);

  const doSearch = useCallback(
    async (q: string) => {
      if (!q.trim()) {
        setResults([]);
        setHasSearched(false);
        return;
      }
      setLoading(true);
      setError("");
      setHasSearched(true);
      try {
        const params = new URLSearchParams({ q: q.trim(), limit: "40" });
        if (selectedRevision) params.set("revisionId", selectedRevision);

        // Fetch quest/story hits
        let questHits: SearchResultItem[] = [];
        try {
          const questRes = (await apiFetch(
            `/api/games/${encodeURIComponent(gameId)}/quests?${params.toString()}`,
          )) as { hits?: UnknownRecord[] };
          if (Array.isArray(questRes.hits)) {
            questHits = questRes.hits.map((h) => ({
              id: `quest-${h.questKey}`,
              type: "story",
              categoryLabel: "剧情",
              title: String(h.title ?? ""),
              snippet:
                typeof h.description === "string"
                  ? h.description
                  : `${h.type ?? ""} · ${h.chapter ?? "开放世界"}`,
              targetHash: `story/${encodeURIComponent(String(h.questKey ?? ""))}`,
            }));
          }
        } catch {
          // ignore
        }

        // Fetch material hits
        let materialHits: SearchResultItem[] = [];
        try {
          const matRes = (await apiFetch(
            `/api/games/${encodeURIComponent(gameId)}/codex/materials?${params.toString()}`,
          )) as { materials?: UnknownRecord[] };
          if (Array.isArray(matRes.materials)) {
            materialHits = matRes.materials.map((m) => ({
              id: `mat-${m.stableId}`,
              type: "data",
              categoryLabel: "材料",
              title: String(m.name ?? ""),
              snippet:
                typeof m.description === "string" ? m.description : `分类: ${m.category ?? ""}`,
              targetHash: `archive/materials/${encodeURIComponent(String(m.stableId ?? ""))}`,
            }));
          }
        } catch {
          // ignore
        }

        // Fetch book hits
        let bookHits: SearchResultItem[] = [];
        try {
          const bookRes = (await apiFetch(
            `/api/games/${encodeURIComponent(gameId)}/codex/books?${params.toString()}`,
          )) as { books?: UnknownRecord[] };
          if (Array.isArray(bookRes.books)) {
            bookHits = bookRes.books
              .filter(
                (b) =>
                  typeof b.title === "string" && b.title.toLowerCase().includes(q.toLowerCase()),
              )
              .map((b) => ({
                id: `book-${b.stableId}`,
                type: "text",
                categoryLabel: "文献",
                title: String(b.title ?? ""),
                snippet: `${b.volumesCount ?? 1} 卷 · 书籍档案`,
                targetHash: `text/books/${encodeURIComponent(String(b.stableId ?? ""))}`,
              }));
          }
        } catch {
          // ignore
        }

        const combined = [...questHits, ...materialHits, ...bookHits];
        setResults(combined);
      } catch (err: unknown) {
        setError((err as Error).message || "检索请求失败");
      } finally {
        setLoading(false);
      }
    },
    [gameId, selectedRevision],
  );

  useEffect(() => {
    if (initialQuery) {
      doSearch(initialQuery);
    }
  }, [initialQuery, doSearch]);

  const filteredResults = results.filter((item) => {
    if (filter === "all") return true;
    return item.type === filter;
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    doSearch(query);
  }

  return (
    <ArchiveLayout
      globalNav={<ArchiveGlobalNav activeSection="search" />}
      main={
        <div className="archive-search-container" role="main">
          <div className="archive-search-header">
            <h1 className="archive-search-title">全局知识库检索</h1>
            <p className="archive-search-subtitle">
              跨剧情、材料百科、多卷文献与长文本的联合索引检索。
            </p>

            <form className="archive-search-form" onSubmit={handleSubmit}>
              <input
                type="search"
                className="archive-search-input-field"
                placeholder="输入检索关键词（例如：风神、提瓦特、绝云椒椒、自由的抗争）..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
                aria-label="检索关键词"
              />
              <button type="submit" className="archive-search-submit-btn">
                检索
              </button>
            </form>

            <div className="archive-search-filter-pills" role="tablist">
              <button
                type="button"
                className={`filter-pill ${filter === "all" ? "active" : ""}`}
                onClick={() => setFilter("all")}
              >
                全部 ({results.length})
              </button>
              <button
                type="button"
                className={`filter-pill ${filter === "story" ? "active" : ""}`}
                onClick={() => setFilter("story")}
              >
                剧情 ({results.filter((r) => r.type === "story").length})
              </button>
              <button
                type="button"
                className={`filter-pill ${filter === "data" ? "active" : ""}`}
                onClick={() => setFilter("data")}
              >
                资料百科 ({results.filter((r) => r.type === "data").length})
              </button>
              <button
                type="button"
                className={`filter-pill ${filter === "text" ? "active" : ""}`}
                onClick={() => setFilter("text")}
              >
                文献文本 ({results.filter((r) => r.type === "text").length})
              </button>
            </div>
          </div>

          <div className="archive-search-results-list">
            {loading && <ArchiveLoading label="正在检索知识库..." />}
            {error && <ArchiveError message={error} onRetry={() => doSearch(query)} />}
            {!loading && !error && hasSearched && filteredResults.length === 0 && (
              <ArchiveEmpty message={`未找到与 “${query}” 相关的档案内容`} />
            )}
            {!loading && !error && !hasSearched && (
              <div className="archive-search-placeholder">
                <p>请输入关键词开始检索知识库条目</p>
              </div>
            )}
            {!loading &&
              !error &&
              filteredResults.map((item) => (
                <div
                  key={item.id}
                  className="archive-search-result-card"
                  onClick={() => (window.location.hash = item.targetHash)}
                  style={{ cursor: "pointer" }}
                >
                  <div className="search-result-top">
                    <span className={`search-badge badge-${item.type}`}>{item.categoryLabel}</span>
                    <h3 className="search-result-title">{item.title}</h3>
                  </div>
                  {item.snippet && <p className="search-result-snippet">{item.snippet}</p>}
                  <div className="search-result-footer">
                    <span className="search-result-target">查看详情 →</span>
                  </div>
                </div>
              ))}
          </div>
        </div>
      }
    />
  );
}
