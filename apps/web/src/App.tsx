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
};

function parsePreviewRoute(hash = window.location.hash): PreviewRoute | null {
  const match = /^#preview\/([^/?]+)(?:\/([^/?]+))?/.exec(hash);
  if (!match?.[1]) return null;
  return {
    candidateId: decodeURIComponent(match[1]),
    buildId: match[2] ? decodeURIComponent(match[2]) : undefined,
  };
}

function parseAdminView(hash = window.location.hash): "intake" | "review" | "verify" | "release" {
  const value = hash.replace(/^#admin\//, "").split("?", 1)[0];
  return (["intake", "review", "verify", "release"] as const).includes(value as never)
    ? (value as "intake" | "review" | "verify" | "release")
    : "intake";
}

function adminHash(view: "intake" | "review" | "verify" | "release", params?: URLSearchParams) {
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

const verificationCategoryLabels: Record<VerificationItem["category"], string> = {
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
        api<{ documents: DocumentSummary[] }>(`/api/games/${gameId}/documents?limit=6&offset=0`),
        api<{ entities: EntitySummary[] }>(`/api/games/${gameId}/entities?limit=6&offset=0`),
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
  }, [gameId]);
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

  if (isAdminRoute && gameId) {
    return (
      <div className="app-shell admin-route-shell">
        <header className="topbar">
          <div>
            <span className="eyebrow">GAME INTELLIGENCE PLATFORM</span>
            <h1>审核工作台</h1>
          </div>
          <button
            className="secondary-button"
            onClick={() => {
              window.location.hash = "";
              setIsAdminRoute(false);
            }}
          >
            返回阅读
          </button>
        </header>
        <main>
          <AdminPanel gameId={gameId} />
        </main>
      </div>
    );
  }

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
          <button
            className="preview-entry-button"
            onClick={() => (window.location.hash = "admin/release")}
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

function previewRecordsFromPayload(payload: unknown, kind: "entity" | "document"): PreviewRecord[] {
  if (!payload || typeof payload !== "object") return [];
  const object = payload as Record<string, unknown>;
  const rows =
    (Array.isArray(object.records) && object.records) ||
    (Array.isArray(object.normalizedRecords) && object.normalizedRecords) ||
    (Array.isArray(object[kind === "entity" ? "entities" : "documents"]) &&
      (object[kind === "entity" ? "entities" : "documents"] as unknown[])) ||
    [];

  return rows.flatMap((row, index) => {
    if (!row || typeof row !== "object") return [];
    const value = row as Record<string, unknown>;
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
        contentHash: String(value.contentHash ?? ""),
        parserVersion: String(value.parserVersion ?? "preview"),
        displayKind: kind,
        displayTitle,
      },
    ];
  });
}

