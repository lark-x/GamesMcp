/* eslint-disable @typescript-eslint/no-unused-vars */
import { useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import type {
  Citation,
  DocumentSummary,
  EntitySummary,
  EvidenceAnswer,
  GameSummary,
  SearchResult,
} from "@gip/contracts";
import type {
  ConflictCase,
  ConflictDetail,
  DocumentDetail,
  EntityDetail,
  NormalizedRecord,
  ReleaseCandidate,
  ReleaseCandidateBuild,
  ReleaseCandidateDetail,
  ReleaseCandidateReadiness,
  VerificationChannel,
  VerificationScreenshot,
} from "@gip/domain";
import { AdminRoutes } from "./admin/AdminRoutes.js";
import { VersionSwitcher } from "./versions/VersionSwitcher.js";
type VerificationStatus = string;
type VerificationItem = {
  id: string;
  status?: string;
  category?: string;
  canonicalKey?: string;
  screenshots?: VerificationScreenshot[];
  [key: string]: unknown;
};
type VerificationRun = { status: string; items: VerificationItem[]; [key: string]: unknown };
type VerificationScreenshotView = VerificationScreenshot & { id: string; url?: string };

type GameResponse = { games: GameSummary[] };
type Overview = {
  ready: { status: string; currentRevision?: string; searchIndex?: string } | null;
  documents: DocumentSummary[];
  entities: EntitySummary[];
  sources: Array<{ id: string; name: string; type: string }>;
};
type AdminSource = {
  id: string;
  gameId: string;
  name: string;
  type: string;
  pathLabel: string;
};
type ImportDiff = {
  added: string[];
  modified: string[];
  deletionCandidates: string[];
  unchanged: string[];
  conflicts: string[];
  unparsed: string[];
};
type AdminBatch = {
  id: string;
  status: string;
  sourceId: string;
  successCount: number;
  failureCount: number;
  errors: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  diff?: ImportDiff | null;
  reviewNote?: string | null;
  createdAt?: string;
};
type AdminRevision = {
  id: string;
  gameId: string;
  revisionNumber: number;
  sourceBatchId?: string;
  releaseNote?: string | null;
  publishedAt?: string | Date;
  isCurrent: boolean;
  indexStatus: string;
};
type AdminJob = {
  id: string;
  type: string;
  status: string;
  attempts: number;
  error?: string | null;
  cancelRequested?: boolean;
};
type AcquisitionStatus = {
  generatedAt?: string;
  conversion?: {
    gameVersion?: string;
    locale?: string;
    accounting?: Record<string, { discovered?: number; converted?: number; excluded?: number }>;
  } | null;
  observations?: {
    total: number;
    snapshots: number;
    sourceCoverage?: Array<{
      name: string;
      category: string;
      complete: boolean;
      latest?: {
        observedCount: number;
        expectedCount: number | null;
        coverage: number | null;
        missingCount: number;
        unexpectedCount: number;
      } | null;
    }>;
    integrity?: { ok: boolean };
  };
  conflicts?: { total: number; open: number; resolved: number };
  releaseGate: {
    ready: boolean;
    manifestComplete: boolean;
    sourceCoverageComplete: boolean;
    observationIntegrity: boolean;
    allSamplesProcessed: boolean;
    exactMatchPerCategory: Record<string, number>;
    openConflicts: number;
    conflictSelectionComplete: boolean;
    backupAvailable: boolean;
    backupAfterCurrentBatches: boolean;
    manualVerificationReady: boolean;
    blockingReasons?: string[];
  };
  latestBackup?: {
    createdAt?: string;
    integrityValid?: boolean;
    afterCurrentBatches?: boolean;
  } | null;
};
type PublishReadiness = {
  ready: boolean;
  blockingReasons?: Array<string | { code: string; message: string; details?: unknown }>;
  verification?: { status?: string; itemCount?: number } | null;
  [key: string]: unknown;
};

type ReleaseGateState = "passed" | "blocked" | "checking" | "unavailable";
type ReleaseGateItem = {
  label: string;
  detail: string;
  state: ReleaseGateState;
  action?: { label: string; view: "review" | "verify" | "release" };
};

type PreviewRoute = {
  candidateId: string;
  buildId?: string;
};

type PreviewRecord = NormalizedRecord & {
  displayKind: "entity" | "document";
  displayTitle: string;
  properties?: Record<string, unknown>;
  aliases?: Array<{ value: string }>;
};

const previewCategories = [
  ["all", "全部"],
  ["characters", "角色"],
  ["weapons", "武器"],
  ["artifacts", "圣遗物"],
  ["materials", "材料"],
  ["enemies", "敌人"],
] as const;

const previewPropertyLabels: Record<string, string> = {
  rarity: "星级",
  element: "元素",
  weaponType: "武器类型",
  region: "地区",
  type: "类型",
};

function parsePreviewRoute(hash = window.location.hash): PreviewRoute | null {
  const match = /^#preview\/([^/?]+)(?:\/([^/?]+))?/.exec(hash);
  if (!match?.[1]) return null;
  return {
    candidateId: decodeURIComponent(match[1]),
    buildId: match[2] ? decodeURIComponent(match[2]) : undefined,
  };
}

function adminHash(view: "intake" | "preview" | "issues" | "history", params?: URLSearchParams) {
  const query = params?.toString();
  return `admin/${view}${query ? `?${query}` : ""}`;
}

const verificationStatusLabels: Record<VerificationStatus, string> = {
  not_checked: "未核验",
  exact_match: "逐字一致",
  formatting_only: "仅格式差异",
  mismatch: "内容不一致",
  unavailable_due_unlock: "尚未解锁",
  version_mismatch: "版本不一致",
};

const verificationCategoryLabels: Record<string, string> = {
  book: "书籍",
  character_story: "角色故事",
  item_description: "物品描述",
};

function reportMayBeStale(status: AcquisitionStatus, batches: AdminBatch[]): boolean {
  const generatedAt = status.generatedAt ? Date.parse(status.generatedAt) : Number.NaN;
  if (!Number.isFinite(generatedAt)) return false;
  return batches.some((batch) => {
    const createdAt = batch.createdAt ? Date.parse(batch.createdAt) : Number.NaN;
    return Number.isFinite(createdAt) && createdAt > generatedAt;
  });
}

async function api<T>(url: string, options: RequestInit = {}, adminToken?: string): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json");
  if (adminToken?.trim()) headers.set("authorization", `Bearer ${adminToken.trim()}`);
  const response = await fetch(url, { ...options, headers });
  const text = await response.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!response.ok) {
    const error = data as { error?: { message?: string; code?: string } };
    throw new Error(
      `${error.error?.code ? `${error.error.code}: ` : ""}${error.error?.message ?? "请求失败"}`,
    );
  }
  return data as T;
}

function revisionQuery(revisionId?: string): string {
  return revisionId ? `?revisionId=${encodeURIComponent(revisionId)}` : "";
}

type ArchiveCategory = {
  id: string;
  label: string;
  description: string;
  marker: string;
  types: Array<"entity" | "document" | "segment">;
  entityType?: string;
  documentType?: string;
};

