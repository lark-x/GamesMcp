import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type {
  Citation,
  ArchiveHomeResponse,
  EvidenceAnswer,
  GameSummary,
  SearchResult,
} from "@gip/contracts";
import type { DocumentDetail, EntityDetail } from "@gip/domain";
import { AdminRoutes } from "./admin/AdminRoutes.js";
import type { Revision } from "./api.js";
import { apiFetch } from "./api.js";
import {
  CodexAchievementsPage,
  CodexArtifactsPage,
  CodexBooksPage,
  CodexCharactersPage,
  CodexCharacterStoriesPage,
  CodexEnemiesPage,
  CodexItemsPage,
  CodexMaterialsPage,
  CodexMechanicsPage,
  CodexVoicesPage,
  CodexWeaponsPage,
} from "./codex/CodexPages.js";
import { mapArchiveHomeResponse } from "./codex/mappers.js";
import {
  parsePreviewRoute,
  revisionQuery,
  type ArchiveCategory,
  type PreviewRoute,
} from "./shared.js";
import { ArchiveSidebar, type Overview, type ResultType } from "./components/ArchiveSidebar.js";
import { AdminEntry, ArchiveFeed, DetailPanel, QaPanel } from "./components/LibraryPanels.js";
import { LibraryHeader } from "./components/LibraryHeader.js";
import { ArchiveToolbar, SearchCard } from "./components/LibrarySearch.js";
import { PreviewBrowser } from "./preview/PreviewBrowser.js";
import { parseArchiveRoute, type ArchiveRoute } from "./archive/archive.routes.js";
import { ArchiveLoading } from "./archive/ArchiveStates.js";

// Archive browsers are route-level code splits: the landing page never pays
// for story/material/text reader code.
const StoryBrowser = lazy(() =>
  import("./archive/story/StoryBrowser.js").then((module) => ({
    default: module.StoryBrowser,
  })),
);
const MaterialBrowser = lazy(() =>
  import("./archive/materials/MaterialBrowser.js").then((module) => ({
    default: module.MaterialBrowser,
  })),
);
const TextBrowser = lazy(() =>
  import("./archive/text/TextBrowser.js").then((module) => ({
    default: module.TextBrowser,
  })),
);

