import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QuestDetail, QuestSearchHit } from "../../api.js";
import { apiFetch } from "../../api.js";
import { mapQuestDetail, mergeQuestPages } from "../../codex/mappers.js";
import { completenessLabel, questTypeLabel } from "../../shared.js";
import { ArchiveEmpty, ArchiveError } from "../ArchiveStates.js";
import { ArchiveLayout } from "../ArchiveLayout.js";
import { ArchiveGlobalNav, type GlobalNavSection } from "../ArchiveGlobalNav.js";
import { StoryCatalog, buildStoryTree, flattenStoryTreeQuests } from "./StoryCatalog.js";
import { StoryInspector } from "./StoryInspector.js";
import { StoryTextBlock } from "./StoryTextBlock.js";
import type { StoryCatalogFilters, StoryEntry } from "./story.types.js";

function toEntry(hit: QuestSearchHit): StoryEntry {
  return {
    questKey: hit.questKey,
    title: hit.title,
    type: hit.type,
    chapter: hit.chapter,
    series: hit.series,
    completeness: hit.completeness,
    locale: hit.locale,
  };
}

/**
 * Story reader built on the existing Quest API: cursor pagination, revision,
 * locale and citations are preserved. Rendered as continuous prose without
 * chat bubbles.
 */
export function StoryBrowser({
  gameId,
  gameName,
  revisionLabel,
  selectedRevision,
  initialQuestKey,
  onHome,
  onOpenMaterials,
  onOpenText,
  onQuestKeyChange,
}: {
  gameId: string;
  gameName: string;
  revisionLabel: string;
  selectedRevision?: string;
  initialQuestKey?: string;
  onHome: () => void;
  onOpenMaterials: () => void;
  onOpenText: () => void;
  onQuestKeyChange?: (questKey: string | undefined, mode?: "push" | "replace") => void;
}) {
  const [filters, setFilters] = useState<StoryCatalogFilters>({
    query: "",
    type: "",
    locale: "zh-CN",
  });
  const [entries, setEntries] = useState<StoryEntry[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [quest, setQuest] = useState<QuestDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [activeSubquestKey, setActiveSubquestKey] = useState<string | undefined>();
  const [highlightNodeKey, setHighlightNodeKey] = useState<string | undefined>();
  const abortRef = useRef<AbortController | null>(null);
  const loaderRef = useRef<HTMLDivElement | null>(null);

  const loadCatalog = useCallback(
    async (nextFilters: StoryCatalogFilters) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setCatalogLoading(true);
      setCatalogError("");
      try {
        const params = new URLSearchParams({ locale: nextFilters.locale, limit: "50" });
        if (nextFilters.query.trim()) params.set("q", nextFilters.query.trim());
        if (nextFilters.type) params.set("type", nextFilters.type);
        if (selectedRevision) params.set("revisionId", selectedRevision);
        const result = await apiFetch<{ quests: QuestSearchHit[] }>(
          `/api/games/${gameId}/quests?${params.toString()}`,
          { signal: controller.signal },
        );
        setEntries(result.quests.map(toEntry));
      } catch (reason) {
        if (
          controller.signal.aborted ||
          (reason instanceof Error && reason.name === "AbortError")
        ) {
          return;
        }
        setCatalogError(reason instanceof Error ? reason.message : "任务目录加载失败");
      } finally {
        if (!controller.signal.aborted) {
          setCatalogLoading(false);
        }
      }
    },
    [gameId, selectedRevision],
  );

  useEffect(() => {
    void loadCatalog(filters);
    return () => {
      abortRef.current?.abort();
    };
  }, [filters, loadCatalog]);

  const openQuest = useCallback(
    async (questKey: string, options?: { cursor?: string | null; subquestKey?: string }) => {
      setDetailLoading(true);
      setDetailError("");
      try {
        const params = new URLSearchParams({ locale: filters.locale, limit: "100" });
        if (selectedRevision) params.set("revisionId", selectedRevision);
        if (options?.cursor) params.set("cursor", options.cursor);
        if (options?.subquestKey) params.set("subquestId", options.subquestKey);
        const result = await apiFetch<{ quest: QuestDetail }>(
          `/api/games/${gameId}/quests/${encodeURIComponent(questKey)}?${params.toString()}`,
        );
        const page = mapQuestDetail(result.quest);
        setQuest((current) => (options?.cursor && current ? mergeQuestPages(current, page) : page));
        setCursor(page.nextCursor);
      } catch (reason) {
        setDetailError(reason instanceof Error ? reason.message : "任务详情加载失败");
      } finally {
        setDetailLoading(false);
      }
    },
    [filters.locale, gameId, selectedRevision],
  );

  // Synchronize when initialQuestKey changes (Deep link or browser back/forward)
  useEffect(() => {
    if (!initialQuestKey) {
      setQuest(null);
      return;
    }
    if (quest?.questKey === initialQuestKey) return;
    setActiveSubquestKey(undefined);
    setCursor(undefined);
    setHighlightNodeKey(undefined);
    void openQuest(initialQuestKey);
  }, [initialQuestKey, openQuest]);

  // Synchronize locale / revision changes for open quest
  useEffect(() => {
    if (!quest?.questKey) return;
    setCursor(undefined);
    setActiveSubquestKey(undefined);
    setHighlightNodeKey(undefined);
    void openQuest(quest.questKey);
  }, [filters.locale, selectedRevision]);

  useEffect(() => {
    if (!highlightNodeKey) return;
    const timer = window.setTimeout(() => setHighlightNodeKey(undefined), 2400);
    return () => window.clearTimeout(timer);
  }, [highlightNodeKey]);

  // Derive flat quest order from story tree for Previous / Next navigation
  const flattenedQuests = useMemo(() => {
    const tree = buildStoryTree(entries);
    return flattenStoryTreeQuests(tree);
  }, [entries]);

  const currentQuestIndex = flattenedQuests.findIndex((q) => q.questKey === quest?.questKey);
  const prevQuest = currentQuestIndex > 0 ? flattenedQuests[currentQuestIndex - 1] : undefined;
  const nextQuest =
    currentQuestIndex >= 0 && currentQuestIndex < flattenedQuests.length - 1
      ? flattenedQuests[currentQuestIndex + 1]
      : undefined;

  const sections: GlobalNavSection[] = useMemo(
    () => [
      {
        label: "浏览",
        items: [
          { key: "home", label: "首页", onSelect: onHome },
          {
            key: "story",
            label: "剧情档案",
            active: true,
            onSelect: () => {
              if (window.location.hash !== "#story") {
                window.location.hash = "story";
              }
            },
          },
          { key: "materials", label: "材料", onSelect: onOpenMaterials },
          { key: "text", label: "文本", onSelect: onOpenText },
        ],
      },
    ],
    [onHome, onOpenMaterials, onOpenText],
  );

  function selectEntry(entry: StoryEntry) {
    setActiveSubquestKey(undefined);
    setCursor(undefined);
    setHighlightNodeKey(undefined);
    onQuestKeyChange?.(entry.questKey, "push");
    void openQuest(entry.questKey);
  }

  function navigateToQuest(targetQuestKey: string) {
    setActiveSubquestKey(undefined);
    setCursor(undefined);
    setHighlightNodeKey(undefined);
    onQuestKeyChange?.(targetQuestKey, "push");
    void openQuest(targetQuestKey);
  }

  function handleSelectCitation(nodeKey: string) {
    setHighlightNodeKey(nodeKey);
    const elem = document.getElementById(`story-node-${nodeKey}`);
    if (elem) {
      elem.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }

  const dialogueNodes = quest?.dialogueNodes.filter((node) => node.body.trim()) ?? [];

  return (
    <ArchiveLayout
      globalNav={
        <ArchiveGlobalNav gameLabel={gameName} revisionLabel={revisionLabel} sections={sections} />
      }
      catalog={
        <StoryCatalog
          filters={filters}
          entries={entries}
          loading={catalogLoading}
          activeQuestKey={quest?.questKey}
          onFilters={(next) => setFilters((current) => ({ ...current, ...next }))}
          onSelect={selectEntry}
        />
      }
      main={
        <article className="story-reader" aria-busy={detailLoading}>
          {catalogError ? (
            <ArchiveError
              message="任务目录加载失败"
              detail={catalogError}
              onRetry={() => void loadCatalog(filters)}
            />
          ) : null}
          {detailError ? (
            <ArchiveError
              message="任务详情加载失败"
              detail={detailError}
              onRetry={() => quest && void openQuest(quest.questKey)}
            />
          ) : null}
          {!quest && !detailLoading ? (
            <ArchiveEmpty
              title="选择一个任务开始阅读"
              detail="剧情正文会以连续文本方式展示，不使用对话气泡。"
            />
          ) : null}
          {quest ? (
            <>
              <header className="story-reader-header">
                <span className="story-type-pill">{questTypeLabel(quest.type)}</span>
                <h2>{quest.title}</h2>
                <p className="story-reader-meta">
                  {completenessLabel(quest.completeness)} ·{" "}
                  {quest.locale === "en" ? "English" : "简体中文"} · Revision{" "}
                  {quest.revision || "—"}
                </p>
              </header>
              {quest.warnings.length ? (
                <div className="inline-warning" role="status">
                  <strong>读取警告</strong>
                  <span>{quest.warnings.join("；")}</span>
                </div>
              ) : null}
              {quest.subquests.length ? (
                <nav className="story-subquest-row" aria-label="子任务">
                  {quest.subquests.map((subquest) => (
                    <button
                      type="button"
                      key={subquest.subquestKey}
                      className={subquest.subquestKey === activeSubquestKey ? "is-active" : ""}
                      onClick={() => {
                        setActiveSubquestKey(subquest.subquestKey);
                        void openQuest(quest.questKey, { subquestKey: subquest.subquestKey });
                      }}
                    >
                      {subquest.title}
                    </button>
                  ))}
                </nav>
              ) : null}
              <div className="story-prose">
                {dialogueNodes.length ? (
                  dialogueNodes.map((node) => (
                    <div
                      className={`story-node ${highlightNodeKey === node.nodeKey ? "is-highlight" : ""}`}
                      id={`story-node-${node.nodeKey}`}
                      key={node.nodeKey}
                    >
                      <StoryTextBlock node={node} />
                    </div>
                  ))
                ) : !detailLoading ? (
                  <p className="muted">暂无正文</p>
                ) : null}
              </div>
              <div className="story-loader" ref={loaderRef} aria-hidden="true" />
              <footer className="story-reader-footer">
                <div className="story-cursor-pagination">
                  <span role="status">
                    已加载 {quest.loadedDialogueNodes ?? dialogueNodes.length} /{" "}
                    {quest.totalDialogueNodes ?? dialogueNodes.length} 条
                  </span>
                  <button
                    type="button"
                    disabled={!cursor || detailLoading}
                    onClick={() => quest && void openQuest(quest.questKey, { cursor })}
                  >
                    {cursor ? "加载更多正文" : "已到正文末尾"}
                  </button>
                </div>
                <nav className="story-quest-navigation" aria-label="任务导航">
                  <button
                    type="button"
                    disabled={!prevQuest}
                    onClick={() => prevQuest && navigateToQuest(prevQuest.questKey)}
                  >
                    ← 上一任务
                  </button>
                  <button
                    type="button"
                    disabled={!nextQuest}
                    onClick={() => nextQuest && navigateToQuest(nextQuest.questKey)}
                  >
                    下一任务 →
                  </button>
                </nav>
              </footer>
            </>
          ) : null}
        </article>
      }
      inspector={<StoryInspector quest={quest} onSelectCitation={handleSelectCitation} />}
    />
  );
}
