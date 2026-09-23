import { useCallback, useEffect, useMemo, useState } from "react";
import type { DocumentDetail } from "@gip/domain";
import type { TextCatalogEntry as EntryModel, TextCatalogResponse } from "@gip/contracts";
import { apiFetch } from "../../api.js";
import { ArchiveEmpty, ArchiveError, ArchiveLoading } from "../ArchiveStates.js";
import { ArchiveLayout } from "../ArchiveLayout.js";
import { ArchiveGlobalNav, type GlobalNavSection } from "../ArchiveGlobalNav.js";
import { ArchiveInspector, InspectorField, InspectorSection } from "../ArchiveInspector.js";
import { isStarRailGame } from "../../shared.js";
import { formatStoryText } from "../story/story-format.js";
import { TextCatalog } from "./TextCatalog.js";
import { getAvailableKinds, getKindConfig } from "./text-kind-registry.js";

/** 短信/访客留言正文按「说话人：文本」解析为聊天行。 */
type ChatBlock =
  | { kind: "heading"; text: string }
  | { kind: "chat"; speaker: string; text: string }
  | { kind: "note"; text: string };

function parseChatBody(body: string): ChatBlock[] {
  const blocks: ChatBlock[] = [];
  for (const rawLine of body.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("##")) {
      blocks.push({ kind: "heading", text: line.replace(/^#+\s*/u, "") });
      continue;
    }
    if (line.startsWith("#")) continue;
    const match = /^(.{1,24}?)：\s*(.+)$/su.exec(line);
    if (match && match[1] && match[2]) {
      blocks.push({ kind: "chat", speaker: match[1], text: match[2] });
    } else {
      blocks.push({ kind: "note", text: line });
    }
  }
  return blocks;
}

export interface TextBrowserProps {
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
    groupId: string | undefined,
    documentId: string | undefined,
    mode?: "push" | "replace",
  ) => void;
}

export function TextBrowser({
  gameId,
  gameName,
  revisionLabel,
  selectedRevision,
  textKind = "books",
  initialBookId,
  initialChapterId,
  onRouteChange,
}: TextBrowserProps) {
  const [catalog, setCatalog] = useState<TextCatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeGroupId, setActiveGroupId] = useState<string | null>(initialBookId ?? null);
  const [activeEntryId, setActiveEntryId] = useState<string | null>(initialChapterId ?? null);
  const [activeEntry, setActiveEntry] = useState<EntryModel | null>(null);
  const [offset, setOffset] = useState(0);

  const [textDocument, setTextDocument] = useState<DocumentDetail | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);

  const isStarRail = isStarRailGame(gameId, gameName);
  const kindConfig = getKindConfig(textKind);
  const availableKinds = useMemo(() => getAvailableKinds(isStarRail), [isStarRail]);

  // Reset pagination, search, and group on kind change
  useEffect(() => {
    setSearchQuery("");
    setOffset(0);
    setActiveGroupId(initialBookId ?? null);
    setActiveEntryId(initialChapterId ?? null);
    setActiveEntry(null);
    setTextDocument(null);
  }, [textKind]);

  // Browser history changes the route props without remounting this reader.
  // Follow the URL so Back/Forward restores the selected document as well.
  useEffect(() => {
    setActiveGroupId(initialBookId ?? null);
    setActiveEntryId(initialChapterId ?? null);
    setActiveEntry(null);
    setOffset(0);
    setSearchQuery("");
  }, [initialBookId, initialChapterId]);

  // Load catalog list
  const loadCatalog = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({
        kind: textKind,
        locale: "zh-CN",
        offset: String(offset),
        limit: "100",
      });
      if (activeGroupId && activeGroupId !== "all") {
        params.set("group", activeGroupId);
      }
      if (searchQuery.trim()) {
        params.set("q", searchQuery.trim());
      }
      if (selectedRevision) {
        params.set("revisionId", selectedRevision);
      }

      const res = await apiFetch<TextCatalogResponse>(
        `/api/games/${gameId}/text/catalog?${params.toString()}`,
      );
      setCatalog(res);

      // Auto select group if none selected
      if (!activeGroupId && res.groups.length > 0 && res.groups[0]) {
        setActiveGroupId(res.groups[0].id);
      }

      // Auto select first entry if none selected or if activeEntry is not in current list
      const entries = res.entries;
      if (entries.length > 0) {
        const found = activeEntryId
          ? entries.find((e) => e.documentId === activeEntryId || e.stableId === activeEntryId)
          : undefined;
        const target = found ?? entries[0];
        if (target) {
          setActiveEntryId(target.documentId);
          // Selecting the default group may issue a second catalog request
          // for the same entry. Do not refetch its body or accidentally retry
          // a failed request just because that list response has a new object.
          setActiveEntry((current) =>
            current?.documentId === target.documentId ? current : target,
          );
        }
      } else {
        setActiveEntry(null);
        setTextDocument(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "文献目录加载失败");
    } finally {
      setLoading(false);
    }
  }, [gameId, textKind, selectedRevision, activeGroupId, searchQuery, offset]);

  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    if (!activeEntryId || !catalog || activeEntry?.documentId === activeEntryId) return;
    const matchingEntry = catalog.entries.find(
      (entry) => entry.documentId === activeEntryId || entry.stableId === activeEntryId,
    );
    if (matchingEntry) setActiveEntry(matchingEntry);
  }, [activeEntryId, activeEntry, catalog]);

  // Load document content
  const loadDocument = useCallback(
    async (entry: EntryModel) => {
      setDocumentLoading(true);
      setError("");
      try {
        const suffix = selectedRevision
          ? "?revisionId=" + encodeURIComponent(selectedRevision)
          : "";
        const result = await apiFetch<{ document: DocumentDetail }>(
          `/api/games/${gameId}/documents/${encodeURIComponent(entry.documentId)}${suffix}`,
        );
        setTextDocument(result.document);
      } catch (reason) {
        if (entry.preview && entry.kind !== "books") {
          setTextDocument({
            id: entry.documentId,
            title: entry.title,
            type: entry.kind,
            locale: entry.locale,
            body: entry.preview,
            sourceName: gameName,
            sourceId: entry.documentId,
            segments: [],
            gameVersion: entry.gameVersion ?? null,
            revision: selectedRevision ?? undefined,
          });
        } else {
          setTextDocument(null);
          setError(reason instanceof Error ? reason.message : "正文加载失败");
        }
      } finally {
        setDocumentLoading(false);
      }
    },
    [gameId, selectedRevision, gameName],
  );

  useEffect(() => {
    if (activeEntry) {
      void loadDocument(activeEntry);
    }
  }, [activeEntry, loadDocument]);

  const selectEntry = useCallback(
    (entry: EntryModel, mode: "push" | "replace" = "push") => {
      setActiveEntryId(entry.documentId);
      setActiveEntry(entry);
      onRouteChange?.(entry.groupId ?? activeGroupId ?? undefined, entry.documentId, mode);
    },
    [activeGroupId, onRouteChange],
  );

  const selectGroup = useCallback(
    (groupId: string) => {
      setActiveGroupId(groupId);
      setOffset(0);
      onRouteChange?.(groupId, undefined, "push");
    },
    [onRouteChange],
  );

  // Previous & Next navigation
  const entries = catalog?.entries ?? [];
  const activeIndex = entries.findIndex(
    (entry) => entry.documentId === activeEntryId || entry.stableId === activeEntryId,
  );
  const prevEntry = activeIndex > 0 ? entries[activeIndex - 1] : undefined;
  const nextEntry =
    activeIndex >= 0 && activeIndex < entries.length - 1 ? entries[activeIndex + 1] : undefined;

  // Global navigation sections
  const sections: GlobalNavSection[] = useMemo(
    () => [
      {
        label: "文献分类",
        items: availableKinds.map((k) => ({
          key: k.id,
          label: k.navLabel,
          active: textKind === k.id,
          onSelect: () => {
            window.location.hash = `text/${k.id}`;
          },
        })),
      },
    ],
    [availableKinds, textKind],
  );

  const isChatDocument =
    textDocument?.type === "message" ||
    textDocument?.type === "train_visitor" ||
    ["messages", "train-visitors"].includes(textKind);

  function renderChat(body: string) {
    const blocks = parseChatBody(body);
    return blocks.map((block, index) => {
      if (block.kind === "heading") {
        return (
          <h3 key={index} style={{ margin: "18px 0 8px" }}>
            {block.text}
          </h3>
        );
      }
      if (block.kind === "note") {
        return (
          <div className="story-script-narration" key={index}>
            <span className="story-narration-glyph" aria-hidden="true">
              ❖
            </span>
            <div className="story-narration-content">
              <p className="story-narration-text">
                {formatStoryText(block.text, {
                  game: isStarRail ? "starrail" : "genshin",
                  gender: "female",
                  nickname: isStarRail ? "开拓者" : "旅行者",
                })}
              </p>
            </div>
          </div>
        );
      }
      const isTrailblazer = block.speaker === "开拓者" || block.speaker === "系统提示";
      const badgeClass = isTrailblazer
        ? "story-speaker-badge speaker-trailblazer"
        : "story-speaker-badge";
      const isSystem = block.speaker === "系统提示";
      if (isSystem) {
        return (
          <div className="story-script-system" key={index}>
            <span className="story-system-icon" aria-hidden="true">
              ⓘ
            </span>
            <span className="story-system-text">
              {formatStoryText(block.text, {
                game: isStarRail ? "starrail" : "genshin",
                gender: "female",
                nickname: isStarRail ? "开拓者" : "旅行者",
              })}
            </span>
          </div>
        );
      }
      return (
        <div className="story-script-row" key={index}>
          <div className="story-script-speaker-col">
            <span className={badgeClass}>{block.speaker}</span>
          </div>
          <div className="story-script-body-col">
            <p className="story-script-text">
              {formatStoryText(block.text, {
                game: isStarRail ? "starrail" : "genshin",
                gender: "female",
                nickname: isStarRail ? "开拓者" : "旅行者",
              })}
            </p>
          </div>
        </div>
      );
    });
  }

  return (
    <ArchiveLayout
      globalNav={
        <ArchiveGlobalNav gameLabel={gameName} revisionLabel={revisionLabel} sections={sections} />
      }
      catalog={
        <TextCatalog
          kindConfig={kindConfig}
          catalog={catalog}
          loading={loading}
          activeGroupId={activeGroupId}
          activeEntryId={activeEntryId}
          searchQuery={searchQuery}
          onSelectGroup={selectGroup}
          onSelectEntry={(entry) => selectEntry(entry, "push")}
          onSearchChange={(q) => {
            setSearchQuery(q);
            setOffset(0);
          }}
          onPageChange={(newOffset) => {
            setOffset(newOffset);
          }}
        />
      }
      main={
        <article className="text-reader" aria-busy={documentLoading}>
          {error ? (
            <ArchiveError
              message="资料加载失败"
              detail={error}
              onRetry={() => {
                void loadCatalog();
                if (activeEntry) void loadDocument(activeEntry);
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
                <span className="story-type-pill">{kindConfig.navLabel}</span>
                <h2>
                  {textDocument.type === "book" ? `《${textDocument.title}》` : textDocument.title}
                </h2>
                <p className="story-reader-meta">
                  {[
                    gameName,
                    activeEntry?.groupName ? `所属: ${activeEntry.groupName}` : null,
                    textDocument.gameVersion ? `v${textDocument.gameVersion}` : null,
                    textDocument.revision ? `Revision ${textDocument.revision}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </header>
              <div className="text-prose">
                {isChatDocument ? (
                  textDocument.body ? (
                    renderChat(textDocument.body)
                  ) : (
                    <p className="muted">本篇暂无内容</p>
                  )
                ) : textDocument.segments.length ? (
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
                  disabled={!prevEntry}
                  onClick={() => prevEntry && selectEntry(prevEntry, "push")}
                >
                  ← 上一篇
                </button>
                <span role="status">
                  {activeIndex >= 0 ? `${activeIndex + 1} / ${entries.length}` : "—"}
                </span>
                <button
                  type="button"
                  disabled={!nextEntry}
                  onClick={() => nextEntry && selectEntry(nextEntry, "push")}
                >
                  下一篇 →
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
                <InspectorField label="标题" value={activeEntry?.title ?? textDocument.title} />
                <InspectorField label="文献分类" value={kindConfig.navLabel} />
                {activeEntry?.groupName && (
                  <InspectorField label={kindConfig.groupLabel} value={activeEntry.groupName} />
                )}
                {activeEntry?.order !== undefined && (
                  <InspectorField label="条目序号" value={String(activeEntry.order)} />
                )}
                <InspectorField label="片段数" value={textDocument.segments.length || 1} />
              </InspectorSection>
              <InspectorSection title="版本与来源">
                <InspectorField
                  label="游戏版本"
                  value={textDocument.gameVersion ?? activeEntry?.gameVersion ?? "—"}
                />
                <InspectorField label="语言" value={textDocument.locale || "zh-CN"} />
                {textDocument.revision && (
                  <InspectorField label="Revision" value={<code>{textDocument.revision}</code>} />
                )}
                {activeEntry?.provenance?.sourceType && (
                  <InspectorField label="来源类型" value={activeEntry.provenance.sourceType} />
                )}
              </InspectorSection>
            </>
          )}
        </ArchiveInspector>
      }
    />
  );
}