type GameResponse = { games: GameSummary[] };
export function App() {
  const [isAdminRoute, setIsAdminRoute] = useState(() =>
    window.location.hash.startsWith("#admin/"),
  );
  const [codexKind, setCodexKind] = useState<string | null>(() => {
    const match = /^#codex\/([a-z-]+)$/.exec(window.location.hash);
    return match?.[1] ?? null;
  });
  const [archiveRoute, setArchiveRoute] = useState<ArchiveRoute | null>(() => {
    const route = parseArchiveRoute();
    return route.kind === "unknown" ? null : route;
  });
  const [previewRoute, setPreviewRoute] = useState<PreviewRoute | null>(() => parsePreviewRoute());
  const [games, setGames] = useState<GameSummary[]>([]);
  const [gameId, setGameId] = useState("");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState<SearchResult | null>(null);
  const [entity, setEntity] = useState<EntityDetail | null>(null);
  const [document, setDocument] = useState<DocumentDetail | null>(null);
  const [activeSegmentId, setActiveSegmentId] = useState<string | undefined>();
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<EvidenceAnswer | null>(null);
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [asking, setAsking] = useState(false);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [overviewError, setOverviewError] = useState("");
  const [activeCategory, setActiveCategory] = useState("all");
  const [types, setTypes] = useState<Array<"entity" | "document" | "segment">>([
    "entity",
    "document",
    "segment",
  ]);
  const [entityType, setEntityType] = useState("");
  const [entityTypes, setEntityTypes] = useState<string[]>([]);
  const [documentType, setDocumentType] = useState("");
  const [documentTypes, setDocumentTypes] = useState<string[]>([]);
  const [gameVersion, setGameVersion] = useState("");
  const [selectedRevision, setSelectedRevision] = useState<string | undefined>();
  const [selectedRevisionLabel, setSelectedRevisionLabel] = useState<string | undefined>();
  const [sourceId, setSourceId] = useState("");
  const [overview, setOverview] = useState<Overview>({
    ready: null,
    home: null,
    sources: [],
  });

  useEffect(() => {
    apiFetch<GameResponse>("/api/games")
      .then((result) => {
        setGames(result.games);
        if (result.games[0]) setGameId(result.games[0].id);
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "无法加载游戏"),
      );
  }, []);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    setOverviewLoading(true);
    setOverviewError("");
    setSearch(null);
    setEntity(null);
    setDocument(null);
    setAnswer(null);
    setActiveSegmentId(undefined);
    setSourceId("");
    const load = async () => {
      const [ready, home, sources] = await Promise.allSettled([
        apiFetch<Overview["ready"]>("/api/ready"),
        apiFetch<ArchiveHomeResponse>(
          `/api/games/${gameId}/home?locale=zh-CN&limit=6${selectedRevision ? `&revisionId=${encodeURIComponent(selectedRevision)}` : ""}`,
        ),
        apiFetch<Pick<Overview, "sources">>(`/api/games/${gameId}/sources`),
      ]);
      if (cancelled) return;
      setOverview({
        ready: ready.status === "fulfilled" ? ready.value : null,
        home: home.status === "fulfilled" ? mapArchiveHomeResponse(home.value) : null,
        sources: sources.status === "fulfilled" ? sources.value.sources : [],
      });
      if ([ready, home, sources].some((result) => result.status === "rejected")) {
        setOverviewError("部分资料暂时无法加载，可以继续检索或稍后刷新页面。");
      }
      setOverviewLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [gameId, selectedRevision]);
  useEffect(() => {
    const onHashChange = () => {
      setIsAdminRoute(window.location.hash.startsWith("#admin/"));
      const codexMatch = /^#codex\/([a-z-]+)$/.exec(window.location.hash);
      setCodexKind(codexMatch?.[1] ?? null);
      const route = parseArchiveRoute();
      setArchiveRoute(route.kind === "unknown" ? null : route);
      setPreviewRoute(parsePreviewRoute());
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const currentGame = useMemo(() => games.find((game) => game.id === gameId), [games, gameId]);
  const visibleRevisionLabel =
    selectedRevisionLabel ??
    overview.ready?.currentRevision ??
    currentGame?.currentRevision ??
    "未发布";

  function clearError() {
    setError("");
  }

  async function runSearch(event: FormEvent) {
    event.preventDefault();
    if (!gameId || !query.trim()) return;
    setError("");
    setSearching(true);
    setEntity(null);
    setDocument(null);
    try {
      const params = {
        query,
        types,
        entityTypes: entityTypes.length ? entityTypes : entityType ? [entityType] : undefined,
        documentTypes: documentTypes.length
          ? documentTypes
          : documentType
            ? [documentType]
            : undefined,
        gameVersions: gameVersion ? [gameVersion] : undefined,
        revisionId: selectedRevision,
        sourceId: sourceId || undefined,
        limit: 20,
      };
      setSearch(
        await apiFetch<SearchResult>(`/api/games/${gameId}/search`, {
          method: "POST",
          body: JSON.stringify(params),
        }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "检索失败");
    } finally {
      setSearching(false);
    }
  }

  async function openEntity(id: string, revisionId: string | undefined = selectedRevision) {
    if (!gameId) return;
    setError("");
    setDetailLoading(true);
    try {
      const result = await apiFetch<{ entity: EntityDetail }>(
        `/api/games/${gameId}/entities/${id}${revisionQuery(revisionId)}`,
      );
      setEntity(result.entity);
      setDocument(null);
      setActiveSegmentId(undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "实体加载失败");
    } finally {
      setDetailLoading(false);
    }
  }

  async function openDocument(
    id: string,
    revisionId: string | undefined = selectedRevision,
    segmentId?: string,
  ) {
    if (!gameId) return;
    setError("");
    setDetailLoading(true);
    try {
      const result = await apiFetch<{ document: DocumentDetail }>(
        `/api/games/${gameId}/documents/${id}${revisionQuery(revisionId)}`,
      );
      setDocument(result.document);
      setEntity(null);
      setActiveSegmentId(segmentId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "文档加载失败");
    } finally {
      setDetailLoading(false);
    }
  }

  function openCitation(citation: Citation) {
    void openDocument(citation.documentId, selectedRevision, citation.segmentId);
  }

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!gameId || !question.trim()) return;
    setError("");
    setAsking(true);
    try {
      setAnswer(
        await apiFetch<EvidenceAnswer>(`/api/games/${gameId}/qa`, {
          method: "POST",
          body: JSON.stringify({ question, maxEvidence: 8, revisionId: selectedRevision }),
        }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "问答失败");
    } finally {
      setAsking(false);
    }
  }

  function selectArchiveCategory(category: ArchiveCategory) {
    if (category.route) {
      window.location.hash = category.route;
      setCodexKind(category.route.startsWith("codex/") ? category.route.slice(6) : null);
      return;
    }
    setActiveCategory(category.id);
    setTypes(category.types);
    setEntityType(category.entityType ?? "");
    setEntityTypes(category.entityTypes ?? (category.entityType ? [category.entityType] : []));
    setDocumentType(category.documentType ?? "");
    setDocumentTypes(
      category.documentTypes ?? (category.documentType ? [category.documentType] : []),
    );
  }

  if (previewRoute && gameId) {
    return (
      <PreviewBrowser
        gameId={gameId}
        candidateId={previewRoute.candidateId}
        initialBuildId={previewRoute.buildId}
      />
    );
  }

  if (archiveRoute && gameId) {
    const archiveGameName = currentGame?.name ?? "Game";
    if (archiveRoute.kind === "quests" || archiveRoute.kind === "story" || archiveRoute.kind === "story-catalog") {
      return (
        <Suspense fallback={<div className="archive-page-fallback"><ArchiveLoading /></div>}>
          <StoryBrowser
            gameId={gameId}
            gameName={archiveGameName}
            revisionLabel={visibleRevisionLabel}
            selectedRevision={selectedRevision}
            initialQuestKey={archiveRoute.kind === "story" ? archiveRoute.questKey : undefined}
            onHome={() => {
              window.location.hash = "";
              setArchiveRoute(null);
            }}
            onOpenMaterials={() => {
              window.location.hash = "archive/materials";
            }}
            onOpenText={() => {
              window.location.hash = "text/books";
            }}
            onQuestKeyChange={(questKey) => {
              const nextHash = questKey ? `story/${encodeURIComponent(questKey)}` : "story";
              if (window.location.hash !== `#${nextHash}`) {
                window.history.replaceState(null, "", `#${nextHash}`);
              }
            }}
          />
        </Suspense>
      );
    }
    if (archiveRoute.kind === "materials") {
      return (
        <Suspense fallback={<div className="archive-page-fallback"><ArchiveLoading /></div>}>
          <MaterialBrowser
            gameId={gameId}
            gameName={archiveGameName}
            revisionLabel={visibleRevisionLabel}
            selectedRevision={selectedRevision}
            initialMaterialId={archiveRoute.materialId}
            onHome={() => {
              window.location.hash = "";
              setArchiveRoute(null);
            }}
            onOpenStory={() => {
              window.location.hash = "story";
            }}
            onOpenText={() => {
              window.location.hash = "text/books";
            }}
            onMaterialIdChange={(materialId) => {
              const nextHash = materialId
                ? `archive/materials/${encodeURIComponent(materialId)}`
                : "archive/materials";
              if (window.location.hash !== `#${nextHash}`) {
                window.history.replaceState(null, "", `#${nextHash}`);
              }
            }}
          />
        </Suspense>
      );
    }
    if (archiveRoute.kind === "text") {
      return (
        <Suspense fallback={<div className="archive-page-fallback"><ArchiveLoading /></div>}>
          <TextBrowser
            gameId={gameId}
            gameName={archiveGameName}
            revisionLabel={visibleRevisionLabel}
            selectedRevision={selectedRevision}
            initialBookId={archiveRoute.bookId}
            initialChapterId={archiveRoute.chapterId}
            onHome={() => {
              window.location.hash = "";
              setArchiveRoute(null);
            }}
            onOpenStory={() => {
              window.location.hash = "story";
            }}
            onOpenMaterials={() => {
              window.location.hash = "archive/materials";
            }}
            onRouteChange={(bookStableId, volumeStableId) => {
              const parts = ["text", "books"];
              if (bookStableId) parts.push(encodeURIComponent(bookStableId));
              if (bookStableId && volumeStableId) parts.push(encodeURIComponent(volumeStableId));
              const nextHash = parts.join("/");
              if (window.location.hash !== `#${nextHash}`) {
                window.history.replaceState(null, "", `#${nextHash}`);
              }
            }}
          />
        </Suspense>
      );
    }
  }

  if (isAdminRoute) return <AdminRoutes initialRoute={window.location.hash.slice(1)} />;

  if (codexKind && gameId) {
    const codexPages: Record<string, React.ReactNode> = {
      characters: <CodexCharactersPage gameId={gameId} />,
      materials: <CodexMaterialsPage gameId={gameId} />,
      items: <CodexItemsPage gameId={gameId} revisionId={selectedRevision} />,
      weapons: <CodexWeaponsPage gameId={gameId} />,
      artifacts: <CodexArtifactsPage gameId={gameId} />,
      achievements: <CodexAchievementsPage gameId={gameId} />,
      enemies: <CodexEnemiesPage gameId={gameId} />,
      books: <CodexBooksPage gameId={gameId} revisionId={selectedRevision} />,
      "character-stories": (
        <CodexCharacterStoriesPage gameId={gameId} revisionId={selectedRevision} />
      ),
      mechanics: <CodexMechanicsPage gameId={gameId} revisionId={selectedRevision} />,
      tutorials: (
        <CodexMechanicsPage gameId={gameId} revisionId={selectedRevision} title="教程与机制" />
      ),
      voices: (
        <CodexVoicesPage gameId={gameId} home={overview.home} revisionId={selectedRevision} />
      ),
    };
    return (
      <div className="app-shell library-shell">
        <LibraryHeader
          gameName={currentGame?.name}
          games={games}
          gameId={gameId}
          overview={overview}
          onGameChange={setGameId}
          onPreview={(candidateId, buildId) => {
            window.location.hash = `preview/${candidateId}${buildId ? `/${buildId}` : ""}`;
          }}
          onRevision={(revisionId, revision?: Revision) => {
            setSelectedRevision(revisionId);
            setSelectedRevisionLabel(
              revision?.revisionNumber
                ? `r${revision.revisionNumber}`
                : (revision?.version ?? revisionId),
            );
          }}
          onCurrent={() => {
            setSelectedRevision(undefined);
            setSelectedRevisionLabel(undefined);
          }}
          onQuests={() => {
            window.location.hash = "quests";
          }}
          onMaterials={() => {
            window.location.hash = "archive/materials";
          }}
          onText={() => {
            window.location.hash = "text/books";
          }}
          onAdminPreview={() => {
            window.location.hash = "admin/preview";
          }}
        />
        <main className="library-page codex-page">
          <nav className="codex-nav" aria-label="数据分类">
            {Object.entries({
              characters: "角色",
              materials: "材料",
              items: "物品文本",
              weapons: "武器",
              artifacts: "圣遗物",
              achievements: "成就",
              enemies: "敌人",
              books: "书籍阅读",
              "character-stories": "角色故事",
              mechanics: "教程/机制",
              voices: "语音",
            }).map(([kind, label]) => (
              <button
                key={kind}
                className={codexKind === kind ? "active" : ""}
                onClick={() => {
                  window.location.hash = `codex/${kind}`;
                }}
              >
                {label}
              </button>
            ))}
            <button
              onClick={() => {
                window.location.hash = "";
              }}
            >
              返回检索
            </button>
          </nav>
          {codexPages[codexKind] ?? <div className="codex-empty">未知分类</div>}
        </main>
        <footer>{currentGame?.name ?? "加载中"}智库 · Game Codex</footer>
      </div>
    );
  }

  return (
    <div className="app-shell library-shell">
      <LibraryHeader
        gameName={currentGame?.name}
        games={games}
        gameId={gameId}
        overview={overview}
        onGameChange={setGameId}
        onPreview={(candidateId, buildId) => {
          window.location.hash = `preview/${candidateId}${buildId ? `/${buildId}` : ""}`;
        }}
        onRevision={(revisionId: string, revision?: Revision) => {
          setSelectedRevision(revisionId);
          setSelectedRevisionLabel(
            revision?.revisionNumber
              ? `r${revision.revisionNumber}`
              : (revision?.version ?? revisionId),
          );
          setSearch(null);
          setEntity(null);
          setDocument(null);
        }}
        onCurrent={() => {
          setSelectedRevision(undefined);
          setSelectedRevisionLabel(undefined);
          setSearch(null);
          setEntity(null);
          setDocument(null);
        }}
          onQuests={() => {
            window.location.hash = "quests";
          }}
          onMaterials={() => {
            window.location.hash = "archive/materials";
          }}
          onText={() => {
            window.location.hash = "text/books";
          }}
          onAdminPreview={() => {
            window.location.hash = "admin/preview";
          }}
      />
      <main className="library-page">
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button onClick={clearError}>关闭</button>
          </div>
        )}
        <SearchCard
          query={query}
          searching={searching}
          disabled={!gameId || !query.trim() || !types.length}
          onQueryChange={setQuery}
          onSearch={runSearch}
        />

        <div className="archive-layout">
          <ArchiveSidebar
            activeCategory={activeCategory}
            types={types as ResultType[]}
            entityType={entityType}
            documentType={documentType}
            gameVersion={gameVersion}
            sourceId={sourceId}
            overview={overview}
            visibleRevisionLabel={visibleRevisionLabel}
            onCategory={selectArchiveCategory}
            onTypesChange={(nextTypes) => {
              setActiveCategory("custom");
              setTypes(nextTypes);
            }}
            onEntityTypeChange={(value) => {
              setActiveCategory("custom");
              setEntityType(value);
              setEntityTypes(value ? [value] : []);
            }}
            onDocumentTypeChange={(value) => {
              setActiveCategory("custom");
              setDocumentType(value);
              setDocumentTypes(value ? [value] : []);
            }}
            onGameVersionChange={setGameVersion}
            onSourceChange={setSourceId}
          />

          <div className="archive-content">
            <ArchiveToolbar
              search={search}
              query={query}
              visibleRevisionLabel={visibleRevisionLabel}
            />

            {overviewError && !search && (
              <div className="inline-warning" role="status">
                <strong>部分内容未加载</strong>
                <span>{overviewError}</span>
              </div>
            )}

            <div className="archive-workspace">
              <ArchiveFeed
                search={search}
                home={overview.home}
                searching={searching}
                overviewLoading={overviewLoading}
                onEntity={openEntity}
                onDocument={openDocument}
                onCategory={selectArchiveCategory}
              />
              <DetailPanel
                detailLoading={detailLoading}
                entity={entity}
                document={document}
                activeSegmentId={activeSegmentId}
                onEntity={openEntity}
                onDocument={openDocument}
                onCitation={openCitation}
              />
            </div>

            <QaPanel
              question={question}
              asking={asking}
              disabled={!gameId || !question.trim()}
              answer={answer}
              onQuestionChange={setQuestion}
              onAsk={ask}
              onCitation={openCitation}
              onEntity={openEntity}
            />

            <AdminEntry
              onOpen={() => {
                window.location.hash = "admin/intake";
                setIsAdminRoute(true);
              }}
            />
          </div>
        </div>
      </main>
      <footer>
        {currentGame?.name ?? "加载中"}资料库 · 当前版本 {visibleRevisionLabel} · 内容均可追溯到来源
      </footer>
    </div>
  );
}
