import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocumentDetail } from "@gip/domain";
import { apiFetch } from "../../api.js";
import { mapBookListResponse, type CodexBookCatalog, type CodexBookVolume } from "../../codex/mappers.js";
import { ArchiveEmpty, ArchiveError, ArchiveLoading } from "../ArchiveStates.js";
import { ArchiveLayout } from "../ArchiveLayout.js";
import { ArchiveGlobalNav, type GlobalNavSection } from "../ArchiveGlobalNav.js";
import { ArchiveInspector, InspectorField, InspectorSection } from "../ArchiveInspector.js";
import { isStarRailGame } from "../../shared.js";
import { formatStoryText } from "../story/story-format.js";
import type { TextChapterRef } from "./text.types.js";

type UnknownRecord = Record<string, unknown>;

type TextKindConfig = {
  navLabel: string;
  itemNoun: string;
  searchLabel: string;
  emptyTitle: string;
  /** 上游条目名直接是正文标题，目录按平铺列表分组。 */
  flatGroupTitle?: string;
};

const TEXT_KINDS: Record<string, TextKindConfig> = {
  books: {
    navLabel: "书籍文献",
    itemNoun: "书籍",
    searchLabel: "搜索书籍",
    emptyTitle: "暂无已发布书籍文本",
  },
  "character-stories": {
    navLabel: "角色故事",
    itemNoun: "角色故事",
    searchLabel: "搜索角色故事",
    emptyTitle: "暂无角色故事文本",
  },
  voices: {
    navLabel: "角色语音",
    itemNoun: "语音",
    searchLabel: "搜索角色语音",
    emptyTitle: "暂无角色语音文本",
    flatGroupTitle: "角色语音",
  },
  messages: {
    navLabel: "星轨短信",
    itemNoun: "短信",
    searchLabel: "搜索星轨短信",
    emptyTitle: "暂无星轨短信文本",
    flatGroupTitle: "星轨短信",
  },
  "train-visitors": {
    navLabel: "列车访客",
    itemNoun: "访客",
    searchLabel: "搜索列车访客",
    emptyTitle: "暂无列车访客文本",
    flatGroupTitle: "列车访客",
  },
  items: {
    navLabel: "物品文本",
    itemNoun: "物品",
    searchLabel: "搜索物品文本",
    emptyTitle: "暂无物品文本",
    flatGroupTitle: "物品文本",
  },
  mechanics: {
    navLabel: "机制教程",
    itemNoun: "教程",
    searchLabel: "搜索机制教程",
    emptyTitle: "暂无机制教程文本",
  },
};

function chapterEntries(catalog: CodexBookCatalog | null): TextChapterRef[] {
  return catalog?.books.flatMap((book) => book.volumes.map((volume) => ({ book, volume }))) ?? [];
}

function kindFor(kind: string | undefined): TextKindConfig {
  return (kind && TEXT_KINDS[kind]) || TEXT_KINDS.books;
}

/**
 * Text browser for readable corpus (books, character stories, voice lines,
 * item texts, star rail messages...). Each text kind maps to its dedicated
 * API; genshin and star rail use different upstream endpoints per kind.
 */