const ARCHIVE_CATEGORIES: ArchiveCategory[] = [
  {
    id: "all",
    label: "全部资料",
    description: "浏览所有已发布内容",
    marker: "全",
    types: ["entity", "document", "segment"],
  },
  {
    id: "characters",
    label: "角色",
    description: "人物、别名与关系",
    marker: "角",
    types: ["entity"],
    entityType: "character",
  },
  {
    id: "regions",
    label: "地区与地点",
    description: "国家、区域与场景",
    marker: "域",
    types: ["entity"],
    entityType: "region",
  },
  {
    id: "factions",
    label: "阵营",
    description: "组织与势力关系",
    marker: "阵",
    types: ["entity"],
    entityType: "faction",
  },
  {
    id: "quests",
    label: "任务剧情",
    description: "任务文本与剧情片段",
    marker: "任",
    types: ["document", "segment"],
    documentType: "archon_quest",
  },
  {
    id: "books",
    label: "书籍与设定",
    description: "书籍、物品和世界设定",
    marker: "书",
    types: ["document", "segment"],
    documentType: "book",
  },
];

function entityTypeLabel(type: string): string {
  return (
    {
      character: "角色",
      faction: "阵营",
      region: "地区",
      location: "地点",
      quest: "任务",
      concept: "概念",
    }[type] ?? type
  );
}

function documentTypeLabel(type: string): string {
  return (
    {
      lore: "世界设定",
      archon_quest: "魔神任务",
      story_quest: "传说任务",
      world_quest: "世界任务",
      book: "书籍",
    }[type] ?? type
  );
}

