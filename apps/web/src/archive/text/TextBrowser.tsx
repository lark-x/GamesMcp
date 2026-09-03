import { useCallback, useEffect, useMemo, useState } from "react";
import type { DocumentDetail } from "@gip/domain";
import { apiFetch } from "../../api.js";
import { mapBookListResponse, type CodexBookCatalog } from "../../codex/mappers.js";
import { ArchiveEmpty, ArchiveError, ArchiveLoading } from "../ArchiveStates.js";
import { ArchiveLayout } from "../ArchiveLayout.js";
import { ArchiveGlobalNav, type GlobalNavSection } from "../ArchiveGlobalNav.js";
import { ArchiveInspector, InspectorField, InspectorSection } from "../ArchiveInspector.js";
import type { TextChapterRef } from "./text.types.js";

function chapterEntries(catalog: CodexBookCatalog | null): TextChapterRef[] {
  return catalog?.books.flatMap((book) => book.volumes.map((volume) => ({ book, volume }))) ?? [];
}

/**
 * Text browser for books / readable documents. Reuses the text API and
 * document reader; chapter navigation keeps the book context. The same frame
 * will serve item text, character stories, and tutorials later.
 */
export function TextBrowser({
  gameId,
  gameName,
  revisionLabel,
  selectedRevision,
  initialBookId,
  initialChapterId,
  onHome,
  onOpenStory,
  onOpenMaterials,
  onRouteChange,
}: {
  gameId: string;
  gameName: string;
  revisionLabel: string;
  selectedRevision?: string;
  initialBookId?: string;
  initialChapterId?: string;
  onHome: () => void;
  onOpenStory: () => void;
  onOpenMaterials: () => void;
  onRouteChange?: (
    bookStableId: string | undefined,
    volumeStableId: string | undefined,
    mode?: "push" | "replace",
  ) => void;
}) {
  const [catalog, setCatalog] = useState<CodexBookCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeVolumeId, setActiveVolumeId] = useState(initialChapterId ?? "");
  const [activeBookId, setActiveBookId] = useState(initialBookId ?? "");
  const [textDocument, setTextDocument] = useState<DocumentDetail | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ locale: "zh-CN", limit: "200" });
      if (selectedRevision) params.set("revisionId", selectedRevision);
      const value = await apiFetch<unknown>(`/api/games/${gameId}/text/books?${params.toString()}`);
      const next = mapBookListResponse(value);
      setCatalog(next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "书籍目录加载失败");
    } finally {
      setLoading(false);
    }
  }, [gameId, selectedRevision]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  // Priority: bookId + chapterId exact match -> bookId first volume -> entire catalog first volume
  useEffect(() => {
    if (!catalog) return;
    const entries = chapterEntries(catalog);
    if (!entries.length) return;

    const exact =
      initialBookId && initialChapterId
        ? entries.find(
            (item) =>
              item.book.bookStableId === initialBookId && item.volume.stableId === initialChapterId,
          )
        : undefined;

    const firstOfBook =
      !exact && initialBookId
        ? entries.find((item) => item.book.bookStableId === initialBookId)
        : undefined;

    const preferred = exact ?? firstOfBook ?? entries[0];
    if (preferred) {
      setActiveVolumeId(preferred.volume.stableId);
      setActiveBookId(preferred.book.bookStableId);
    }
  }, [catalog, initialBookId, initialChapterId]);

  const activeEntry = useMemo(
    () =>
      chapterEntries(catalog).find(
        (entry) =>
          entry.volume.stableId === activeVolumeId &&
          (!activeBookId || entry.book.bookStableId === activeBookId),
      ),
    [catalog, activeVolumeId, activeBookId],
  );

  const loadDocument = useCallback(
    async (documentId: string) => {
      setDocumentLoading(true);
      try {
        const suffix = selectedRevision
          ? "?revisionId=" + encodeURIComponent(selectedRevision)
          : "";
        const result = await apiFetch<{ document: DocumentDetail }>(
          `/api/games/${gameId}/documents/${encodeURIComponent(documentId)}${suffix}`,
        );
        setTextDocument(result.document);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "书籍正文加载失败");
      } finally {
        setDocumentLoading(false);
      }
    },
    [gameId, selectedRevision],
  );

  useEffect(() => {
    if (!activeEntry) {
      setTextDocument(null);
      return;
    }
    void loadDocument(activeEntry.volume.documentId);
  }, [activeEntry?.volume.documentId, loadDocument]);

  const entries = chapterEntries(catalog);
  const activeIndex = entries.findIndex(
    (entry) => entry.volume.stableId === activeEntry?.volume.stableId,
  );
  const prevChapter = activeIndex > 0 ? entries[activeIndex - 1] : undefined;
  const nextChapter =
    activeIndex >= 0 && activeIndex < entries.length - 1 ? entries[activeIndex + 1] : undefined;

  const filteredBooks = useMemo(() => {
    if (!catalog?.books) return [];
    const q = searchQuery.trim().toLowerCase();
    if (!q) return catalog.books;
    return catalog.books
      .map((book) => {
        const bookMatches = book.title.toLowerCase().includes(q);
        const matchedVolumes = book.volumes.filter(
          (vol) => bookMatches || vol.title.toLowerCase().includes(q),
        );
        if (matchedVolumes.length === 0) return null;
        return { ...book, volumes: matchedVolumes };
      })
      .filter((b): b is NonNullable<typeof b> => b !== null);
  }, [catalog?.books, searchQuery]);

  const sections: GlobalNavSection[] = useMemo(
    () => [
      {
        label: "浏览",
        items: [
          { key: "home", label: "首页", onSelect: onHome },
          { key: "story", label: "剧情档案", onSelect: onOpenStory },
          { key: "materials", label: "材料", onSelect: onOpenMaterials },
          {
            key: "text",
            label: "文本",
            active: true,
            onSelect: () => {
              if (window.location.hash !== "#text/books") {
                window.location.hash = "text/books";
              }
            },
          },
        ],
      },
    ],
    [onHome, onOpenStory, onOpenMaterials],
  );

  function selectVolume(entry: TextChapterRef, mode: "push" | "replace" = "push") {
    setActiveVolumeId(entry.volume.stableId);
    setActiveBookId(entry.book.bookStableId);
    onRouteChange?.(entry.book.bookStableId, entry.volume.stableId, mode);
  }

  return (
    <ArchiveLayout
      globalNav={
        <ArchiveGlobalNav gameLabel={gameName} revisionLabel={revisionLabel} sections={sections} />
      }
      catalog={
        <div className="text-catalog">
          <input
            aria-label="搜索书籍"
            placeholder="搜索书名、卷名…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {loading ? (
            <ArchiveLoading label="书籍目录加载中" />
          ) : filteredBooks.length ? (
            filteredBooks.map((book) => (
              <section key={book.stableId} className="text-catalog-book">
                <h3>{book.title}</h3>
                {book.volumes.map((volume) => (
                  <button
                    type="button"
                    key={volume.stableId}
                    className={volume.stableId === activeVolumeId ? "is-active" : ""}
                    aria-current={volume.stableId === activeVolumeId ? "true" : undefined}
                    onClick={() => selectVolume({ book, volume }, "push")}
                  >
                    <strong>
                      {volume.volume == null ? "卷" : `第 ${volume.volume} 卷`} · {volume.title}
                    </strong>
                    <small>{volume.segmentCount || "—"} 个片段</small>
                  </button>
                ))}
              </section>
            ))
          ) : (
            <ArchiveEmpty
              title={searchQuery ? "未找到相关书籍" : "暂无已发布书籍文本"}
              detail={searchQuery ? "尝试更换搜索词" : undefined}
            />
          )}
        </div>
      }
      main={
        <article className="text-reader" aria-busy={documentLoading}>
          {error ? (
            <ArchiveError
              message="资料加载失败"
              detail={error}
              onRetry={() => {
                void loadCatalog();
                if (activeEntry) void loadDocument(activeEntry.volume.documentId);
              }}
            />
          ) : null}
          {documentLoading ? <ArchiveLoading label="正文加载中" /> : null}
          {textDocument && !documentLoading ? (
            <>
              <header className="text-reader-header">
                <span className="story-type-pill">书籍</span>
                <h2>《{textDocument.title}》</h2>
                <p className="story-reader-meta">
                  {textDocument.sourceName} · {textDocument.gameVersion ?? "游戏版本未知"} ·
                  Revision {textDocument.revision || "—"}
                </p>
              </header>
              <div className="text-prose">
                {textDocument.segments.length ? (
                  textDocument.segments.map((segment) => (
                    <div key={segment.id} className="text-segment">
                      {segment.headingPath?.length ? (
                        <h3>{segment.headingPath.join(" / ")}</h3>
                      ) : null}
                      <p>{segment.body}</p>
                    </div>
                  ))
                ) : (
                  <p className="muted">本卷暂无内容</p>
                )}
              </div>
              <footer className="story-reader-footer text-chapter-nav">
                <button
                  type="button"
                  disabled={!prevChapter}
                  onClick={() => prevChapter && selectVolume(prevChapter, "push")}
                >
                  ← 上一章
                </button>
                <span role="status">
                  {activeIndex >= 0 ? `${activeIndex + 1} / ${entries.length}` : "—"}
                </span>
                <button
                  type="button"
                  disabled={!nextChapter}
                  onClick={() => nextChapter && selectVolume(nextChapter, "push")}
                >
                  下一章 →
                </button>
              </footer>
            </>
          ) : null}
        </article>
      }
      inspector={
        <ArchiveInspector title="书籍信息">
          {!textDocument ? (
            <p className="muted">选择书籍章节查看文献出处与分卷信息。</p>
          ) : (
            <>
              <InspectorSection title="基本信息">
                <InspectorField
                  label="书籍"
                  value={activeEntry?.book.title ?? textDocument.title}
                />
                <InspectorField label="章节" value={activeEntry?.volume.title ?? "—"} />
                <InspectorField
                  label="卷次"
                  value={
                    activeEntry?.volume.volume == null ? "—" : `第 ${activeEntry.volume.volume} 卷`
                  }
                />
                <InspectorField label="片段数" value={textDocument.segments.length} />
              </InspectorSection>
              <InspectorSection title="来源">
                <InspectorField label="数据来源" value={textDocument.sourceName} />
                <InspectorField label="Document ID" value={<code>{textDocument.id}</code>} />
                <InspectorField label="Revision" value={<code>{textDocument.revision}</code>} />
              </InspectorSection>
            </>
          )}
        </ArchiveInspector>
      }
    />
  );
}