export function TextBrowser({
  gameId,
  gameName,
  revisionLabel,
  selectedRevision,
  textKind = "books",
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
  textKind?: string;
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
  // 语音等平铺语料的正文随目录下发，避免逐条二次请求。
  const inlineBodiesRef = useRef<Map<string, string>>(new Map());

  const isStarRail = isStarRailGame(gameId, gameName);
  const kindConfig = kindFor(textKind);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ locale: "zh-CN", limit: "200" });
      if (selectedRevision) params.set("revisionId", selectedRevision);
      const query = params.toString();
      const inlineBodies = new Map<string, string>();
      // 原神语音端点上限 100、物品端点上限 50。
      const voicesQuery = new URLSearchParams({ locale: "zh-CN", limit: "100" });
      if (selectedRevision) voicesQuery.set("revisionId", selectedRevision);
      const voicesQueryText = voicesQuery.toString();
      const itemsQuery = new URLSearchParams({ locale: "zh-CN", limit: "50" });
      if (selectedRevision) itemsQuery.set("revisionId", selectedRevision);
      const itemsQueryText = itemsQuery.toString();

      // 原神与星铁的上游不同：语音/物品在原神走专用语料端点，星铁走
      // documents 语料端点；书籍与角色故事两端结构一致。
      let endpoint: string;
      if (textKind === "voices") {
        endpoint = isStarRail ? `documents?type=voiceline&${query}` : `voices?${voicesQueryText}`;
      } else if (textKind === "items") {
        endpoint = isStarRail ? `documents?type=item_lore&${query}` : `items?${itemsQueryText}`;
      } else if (textKind === "messages") {
        endpoint = `documents?type=message&${query}`;
      } else if (textKind === "train-visitors") {
        endpoint = `documents?type=train_visitor&${query}`;
      } else if (textKind === "character-stories") {
        endpoint = `character-stories?${query}`;
      } else if (textKind === "mechanics") {
        // 机制教程按关键词检索，无列表语料。
        setCatalog({
          gameId,
          locale: "zh-CN",
          books: [],
          totalVolumes: 0,
          truncated: false,
        });
        setLoading(false);
        return;
      } else {
        endpoint = `books?${query}`;
      }

      const value = await apiFetch<unknown>(`/api/games/${gameId}/text/${endpoint}`);

      if (textKind === "character-stories") {
        const raw = value as UnknownRecord;
        const characters = Array.isArray(raw.characters) ? (raw.characters as UnknownRecord[]) : [];
        const books = characters
          .map((character) => {
            const characterName = String(character.characterName ?? "未知角色");
            const characterStableId = String(character.characterStableId ?? characterName);
            const stories = Array.isArray(character.stories) ? (character.stories as UnknownRecord[]) : [];
            const volumes: CodexBookVolume[] = stories.map((story, index) => ({
              stableId: String(story.storyStableId ?? story.documentId ?? index),
              bookStableId: characterStableId,
              documentId: String(story.documentId),
              title: String(story.title ?? story.displayTitle ?? `故事 ${index + 1}`),
              volume: null,
              order: index + 1,
              segmentCount: 1,
            }));
            return { stableId: characterStableId, bookStableId: characterStableId, title: characterName, volumes };
          })
          .filter((book) => book.volumes.length > 0);
        setCatalog({
          gameId: String(raw.gameId ?? gameId),
          revisionId: typeof raw.revisionId === "string" ? raw.revisionId : undefined,
          locale: "zh-CN",
          books,
          totalVolumes: books.reduce((sum, book) => sum + book.volumes.length, 0),
          truncated: false,
        });
      } else if (
        textKind === "voices" ||
        textKind === "items" ||
        textKind === "messages" ||
        textKind === "train-visitors"
      ) {
        const raw = value as UnknownRecord;
        const listKey = ["voices", "items", "entries"].find((key) => Array.isArray(raw[key]));
        // 上游个别条目名带未解析模板占位（如 #{REALNAME[..]}），不进入目录。
        const entries = (listKey ? (raw[listKey] as UnknownRecord[]) : [])
          .filter((entry) => !/\#\{|\}\s*锛|锛.{0,3}$/.test(String(entry.name ?? entry.title ?? "")))
          .map((entry, index): CodexBookVolume => {
            const documentId = String(entry.documentId ?? entry.id ?? index);
            const title = String(entry.title ?? entry.name ?? `条目 ${index + 1}`);
            // 语音语料的正文随目录下发，无需二次请求。
            const body = typeof entry.body === "string" ? entry.body : undefined;
            if (body) inlineBodies.set(documentId, body);
            return {
              stableId: documentId,
              bookStableId: "flat",
              documentId,
              title,
              volume: null,
              order: index + 1,
              segmentCount: 1,
            };
          });
        inlineBodiesRef.current = inlineBodies;
        setCatalog({
          gameId: String(raw.gameId ?? gameId),
          revisionId: typeof raw.revisionId === "string" ? raw.revisionId : undefined,
          locale: "zh-CN",
          books: entries.length
            ? [{ stableId: "flat", bookStableId: "flat", title: kindConfig.flatGroupTitle ?? kindConfig.navLabel, volumes: entries }]
            : [],
          totalVolumes: entries.length,
          truncated: false,
        });
      } else {
        setCatalog(mapBookListResponse(value));
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "文献目录加载失败");
    } finally {
      setLoading(false);
    }
  }, [gameId, selectedRevision, textKind, isStarRail, kindConfig.flatGroupTitle, kindConfig.navLabel]);

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
    async (documentId: string, entryTitle?: string) => {
      // 语音等目录内嵌正文：直接合成文档，跳过 documents 查询。
      const inlineBody = inlineBodiesRef.current.get(documentId);
      if (inlineBody !== undefined) {
        setTextDocument({
          id: documentId,
          title: entryTitle ?? documentId,
          type: "voiceline",
          locale: "zh-CN",
          body: inlineBody,
          sourceName: gameName,
          sourceId: documentId,
          segments: [],
          gameVersion: null,
          revision: selectedRevision ?? undefined,
        });
        setDocumentLoading(false);
        return;
      }
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
        setError(reason instanceof Error ? reason.message : "文献正文加载失败");
      } finally {
        setDocumentLoading(false);
      }
    },
    [gameId, selectedRevision, gameName],
  );

  useEffect(() => {
    if (!activeEntry) {
      setTextDocument(null);
      return;
    }
    void loadDocument(activeEntry.volume.documentId, activeEntry.volume.title);
  }, [activeEntry?.volume.documentId, activeEntry?.volume.title, loadDocument]);

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
          { key: "materials", label: isStarRail ? "光锥/材料" : "材料", onSelect: onOpenMaterials },
        ],
      },
      {
        label: "文献分类",
        items: [
          {
            key: "books",
            label: "书籍文献",
            active: textKind === "books",
            onSelect: () => {
              if (window.location.hash !== "#text/books") {
                window.location.hash = "text/books";
              }
            },
          },
          {
            key: "character-stories",
            label: "角色故事",
            active: textKind === "character-stories",
            onSelect: () => (window.location.hash = "text/character-stories"),
          },
          {
            key: "voices",
            label: "角色语音",
            active: textKind === "voices",
            onSelect: () => (window.location.hash = "text/voices"),
          },
          ...(isStarRail
            ? [
                {
                  key: "messages",
                  label: "星轨短信",
                  active: textKind === "messages",
                  onSelect: () => (window.location.hash = "text/messages"),
                },
                {
                  key: "train-visitors",
                  label: "列车访客",
                  active: textKind === "train-visitors",
                  onSelect: () => (window.location.hash = "text/train-visitors"),
                },
                {
                  key: "items",
                  label: "物品文本",
                  active: textKind === "items",
                  onSelect: () => (window.location.hash = "text/items"),
                },
              ]
            : [
                {
                  key: "items",
                  label: "物品文本",
                  active: textKind === "items",
                  onSelect: () => (window.location.hash = "text/items"),
                },
                {
                  key: "mechanics",
                  label: "机制教程",
                  active: textKind === "mechanics",
                  onSelect: () => (window.location.hash = "text/mechanics"),
                },
              ]),
        ],
      },
    ],
    [onHome, onOpenStory, onOpenMaterials, isStarRail, textKind],
  );

  function selectVolume(entry: TextChapterRef, mode: "push" | "replace" = "push") {
    setActiveVolumeId(entry.volume.stableId);
    setActiveBookId(entry.book.bookStableId);
    onRouteChange?.(entry.book.bookStableId, entry.volume.stableId, mode);
  }

  const typeLabel =
    textDocument?.type === "book"
      ? "书籍"
      : textDocument?.type === "character_story"
        ? "角色故事"
        : textDocument?.type === "voiceline"
          ? "角色语音"
          : textDocument?.type === "message"
            ? "星轨短信"
            : textDocument?.type === "train_visitor"
              ? "列车访客"
              : textDocument?.type === "item_lore" || textDocument?.type === "item_description"
                ? "物品文本"
                : "文献";

  return (
    <ArchiveLayout
      globalNav={
        <ArchiveGlobalNav gameLabel={gameName} revisionLabel={revisionLabel} sections={sections} />
      }
      catalog={
        <div className="text-catalog">
          <input
            aria-label={kindConfig.searchLabel}
            placeholder={`搜索${kindConfig.itemNoun}…`}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {loading ? (
            <ArchiveLoading label={`${kindConfig.navLabel}目录加载中`} />
          ) : filteredBooks.length ? (
            filteredBooks.map((book) => (
              <section key={book.stableId} className="text-catalog-book">
                {filteredBooks.length > 1 || book.stableId !== "flat" ? <h3>{book.title}</h3> : null}
                {book.volumes.map((volume) => (
                  <button
                    type="button"
                    key={volume.stableId}
                    className={volume.stableId === activeVolumeId ? "is-active" : ""}
                    aria-current={volume.stableId === activeVolumeId ? "true" : undefined}
                    onClick={() => selectVolume({ book, volume }, "push")}
                  >
                    <strong>{volume.title}</strong>
                    {volume.segmentCount > 1 ? <small>{volume.segmentCount} 个片段</small> : null}
                  </button>
                ))}
              </section>
            ))
          ) : (
            <ArchiveEmpty
              title={searchQuery ? "未找到相关内容" : kindConfig.emptyTitle}
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
          {!textDocument && !documentLoading && !loading && !error && entries.length === 0 ? (
            <ArchiveEmpty
              title={`暂无已收录的${kindConfig.itemNoun}文本`}
              detail="当前版本的上游快照尚未包含此类文献。"
            />
          ) : null}
          {textDocument && !documentLoading ? (
            <>
              <header className="text-reader-header">
                <span className="story-type-pill">{typeLabel}</span>
                <h2>{textDocument.type === "book" ? `《${textDocument.title}》` : textDocument.title}</h2>
                <p className="story-reader-meta">
                  {[gameName, textDocument.gameVersion, textDocument.revision ? `Revision ${textDocument.revision}` : ""]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </header>
              <div className="text-prose">
                {textDocument.segments.length ? (
                  textDocument.segments.map((segment) => (
                    <div key={segment.id} className="text-segment">
                      {segment.headingPath?.length &&
                      segment.headingPath.join(" / ") !== textDocument.title ? (
                        <h3>{segment.headingPath.join(" / ")}</h3>
                      ) : null}
                      <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.8 }}>
                        {formatStoryText(segment.body, {
                          game: isStarRail ? "starrail" : "genshin",
                          gender: "female",
                          nickname: isStarRail ? "开拓者" : "旅行者",
                        })}
                      </p>
                    </div>
                  ))
                ) : textDocument.body ? (
                  <div className="text-segment">
                    <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.8 }}>
                      {formatStoryText(textDocument.body, {
                        game: isStarRail ? "starrail" : "genshin",
                        gender: "female",
                        nickname: isStarRail ? "开拓者" : "旅行者",
                      })}
                    </p>
                  </div>
                ) : (
                  <p className="muted">本篇暂无内容</p>
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
        <ArchiveInspector title={`${kindConfig.itemNoun}信息`}>
          {!textDocument ? (
            <p className="muted">选择左侧条目查看文献出处与收录信息。</p>
          ) : (
            <>
              <InspectorSection title="基本信息">
                <InspectorField
                  label="标题"
                  value={activeEntry?.book.title ?? textDocument.title}
                />
                <InspectorField label="分类" value={typeLabel} />
                <InspectorField label="片段数" value={textDocument.segments.length} />
              </InspectorSection>
              <InspectorSection title="版本与来源">
                <InspectorField label="当前版本" value={textDocument.gameVersion ?? "—"} />
                <InspectorField label="Revision" value={<code>{textDocument.revision}</code>} />
              </InspectorSection>
            </>
          )}
        </ArchiveInspector>
      }
    />
  );
}
