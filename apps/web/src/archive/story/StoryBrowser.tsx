import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { QuestDetail, QuestSearchHit, StoryCatalog as ApiStoryCatalog } from "../../api.js";
import { api, apiFetch } from "../../api.js";
import { mapQuestDetail, mergeQuestPages } from "../../codex/mappers.js";
import { completenessLabel, isStarRailGame, questTypeLabel } from "../../shared.js";
import { ArchiveEmpty, ArchiveError } from "../ArchiveStates.js";
import { ArchiveLayout } from "../ArchiveLayout.js";
import { ArchiveGlobalNav, type GlobalNavSection } from "../ArchiveGlobalNav.js";
import { StoryCatalog, buildStoryTree, flattenStoryTreeQuests } from "./StoryCatalog.js";
import { StoryInspector } from "./StoryInspector.js";
import { StoryTextBlock } from "./StoryTextBlock.js";
import type { ProtagonistPreferences, StoryCatalogFilters, StoryEntry } from "./story.types.js";
import { loadProtagonistPreferences, saveProtagonistPreferences } from "./story.types.js";
import { formatStoryText } from "./story-format.js";

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
  gameSlug,
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
  gameSlug?: string;
  gameName: string;
  revisionLabel: string;
  selectedRevision?: string;
  initialQuestKey?: string;
  onHome: () => void;
  onOpenMaterials: () => void;
  onOpenText: () => void;
  onQuestKeyChange?: (questKey: string | undefined, mode?: "push" | "replace") => void;
}) {
  const isStarRail = isStarRailGame(gameSlug || gameId, gameName);
  const [filters, setFilters] = useState<StoryCatalogFilters>({
    query: "",
    type: "",
    locale: "zh-CN",
  });
  const [entries, setEntries] = useState<StoryEntry[]>([]);
  const [catalog, setCatalog] = useState<ApiStoryCatalog | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const [quest, setQuest] = useState<QuestDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [activeSubquestKey, setActiveSubquestKey] = useState<string | undefined>();
  const [highlightNodeKey, setHighlightNodeKey] = useState<string | undefined>();
  const [travelerPrefs, setTravelerPrefs] = useState<ProtagonistPreferences>(() =>
    loadProtagonistPreferences(isStarRail),
  );
  const abortRef = useRef<AbortController | null>(null);
  const loaderRef = useRef<HTMLDivElement | null>(null);

  // Synchronize preference state when switching between games
  useEffect(() => {
    setTravelerPrefs(loadProtagonistPreferences(isStarRail));
  }, [isStarRail, gameId]);

  function updateTravelerPrefs(patch: Partial<ProtagonistPreferences>) {
    setTravelerPrefs((prev) => {
      const next: ProtagonistPreferences = {
        ...prev,
        ...patch,
        game: isStarRail ? "starrail" : "genshin",
      };
      saveProtagonistPreferences(next);
      return next;
    });
  }

  const loadCatalog = useCallback(
    async (nextFilters: StoryCatalogFilters) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setCatalogLoading(true);
      setCatalogError("");
      try {
        try {
          const catalogResult = await api.storyCatalog(gameId, {
            revisionId: selectedRevision,
          });
          if (catalogResult && catalogResult.regions && catalogResult.regions.length > 0) {
            setCatalog(catalogResult);
          }
        } catch {
          // Fallback if catalog not ready
        }

        const params = new URLSearchParams({ locale: nextFilters.locale, limit: "100" });
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
    const tree = buildStoryTree(entries, catalog, filters.query, isStarRail);
    return flattenStoryTreeQuests(tree);
  }, [entries, catalog, filters.query, isStarRail]);

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

  function selectEntry(entry: { questKey: string; title: string }) {
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
          catalog={catalog}
          loading={catalogLoading}
          activeQuestKey={quest?.questKey}
          isStarRail={isStarRail}
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
            isStarRail && entries.length === 0 ? (
              <div className="starrail-readiness-card" role="region" aria-label="星穹铁道档案就绪说明">
                <div className="starrail-readiness-badge">
                  <span>🚀 银河铁道之声 · 星海剧情档案库</span>
                </div>
                <h3 className="starrail-readiness-title">《崩坏：星穹铁道》专属界面体系已就绪</h3>
                <p className="starrail-readiness-desc">
                  当前平台已为星铁全面升级专属数据分类与叙事体系：光锥/遗器分类过滤、穹/星开拓者视角自适应、以及涵盖开拓任务、同行任务与开拓续闻的多级目录架构。
                </p>

                <div className="story-reader-pref-bar" style={{ margin: "0 0 20px 0" }}>
                  <div className="story-pref-controls-left">
                    <div className="story-pref-group">
                      <span className="story-pref-label">开拓者设定</span>
                      <div className="story-gender-segmented" role="radiogroup" aria-label="开拓者视角">
                        <button
                          type="button"
                          className={`story-gender-btn ${travelerPrefs.gender === "male" ? "is-active" : ""}`}
                          onClick={() => updateTravelerPrefs({ gender: "male" })}
                          title="穹（男主）视角：对白中使用他/穹，开拓者代称"
                        >
                          👦 穹 (男)
                        </button>
                        <button
                          type="button"
                          className={`story-gender-btn ${travelerPrefs.gender === "female" ? "is-active" : ""}`}
                          onClick={() => updateTravelerPrefs({ gender: "female" })}
                          title="星（女主）视角：对白中使用她/星，开拓者代称"
                        >
                          👧 星 (女)
                        </button>
                      </div>
                    </div>

                    <div className="story-pref-group">
                      <label htmlFor="story-readiness-nickname" className="story-pref-label">
                        昵称
                      </label>
                      <div className="story-nickname-wrapper">
                        <input
                          id="story-readiness-nickname"
                          type="text"
                          className="story-nickname-input"
                          value={travelerPrefs.nickname}
                          placeholder="开拓者"
                          maxLength={16}
                          onChange={(e) => updateTravelerPrefs({ nickname: e.target.value })}
                          title="自定义开拓者代称"
                        />
                        {travelerPrefs.nickname && travelerPrefs.nickname !== "开拓者" ? (
                          <button
                            type="button"
                            className="story-nickname-reset-btn"
                            title="重置为默认「开拓者」"
                            onClick={() => updateTravelerPrefs({ nickname: "开拓者" })}
                          >
                            ✕
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                  <div className="story-pref-hint">
                    <span>💡 独立保存星铁开拓者偏好</span>
                  </div>
                </div>

                <div className="starrail-worlds-grid">
                  <div className="starrail-world-chip">
                    <span className="starrail-world-icon">🛰️</span>
                    <span className="starrail-world-name">空间站「黑塔」</span>
                    <span className="starrail-world-sub">Herta Space Station</span>
                  </div>
                  <div className="starrail-world-chip">
                    <span className="starrail-world-icon">❄️</span>
                    <span className="starrail-world-name">雅利洛-VI</span>
                    <span className="starrail-world-sub">Jarilo-VI</span>
                  </div>
                  <div className="starrail-world-chip">
                    <span className="starrail-world-icon">🏮</span>
                    <span className="starrail-world-name">仙舟「罗浮」</span>
                    <span className="starrail-world-sub">Xianzhou Luofu</span>
                  </div>
                  <div className="starrail-world-chip">
                    <span className="starrail-world-icon">🍷</span>
                    <span className="starrail-world-name">匹诺康尼</span>
                    <span className="starrail-world-sub">Penacony</span>
                  </div>
                  <div className="starrail-world-chip">
                    <span className="starrail-world-icon">🏛️</span>
                    <span className="starrail-world-name">翁法罗斯</span>
                    <span className="starrail-world-sub">Amphoreus</span>
                  </div>
                </div>

                <div className="starrail-readiness-info">
                  ℹ️ <strong>数据管道状态</strong>：当前本地检索库已收录 15,907 份星铁原始资料。全量主线开拓任务与短信对白文本正在通过 TurnBasedGameData 管道等待导入与语义图谱构建。
                </div>

                <div className="starrail-readiness-actions">
                  <button
                    type="button"
                    className="starrail-action-btn primary"
                    onClick={() => (window.location.hash = "search")}
                  >
                    前往星铁全文搜索
                  </button>
                  <button
                    type="button"
                    className="starrail-action-btn"
                    onClick={() => (window.location.hash = "archive/weapons")}
                  >
                    查看光锥与遗器
                  </button>
                </div>
              </div>
            ) : (
              <ArchiveEmpty
                title="选择一个任务开始阅读"
                detail="剧情正文会以连续文本方式展示，不使用对话气泡。"
              />
            )
          ) : null}
          {quest ? (
            <>
              <header className="story-reader-header">
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "6px" }}>
                  {quest.region ? <span className="story-type-pill">{quest.region}</span> : null}
                  {quest.chapter ? <span className="story-type-pill">{quest.chapter}</span> : null}
                  <span className="story-type-pill">{questTypeLabel(quest.type, isStarRail)}</span>
                </div>
                <h2>{quest.title}</h2>
                <p className="story-reader-meta">
                  {completenessLabel(quest.completeness)} ·{" "}
                  {quest.locale === "en" ? "English" : "简体中文"} · Revision{" "}
                  {quest.revision || "—"}
                </p>

                <div className="story-reader-pref-bar">
                  <div className="story-pref-controls-left">
                    <div className="story-pref-group">
                      <span className="story-pref-label">
                        {isStarRail ? "开拓者设定" : "主角设定"}
                      </span>
                      <div className="story-gender-segmented" role="radiogroup" aria-label="主角视角">
                        <button
                          type="button"
                          className={`story-gender-btn ${travelerPrefs.gender === "male" ? "is-active" : ""}`}
                          onClick={() => updateTravelerPrefs({ gender: "male" })}
                          title={
                            isStarRail
                              ? "穹（男主）视角：对白中使用他/穹，开拓者代称"
                              : "空（男主）视角：对白中使用他/哥哥/空，深渊血亲为妹妹荧"
                          }
                        >
                          {isStarRail ? "👦 穹 (男)" : "👦 空 (男)"}
                        </button>
                        <button
                          type="button"
                          className={`story-gender-btn ${travelerPrefs.gender === "female" ? "is-active" : ""}`}
                          onClick={() => updateTravelerPrefs({ gender: "female" })}
                          title={
                            isStarRail
                              ? "星（女主）视角：对白中使用她/星，开拓者代称"
                              : "荧（女主）视角：对白中使用她/姐姐/荧，深渊血亲为哥哥空"
                          }
                        >
                          {isStarRail ? "👧 星 (女)" : "👧 荧 (女)"}
                        </button>
                      </div>
                    </div>

                    <div className="story-pref-group">
                      <label htmlFor="story-nickname-input" className="story-pref-label">
                        昵称
                      </label>
                      <div className="story-nickname-wrapper">
                        <input
                          id="story-nickname-input"
                          type="text"
                          className="story-nickname-input"
                          value={travelerPrefs.nickname}
                          placeholder={isStarRail ? "开拓者" : "旅行者"}
                          maxLength={16}
                          onChange={(e) => updateTravelerPrefs({ nickname: e.target.value })}
                          title={
                            isStarRail
                              ? "自定义对白中被呼唤的名字（留空恢复默认「开拓者」）"
                              : "自定义对白中被呼唤的名字（留空恢复默认「旅行者」）"
                          }
                        />
                        {travelerPrefs.nickname &&
                        travelerPrefs.nickname !== (isStarRail ? "开拓者" : "旅行者") ? (
                          <button
                            type="button"
                            className="story-nickname-reset-btn"
                            title={`重置为默认「${isStarRail ? "开拓者" : "旅行者"}」`}
                            onClick={() =>
                              updateTravelerPrefs({ nickname: isStarRail ? "开拓者" : "旅行者" })
                            }
                          >
                            ✕
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="story-pref-hint">
                    <span>
                      {isStarRail ? "💡 实时驱动开拓者称谓与注音" : "💡 实时驱动人称与双关注音"}
                    </span>
                  </div>
                </div>
              </header>
              {quest.warnings.length ? (
                <div className="inline-warning" role="status">
                  <strong>读取警告</strong>
                  <span>{quest.warnings.join("；")}</span>
                </div>
              ) : null}
              {quest.subquests.length ? (
                <nav className="story-subquest-row" aria-label="子任务">
                  <button
                    type="button"
                    className={!activeSubquestKey ? "is-active" : ""}
                    onClick={() => {
                      setActiveSubquestKey(undefined);
                      void openQuest(quest.questKey);
                    }}
                  >
                    全部阶段 ({quest.subquests.length})
                  </button>
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
              {activeSubquestKey ? (
                <div className="story-active-subquest-indicator">
                  <span>❖ 当前聚焦阶段：{quest.subquests.find((s) => s.subquestKey === activeSubquestKey)?.title}</span>
                  <button
                    type="button"
                    className="story-inline-link"
                    onClick={() => {
                      setActiveSubquestKey(undefined);
                      void openQuest(quest.questKey);
                    }}
                  >
                    查看全部阶段剧情
                  </button>
                </div>
              ) : null}
              <div className="story-prose">
                {quest.narrative?.mode === "document" ? (
                  <div className="story-narrative-document">
                    {quest.narrative.documentSegments && quest.narrative.documentSegments.length > 0 ? (
                      quest.narrative.documentSegments.map((seg) => (
                        <section key={seg.segmentId} className="story-script-narration" style={{ marginBottom: "16px" }}>
                          <span className="story-narration-glyph" aria-hidden="true">❖</span>
                          <div className="story-narration-content">
                            {seg.heading ? (
                              <h4 style={{ margin: "0 0 8px", color: "var(--archive-text)" }}>
                                {formatStoryText(seg.heading, travelerPrefs)}
                              </h4>
                            ) : null}
                            <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.8, color: "var(--archive-text)" }}>
                              {formatStoryText(seg.body, travelerPrefs)}
                            </p>
                          </div>
                        </section>
                      ))
                    ) : quest.narrative.documentBody ? (
                      <section className="story-script-narration">
                        <span className="story-narration-glyph" aria-hidden="true">❖</span>
                        <div className="story-narration-content">
                          <p style={{ margin: 0, whiteSpace: "pre-wrap", lineHeight: 1.8, color: "var(--archive-text)" }}>
                            {formatStoryText(quest.narrative.documentBody, travelerPrefs)}
                          </p>
                        </div>
                      </section>
                    ) : (
                      <p className="muted">暂无文档正文</p>
                    )}
                  </div>
                ) : quest.narrative?.mode === "objective_only" ? (
                  <div className="story-narrative-objectives">
                    <p className="muted" style={{ marginBottom: "12px" }}>此任务为目标型任务，无独立角色对白记录：</p>
                    {quest.subquests.map((sub) => (
                      <div key={sub.subquestKey} className="story-script-objective">
                        <span className="story-objective-badge">目标</span>
                        <div style={{ flex: 1 }}>
                          <strong>{formatStoryText(sub.title, travelerPrefs)}</strong>
                          {sub.objective ? (
                            <p style={{ margin: "4px 0 0", color: "var(--archive-text-secondary)" }}>
                              {formatStoryText(sub.objective, travelerPrefs)}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : quest.narrative?.mode === "unavailable" ? (
                  <div className="story-narrative-unavailable">
                    <p className="muted">{quest.narrative.reason ?? "当前任务暂无剧情数据。"}</p>
                  </div>
                ) : dialogueNodes.length ? (
                  dialogueNodes.map((node) => (
                    <div
                      className={`story-node ${highlightNodeKey === node.nodeKey ? "is-highlight" : ""}`}
                      id={`story-node-${node.nodeKey}`}
                      key={node.nodeKey}
                    >
                      <StoryTextBlock node={node} prefs={travelerPrefs} />
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
