import { useEffect, useMemo, useState } from "react";
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
  onRouteChange?: (bookStableId: string | undefined, volumeStableId: string | undefined) => void;
}) {
  const [catalog, setCatalog] = useState<CodexBookCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeVolumeId, setActiveVolumeId] = useState(initialChapterId ?? "");
  const [activeBookId, setActiveBookId] = useState(initialBookId ?? "");
  const [textDocument, setTextDocument] = useState<DocumentDetail | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ locale: "zh-CN", limit: "200" });
    if (selectedRevision) params.set("revisionId", selectedRevision);
    apiFetch<unknown>(`/api/games/${gameId}/text/books?${params.toString()}`)
      .then((value) => {
        if (cancelled) return;
        const next = mapBookListResponse(value);
        setCatalog(next);
        const entries = chapterEntries(next);
        const preferred =
          (initialBookId &&
            entries.find((entry) => entry.book.bookStableId === initialBookId)?.volume.stableId) ||
          initialChapterId ||
          entries[0]?.volume.stableId ||
          "";
        setActiveVolumeId(preferred);
        const preferredBook = entries.find((entry) => entry.volume.stableId === preferred);
        setActiveBookId(preferredBook?.book.bookStableId ?? "");
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "书籍目录加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, selectedRevision]);

  const activeEntry = useMemo(
    () =>
      chapterEntries(catalog).find(
        (entry) =>
          entry.volume.stableId === activeVolumeId &&
          (!activeBookId || entry.book.bookStableId === activeBookId),
      ),
    [catalog, activeVolumeId, activeBookId],
  );

  useEffect(() => {
    if (!activeEntry) {
      setTextDocument(null);
      return;
    }
    let cancelled = false;
    setDocumentLoading(true);
    const suffix = selectedRevision ? "?revisionId=" + encodeURIComponent(selectedRevision) : "";
    apiFetch<{ document: DocumentDetail }>(
      `/api/games/${gameId}/documents/${encodeURIComponent(activeEntry.volume.documentId)}${suffix}`,
    )
      .then((result) => {
        if (!cancelled) setTextDocument(result.document);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "书籍正文加载失败");
      })
      .finally(() => {
        if (!cancelled) setDocumentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeEntry?.volume.documentId, gameId, selectedRevision]);

  const entries = chapterEntries(catalog);
  const activeIndex = entries.findIndex(
    (entry) => entry.volume.stableId === activeEntry?.volume.stableId,
  );
  const prevChapter = activeIndex > 0 ? entries[activeIndex - 1] : undefined;
  const nextChapter =
    activeIndex >= 0 && activeIndex < entries.length - 1 ? entries[activeIndex + 1] : undefined;

  const sections: GlobalNavSection[] = useMemo(
    () => [
      {
        label: "浏览",
        items: [
          { key: "home", label: "首页", onSelect: onHome },
          { key: "story", label: "剧情档案", onSelect: onOpenStory },
          { key: "materials", label: "材料", onSelect: onOpenMaterials },
          { key: "text", label: "文本", active: true, onSelect: onHome },
        ],
      },
    ],
    [onHome, onOpenStory, onOpenMaterials],
  );

  function selectVolume(entry: TextChapterRef) {
    setActiveVolumeId(entry.volume.stableId);
    setActiveBookId(entry.book.bookStableId);
    onRouteChange?.(entry.book.bookStableId, entry.volume.stableId);
  }

  return (
    <ArchiveLayout
      globalNav={
        <ArchiveGlobalNav gameLabel={gameName} revisionLabel={revisionLabel} sections={sections} />
      }
      catalog={
        <div className="text-catalog">
          {loading ? (
            <ArchiveLoading label="书籍目录加载中" />
          ) : catalog?.books.length ? (
            catalog.books.map((book) => (
              <section key={book.stableId} className="text-catalog-book">
                <h3>{book.title}</h3>
                {book.volumes.map((volume) => (
                  <button
                    type="button"
                    key={volume.stableId}
                    className={volume.stableId === activeVolumeId ? "is-active" : ""}
                    aria-current={volume.stableId === activeVolumeId ? "true" : undefined}
                    onClick={() => selectVolume({ book, volume })}
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
            <ArchiveEmpty title="暂无已发布书籍文本" />
          )}
        </div>
      }
      main={
        <article className="text-reader" aria-busy={documentLoading}>
          {error ? (
            <ArchiveError message="资料加载失败" detail={error} onRetry={() => setError("")} />
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
                    <section key={segment.id} className="text-segment">
                      {segment.headingPath.length ? (
                        <h3>{segment.headingPath.join(" / ")}</h3>
                      ) : null}
                      {segment.body
                        .split(/\n+/)
                        .map((paragraph, index) =>
                          paragraph.trim() ? <p key={index}>{paragraph}</p> : null,
                        )}
                    </section>
                  ))
                ) : (
                  <p className="muted">暂无正文</p>
                )}
              </div>
              <footer className="story-reader-footer">
                <button
                  type="button"
                  disabled={!prevChapter}
                  onClick={() => prevChapter && selectVolume(prevChapter)}
                >
                  ← 上一章
                </button>
                <span>
                  {activeIndex + 1} / {entries.length}
                </span>
                <button
                  type="button"
                  disabled={!nextChapter}
                  onClick={() => nextChapter && selectVolume(nextChapter)}
                >
                  下一章 →
                </button>
              </footer>
            </>
          ) : null}
          {!textDocument && !documentLoading && !error ? (
            <ArchiveEmpty title="选择一卷开始阅读" />
          ) : null}
        </article>
      }
      inspector={
        <ArchiveInspector title="书籍信息">
          {textDocument ? (
            <>
              <InspectorSection title="文档信息">
                <InspectorField label="类型" value="书籍" />
                <InspectorField label="版本" value={textDocument.gameVersion ?? "—"} />
                <InspectorField label="语言" value={textDocument.locale ?? "zh-CN"} />
                <InspectorField label="来源" value={textDocument.sourceName} />
              </InspectorSection>
              <InspectorSection title="引用">
                <InspectorField label="Document ID" value={<code>{textDocument.id}</code>} />
                <InspectorField label="Revision" value={<code>{textDocument.revision}</code>} />
                <InspectorField label="片段数" value={textDocument.segments.length} />
              </InspectorSection>
            </>
          ) : (
            <p className="muted">选择书籍后展示文档信息与来源。</p>
          )}
        </ArchiveInspector>
      }
    />
  );
}