async function loadPreviewRecords(buildId: string, adminToken: string): Promise<PreviewRecord[]> {
  const [entities, documents] = await Promise.all([
    api<unknown>(`/api/admin/previews/${buildId}/entities?limit=500&offset=0`, {}, adminToken),
    api<unknown>(`/api/admin/previews/${buildId}/documents?limit=500&offset=0`, {}, adminToken),
  ]);
  return [
    ...previewRecordsFromPayload(entities, "entity"),
    ...previewRecordsFromPayload(documents, "document"),
  ];
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
          [...detail.builds].sort((left, right) => right.buildNumber - left.buildNumber)[0]?.id ??
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
    loadPreviewRecords(buildId, adminToken)
      .then((nextRecords) => {
        if (cancelled) return;
        setRecords(nextRecords);
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
  }, [adminToken, buildId]);

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
    const batchId = candidate?.importBatchIds[0];
    if (batchId) params.set("batchId", batchId);
    try {
      await api(
        "/api/admin/review-issues",
        {
          method: "POST",
          body: JSON.stringify({
            candidateId,
            buildId,
            batchId,
            canonicalKey: record.sourceKey,
            title: record.displayTitle,
          }),
        },
        adminToken,
      );
    } catch {
      // Older API deployments do not expose issue persistence; the queue route remains usable.
    }
    window.location.hash = adminHash("verify", params);
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
            onClick={() => (window.location.hash = "admin/release")}
          >
            返回发布管理
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
              .slice()
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
          <span>校验：{selectedBuild?.contentChecksum.slice(0, 12) ?? "—"}</span>
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

function AdminPanel({ gameId }: { gameId: string }) {
  const initialAdminParams = useMemo(
    () => new URLSearchParams(window.location.hash.split("?", 2)[1] ?? ""),
    [],
  );
  const [adminView, setAdminView] = useState<"intake" | "review" | "verify" | "release">(() =>
    parseAdminView(),
  );
  const [sources, setSources] = useState<AdminSource[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [path, setPath] = useState("");
  const [type, setType] = useState("local_directory");
  const [name, setName] = useState("本地原神资料");
  const [adminToken, setAdminToken] = useState(
    () => window.sessionStorage.getItem("gip-admin-token") ?? "",
  );
  const [status, setStatus] = useState("");
  const [batchId, setBatchId] = useState(() => initialAdminParams.get("batchId") ?? "");
  const [batches, setBatches] = useState<AdminBatch[]>([]);
  const [batch, setBatch] = useState<AdminBatch | null>(null);
  const [diff, setDiff] = useState<ImportDiff | null>(null);
  const [diffPage, setDiffPage] = useState(0);
  const diffPageSize = 50;
  const [selectedDeletions, setSelectedDeletions] = useState<string[]>([]);
  const [releaseNote, setReleaseNote] = useState("Web 管理界面发布");
  const [rollbackReason, setRollbackReason] = useState("Web 管理界面回滚");
  const [revisions, setRevisions] = useState<AdminRevision[]>([]);
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [verification, setVerification] = useState<VerificationRun | null>(null);
  const [verificationFilter, setVerificationFilter] = useState<"all" | VerificationStatus>("all");
  const [verificationCategory, setVerificationCategory] = useState<
    "all" | VerificationItem["category"]
  >("all");
  const [verificationQuery, setVerificationQuery] = useState(
    () => initialAdminParams.get("canonicalKey") ?? initialAdminParams.get("title") ?? "",
  );
  const [verificationIndex, setVerificationIndex] = useState(0);
  const [verificationSavingId, setVerificationSavingId] = useState("");
  const [verificationScreenshots, setVerificationScreenshots] = useState<
    VerificationScreenshotView[]
  >([]);
  const [verificationEvidenceBusy, setVerificationEvidenceBusy] = useState(false);
  const [reviewIssues, setReviewIssues] = useState<
    Array<{ id: string; title?: string; canonicalKey?: string; status?: string; detail?: string }>
  >([]);
  const [issueFilter, setIssueFilter] = useState("all");
  const [conflicts, setConflicts] = useState<ConflictCase[]>([]);
  const [conflictDetail, setConflictDetail] = useState<ConflictDetail | null>(null);
  const [selectedConflictObservationId, setSelectedConflictObservationId] = useState("");
  const [conflictResolutionReason, setConflictResolutionReason] = useState("");
  const [acquisitionStatus, setAcquisitionStatus] = useState<AcquisitionStatus | null>(null);
  const [publishReadiness, setPublishReadiness] = useState<PublishReadiness | null>(null);
  const [releaseConfirmOpen, setReleaseConfirmOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [rollbackTargetId, setRollbackTargetId] = useState("");
  const [rollingBackRevisionId, setRollingBackRevisionId] = useState("");
  const [releaseCandidates, setReleaseCandidates] = useState<ReleaseCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState(
    () => initialAdminParams.get("candidateId") ?? "",
  );
  const [releaseCandidateDetail, setReleaseCandidateDetail] =
    useState<ReleaseCandidateDetail | null>(null);
  const [selectedBuildId, setSelectedBuildId] = useState(
    () => initialAdminParams.get("buildId") ?? "",
  );
  const [candidateReadiness, setCandidateReadiness] = useState<ReleaseCandidateReadiness | null>(
    null,
  );
  const [candidateBusy, setCandidateBusy] = useState(false);
  const verificationSummary = useMemo(() => {
    if (!verification) return [];
    const categories = [...new Set(verification.items.map((item) => item.category))];
    return categories.map((category) => {
      const items = verification.items.filter((item) => item.category === category);
      const exact = items.filter(
        (item) =>
          item.status === "exact_match" &&
          item.channel === "game_client" &&
          item.checkedGameVersion === verification.expectedGameVersion &&
          item.checkedLocale === verification.expectedLocale,
      ).length;
      const pending = items.filter((item) => item.status === "not_checked").length;
      const required = items.filter((item) => item.required).length;
      return {
        category,
        label: verificationCategoryLabels[category],
        total: items.length,
        required,
        exact,
        pending,
      };
    });
  }, [verification]);
  const visibleVerificationItems = useMemo(() => {
    if (!verification) return [];
    const query = verificationQuery.trim().toLocaleLowerCase();
    return verification.items.filter((item) => {
      const matchesStatus = verificationFilter === "all" || item.status === verificationFilter;
      const matchesCategory =
        verificationCategory === "all" || item.category === verificationCategory;
      const matchesQuery =
        !query || `${item.title} ${item.canonicalKey}`.toLocaleLowerCase().includes(query);
      return matchesStatus && matchesCategory && matchesQuery;
    });
  }, [verification, verificationCategory, verificationFilter, verificationQuery]);
  useEffect(() => {
    setVerificationIndex(0);
  }, [verificationCategory, verificationFilter, verificationQuery]);
  useEffect(() => {
    setVerificationIndex((current) =>
      Math.max(0, Math.min(current, Math.max(visibleVerificationItems.length - 1, 0))),
    );
  }, [visibleVerificationItems.length]);
  useEffect(() => {
    const onHash = () => {
      if (window.location.hash.startsWith("#admin/")) setAdminView(parseAdminView());
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    window.sessionStorage.setItem("gip-admin-token", adminToken);
  }, [adminToken]);
  const selectedVerificationItem = visibleVerificationItems[verificationIndex];
  const nextRevisionNumber =
    revisions.reduce((maximum, revision) => Math.max(maximum, revision.revisionNumber), 0) + 1;
  const normalizedPublishBlockers = (publishReadiness?.blockingReasons ?? []).map((reason) =>
    typeof reason === "string"
      ? { code: reason, message: releaseBlockerMessage(reason), details: undefined }
      : reason,
  );
  const releaseGateGroups: Array<{ title: string; summary: string; items: ReleaseGateItem[] }> = [
    {
      title: "批次与变更",
      summary: "确认导入结果已经审核，删除项已经确认。",
      items: [
        {
          label: "已选择发布批次",
          detail: batchId ? `批次 ${batchId.slice(0, 8)}` : "尚未选择批次",
          state: batchId ? "passed" : "blocked",
          action: batchId ? undefined : { label: "选择批次", view: "review" },
        },
        {
          label: "预发布候选已生成",
          detail: batch ? `当前状态：${batch.status}` : "等待批次数据",
          state: !batch
            ? "unavailable"
            : ["review_required", "published"].includes(batch.status)
              ? "passed"
              : "blocked",
          action:
            batch && !["review_required", "published"].includes(batch.status)
              ? { label: "打开预发布候选", view: "review" }
              : undefined,
        },
        {
          label: "导入错误与删除确认",
          detail: batch
            ? `${batch.failureCount} 个导入错误 · ${batch.diff?.deletionCandidates.length ?? 0} 个删除候选`
            : "等待批次数据",
          state: !batch
            ? "unavailable"
            : batch.failureCount === 0 &&
                !normalizedPublishBlockers.some((reason) =>
                  ["import_has_errors", "deletions_unconfirmed"].includes(reason.code),
                )
              ? "passed"
              : "blocked",
          action:
            batch &&
            (batch.failureCount > 0 ||
              normalizedPublishBlockers.some((reason) =>
                ["import_has_errors", "deletions_unconfirmed"].includes(reason.code),
              ))
              ? { label: "检查 Diff", view: "review" }
              : undefined,
        },
      ],
    },
    {
      title: "数据与人工核验",
      summary: "确认采集覆盖、数据完整性以及游戏内逐字核验。",
      items: [
        releaseAuditGate(
          "Manifest 与暂存数据",
          acquisitionStatus,
          acquisitionStatus?.releaseGate.manifestComplete,
          "采集清单、暂存记录与来源快照",
        ),
        releaseAuditGate(
          "渠道覆盖与观察层",
          acquisitionStatus,
          acquisitionStatus
            ? acquisitionStatus.releaseGate.sourceCoverageComplete &&
                acquisitionStatus.releaseGate.observationIntegrity &&
                acquisitionStatus.releaseGate.allSamplesProcessed
            : undefined,
          "来源覆盖、哈希完整性与样本处理",
        ),
        {
          ...releaseAuditGate(
            "游戏内人工核验",
            acquisitionStatus,
            acquisitionStatus?.releaseGate.manualVerificationReady,
            publishReadiness?.verification
              ? `${publishReadiness.verification.status ?? "未知状态"} · ${publishReadiness.verification.itemCount ?? 0} 项`
              : "要求版本、语言和客户端渠道全部匹配",
          ),
          action:
            acquisitionStatus && !acquisitionStatus.releaseGate.manualVerificationReady
              ? { label: "继续数据核验", view: "verify" }
              : undefined,
        },
      ],
    },
    {
      title: "发布安全",
      summary: "冲突、备份和实时 readiness 全部通过后才能生成 Revision。",
      items: [
        {
          label: "冲突裁决",
          detail: `${conflicts.length} 个未解决冲突`,
          state: !acquisitionStatus
            ? "unavailable"
            : conflicts.length === 0 &&
                acquisitionStatus.releaseGate.conflictSelectionComplete &&
                acquisitionStatus.releaseGate.openConflicts === 0
              ? "passed"
              : "blocked",
        },
        releaseAuditGate(
          "发布前备份",
          acquisitionStatus,
          acquisitionStatus?.releaseGate.backupAfterCurrentBatches,
          acquisitionStatus?.latestBackup?.createdAt
            ? `备份时间：${formatReleaseDate(acquisitionStatus.latestBackup.createdAt)}`
            : "必须覆盖当前批次且校验有效",
        ),
        {
          label: "实时发布检查",
          detail: !batchId
            ? "选择批次后开始检查"
            : publishReadiness
              ? publishReadiness.ready
                ? "服务端已确认可发布"
                : `${normalizedPublishBlockers.length} 个阻塞原因`
              : "正在读取服务端门禁",
          state: !batchId
            ? "unavailable"
            : publishReadiness
              ? publishReadiness.ready
                ? "passed"
                : "blocked"
              : "checking",
        },
      ],
    },
  ];

  useEffect(() => {
    const item = selectedVerificationItem;
    if (!item) {
      setVerificationScreenshots([]);
      return;
    }
    let cancelled = false;
    const previewUrls: string[] = [];
    setVerificationEvidenceBusy(true);
    void api<{ screenshots: VerificationScreenshot[] }>(
      `/api/admin/verification/items/${item.id}/screenshots`,
      {},
      adminToken,
    )
      .then(async ({ screenshots }) => {
        const views = await Promise.all(
          screenshots.map(async (screenshot) => {
            const headers = new Headers();
            if (adminToken.trim()) headers.set("authorization", `Bearer ${adminToken.trim()}`);
            const response = await fetch(`/api/admin/verification/screenshots/${screenshot.id}`, {
              headers,
            });
            if (!response.ok) return screenshot;
            const previewUrl = URL.createObjectURL(await response.blob());
            previewUrls.push(previewUrl);
            return { ...screenshot, previewUrl };
          }),
        );
        if (!cancelled) setVerificationScreenshots(views);
      })
      .catch(() => {
        if (!cancelled) setVerificationScreenshots([]);
      })
      .finally(() => {
        if (!cancelled) setVerificationEvidenceBusy(false);
      });
    return () => {
      cancelled = true;
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [selectedVerificationItem?.id, selectedVerificationItem?.screenshotCount, adminToken]);

  async function refreshAdmin() {
    try {
      const [
        sourceResponse,
        revisionResponse,
        jobResponse,
        conflictResponse,
        importsResponse,
        statusResponse,
        candidateResponse,
      ] = await Promise.all([
        api<{ sources: AdminSource[] }>(`/api/admin/sources?gameId=${gameId}`, {}, adminToken),
        api<{ revisions: AdminRevision[] }>(
          `/api/admin/revisions?gameId=${gameId}`,
          {},
          adminToken,
        ),
        api<{ jobs: AdminJob[] }>("/api/admin/jobs", {}, adminToken),
        api<{ conflicts: ConflictCase[] }>(
          `/api/admin/conflicts?gameId=${gameId}&status=open`,
          {},
          adminToken,
        ),
        api<{ imports: AdminBatch[] }>(`/api/admin/imports?gameId=${gameId}`, {}, adminToken),
        api<{ status: AcquisitionStatus }>(
          `/api/admin/acquisition/status?gameId=${gameId}`,
          {},
          adminToken,
        ).catch(() => null),
        api<{ candidates: ReleaseCandidate[] }>(
          `/api/admin/release-candidates?gameId=${encodeURIComponent(gameId)}`,
          {},
          adminToken,
        ).catch(() => ({ candidates: [] })),
      ]);
      setSources(sourceResponse.sources);
      setRevisions(revisionResponse.revisions);
      setJobs(jobResponse.jobs);
      setConflicts(conflictResponse.conflicts);
      setBatches(importsResponse.imports);
      setAcquisitionStatus(statusResponse?.status ?? null);
      setReleaseCandidates(candidateResponse?.candidates ?? []);
      if (!sourceId && sourceResponse.sources[0]) setSourceId(sourceResponse.sources[0].id);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "管理数据加载失败");
    }
  }

  useEffect(() => {
    void refreshAdmin();
  }, [gameId]);

  async function refreshReleaseCandidate(candidateId = selectedCandidateId) {
    if (!candidateId) {
      setReleaseCandidateDetail(null);
      setSelectedBuildId("");
      setCandidateReadiness(null);
      return;
    }
    try {
      const [detailResponse, readiness] = await Promise.all([
        api<ReleaseCandidateDetail | { candidate: ReleaseCandidateDetail }>(
          `/api/admin/release-candidates/${candidateId}`,
          {},
          adminToken,
        ),
        api<ReleaseCandidateReadiness>(
          `/api/admin/release-candidates/${candidateId}/readiness`,
          {},
          adminToken,
        ).catch(() => null),
      ]);
      const detail = "candidate" in detailResponse ? detailResponse.candidate : detailResponse;
      setReleaseCandidateDetail(detail);
      setCandidateReadiness(readiness);
      setSelectedBuildId((current) => {
        if (detail.builds.some((build) => build.id === current)) return current;
        return (
          detail.currentBuildId ??
          [...detail.builds].sort((left, right) => right.buildNumber - left.buildNumber)[0]?.id ??
          ""
        );
      });
    } catch (reason) {
      setReleaseCandidateDetail(null);
      setCandidateReadiness(null);
      setStatus(reason instanceof Error ? reason.message : "预发布候选加载失败");
    }
  }

  useEffect(() => {
    if (adminView !== "release" || !selectedCandidateId) return;
    void refreshReleaseCandidate(selectedCandidateId);
  }, [adminView, selectedCandidateId, adminToken]);

  useEffect(() => {
    if (adminView !== "verify") return;
    const query = selectedCandidateId
      ? `?candidateId=${encodeURIComponent(selectedCandidateId)}`
      : "";
    void api<{ issues: typeof reviewIssues }>(`/api/admin/review-issues${query}`, {}, adminToken)
      .then((payload) => setReviewIssues(payload.issues ?? []))
      .catch(() => setReviewIssues([]));
  }, [adminView, selectedCandidateId, adminToken]);

  async function buildReleaseCandidate() {
    if (!selectedCandidateId) return;
    setCandidateBusy(true);
    try {
      const build = await api<ReleaseCandidateBuild>(
        `/api/admin/release-candidates/${selectedCandidateId}/builds`,
        { method: "POST", body: JSON.stringify({}) },
        adminToken,
      );
      setSelectedBuildId(build.id);
      setStatus(`Build ${build.buildNumber} 已生成，可以进入预发布页面逐条查看`);
      await refreshAdmin();
      await refreshReleaseCandidate(selectedCandidateId);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "预发布 Build 生成失败");
    } finally {
      setCandidateBusy(false);
    }
  }

  async function promoteReleaseCandidate() {
    if (!selectedCandidateId || !selectedBuildId || !releaseCandidateDetail) return;
    const build = releaseCandidateDetail.builds.find((item) => item.id === selectedBuildId);
    if (!build) return;
    if (!window.confirm(`确认将 Build ${build.buildNumber} 晋级为正式 MCP 数据版本？`)) return;
    setCandidateBusy(true);
    try {
      const currentRevisionId = revisions.find((revision) => revision.isCurrent)?.id ?? null;
      const revision = await api<AdminRevision>(
        `/api/admin/release-candidates/${selectedCandidateId}/promote`,
        {
          method: "POST",
          body: JSON.stringify({
            buildId: build.id,
            contentChecksum: build.contentChecksum,
            expectedCurrentRevisionId: currentRevisionId,
            releaseNote,
            idempotencyKey: crypto.randomUUID(),
          }),
        },
        adminToken,
      );
      setStatus(`候选版本已晋级为 r${revision.revisionNumber}，正式 MCP 将读取这个 Revision`);
      await refreshAdmin();
      await refreshReleaseCandidate(selectedCandidateId);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "候选版本晋级失败");
    } finally {
      setCandidateBusy(false);
    }
  }

  useEffect(() => {
    if (!batchId || !batch || !["pending", "running"].includes(batch.status)) return;
    const timer = window.setInterval(() => void refreshBatch(false), 1_500);
    return () => window.clearInterval(timer);
  }, [batchId, batch?.status, diffPage]);

  useEffect(() => {
    if (adminView !== "release" || !batchId) {
      setPublishReadiness(null);
      return;
    }
    void api<PublishReadiness>(`/api/admin/imports/${batchId}/publish-readiness`, {}, adminToken)
      .then(setPublishReadiness)
      .catch(() => setPublishReadiness(null));
  }, [adminView, batchId, adminToken, batch?.status]);

  async function createSourceAndImport(event: FormEvent) {
    event.preventDefault();
    if (!path.trim()) return;
    setStatus("正在创建快照并进入预发布候选…");
    try {
      let activeSourceId = sourceId;
      if (!activeSourceId) {
        const source = await api<AdminSource>(
          "/api/admin/sources",
          {
            method: "POST",
            body: JSON.stringify({
              gameId,
              name,
              type,
              pathLabel: path.split(/[\\/]/).pop() || path,
              parserType: "builtin",
            }),
          },
          adminToken,
        );
        activeSourceId = source.id;
        setSourceId(activeSourceId);
      }
      const nextBatch = await api<AdminBatch>(
        "/api/admin/imports",
        {
          method: "POST",
          body: JSON.stringify({ gameId, sourceId: activeSourceId, path }),
        },
        adminToken,
      );
      setBatchId(nextBatch.id);
      setBatch(nextBatch);
      setDiff(nextBatch.diff ?? null);
      setSelectedDeletions([]);
      // Import is an intake event: immediately create the isolated release candidate.
      const candidateResponse = await api<{ candidate: ReleaseCandidate }>(
        "/api/admin/release-candidates",
        {
          method: "POST",
          body: JSON.stringify({
            gameId,
            name: `导入 ${nextBatch.id.slice(0, 8)}`,
            importBatchIds: [nextBatch.id],
          }),
        },
        adminToken,
      ).catch(() => null);
      if (candidateResponse?.candidate) {
        setSelectedCandidateId(candidateResponse.candidate.id);
        window.location.hash = `admin/review?batchId=${encodeURIComponent(nextBatch.id)}&candidateId=${encodeURIComponent(candidateResponse.candidate.id)}`;
      }
      setStatus(`导入批次 ${nextBatch.id} 已进入预发布候选`);
      await refreshAdmin();
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "导入失败");
    }
  }

  async function refreshBatch(announce = true, selectedBatchId = batchId) {
    if (!selectedBatchId) return;
    try {
      const [batchResponse, diffResponse, verificationResponse] = await Promise.all([
        api<AdminBatch>(`/api/admin/imports/${selectedBatchId}`, {}, adminToken),
        api<{ diff: ImportDiff | null }>(
          `/api/admin/imports/${selectedBatchId}/diff?offset=${diffPage * diffPageSize}&limit=${diffPageSize}`,
          {},
          adminToken,
        ),
        api<VerificationRun>(
          `/api/admin/imports/${selectedBatchId}/verification`,
          {},
          adminToken,
        ).catch((reason) => {
          if (reason instanceof Error && reason.message.startsWith("verification_run_not_found:"))
            return null;
          throw reason;
        }),
      ]);
      setBatch(batchResponse);
      setBatchId(selectedBatchId);
      setDiff(diffResponse.diff);
      setVerification(verificationResponse);
      if (adminView === "release") {
        const readiness = await api<PublishReadiness>(
          `/api/admin/imports/${selectedBatchId}/publish-readiness`,
          {},
          adminToken,
        ).catch(() => null);
        setPublishReadiness(readiness);
      }
      if (announce) setStatus(`批次状态：${batchResponse.status}`);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "批次刷新失败");
    }
  }

  async function updateVerification(
    item: VerificationItem,
    status: VerificationStatus,
    channel: VerificationChannel = item.channel ?? "game_client",
    note = item.note ?? "",
    checkedGameVersion = item.checkedGameVersion ?? verification?.expectedGameVersion ?? "7.0.0",
    checkedLocale = item.checkedLocale ?? verification?.expectedLocale ?? "zh-CN",
  ) {
    setVerificationSavingId(item.id);
    setStatus(`正在保存 ${item.title}…`);
    try {
      await api(
        `/api/admin/verification/items/${item.id}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            status,
            channel,
            checkedGameVersion,
            checkedLocale,
            note,
          }),
        },
        adminToken,
      );
      await refreshBatch(false);
      setStatus(`已保存 ${item.title}`);
      return true;
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "核验状态提交失败");
      return false;
    } finally {
      setVerificationSavingId("");
    }
  }

  async function saveAndNext(item: VerificationItem, index: number) {
    const saved = await updateVerification(
      item,
      item.status,
      item.channel ?? "game_client",
      item.note ?? "",
    );
    if (!saved) return;
    const next = visibleVerificationItems[index + 1];
    if (next) {
      setVerificationIndex(index + 1);
      window.setTimeout(
        () =>
          document
            .querySelector(`[aria-label="${next.canonicalKey}核验状态"]`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" }),
        0,
      );
      setStatus(`已保存 ${item.title}，已定位下一条`);
    } else setStatus(`已保存 ${item.title}，这是当前筛选的最后一条`);
  }

  async function uploadScreenshot(item: VerificationItem, file?: File) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setStatus("只支持 PNG、JPEG 或 WebP 截图");
      return;
    }
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",", 2)[1] ?? "");
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    setVerificationEvidenceBusy(true);
    setStatus(`正在上传 ${file.name}…`);
    try {
      await api(
        `/api/admin/verification/items/${item.id}/screenshots`,
        {
          method: "POST",
          body: JSON.stringify({ mimeType: file.type, dataBase64: base64 }),
        },
        adminToken,
      );
      await refreshBatch(false);
      setStatus(`截图已上传：${file.name}`);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "截图上传失败");
    } finally {
      setVerificationEvidenceBusy(false);
    }
  }

  async function deleteVerificationScreenshot(screenshot: VerificationScreenshot) {
    if (!window.confirm("确定删除这张核验截图吗？此操作无法撤销。")) return;
    setVerificationEvidenceBusy(true);
    try {
      await api(
        `/api/admin/verification/screenshots/${screenshot.id}`,
        { method: "DELETE" },
        adminToken,
      );
      await refreshBatch(false);
      setStatus("截图证据已删除");
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "截图删除失败");
    } finally {
      setVerificationEvidenceBusy(false);
    }
  }

  async function resolveConflict(conflict: ConflictCase) {
    let detail = conflictDetail?.id === conflict.id ? conflictDetail : undefined;
    let selectedForConflict = detail ? selectedConflictObservationId : "";
    if (!detail && conflict.observationIds.length > 1) {
      setStatus("请先查看原文并选择采用的来源观察");
      return;
    }
    try {
      if (!detail) {
        const response = await api<{ conflict: ConflictDetail }>(
          `/api/admin/conflicts/${conflict.id}`,
          {},
          adminToken,
        );
        detail = response.conflict;
        setConflictDetail(detail);
        setSelectedConflictObservationId(
          detail.selectedObservationId ?? detail.observations[0]?.id ?? "",
        );
        selectedForConflict = detail.selectedObservationId ?? detail.observations[0]?.id ?? "";
      }
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "冲突详情加载失败");
      return;
    }
    const selectedObservationId =
      selectedForConflict || detail?.selectedObservationId || detail?.observations[0]?.id;
    if (!selectedObservationId) {
      setStatus("此冲突没有可供采用的来源观察，无法裁决");
      return;
    }
    const resolution = conflictResolutionReason.trim();
    if (!resolution) {
      setStatus("请填写裁决理由后再提交");
      return;
    }
    try {
      await api(
        `/api/admin/conflicts/${conflict.id}/resolve`,
        {
          method: "POST",
          body: JSON.stringify({ resolution, selectedObservationId }),
        },
        adminToken,
      );
      await refreshAdmin();
      if (conflictDetail?.id === conflict.id) setConflictDetail(null);
      setSelectedConflictObservationId("");
      setConflictResolutionReason("");
      if (batchId) await refreshBatch(false);
      setStatus(`已完成 ${conflict.canonicalKey} 的冲突裁决`);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "冲突裁决失败");
    }
  }

  async function inspectConflict(conflict: ConflictCase) {
    try {
      const response = await api<{ conflict: ConflictDetail }>(
        `/api/admin/conflicts/${conflict.id}`,
        {},
        adminToken,
      );
      setConflictDetail(response.conflict);
      setSelectedConflictObservationId(
        response.conflict.selectedObservationId ?? response.conflict.observations[0]?.id ?? "",
      );
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "冲突详情加载失败");
    }
  }

  /* Legacy batch review/publish endpoints are intentionally not part of the admin workflow. */
  async function review() {
    if (!batchId) return;
    try {
      const reviewed = await api<AdminBatch>(
        `/api/admin/imports/${batchId}/review`,
        {
          method: "POST",
          body: JSON.stringify({
            approved: true,
            note: "Web 管理界面审核通过",
            confirmedDeletionKeys: selectedDeletions,
          }),
        },
        adminToken,
      );
      setBatch(reviewed);
      setStatus(`审核完成：${reviewed.status}`);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "审核失败");
    }
  }

  async function publish() {
    if (!batchId) return;
    setPublishing(true);
    try {
      const readiness = await api<PublishReadiness>(
        `/api/admin/imports/${batchId}/publish-readiness`,
        {},
        adminToken,
      );
      setPublishReadiness(readiness);
      if (!readiness.ready) {
        setReleaseConfirmOpen(false);
        setStatus("发布门禁已发生变化，请处理新的阻塞项后重试");
        return;
      }
      const revision = await api<AdminRevision>(
        `/api/admin/imports/${batchId}/publish`,
        {
          method: "POST",
          body: JSON.stringify({ releaseNote }),
        },
        adminToken,
      );
      setStatus(`发布成功：r${revision.revisionNumber}，索引任务已排队`);
      setReleaseConfirmOpen(false);
      await refreshAdmin();
      await refreshBatch(false);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "发布失败");
    } finally {
      setPublishing(false);
    }
  }

  void review;
  void publish;

  async function rollback(revisionId: string) {
    if (!rollbackReason.trim()) {
      setStatus("请填写回滚原因后再确认");
      return;
    }
    setRollingBackRevisionId(revisionId);
    try {
      const revision = await api<AdminRevision>(
        `/api/admin/revisions/${revisionId}/rollback`,
        {
          method: "POST",
          body: JSON.stringify({ reason: rollbackReason }),
        },
        adminToken,
      );
      setStatus(`已回滚到 r${revision.revisionNumber}，等待索引任务完成`);
      setRollbackTargetId("");
      await refreshAdmin();
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "回滚失败");
    } finally {
      setRollingBackRevisionId("");
    }
  }

  return (
    <div className="admin-panel">
      <div className="panel-title">
        <div>
          <span className="eyebrow">ADMIN WORKFLOW</span>
          <h2>数据管理</h2>
        </div>
        <span>本地路径只用于导入，不在结果中回显</span>
      </div>
      <nav className="workbench-nav" aria-label="审核工作台导航">
        {(
          [
            ["intake", "导入"],
            ["review", "预发布分支"],
            ["verify", "待处理问题"],
            ["release", "正式版本历史"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className={adminView === value ? "is-active" : ""}
            onClick={() => {
              window.location.hash = `admin/${value}`;
              setAdminView(value);
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="admin-auth-row">
        <label>
          生产管理 Token
          <input
            type="password"
            value={adminToken}
            onChange={(event) => setAdminToken(event.target.value)}
            placeholder="开发环境可留空"
          />
        </label>
        <button className="secondary-button" onClick={() => void refreshAdmin()}>
          刷新管理状态
        </button>
      </div>
      {adminView === "intake" && (
        <form className="admin-form" onSubmit={createSourceAndImport}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="新来源名称"
          />
          <select
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
            aria-label="已有来源"
          >
            <option value="">新建来源</option>
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.name} · {source.type}
              </option>
            ))}
          </select>
          {!sourceId && (
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
              aria-label="来源类型"
            >
              <option value="local_directory">本地目录</option>
              <option value="local_json">JSON 文件</option>
              <option value="local_markdown">Markdown 文件</option>
              <option value="local_text">文本文件</option>
            </select>
          )}
          <input
            value={path}
            onChange={(event) => setPath(event.target.value)}
            placeholder="本地文件或目录路径"
            required
          />
          <button type="submit">导入并进入预发布</button>
        </form>
      )}
      {status && (
        <p className="status-line" role="status">
          {status}
        </p>
      )}
      {batch && adminView === "review" && (
        <section className="admin-section">
          <div className="section-heading">
            <h3>预发布候选</h3>
            <button className="secondary-button" onClick={() => void refreshBatch()}>
              刷新批次
            </button>
          </div>
          <p className="muted small">
            {batch.id} · {batch.status} · 成功 {batch.successCount} · 失败 {batch.failureCount}
          </p>
          {batch.errors.length > 0 && (
            <details className="admin-errors">
              <summary>导入错误（{batch.errors.length}）</summary>
              {batch.errors.map((item) => (
                <span key={`${item.code}-${item.message}`}>
                  ✕ {item.code}: {item.message}
                </span>
              ))}
            </details>
          )}
          {diff && (
            <DiffView
              diff={diff}
              selected={selectedDeletions}
              onToggle={(key) =>
                setSelectedDeletions((current) =>
                  current.includes(key)
                    ? current.filter((item) => item !== key)
                    : [...current, key],
                )
              }
            />
          )}
          <div className="admin-actions" aria-label="预发布分页">
            <button
              className="secondary-button"
              disabled={diffPage === 0}
              onClick={() => setDiffPage((page) => Math.max(0, page - 1))}
            >
              上一页
            </button>
            <span className="muted small">
              第 {diffPage + 1} 页 · 每页 {diffPageSize} 条
            </span>
            <button
              className="secondary-button"
              disabled={!diff || Object.values(diff).every((items) => items.length < diffPageSize)}
              onClick={() => setDiffPage((page) => page + 1)}
            >
              下一页
            </button>
          </div>
          <div className="admin-actions">
            <button
              onClick={() => {
                window.location.hash = "admin/verify";
                setAdminView("verify");
              }}
            >
              查看问题队列
            </button>
          </div>
        </section>
      )}
      {adminView === "verify" && (
        <section className="admin-section issue-queue" aria-label="问题队列">
          <div className="section-heading">
            <div>
              <h3>问题队列</h3>
              <span className="muted small">按问题分类处理，解决后可回到预发布晋级</span>
            </div>
          </div>
          <div className="issue-filter-row" aria-label="问题类型过滤">
            {[["all", "全部"], ["missing", "缺失"], ["conflict", "冲突"], ["format", "格式"], ["version", "版本"], ["locale", "语言"], ["source", "来源"], ["media", "媒体"], ["other", "其他"]].map(([value, label]) => (
              <button key={value} className={issueFilter === value ? "is-active" : "secondary-button"} onClick={() => setIssueFilter(value)}>{label}</button>
            ))}
          </div>
          {!reviewIssues.length ? (
            <p className="empty-state">无待处理问题，可直接晋级</p>
          ) : (
            <div className="issue-list">
              {reviewIssues.filter((issue) => issueFilter === "all" || `${issue.title ?? ""} ${issue.detail ?? ""}`.toLowerCase().includes(issueFilter)).map((issue) => (
                <article className="issue-card" key={issue.id}>
                  <div>
                    <strong>{issue.title ?? issue.canonicalKey ?? "未命名问题"}</strong>
                    <small>{issue.detail ?? issue.canonicalKey ?? ""}</small>
                  </div>
                  <button
                    onClick={() =>
                      void api(
                        `/api/admin/review-issues/${issue.id}/resolve`,
                        { method: "POST", body: JSON.stringify({}) },
                        adminToken,
                      ).then(() =>
                        setReviewIssues((items) => items.filter((item) => item.id !== issue.id)),
                      )
                    }
                  >
                    解决问题
                  </button>
                  <button className="secondary-button" onClick={() => void api(`/api/admin/review-issues/${issue.id}/reopen`, { method: "POST", body: JSON.stringify({}) }, adminToken).then(() => setStatus("问题已重新打开")).catch(() => setStatus("重新打开失败"))}>重新打开</button>
                </article>
              ))}
            </div>
          )}
        </section>
      )}
      {adminView === "release" && (
        <>
          <section className="release-hero" aria-labelledby="release-title">
            <div>
              <span className="eyebrow">RELEASE CONTROL</span>
              <h3 id="release-title">发布管理</h3>
              <p>
                选择一个已审核批次，处理全部阻塞项，再生成不可变的 Dataset Revision。
                发布后可在下方跟踪索引任务或发起带原因的回滚。
              </p>
            </div>
            <div
              className={`release-state-card ${publishReadiness?.ready ? "is-ready" : "is-blocked"}`}
            >
              <span>{batchId ? `批次 ${batchId.slice(0, 8)}` : "尚未选择批次"}</span>
              <strong>
                {!batchId
                  ? "等待选择"
                  : !publishReadiness
                    ? "正在检查"
                    : publishReadiness.ready
                      ? "可以发布"
                      : `${normalizedPublishBlockers.length} 项阻塞`}
              </strong>
              <small>目标版本 r{nextRevisionNumber}</small>
            </div>
          </section>

          <section className="release-gates" aria-label="发布门禁分组">
            {releaseGateGroups.map((group) => (
              <article className="release-gate-group" key={group.title}>
                <div className="release-gate-heading">
                  <h3>{group.title}</h3>
                  <span>{group.summary}</span>
                </div>
                <div className="release-gate-list">
                  {group.items.map((item) => (
                    <div className={`release-gate-row is-${item.state}`} key={item.label}>
                      <span className="release-gate-icon" aria-hidden="true">
                        {releaseGateIcon(item.state)}
                      </span>
                      <div>
                        <b>{item.label}</b>
                        <small>{item.detail}</small>
                      </div>
                      <span className="release-gate-label">{releaseGateLabel(item.state)}</span>
                      {item.action && (
                        <button
                          className="release-link-button"
                          onClick={() => {
                            window.location.hash = `admin/${item.action?.view ?? "release"}`;
                          }}
                        >
                          {item.action.label}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </article>
            ))}
          </section>

          <section className="admin-section release-readiness">
            <div className="section-heading release-section-title">
              <div>
                <span className="eyebrow">BLOCKERS</span>
                <h3>阻塞原因</h3>
              </div>
              <button
                className="secondary-button"
                disabled={!batchId}
                onClick={() => void refreshBatch(false)}
              >
                重新检查
              </button>
            </div>
            {!batchId && <div className="release-empty">选择批次后，这里会显示具体门禁结果。</div>}
            {publishReadiness && !publishReadiness.ready && (
              <div className="release-blocker-grid">
                {normalizedPublishBlockers.map((reason) => (
                  <article
                    className="release-blocker-card"
                    key={`${reason.code}-${reason.message}`}
                  >
                    <span>{reason.code}</span>
                    <strong>{reason.message}</strong>
                    {reason.details !== undefined && (
                      <small>{formatReleaseDetails(reason.details)}</small>
                    )}
                    {releaseBlockerAction(reason.code) && (
                      <button
                        className="release-link-button"
                        onClick={() => {
                          window.location.hash = `admin/${releaseBlockerAction(reason.code)}`;
                        }}
                      >
                        前往处理
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
            {publishReadiness?.ready && (
              <div className="release-success-message" role="status">
                <b>全部检查通过</b>
                <span>服务端当前允许发布。请在预发布候选中选择 Build 并晋级正式版本。</span>
              </div>
            )}
          </section>

          {acquisitionStatus && (
            <details className="release-audit-details">
              <summary>查看采集完整性审计明细</summary>
              <AcquisitionStatusPanel
                status={acquisitionStatus}
                stale={reportMayBeStale(acquisitionStatus, batches)}
              />
            </details>
          )}

          <section
            className="admin-section release-candidates-panel"
            aria-label="预发布候选与版本切换"
          >
            <div className="release-section-title">
              <div>
                <span className="eyebrow">PREVIEW & CANDIDATE</span>
                <h3>预发布分支与 Build</h3>
              </div>
              <span
                className={`release-pill ${candidateReadiness?.ready ? "is-ready" : "is-blocked"}`}
              >
                {candidateReadiness?.ready ? "预发布就绪" : "待构建/待检查"}
              </span>
            </div>
            <p className="muted small">
              先创建预发布版本并在独立预览页面中逐条浏览、核验与报告问题；全部确认后可一键晋级为正式
              MCP Revision。
            </p>
            <div className="candidate-toolbar">
              <label className="candidate-select-field">
                <span>选择发布候选</span>
                <select
                  value={selectedCandidateId}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    setSelectedCandidateId(nextId);
                    if (nextId) void refreshReleaseCandidate(nextId);
                  }}
                >
                  <option value="">-- 请选择预发布分支 --</option>
                  {releaseCandidates.map((cand) => (
                    <option key={cand.id} value={cand.id}>
                      {cand.name} · {cand.status}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {releaseCandidateDetail && (
              <div className="candidate-detail-card">
                <div className="candidate-detail-header">
                  <strong>{releaseCandidateDetail.name}</strong>
                  <span>状态: {releaseCandidateDetail.status}</span>
                  <small>创建时间: {formatReleaseDate(releaseCandidateDetail.createdAt)}</small>
                </div>
                <div className="candidate-builds-list">
                  <b>历史 Build（不可变快照）：</b>
                  {releaseCandidateDetail.builds.map((build) => (
                    <div
                      key={build.id}
                      className={`candidate-build-item ${
                        selectedBuildId === build.id ? "is-selected" : ""
                      }`}
                    >
                      <span>
                        Build #{build.buildNumber} · {build.recordCount} 条记录 · {build.status}
                      </span>
                      <div className="candidate-build-actions">
                        <button
                          className="secondary-button"
                          onClick={() => {
                            setSelectedBuildId(build.id);
                            window.location.hash = `preview/${encodeURIComponent(
                              releaseCandidateDetail.id,
                            )}/${encodeURIComponent(build.id)}`;
                          }}
                        >
                          进入预发布查看
                        </button>
                      </div>
                    </div>
                  ))}
                  {!releaseCandidateDetail.builds.length && (
                    <p className="muted small">尚未生成任何 Build 快照。</p>
                  )}
                </div>
                <div className="candidate-actions">
                  <button
                    className="secondary-button"
                    disabled={candidateBusy}
                    onClick={() => void buildReleaseCandidate()}
                  >
                    {candidateBusy ? "构建中…" : "生成新预发布 Build"}
                  </button>
                  {selectedBuildId && (
                    <button
                      disabled={candidateBusy || !candidateReadiness?.ready}
                      onClick={() => void promoteReleaseCandidate()}
                    >
                      {candidateBusy ? "晋级中…" : "将当前 Build 晋级为正式版本"}
                    </button>
                  )}
                </div>
              </div>
            )}
          </section>

          <section className="admin-section release-compose">
            <div className="release-section-title">
              <div>
                <span className="eyebrow">NEW REVISION</span>
                <h3>生成 r{nextRevisionNumber}</h3>
              </div>
              <span
                className={`release-pill ${publishReadiness?.ready ? "is-ready" : "is-blocked"}`}
              >
                {publishReadiness?.ready ? "门禁通过" : "暂不可发布"}
              </span>
            </div>
            <label className="release-note-field">
              <span>发布说明</span>
              <textarea
                value={releaseNote}
                onChange={(event) => setReleaseNote(event.target.value)}
                placeholder="说明本次数据来源、主要变更和需要关注的内容"
                rows={3}
              />
              <small>{releaseNote.trim().length} 个字符 · 会随 Revision 永久保存</small>
            </label>
            <div className="release-preview">
              <span>
                当前批次 <b>{batchId ? batchId.slice(0, 8) : "—"}</b>
              </span>
              <span>
                成功记录 <b>{batch?.successCount ?? "—"}</b>
              </span>
              <span>
                变更总数{" "}
                <b>
                  {diff
                    ? diff.added.length + diff.modified.length + diff.deletionCandidates.length
                    : "—"}
                </b>
              </span>
              <span>
                发布后任务 <b>搜索索引 + Embeddings</b>
              </span>
            </div>
            <button
              className="release-primary-button"
              disabled={!publishReadiness?.ready || !releaseNote.trim() || publishing}
              onClick={() => setReleaseConfirmOpen(true)}
            >
              {publishing ? "正在检查…" : "刷新发布状态"}
            </button>
          </section>
          <section className="admin-section release-conflicts">
            <div className="release-section-title">
              <div>
                <span className="eyebrow">CONFLICTS</span>
                <h3>冲突裁决</h3>
              </div>
              <span className={`release-pill ${conflicts.length ? "is-blocked" : "is-ready"}`}>
                {conflicts.length ? `${conflicts.length} 项待处理` : "已全部处理"}
              </span>
            </div>
            <p className="muted small verification-hint">
              裁决时请选择采用的来源观察：同版本游戏客户端原文优先于社区转储；官方公告只裁决版本或活动事实；HoYoWiki
              仅作辅助。双方原文和出处会永久保留。
            </p>
            <div className="release-conflict-list">
              {conflicts.map((conflict) => (
                <article
                  className={`release-conflict-card ${conflictDetail?.id === conflict.id ? "is-active" : ""}`}
                  key={conflict.id}
                >
                  <div>
                    <span>{conflict.kind}</span>
                    <strong>{conflict.canonicalKey}</strong>
                    <small>
                      {conflict.gameVersion} · {conflict.locale} · {conflict.observationIds.length}{" "}
                      个来源观察
                    </small>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() => void inspectConflict(conflict)}
                  >
                    对比并裁决
                  </button>
                </article>
              ))}
              {!conflicts.length && (
                <div className="release-success-message">
                  <b>没有未解决冲突</b>
                  <span>所有来源选择均已记录，双方原文和出处仍会保留。</span>
                </div>
              )}
            </div>
            {conflictDetail && (
              <div className="conflict-detail" role="region" aria-label="冲突原文详情">
                <div className="section-heading">
                  <h4>
                    {conflictDetail.canonicalKey} · {conflictDetail.kind}
                  </h4>
                  <button
                    className="secondary-button"
                    onClick={() => {
                      setConflictDetail(null);
                      setSelectedConflictObservationId("");
                      setConflictResolutionReason("");
                    }}
                  >
                    收起
                  </button>
                </div>
                {conflictDetail.observations.length > 0 && (
                  <label className="conflict-selection">
                    <span>采用的标准来源观察</span>
                    <select
                      value={
                        selectedConflictObservationId ||
                        conflictDetail.selectedObservationId ||
                        conflictDetail.observations[0]?.id ||
                        ""
                      }
                      onChange={(event) => setSelectedConflictObservationId(event.target.value)}
                    >
                      {conflictDetail.observations.map((observation, index) => (
                        <option value={observation.id} key={observation.id}>
                          {index + 1} · {observation.sourceId.slice(0, 8)} · {observation.title}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <div className="conflict-observations">
                  {conflictDetail.observations.map((observation) => (
                    <article key={observation.id} className="conflict-observation">
                      <b>来源观察 {observation.id.slice(0, 8)}</b>
                      <small>
                        source {observation.sourceId.slice(0, 8)} · snapshot{" "}
                        {observation.sourceSnapshotId.slice(0, 8)} · {observation.gameVersion} ·{" "}
                        {observation.locale}
                      </small>
                      <strong>{observation.title}</strong>
                      <pre>{observation.body}</pre>
                      <small>
                        raw {observation.rawContentHash.slice(0, 16)}… · normalized{" "}
                        {observation.normalizedContentHash.slice(0, 16)}…
                      </small>
                      {observation.provenance?.upstreamCommit && (
                        <small>
                          commit {observation.provenance.upstreamCommit} · files{" "}
                          {(observation.provenance.sourceFiles ?? []).join(", ") || "未提供"}
                        </small>
                      )}
                    </article>
                  ))}
                </div>
                <div className="conflict-resolution-form">
                  <label>
                    <span>裁决理由</span>
                    <textarea
                      value={conflictResolutionReason}
                      onChange={(event) => setConflictResolutionReason(event.target.value)}
                      placeholder="说明采用此来源的依据，例如：同版本 zh-CN 游戏客户端逐字核验"
                      rows={3}
                    />
                  </label>
                  <button
                    disabled={!selectedConflictObservationId || !conflictResolutionReason.trim()}
                    onClick={() => {
                      const conflict = conflicts.find((item) => item.id === conflictDetail.id);
                      if (conflict) void resolveConflict(conflict);
                    }}
                  >
                    记录人工裁决
                  </button>
                </div>
              </div>
            )}
          </section>
          <section className="admin-section release-history">
            <div className="release-section-title">
              <div>
                <span className="eyebrow">REVISION HISTORY</span>
                <h3>版本历史</h3>
              </div>
              <span className="muted small">{revisions.length} 个已发布版本</span>
            </div>
            <div className="revision-list">
              {revisions.map((revision) => (
                <article
                  className={`revision-row ${revision.isCurrent ? "is-current" : ""}`}
                  key={revision.id}
                >
                  <div className="revision-number">
                    <strong>r{revision.revisionNumber}</strong>
                    {revision.isCurrent && <span>当前版本</span>}
                  </div>
                  <div className="revision-copy">
                    <b>{revision.releaseNote ?? "无发布说明"}</b>
                    <small>
                      {revision.publishedAt
                        ? formatReleaseDate(revision.publishedAt)
                        : "发布时间未知"}
                      {revision.sourceBatchId
                        ? ` · 批次 ${revision.sourceBatchId.slice(0, 8)}`
                        : ""}
                    </small>
                  </div>
                  <span className={`index-status is-${revision.indexStatus}`}>
                    {releaseIndexStatusLabel(revision.indexStatus)}
                  </span>
                  {!revision.isCurrent && (
                    <button
                      className="secondary-button"
                      onClick={() => {
                        setRollbackTargetId(revision.id);
                        setRollbackReason("");
                      }}
                    >
                      回滚到此版本
                    </button>
                  )}
                </article>
              ))}
            </div>
            {!revisions.length && <p className="muted small">暂无已发布版本</p>}
          </section>
          <section className="admin-section release-jobs">
            <div className="release-section-title">
              <div>
                <span className="eyebrow">JOBS</span>
                <h3>发布后任务</h3>
              </div>
              <span className="muted small">页面刷新后仍可追踪</span>
            </div>
            <div className="job-list">
              {jobs.slice(0, 20).map((job) => (
                <div className="job-row" key={job.id}>
                  <span className="job-icon" aria-hidden="true">
                    {releaseJobIcon(job.status)}
                  </span>
                  <div>
                    <b>{releaseJobTypeLabel(job.type)}</b>
                    <small>
                      {job.id.slice(0, 8)} · 尝试 {job.attempts}
                      {job.error ? ` · ${job.error}` : ""}
                    </small>
                  </div>
                  <b className={`job-${job.status}`}>{releaseJobStatusLabel(job.status)}</b>
                </div>
              ))}
            </div>
            {!jobs.length && <p className="muted small">暂无任务</p>}
          </section>

          {releaseConfirmOpen && (
            <div className="release-dialog-backdrop" role="presentation">
              <section
                className="release-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="release-confirm-title"
              >
                <span className="eyebrow">FINAL CONFIRMATION</span>
                <h3 id="release-confirm-title">确认发布 r{nextRevisionNumber}？</h3>
                <p>系统会再次读取实时门禁，通过后立即生成 Revision 并排队重建索引。</p>
                <dl>
                  <div>
                    <dt>批次</dt>
                    <dd>{batchId.slice(0, 8)}</dd>
                  </div>
                  <div>
                    <dt>成功记录</dt>
                    <dd>{batch?.successCount ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>发布说明</dt>
                    <dd>{releaseNote}</dd>
                  </div>
                </dl>
                <div className="release-dialog-actions">
                  <button
                    className="secondary-button"
                    disabled={publishing}
                    onClick={() => setReleaseConfirmOpen(false)}
                  >
                    取消
                  </button>
                  <span className="muted small">正式版本只能由预发布 Build 晋级生成</span>
                </div>
              </section>
            </div>
          )}

          {rollbackTargetId &&
            (() => {
              const target = revisions.find((revision) => revision.id === rollbackTargetId);
              if (!target) return null;
              return (
                <div className="release-dialog-backdrop" role="presentation">
                  <section
                    className="release-dialog is-danger"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="rollback-confirm-title"
                  >
                    <span className="eyebrow">ROLLBACK</span>
                    <h3 id="rollback-confirm-title">回滚到 r{target.revisionNumber}？</h3>
                    <p>回滚会切换当前数据版本并排队重建索引。现有 Revision 不会被删除。</p>
                    <label className="release-note-field">
                      <span>回滚原因（必填）</span>
                      <textarea
                        autoFocus
                        value={rollbackReason}
                        onChange={(event) => setRollbackReason(event.target.value)}
                        placeholder="说明需要回滚的问题和后续处理计划"
                        rows={3}
                      />
                    </label>
                    <div className="release-dialog-actions">
                      <button
                        className="secondary-button"
                        disabled={Boolean(rollingBackRevisionId)}
                        onClick={() => setRollbackTargetId("")}
                      >
                        取消
                      </button>
                      <button
                        className="danger-button"
                        disabled={!rollbackReason.trim() || Boolean(rollingBackRevisionId)}
                        onClick={() => void rollback(target.id)}
                      >
                        {rollingBackRevisionId ? "正在回滚…" : "确认回滚"}
                      </button>
                    </div>
                  </section>
                </div>
              );
            })()}
        </>
      )}
    </div>
  );
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

function VerificationProvenance({
  item,
  datasetRevision,
  upstreamCommit,
}: {
  item: VerificationItem;
  datasetRevision?: string | null;
  upstreamCommit: string;
}) {
  const provenance = item.provenance;
  return (
    <details className="verification-provenance">
      <summary>查看正文与完整出处</summary>
      <div className="provenance-grid">
        <span>Dataset Revision</span>
        <b>{datasetRevision ?? "待发布"}</b>
        <span>Source Snapshot</span>
        <b>{item.sourceSnapshotId ?? "未关联"}</b>
        <span>Commit / 版本</span>
        <b>
          {provenance?.upstreamCommit ?? upstreamCommit}
          {provenance?.upstreamVersionLabel ? ` · ${provenance.upstreamVersionLabel}` : ""}
        </b>
        <span>游戏版本 / 语言</span>
        <b>
          {item.gameVersion ?? "未知"} · {item.locale ?? "未知"}
        </b>
        <span>Canonical Key</span>
        <b>{provenance?.canonicalKey ?? item.canonicalKey}</b>
        <span>上游 ID</span>
        <b>{formatProvenanceValue(provenance?.upstreamIds)}</b>
        <span>相对文件</span>
        <b>{provenance?.sourceFiles?.join(", ") || "未提供"}</b>
        <span>字段映射</span>
        <b>{formatProvenanceValue(provenance?.lineage)}</b>
        <span>TextMap Hash</span>
        <b>{formatProvenanceValue(provenance?.textMapHashes)}</b>
        <span>正文哈希</span>
        <b>
          normalized: {provenance?.normalizedContentHash ?? "未提供"}
          <br />
          raw: {provenance?.rawContentHash ?? "未提供"}
        </b>
        <span>转换步骤</span>
        <b>{provenance?.transforms?.join("；") || "未提供"}</b>
      </div>
    </details>
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