export function App() {
  const [isAdminRoute, setIsAdminRoute] = useState(() =>
    window.location.hash.startsWith("#admin/"),
  );
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
  const [documentType, setDocumentType] = useState("");
  const [gameVersion, setGameVersion] = useState("");
  const [selectedRevision, setSelectedRevision] = useState<string | undefined>();
  const [sourceId, setSourceId] = useState("");
  const [overview, setOverview] = useState<Overview>({
    ready: null,
    documents: [],
    entities: [],
    sources: [],
  });

  useEffect(() => {
    api<GameResponse>("/api/games")
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
      const [ready, documents, entities, sources] = await Promise.allSettled([
        api<Overview["ready"]>("/api/ready"),
        api<{ documents: DocumentSummary[] }>(`/api/games/${gameId}/documents?limit=6&offset=0${selectedRevision ? `&revisionId=${encodeURIComponent(selectedRevision)}` : ""}`),
        api<{ entities: EntitySummary[] }>(`/api/games/${gameId}/entities?limit=6&offset=0${selectedRevision ? `&revisionId=${encodeURIComponent(selectedRevision)}` : ""}`),
        api<Pick<Overview, "sources">>(`/api/games/${gameId}/sources`),
      ]);
      if (cancelled) return;
      setOverview({
        ready: ready.status === "fulfilled" ? ready.value : null,
        documents: documents.status === "fulfilled" ? documents.value.documents : [],
        entities: entities.status === "fulfilled" ? entities.value.entities : [],
        sources: sources.status === "fulfilled" ? sources.value.sources : [],
      });
      if ([ready, documents, entities, sources].some((result) => result.status === "rejected")) {
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
      setPreviewRoute(parsePreviewRoute());
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const currentGame = useMemo(() => games.find((game) => game.id === gameId), [games, gameId]);

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
        entityTypes: entityType ? [entityType] : undefined,
        documentTypes: documentType ? [documentType] : undefined,
          gameVersions: gameVersion ? [gameVersion] : undefined,
          revisionId: selectedRevision,
        sourceId: sourceId || undefined,
        limit: 20,
      };
      setSearch(
        await api<SearchResult>(`/api/games/${gameId}/search`, {
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

  async function openEntity(id: string, revisionId?: string) {
    if (!gameId) return;
    setError("");
    setDetailLoading(true);
    try {
      const result = await api<{ entity: EntityDetail }>(
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

  async function openDocument(id: string, revisionId?: string, segmentId?: string) {
    if (!gameId) return;
    setError("");
    setDetailLoading(true);
    try {
      const result = await api<{ document: DocumentDetail }>(
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
    void openDocument(citation.documentId, undefined, citation.segmentId);
  }

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!gameId || !question.trim()) return;
    setError("");
    setAsking(true);
    try {
      setAnswer(
        await api<EvidenceAnswer>(`/api/games/${gameId}/qa`, {
          method: "POST",
          body: JSON.stringify({ question, maxEvidence: 8 }),
        }),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "问答失败");
    } finally {
      setAsking(false);
    }
  }

  function toggleType(type: "entity" | "document" | "segment") {
    setActiveCategory("custom");
    setTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  }

  function selectArchiveCategory(category: ArchiveCategory) {
    setActiveCategory(category.id);
    setTypes(category.types);
    setEntityType(category.entityType ?? "");
    setDocumentType(category.documentType ?? "");
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

  if (isAdminRoute) return <AdminRoutes initialRoute={window.location.hash.slice(1)} />;

  return (
    <div className="app-shell library-shell">
      <header className="topbar library-topbar">
        <div className="library-brand">
          <span className="brand-mark" aria-hidden="true">
            GI
          </span>
          <div>
            <span className="eyebrow">TEYVAT ARCHIVE</span>
            <h1>原神叙事知识库</h1>
          </div>
        </div>
        <div className="library-top-actions">
          <span className="library-data-state">
            <i aria-hidden="true" />
            {overview.ready?.searchIndex === "ready" ? "资料索引可用" : "正在检查资料索引"}
          </span>
          <div className="game-picker">
            <label htmlFor="game">正式版本</label>
            <select id="game" value={gameId} onChange={(event) => setGameId(event.target.value)}>
              {games.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.name} · {game.currentRevision ?? "未发布"}
                </option>
              ))}
            </select>
          </div>
          <VersionSwitcher
            onPreview={(candidateId, buildId) => {
              window.location.hash = `preview/${candidateId}${buildId ? `/${buildId}` : ""}`;
            }}
            onRevision={(revisionId) => setSelectedRevision(revisionId)}
            onCurrent={() => setSelectedRevision(undefined)}
          />
          <button
            className="preview-entry-button"
            onClick={() => (window.location.hash = "admin/preview")}
          >
            预发布版本
          </button>
        </div>
      </header>
      <main className="library-page">
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button onClick={clearError}>关闭</button>
          </div>
        )}
        <section className="library-search-card" aria-labelledby="library-search-title">
          <div className="search-heading">
            <span className="eyebrow">ARCHIVE SEARCH</span>
            <h2 id="library-search-title">查找提瓦特资料</h2>
            <p>搜索角色、地区、书籍或剧情原文，结果会标明来源与数据版本。</p>
          </div>
          <form className="search-form" onSubmit={runSearch}>
            <span className="search-symbol" aria-hidden="true">
              ⌕
            </span>
            <input
              aria-label="搜索知识库"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索角色、任务、地区或剧情关键词"
            />
            <button type="submit" disabled={searching || !gameId || !query.trim() || !types.length}>
              {searching ? "检索中…" : "检索"}
            </button>
          </form>
        </section>

        <div className="archive-layout">
          <aside className="archive-sidebar" aria-label="资料分类和筛选">
            <section className="sidebar-section">
              <div className="sidebar-heading">
                <span>资料分类</span>
                {activeCategory === "custom" && <small>自定义</small>}
              </div>
              <nav className="category-nav" aria-label="资料分类">
                {ARCHIVE_CATEGORIES.map((category) => (
                  <button
                    type="button"
                    key={category.id}
                    className={activeCategory === category.id ? "is-active" : ""}
                    onClick={() => selectArchiveCategory(category)}
                    aria-pressed={activeCategory === category.id}
                  >
                    <span className="category-marker" aria-hidden="true">
                      {category.marker}
                    </span>
                    <span>
                      <strong>{category.label}</strong>
                      <small>{category.description}</small>
                    </span>
                  </button>
                ))}
              </nav>
            </section>

            <section className="sidebar-section filter-section">
              <div className="sidebar-heading">
                <span>结果范围</span>
                <small>可多选</small>
              </div>
              <div className="scope-options">
                {(["entity", "document", "segment"] as const).map((type) => (
                  <label className="scope-option" key={type}>
                    <input
                      type="checkbox"
                      checked={types.includes(type)}
                      onChange={() => toggleType(type)}
                    />
                    <span>
                      {type === "entity" ? "实体" : type === "document" ? "文档" : "原文片段"}
                    </span>
                  </label>
                ))}
              </div>
              <label className="filter-field">
                <span>实体类型</span>
                <select
                  aria-label="实体类型"
                  value={entityType}
                  onChange={(event) => {
                    setActiveCategory("custom");
                    setEntityType(event.target.value);
                  }}
                >
                  <option value="">全部实体类型</option>
                  <option value="character">角色</option>
                  <option value="faction">阵营</option>
                  <option value="region">地区</option>
                  <option value="location">地点</option>
                  <option value="quest">任务</option>
                  <option value="concept">概念</option>
                </select>
              </label>
              <label className="filter-field">
                <span>文档类型</span>
                <select
                  aria-label="文档类型"
                  value={documentType}
                  onChange={(event) => {
                    setActiveCategory("custom");
                    setDocumentType(event.target.value);
                  }}
                >
                  <option value="">全部文档类型</option>
                  <option value="lore">设定</option>
                  <option value="archon_quest">魔神任务</option>
                  <option value="story_quest">传说任务</option>
                  <option value="world_quest">世界任务</option>
                  <option value="book">书籍</option>
                </select>
              </label>
              <label className="filter-field">
                <span>游戏版本</span>
                <input
                  aria-label="游戏版本过滤"
                  value={gameVersion}
                  onChange={(event) => setGameVersion(event.target.value)}
                  placeholder="例如 5.0"
                />
              </label>
              <label className="filter-field">
                <span>资料来源</span>
                <select
                  aria-label="来源过滤"
                  value={sourceId}
                  onChange={(event) => setSourceId(event.target.value)}
                >
                  <option value="">全部来源</option>
                  {overview.sources.map((source) => (
                    <option value={source.id} key={source.id}>
                      {source.name} · {source.type}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            <section className="sidebar-version" aria-label="资料版本">
              <span>当前资料版本</span>
              <strong>
                {overview.ready?.currentRevision ?? currentGame?.currentRevision ?? "未发布"}
              </strong>
              <small>{overview.ready?.searchIndex ?? "索引状态检查中"}</small>
            </section>
          </aside>

          <div className="archive-content">
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
                <span className="archive-revision">
                  {overview.ready?.currentRevision ?? currentGame?.currentRevision ?? "尚无版本"}
                </span>
              )}
            </div>

            {overviewError && !search && (
              <div className="inline-warning" role="status">
                <strong>部分内容未加载</strong>
                <span>{overviewError}</span>
              </div>
            )}

            <div className="archive-workspace">
              <section className="archive-feed" aria-busy={searching || overviewLoading}>
                {searching || (!search && overviewLoading) ? (
                  <LoadingCards />
                ) : search ? (
                  <SearchResultFeed
                    search={search}
                    onEntity={openEntity}
                    onDocument={openDocument}
                  />
                ) : (
                  <ArchiveHome
                    documents={overview.documents}
                    entities={overview.entities}
                    onEntity={openEntity}
                    onDocument={openDocument}
                    onCategory={selectArchiveCategory}
                  />
                )}
              </section>

              <section className="panel detail-panel archive-detail" aria-busy={detailLoading}>
                {detailLoading ? (
                  <div className="detail-loading" role="status">
                    <span className="loading-orb" aria-hidden="true" />
                    <strong>正在读取完整资料</strong>
                    <small>正在加载正文、出处和关联内容…</small>
                  </div>
                ) : entity ? (
                  <EntityView
                    entity={entity}
                    onEntity={openEntity}
                    onDocument={openDocument}
                    onCitation={openCitation}
                  />
                ) : document ? (
                  <DocumentView
                    document={document}
                    activeSegmentId={activeSegmentId}
                    onEntity={openEntity}
                    onCopy={copyCitationText}
                  />
                ) : (
                  <div className="empty-detail">
                    <span className="detail-mark">✦</span>
                    <h2>在这里阅读完整资料</h2>
                    <p>从左侧结果选择实体、文档或原文片段，即可查看正文、出处、版本和关联内容。</p>
                  </div>
                )}
              </section>
            </div>

            <section className="panel qa-panel archive-qa">
              <div className="panel-title">
                <div>
                  <span className="eyebrow">EVIDENCE QA</span>
                  <h2>基于资料提问</h2>
                </div>
                <span className="muted">答案附带可定位的原文引用</span>
              </div>
              <form className="qa-form" onSubmit={ask}>
                <textarea
                  aria-label="问答问题"
                  value={question}
                  onChange={(event) => setQuestion(event.target.value)}
                  placeholder="例如：某角色与某阵营有什么关系？"
                  rows={2}
                />
                <button type="submit" disabled={asking || !gameId || !question.trim()}>
                  {asking ? "查找证据中…" : "基于证据回答"}
                </button>
              </form>
              {answer && (
                <AnswerView answer={answer} onCitation={openCitation} onEntity={openEntity} />
              )}
            </section>

            <section className="admin-toggle library-admin-entry">
              <span>需要维护资料？管理功能位于独立工作台。</span>
              <button
                className="secondary-button"
                onClick={() => {
                  window.location.hash = "admin/intake";
                  setIsAdminRoute(true);
                }}
              >
                打开审核工作台
              </button>
            </section>
          </div>
        </div>
      </main>
      <footer>
        {currentGame?.name ?? "加载中"}资料库 · 当前版本{" "}
        {overview.ready?.currentRevision ?? currentGame?.currentRevision ?? "未发布"} ·
        内容均可追溯到来源
      </footer>
    </div>
  );
}

function LoadingCards() {
  return (
    <div className="loading-card-grid" role="status" aria-label="资料加载中">
      {[0, 1, 2, 3].map((item) => (
        <div className="loading-card" key={item}>
          <span />
          <i />
          <i />
        </div>
      ))}
    </div>
  );
}

function ArchiveHome({
  documents,
  entities,
  onEntity,
  onDocument,
  onCategory,
}: {
  documents: DocumentSummary[];
  entities: EntitySummary[];
  onEntity: (id: string) => void;
  onDocument: (id: string) => void;
  onCategory: (category: ArchiveCategory) => void;
}) {
  return (
    <div className="archive-home">
      <section className="archive-home-section">
        <div className="section-title-row">
          <div>
            <span className="eyebrow">EXPLORE</span>
            <h3>按主题浏览</h3>
          </div>
          <small>选择分类后，可继续输入关键词精确检索</small>
        </div>
        <div className="topic-card-grid">
          {ARCHIVE_CATEGORIES.slice(1).map((category) => (
            <button
              type="button"
              className="topic-card"
              key={category.id}
              onClick={() => onCategory(category)}
            >
              <span className="topic-marker" aria-hidden="true">
                {category.marker}
              </span>
              <span>
                <strong>{category.label}</strong>
                <small>{category.description}</small>
              </span>
              <b aria-hidden="true">›</b>
            </button>
          ))}
        </div>
      </section>

      <section className="archive-home-section">
        <div className="section-title-row">
          <div>
            <span className="eyebrow">LATEST DOCUMENTS</span>
            <h3>最近收录</h3>
          </div>
          <small>{documents.length} 篇可浏览文档</small>
        </div>
        {documents.length ? (
          <div className="archive-card-grid">
            {documents.map((item) => (
              <DocumentResultCard key={item.id} item={item} onOpen={() => onDocument(item.id)} />
            ))}
          </div>
        ) : (
          <ArchiveEmpty title="暂无已发布文档" detail="资料发布后会在这里显示最近收录内容。" />
        )}
      </section>

      <section className="archive-home-section">
        <div className="section-title-row">
          <div>
            <span className="eyebrow">FEATURED ENTRIES</span>
            <h3>常用条目</h3>
          </div>
          <small>{entities.length} 个可浏览实体</small>
        </div>
        {entities.length ? (
          <div className="archive-card-grid">
            {entities.map((item) => (
              <EntityResultCard key={item.id} item={item} onOpen={() => onEntity(item.id)} />
            ))}
          </div>
        ) : (
          <ArchiveEmpty title="暂无常用条目" detail="可以使用上方搜索框直接查询资料库。" />
        )}
      </section>
    </div>
  );
}

function SearchResultFeed({
  search,
  onEntity,
  onDocument,
}: {
  search: SearchResult;
  onEntity: (id: string, revisionId?: string) => void;
  onDocument: (id: string, revisionId?: string, segmentId?: string) => void;
}) {
  const total = search.entities.length + search.documents.length + search.segments.length;
  if (!total) {
    return (
      <ArchiveEmpty
        title="没有找到匹配资料"
        detail="可以尝试缩短关键词、切换资料分类，或清除版本与来源筛选。"
      />
    );
  }
  return (
    <div className="search-result-feed">
      <div className="search-revision-line">
        <span>检索基于 {search.revision || "当前版本"}</span>
        <small>索引状态：{search.indexStatus}</small>
      </div>
      {search.entities.length > 0 && (
        <section className="search-result-group">
          <div className="section-title-row compact">
            <h3>实体</h3>
            <span>{search.entities.length}</span>
          </div>
          <div className="archive-card-grid">
            {search.entities.map((item) => (
              <EntityResultCard
                key={item.id}
                item={item}
                onOpen={() => onEntity(item.id, search.revisionId)}
              />
            ))}
          </div>
        </section>
      )}
      {search.documents.length > 0 && (
        <section className="search-result-group">
          <div className="section-title-row compact">
            <h3>文档</h3>
            <span>{search.documents.length}</span>
          </div>
          <div className="archive-card-grid">
            {search.documents.map((item) => (
              <DocumentResultCard
                key={item.id}
                item={item}
                onOpen={() => onDocument(item.id, search.revisionId)}
              />
            ))}
          </div>
        </section>
      )}
      {search.segments.length > 0 && (
        <section className="search-result-group">
          <div className="section-title-row compact">
            <h3>原文片段</h3>
            <span>{search.segments.length}</span>
          </div>
          <div className="segment-result-list">
            {search.segments.map((item) => (
              <button
                type="button"
                className="segment-result-card"
                key={item.segmentId}
                onClick={() => onDocument(item.id, search.revisionId, item.segmentId)}
              >
                <span className="result-type-row">
                  <b>原文片段</b>
                  <small>{documentTypeLabel(item.type)}</small>
                </span>
                <strong>{item.title}</strong>
                <p>{item.snippet || "点击查看完整原文与上下文。"}</p>
                <span className="result-metadata">
                  <small>{item.match ?? "正文命中"}</small>
                  <small>{item.gameVersion ?? item.revision ?? search.revision}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function EntityResultCard({ item, onOpen }: { item: EntitySummary; onOpen: () => void }) {
  return (
    <button type="button" className="archive-result-card entity-result-card" onClick={onOpen}>
      <span className="result-card-emblem" aria-hidden="true">
        {item.name.slice(0, 1)}
      </span>
      <span className="result-card-body">
        <span className="result-type-row">
          <b>{entityTypeLabel(item.type)}</b>
          {item.match && <small>{item.match}</small>}
        </span>
        <strong>{item.name}</strong>
        <p>{item.summary || item.aliases.join(" · ") || "点击查看属性、关系和相关文档。"}</p>
        <span className="result-metadata">
          <small>{item.aliases.slice(0, 2).join(" · ") || "无其他别名"}</small>
          <small>{item.revision ?? "当前版本"}</small>
        </span>
      </span>
    </button>
  );
}

function DocumentResultCard({ item, onOpen }: { item: DocumentSummary; onOpen: () => void }) {
  return (
    <button type="button" className="archive-result-card document-result-card" onClick={onOpen}>
      <span className="result-card-emblem" aria-hidden="true">
        文
      </span>
      <span className="result-card-body">
        <span className="result-type-row">
          <b>{documentTypeLabel(item.type)}</b>
          {item.match && <small>{item.match}</small>}
        </span>
        <strong>{item.title}</strong>
        <p>{item.snippet || "点击阅读完整内容、章节目录和资料出处。"}</p>
        <span className="result-metadata">
          <small>{item.gameVersion ?? "游戏版本未知"}</small>
          <small>{item.revision ?? "当前版本"}</small>
        </span>
      </span>
    </button>
  );
}

function ArchiveEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="archive-empty">
      <span aria-hidden="true">◇</span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

function EntityView({
  entity,
  onEntity,
  onDocument,
  onCitation,
}: {
  entity: EntityDetail;
  onEntity: (id: string, revisionId?: string) => void;
  onDocument: (id: string, revisionId?: string, segmentId?: string) => void;
  onCitation: (citation: Citation) => void;
}) {
  return (
    <article>
      <div className="detail-header">
        <span className="type-pill">{entityTypeLabel(entity.type)}</span>
        <h2>{entity.name}</h2>
        <p>{entity.summary || "暂无摘要"}</p>
        <div className="chips">
          {entity.aliases.map((alias) => (
            <span key={alias}>{alias}</span>
          ))}
        </div>
        <small className="detail-meta">
          source key: {entity.sourceKey ?? "—"} · {entity.revision ?? "当前版本"}
        </small>
      </div>
      <details className="properties-details">
        <summary>查看结构化属性 JSON</summary>
        <pre className="properties-box">{JSON.stringify(entity.properties, null, 2)}</pre>
      </details>
      <h3>关系</h3>
      {entity.relationships.length ? (
        <ul className="relationship-list">
          {entity.relationships.map((relation) => (
            <li key={relation.id}>
              <button className="inline-link" onClick={() => onEntity(relation.subjectId)}>
                {relation.subjectName}
              </button>
              <b>{relation.predicate}</b>
              <button className="inline-link" onClick={() => onEntity(relation.objectId)}>
                {relation.objectName}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">暂无已发布关系</p>
      )}
      <h3>相关文档</h3>
      {entity.documents.length ? (
        entity.documents.map((doc) => (
          <button className="link-row" key={doc.id} onClick={() => onDocument(doc.id)}>
            {doc.title}
            <span>
              {documentTypeLabel(doc.type)} · {doc.gameVersion ?? "版本未知"}
            </span>
          </button>
        ))
      ) : (
        <p className="muted">暂无相关文档</p>
      )}
      {entity.claims.length > 0 && (
        <>
          <h3>证据主张</h3>
          {entity.claims.map((claim) => (
            <div className={`claim-card claim-${claim.status}`} key={claim.id}>
              <strong>{claim.status}</strong>
              <p>{claim.statement}</p>
              <small>
                {claim.evidence.length} 条证据 · 置信度 {claim.confidence ?? "未知"}
              </small>
              {claim.evidence.map((item) => (
                <button
                  className="citation-card"
                  key={item.id}
                  onClick={() =>
                    onCitation({
                      documentId: item.documentId,
                      documentTitle: item.documentTitle,
                      segmentId: item.segmentId,
                      quote: item.quote,
                      sourceName: "—",
                      gameVersion: null,
                      datasetRevision: entity.revision ?? "",
                    })
                  }
                >
                  <span>引用 · {item.documentTitle}</span>
                  <small>{item.quote}</small>
                </button>
              ))}
            </div>
          ))}
        </>
      )}
    </article>
  );
}

function DocumentView({
  document,
  activeSegmentId,
  onEntity,
  onCopy,
}: {
  document: DocumentDetail;
  activeSegmentId?: string;
  onEntity: (id: string) => void;
  onCopy: (document: DocumentDetail, segmentId: string, body: string) => void;
}) {
  useEffect(() => {
    if (!activeSegmentId) return;
    globalThis.document
      .getElementById(activeSegmentId)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeSegmentId, document]);
  return (
    <article>
      <div className="detail-header">
        <span className="type-pill">{documentTypeLabel(document.type)}</span>
        <h2>{document.title}</h2>
        <p>
          {document.sourceName} · {document.gameVersion ?? "游戏版本未知"} · Dataset Revision{" "}
          {document.revision}
        </p>
        <small className="detail-meta">
          source key: {document.sourceKey ?? "—"} · source version: {document.sourceVersion ?? "—"}{" "}
          · document id: {document.id}
        </small>
      </div>
      {document.provenance && (
        <details className="provenance-panel">
          <summary>查看完整出处</summary>
          <dl>
            <dt>Dataset Revision</dt>
            <dd>{document.provenance.datasetRevision ?? document.revision ?? "—"}</dd>
            <dt>Source Snapshot</dt>
            <dd>{document.provenance.sourceSnapshotId ?? "—"}</dd>
            <dt>Canonical Key</dt>
            <dd>{document.provenance.canonicalKey ?? document.sourceKey ?? "—"}</dd>
            <dt>上游仓库</dt>
            <dd>{document.provenance.upstreamSource ?? "—"}</dd>
            <dt>Commit / 版本</dt>
            <dd>
              {document.provenance.upstreamCommit ?? "—"} ·{" "}
              {document.provenance.upstreamVersionLabel ?? "—"}
            </dd>
            <dt>语言</dt>
            <dd>{document.provenance.locale ?? "—"}</dd>
            <dt>相对文件</dt>
            <dd>
              {document.provenance.sourceFiles?.join(" · ") ||
                document.provenance.readableFile ||
                "—"}
            </dd>
            <dt>上游 ID</dt>
            <dd>{JSON.stringify(document.provenance.upstreamIds ?? {})}</dd>
            <dt>字段映射</dt>
            <dd>{JSON.stringify(document.provenance.lineage ?? {})}</dd>
            <dt>TextMap Hash</dt>
            <dd>{JSON.stringify(document.provenance.textMapHashes ?? {})}</dd>
            <dt>正文哈希</dt>
            <dd>
              normalized: {document.provenance.normalizedContentHash ?? "—"}
              <br />
              raw: {document.provenance.rawContentHash ?? "—"}
            </dd>
            <dt>转换步骤</dt>
            <dd>{document.provenance.transforms?.join(" → ") || "—"}</dd>
          </dl>
        </details>
      )}
      <div className="document-body">
        <nav className="document-toc" aria-label="文档目录">
          {document.segments.map((segment) => (
            <a key={segment.id} href={`#${segment.id}`}>
              片段 {segment.ordinal + 1}
              {segment.headingPath.length ? ` · ${segment.headingPath.join(" / ")}` : ""}
            </a>
          ))}
        </nav>
        {document.segments.map((segment) => (
          <section
            className={`document-segment ${activeSegmentId === segment.id ? "is-active" : ""}`}
            id={segment.id}
            key={segment.id}
          >
            <div className="segment-toolbar">
              <span className="segment-label">
                片段 {segment.ordinal + 1} · {segment.id.slice(0, 8)}
              </span>
              <button
                className="copy-button"
                onClick={() => onCopy(document, segment.id, segment.body)}
              >
                复制引用
              </button>
            </div>
            {segment.headingPath.length > 0 && <h3>{segment.headingPath.join(" / ")}</h3>}
            <p>{segment.body}</p>
            {segment.mentions.length > 0 && (
              <div className="mention-row" aria-label="片段中的实体">
                {segment.mentions.map((mention) => (
                  <button
                    className="mention"
                    key={`${mention.entityId}-${mention.startOffset}`}
                    onClick={() => onEntity(mention.entityId)}
                  >
                    {mention.name}
                  </button>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </article>
  );
}

function AnswerView({
  answer,
  onCitation,
  onEntity,
}: {
  answer: EvidenceAnswer;
  onCitation: (citation: Citation) => void;
  onEntity: (id: string) => void;
}) {
  return (
    <div className="answer-view">
      <div className="answer-summary">
        <span className={`confidence confidence-${answer.confidence}`}>{answer.confidence}</span>
        <span>Dataset Revision {answer.datasetRevision}</span>
      </div>
      <p className="answer-text">{answer.answer}</p>
      {answer.warnings.length > 0 && (
        <div className="warning-list">
          {answer.warnings.map((warning) => (
            <span key={warning}>⚠ {warning}</span>
          ))}
        </div>
      )}
      <h3>引用（点击跳转原文）</h3>
      <div className="citation-grid">
        {answer.citations.map((citation, index) => (
          <button
            className="citation-card"
            key={`${citation.segmentId}-${index}`}
            onClick={() => onCitation(citation)}
          >
            <span>
              [S{index + 1}] {citation.documentTitle}
            </span>
            <small>
              {citation.quote} · {citation.sourceName} · {citation.gameVersion ?? "版本未知"} ·
              source version {citation.sourceVersion ?? "—"}
            </small>
          </button>
        ))}
      </div>
      {answer.relatedEntities.length > 0 && (
        <>
          <h3>相关实体</h3>
          <div className="chips entity-chips">
            {answer.relatedEntities.map((item) => (
              <button key={item.id} className="entity-chip" onClick={() => onEntity(item.id)}>
                {item.name} · {item.type}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function previewRecordsFromPayload(
  payload: unknown,
  fallbackKind: "entity" | "document" = "entity",
): PreviewRecord[] {
  if (!payload || typeof payload !== "object") return [];
  const object = payload as Record<string, unknown>;
  const rows =
    (Array.isArray(object.records) && object.records) ||
    (Array.isArray(object.normalizedRecords) && object.normalizedRecords) ||
    (Array.isArray(object[fallbackKind === "entity" ? "entities" : "documents"]) &&
      (object[fallbackKind === "entity" ? "entities" : "documents"] as unknown[])) ||
    [];

  return rows.flatMap((row, index) => {
    if (!row || typeof row !== "object") return [];
    const value = row as Record<string, unknown>;
    const kind = value.displayKind === "document" ? "document" : fallbackKind;
    const sourceKey = String(value.sourceKey ?? value.id ?? `${kind}-${index}`);
    const displayTitle = String(value.title ?? value.name ?? sourceKey);
    const metadata =
      value.metadata && typeof value.metadata === "object"
        ? (value.metadata as Record<string, unknown>)
        : {};
    return [
      {
        sourceKey,
        recordType: String(value.recordType ?? value.type ?? kind),
        title: displayTitle,
        body: String(value.body ?? value.snippet ?? value.summary ?? ""),
        entityType:
          kind === "entity" && typeof value.type === "string"
            ? (value.type as NormalizedRecord["entityType"])
            : undefined,
        documentType:
          kind === "document" && typeof value.type === "string"
            ? (value.type as NormalizedRecord["documentType"])
            : undefined,
        gameVersion: typeof value.gameVersion === "string" ? value.gameVersion : undefined,
        metadata,
        properties:
          value.properties && typeof value.properties === "object"
            ? (value.properties as Record<string, unknown>)
            : {},
        aliases: Array.isArray(value.aliases)
          ? value.aliases.flatMap((alias) =>
              alias &&
              typeof alias === "object" &&
              typeof (alias as { value?: unknown }).value === "string"
                ? [{ value: String((alias as { value: string }).value) }]
                : [],
            )
          : [],
        contentHash: String(value.contentHash ?? ""),
        parserVersion: String(value.parserVersion ?? "preview"),
        displayKind: kind,
        displayTitle,
      },
    ];
  });
}

async function loadPreviewRecords(
  buildId: string,
  adminToken: string,
  offset: number,
  limit: number,
  query = "",
  category = "all",
): Promise<{ records: PreviewRecord[]; total: number }> {
  const suffix = query.trim() ? `&q=${encodeURIComponent(query.trim())}` : "";
  const payload = await api<unknown>(
    `/api/admin/previews/${buildId}/records?kind=all&category=${encodeURIComponent(category)}&limit=${limit}&offset=${offset}${suffix}`,
    {},
    adminToken,
  );
  return {
    records: previewRecordsFromPayload(payload),
    total: Number((payload as { total?: number })?.total ?? 0),
  };
}

function PreviewBrowser({
  gameId,
  candidateId,
  initialBuildId,
}: {
  gameId: string;
  candidateId: string;
  initialBuildId?: string;
}) {
  const [adminToken, setAdminToken] = useState(
    () => window.sessionStorage.getItem("gip-admin-token") ?? "",
  );
  const [candidates, setCandidates] = useState<ReleaseCandidate[]>([]);
  const [candidate, setCandidate] = useState<ReleaseCandidateDetail | null>(null);
  const [buildId, setBuildId] = useState(initialBuildId ?? "");
  const [records, setRecords] = useState<PreviewRecord[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "entity" | "document">("all");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    window.sessionStorage.setItem("gip-admin-token", adminToken);
  }, [adminToken]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      api<{ candidates: ReleaseCandidate[] }>(
        `/api/admin/release-candidates?gameId=${encodeURIComponent(gameId)}`,
        {},
        adminToken,
      ),
      api<ReleaseCandidateDetail | { candidate: ReleaseCandidateDetail }>(
        `/api/admin/release-candidates/${candidateId}`,
        {},
        adminToken,
      ),
    ])
      .then(([candidateResponse, detailResponse]) => {
        if (cancelled) return;
        const detail = "candidate" in detailResponse ? detailResponse.candidate : detailResponse;
        setCandidates(candidateResponse.candidates);
        setCandidate(detail);
        const nextBuildId =
          initialBuildId ??
          detail.currentBuildId ??
          [...(detail.builds ?? [])].sort((left, right) => right.buildNumber - left.buildNumber)[0]
            ?.id ??
          "";
        setBuildId(nextBuildId);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "预发布候选加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [adminToken, candidateId, gameId, initialBuildId]);

  useEffect(() => {
    if (!buildId) {
      setRecords([]);
      setSelectedKey("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    loadPreviewRecords(buildId, adminToken, page * pageSize, pageSize, query, category)
      .then(({ records: nextRecords, total: nextTotal }) => {
        if (cancelled) return;
        setRecords(nextRecords);
        setTotal(nextTotal);
        setSelectedKey((current) =>
          nextRecords.some((record) => record.sourceKey === current)
            ? current
            : (nextRecords[0]?.sourceKey ?? ""),
        );
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setRecords([]);
          setError(
            reason instanceof Error
              ? reason.message
              : "这个 Build 暂时无法预览，请返回发布页重新构建。",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [adminToken, buildId, category, page, query]);

  useEffect(() => setPage(0), [buildId, query, kind, category]);

  const selectedBuild = candidate?.builds.find((build) => build.id === buildId);
  const visibleRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return records.filter(
      (record) =>
        (kind === "all" || record.displayKind === kind) &&
        (!normalizedQuery ||
          `${record.displayTitle} ${record.sourceKey} ${record.body ?? ""}`
            .toLocaleLowerCase()
            .includes(normalizedQuery)),
    );
  }, [kind, query, records]);
  const selectedRecord =
    visibleRecords.find((record) => record.sourceKey === selectedKey) ?? visibleRecords[0];

  function openCandidate(nextCandidateId: string) {
    if (!nextCandidateId) return;
    window.location.hash = `preview/${encodeURIComponent(nextCandidateId)}`;
  }

  function openBuild(nextBuildId: string) {
    setBuildId(nextBuildId);
    setSelectedKey("");
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#preview/${encodeURIComponent(candidateId)}/${encodeURIComponent(nextBuildId)}`,
    );
  }

  async function reportRecord(record: PreviewRecord) {
    const params = new URLSearchParams({
      candidateId,
      buildId,
      canonicalKey: record.sourceKey,
      title: record.displayTitle,
    });
    const batchId = candidate?.importBatchIds?.[0];
    if (batchId) params.set("batchId", batchId);
    try {
      await api(
        `/api/admin/release-candidates/${candidateId}/issues`,
        {
          method: "POST",
          body: JSON.stringify({
            buildId,
            canonicalKey: record.sourceKey,
            summary: `预发布资料可能有误：${record.displayTitle}`,
            details: {
              title: record.displayTitle,
              displayKind: record.displayKind,
              batchId,
            },
          }),
        },
        adminToken,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "问题创建失败");
      return;
    }
    window.location.hash = adminHash("issues", params);
  }

  return (
    <div className="app-shell preview-shell">
      <header className="preview-topbar">
        <div className="preview-brand">
          <span className="preview-badge">PREVIEW</span>
          <div>
            <span className="eyebrow">RELEASE CANDIDATE</span>
            <h1>{candidate?.name ?? "预发布查看"}</h1>
          </div>
        </div>
        <div className="preview-top-actions">
          <button
            className="secondary-button"
            onClick={() => (window.location.hash = "admin/preview")}
          >
            返回预发布分支
          </button>
          <button className="secondary-button" onClick={() => (window.location.hash = "")}>
            查看正式资料库
          </button>
        </div>
      </header>

      <div className="preview-warning" role="status">
        <strong>这是预发布数据，当前正式 MCP 不会读取此 Build</strong>
        <span>只有在发布管理页明确晋级后，数据才会成为正式 Revision。</span>
      </div>

      <section className="preview-version-bar" aria-label="预发布版本切换">
        <label>
          候选版本
          <select value={candidateId} onChange={(event) => openCandidate(event.target.value)}>
            {candidates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.status}
              </option>
            ))}
          </select>
        </label>
        <label>
          预发布 Build
          <select value={buildId} onChange={(event) => openBuild(event.target.value)}>
            <option value="">请选择 Build</option>
            {candidate?.builds
              ?.slice()
              .sort((left, right) => right.buildNumber - left.buildNumber)
              .map((build) => (
                <option key={build.id} value={build.id}>
                  Build {build.buildNumber} · {build.status} · {build.recordCount} 条
                </option>
              ))}
          </select>
        </label>
        <div className="preview-build-facts">
          <span>状态：{selectedBuild?.status ?? "未选择"}</span>
          <span>校验：{selectedBuild?.contentChecksum?.slice(0, 12) ?? "—"}</span>
          <span>记录：{selectedBuild?.recordCount ?? 0}</span>
        </div>
        <label className="preview-token-field">
          管理 Token
          <input
            type="password"
            value={adminToken}
            onChange={(event) => setAdminToken(event.target.value)}
            placeholder="开发环境可留空"
          />
        </label>
      </section>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")}>关闭</button>
        </div>
      )}

      <main className="preview-workspace">
        <aside className="preview-record-list">
          <div className="preview-search-tools">
            <input
              aria-label="搜索预发布资料"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索标题、正文或 Canonical Key"
            />
            <div className="preview-kind-filter" aria-label="预发布资料类型">
              {(["all", "entity", "document"] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  className={kind === value ? "is-active" : ""}
                  onClick={() => setKind(value)}
                >
                  {value === "all" ? "全部" : value === "entity" ? "实体" : "文档"}
                </button>
              ))}
            </div>
            <div className="preview-category-filter" aria-label="预发布资料分类">
              {previewCategories.map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={category === value ? "is-active" : ""}
                  onClick={() => setCategory(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="preview-list-heading">
            <b>当前 Build 资料</b>
            <span>{visibleRecords.length} 条</span>
          </div>
          <div className="preview-record-scroll" aria-busy={loading}>
            {loading ? (
              <div className="preview-empty">正在读取隔离的预发布数据…</div>
            ) : (
              visibleRecords.map((record) => (
                <button
                  type="button"
                  key={`${record.displayKind}-${record.sourceKey}`}
                  className={selectedRecord?.sourceKey === record.sourceKey ? "is-active" : ""}
                  onClick={() => setSelectedKey(record.sourceKey)}
                >
                  <span>{record.displayKind === "entity" ? "实体" : "文档"}</span>
                  <strong>{record.displayTitle}</strong>
                  <small>{record.sourceKey}</small>
                </button>
              ))
            )}
            {!loading && !visibleRecords.length && (
              <div className="preview-empty">
                <b>没有符合条件的资料</b>
                <span>可以更换 Build、类型或搜索条件。</span>
              </div>
            )}
          </div>
          <nav className="preview-pagination" aria-label="预发布资料分页">
            <button
              type="button"
              className="secondary-button"
              disabled={page === 0 || loading}
              onClick={() => setPage((value) => Math.max(0, value - 1))}
            >
              上一页
            </button>
            <span>
              {total
                ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, total)} / ${total}`
                : "0 / 0"}
            </span>
            <button
              type="button"
              className="secondary-button"
              disabled={loading || (page + 1) * pageSize >= total}
              onClick={() => setPage((value) => value + 1)}
            >
              下一页
            </button>
          </nav>
        </aside>

        <section className="preview-record-detail">
          {selectedRecord ? (
            <>
              <header>
                <div>
                  <span className="eyebrow">{selectedRecord.displayKind.toUpperCase()}</span>
                  <h2>{selectedRecord.displayTitle}</h2>
                  <small>{selectedRecord.sourceKey}</small>
                </div>
                <button
                  className="report-issue-button"
                  onClick={() => reportRecord(selectedRecord)}
                >
                  报告问题
                </button>
              </header>
              <div className="preview-record-meta">
                <span>游戏版本：{selectedRecord.gameVersion ?? "未标注"}</span>
                <span>解析器：{selectedRecord.parserVersion}</span>
                <span>内容哈希：{selectedRecord.contentHash.slice(0, 16) || "未提供"}</span>
              </div>
              <article className="preview-record-body">
                {selectedRecord.body ? (
                  selectedRecord.body
                    .split(/\n{2,}/)
                    .map((paragraph, index) => <p key={index}>{paragraph}</p>)
                ) : (
                  <p className="muted">这条资料没有可显示的正文。</p>
                )}
              </article>
              {selectedRecord.properties && Object.keys(selectedRecord.properties).length > 0 && (
                <section className="preview-properties" aria-label="条目属性">
                  <h3>基础属性</h3>
                  <dl>
                    {Object.entries(selectedRecord.properties).map(([key, value]) => (
                      <div key={key}>
                        <dt>{previewPropertyLabels[key] ?? key}</dt>
                        <dd>{Array.isArray(value) ? value.join("、") : String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
              <section className="preview-source-card" aria-label="数据来源">
                <h3>数据来源</h3>
                <span>{String(selectedRecord.metadata.upstreamSource ?? "未标注")}</span>
                <span>
                  上游提交：
                  {String(selectedRecord.metadata.upstreamCommit ?? "未标注").slice(0, 12)}
                </span>
                <span>语言：{String(selectedRecord.metadata.locale ?? "未标注")}</span>
                <span>许可：{String(selectedRecord.metadata.codeLicense ?? "未标注")}</span>
              </section>
              <footer className="preview-evidence-note">
                <strong>发现内容错误？</strong>
                <span>点击“报告问题”会定位对应审核项；提交修正时必须上传游戏内截图。</span>
              </footer>
            </>
          ) : (
            <div className="preview-empty preview-detail-empty">
              <b>请选择一条资料</b>
              <span>这里会显示当前预发布 Build 的内容，不会读取正式 MCP 数据。</span>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

async function copyCitationText(document: DocumentDetail, segmentId: string, body: string) {
  const text = `[Dataset Revision ${document.revision}] ${document.title} (${document.sourceName}) · source version ${document.sourceVersion ?? "—"} · segment ${segmentId}\n${body}`;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard permissions are optional in local deployments.
  }
}

function releaseAuditGate(
  label: string,
  status: AcquisitionStatus | null,
  passed: boolean | undefined,
  detail: string,
): ReleaseGateItem {
  return {
    label,
    detail: status ? detail : "采集状态报告不可用",
    state: !status ? "unavailable" : passed ? "passed" : "blocked",
  };
}

function releaseGateIcon(state: ReleaseGateState): string {
  return { passed: "✓", blocked: "!", checking: "…", unavailable: "—" }[state];
}

function releaseGateLabel(state: ReleaseGateState): string {
  return { passed: "通过", blocked: "阻塞", checking: "检查中", unavailable: "无法检查" }[state];
}

function releaseBlockerMessage(code: string): string {
  const messages: Record<string, string> = {
    import_has_errors: "导入批次仍包含错误",
    deletions_unconfirmed: "删除候选尚未全部确认",
    verification_blocked: "游戏内人工核验尚未通过",
    staged_data_missing: "暂存数据不存在",
    source_snapshot_missing: "来源快照不存在",
    acquisition_review_missing: "采集审核尚未完成",
    release_backup_missing: "缺少覆盖当前批次的发布前备份",
  };
  if (code.startsWith("invalid_status:")) return `批次状态不允许发布：${code.split(":")[1]}`;
  return messages[code] ?? code.replaceAll("_", " ");
}

function releaseBlockerAction(code: string): "review" | "verify" | "release" | undefined {
  if (code.includes("verification")) return "verify";
  if (
    code.includes("import") ||
    code.includes("deletion") ||
    code.includes("status") ||
    code.includes("review")
  )
    return "review";
  if (code.includes("conflict") || code.includes("backup")) return "release";
  return undefined;
}

function formatReleaseDetails(details: unknown): string {
  if (typeof details === "string") return details;
  try {
    return JSON.stringify(details);
  } catch {
    return "存在需要处理的附加信息";
  }
}

function formatReleaseDate(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function releaseIndexStatusLabel(status: string): string {
  return (
    { ready: "索引就绪", pending: "等待索引", rebuilding: "正在重建", failed: "索引失败" }[
      status
    ] ?? status
  );
}

function releaseJobTypeLabel(type: string): string {
  return { rebuild_search: "重建搜索索引", generate_embeddings: "生成 Embeddings" }[type] ?? type;
}

function releaseJobStatusLabel(status: string): string {
  return (
    { completed: "已完成", running: "执行中", failed: "失败", pending: "等待中" }[status] ?? status
  );
}

function releaseJobIcon(status: string): string {
  return { completed: "✓", running: "↻", failed: "!", pending: "·" }[status] ?? "·";
}

function AcquisitionStatusPanel({ status, stale }: { status: AcquisitionStatus; stale: boolean }) {
  const gate = status.releaseGate;
  const labels: Record<string, string> = {
    book: "书籍",
    character_story: "角色故事",
    item_description: "物品描述",
  };
  const blockers = gate.blockingReasons ?? [];
  const accounting = status.conversion?.accounting ?? {};
  return (
    <section className="admin-section acquisition-status-panel">
      <div className="section-heading">
        <div>
          <h3>采集完整性审计</h3>
          <span className="muted small">
            报告时间：{status.generatedAt ?? "未知"} · 版本{" "}
            {status.conversion?.gameVersion ?? "未知"} · {status.conversion?.locale ?? "未知"}
          </span>
          {stale && (
            <span className="acquisition-stale">
              报告可能早于最新批次，请先运行 pnpm data:status:anime:write
            </span>
          )}
        </div>
        <b className={gate.ready ? "acquisition-ready" : "acquisition-blocked"}>
          {gate.ready ? "可发布" : "未达到发布门禁"}
        </b>
      </div>
      <div className="acquisition-check-grid" aria-label="采集发布门禁">
        <AcquisitionCheck label="Manifest" ok={gate.manifestComplete} />
        <AcquisitionCheck label="渠道覆盖" ok={gate.sourceCoverageComplete} />
        <AcquisitionCheck label="观察层完整性" ok={gate.observationIntegrity} />
        <AcquisitionCheck
          label="冲突裁决"
          ok={gate.conflictSelectionComplete && gate.openConflicts === 0}
        />
        <AcquisitionCheck label="备份" ok={gate.backupAfterCurrentBatches} />
        <AcquisitionCheck label="人工核验" ok={gate.manualVerificationReady} />
      </div>
      <div className="acquisition-audit-summary">
        <span>
          观察层：{status.observations?.total ?? "—"} 条 / {status.observations?.snapshots ?? "—"}{" "}
          个快照
        </span>
        <span>
          冲突：{status.conflicts?.total ?? "—"} 条 · 未解决 {status.conflicts?.open ?? "—"}
        </span>
        <span>
          备份：{status.latestBackup?.integrityValid ? "校验通过" : "不可用"}
          {status.latestBackup?.afterCurrentBatches ? " · 已覆盖当前批次" : " · 需更新"}
        </span>
      </div>
      {Object.keys(accounting).length > 0 && (
        <div className="acquisition-accounting">
          {Object.entries(accounting).map(([category, counts]) => (
            <span key={category}>
              {labels[category] ?? category}：发现 {counts.discovered ?? "—"} · 成功{" "}
              {counts.converted ?? "—"} · 排除 {counts.excluded ?? "—"}
            </span>
          ))}
        </div>
      )}
      {status.observations?.sourceCoverage && status.observations.sourceCoverage.length > 0 && (
        <div className="acquisition-coverage-list">
          {status.observations.sourceCoverage.map((entry) => {
            const latest = entry.latest;
            return (
              <div className="acquisition-coverage-row" key={`${entry.category}-${entry.name}`}>
                <span>
                  {labels[entry.category] ?? entry.category} · {entry.name}
                </span>
                <small>
                  {latest
                    ? `${latest.observedCount}/${latest.expectedCount ?? "?"} 条 · 缺 ${latest.missingCount} · 多 ${latest.unexpectedCount}`
                    : "没有可用快照"}
                </small>
                <b className={entry.complete ? "acquisition-ready" : "acquisition-blocked"}>
                  {entry.complete ? "完整" : "不完整"}
                </b>
              </div>
            );
          })}
        </div>
      )}
      <div className="acquisition-exact-summary">
        {Object.entries(gate.exactMatchPerCategory).map(([category, exact]) => (
          <span key={category}>
            {labels[category] ?? category}：游戏内逐字一致 {exact}/10
          </span>
        ))}
      </div>
      {blockers.length > 0 && (
        <div className="admin-errors acquisition-blockers">
          <strong>当前阻塞原因</strong>
          {blockers.map((reason) => (
            <span key={reason}>✕ {reason}</span>
          ))}
        </div>
      )}
    </section>
  );
}

function AcquisitionCheck({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className={`acquisition-check ${ok ? "is-ok" : "is-blocked"}`}>
      <span>{label}</span>
      <b>{ok ? "通过" : "阻塞"}</b>
    </div>
  );
}

function formatProvenanceValue(value: unknown): string {
  if (value === undefined || value === null) return "未提供";
  return JSON.stringify(value) ?? "未提供";
}

function DiffView({
  diff,
  selected,
  onToggle,
}: {
  diff: ImportDiff;
  selected: string[];
  onToggle: (key: string) => void;
}) {
  return (
    <div className="diff-grid">
      <DiffColumn title="新增" values={diff.added} />
      <DiffColumn title="修改" values={diff.modified} />
      <div>
        <h4>删除候选</h4>
        {diff.deletionCandidates.length ? (
          diff.deletionCandidates.map((key) => (
            <label className="deletion-row" key={key}>
              <input
                type="checkbox"
                checked={selected.includes(key)}
                onChange={() => onToggle(key)}
              />
              {key}
            </label>
          ))
        ) : (
          <p className="muted small">无</p>
        )}
      </div>
      <DiffColumn title="未变化" values={diff.unchanged} />
      <DiffColumn title="冲突" values={diff.conflicts} />
      <DiffColumn title="未解析" values={diff.unparsed} />
    </div>
  );
}

function DiffColumn({ title, values }: { title: string; values: string[] }) {
  const pageSize = 12;
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(values.length / pageSize));
  const visible = values.slice(page * pageSize, (page + 1) * pageSize);
  useEffect(() => {
    if (page >= pageCount) setPage(0);
  }, [page, pageCount]);
  return (
    <div>
      <h4>{title}</h4>
      {values.length ? (
        <ul className="key-list">
          {visible.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      ) : (
        <p className="muted small">无</p>
      )}
      {pageCount > 1 && (
        <div className="diff-pagination">
          <button disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
            上一页
          </button>
          <span>
            {page + 1} / {pageCount}
          </span>
          <button disabled={page + 1 === pageCount} onClick={() => setPage((p) => p + 1)}>
            下一页
          </button>
        </div>
      )}
    </div>
  );
}
