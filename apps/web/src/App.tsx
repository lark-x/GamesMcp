import { useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
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
  VerificationItem,
  VerificationRun,
  VerificationChannel,
  VerificationStatus,
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
  releaseNote?: string | null;
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

export function App() {
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
  const [busy, setBusy] = useState(false);
  const [adminOpen, setAdminOpen] = useState(false);
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
    setSearch(null);
    setEntity(null);
    setDocument(null);
    setAnswer(null);
    setActiveSegmentId(undefined);
    setSourceId("");
    const load = async () => {
      const [ready, documents, entities, sources] = await Promise.all([
        api<Overview["ready"]>("/api/ready").catch(() => null),
        api<{ documents: DocumentSummary[] }>(
          `/api/games/${gameId}/documents?limit=6&offset=0`,
        ).catch(() => ({ documents: [] })),
        api<{ entities: EntitySummary[] }>(`/api/games/${gameId}/entities?limit=6&offset=0`).catch(
          () => ({ entities: [] }),
        ),
        api<Pick<Overview, "sources">>(`/api/games/${gameId}/sources`).catch(() => ({
          sources: [],
        })),
      ]);
      if (!cancelled)
        setOverview({
          ready,
          documents: documents.documents,
          entities: entities.entities,
          sources: sources.sources,
        });
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  const currentGame = useMemo(() => games.find((game) => game.id === gameId), [games, gameId]);

  function clearError() {
    setError("");
  }

  async function runSearch(event: FormEvent) {
    event.preventDefault();
    if (!gameId || !query.trim()) return;
    setError("");
    setBusy(true);
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
      setBusy(false);
    }
  }

  async function openEntity(id: string, revisionId?: string) {
    if (!gameId) return;
    setError("");
    setBusy(true);
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
      setBusy(false);
    }
  }

  async function openDocument(id: string, revisionId?: string, segmentId?: string) {
    if (!gameId) return;
    setError("");
    setBusy(true);
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
      setBusy(false);
    }
  }

  function openCitation(citation: Citation) {
    void openDocument(citation.documentId, undefined, citation.segmentId);
  }

  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!gameId || !question.trim()) return;
    setError("");
    setBusy(true);
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
      setBusy(false);
    }
  }

  function toggleType(type: "entity" | "document" | "segment") {
    setTypes((current) =>
      current.includes(type) ? current.filter((item) => item !== type) : [...current, type],
    );
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <span className="eyebrow">GAME INTELLIGENCE PLATFORM</span>
          <h1>原神叙事知识库</h1>
        </div>
        <div className="game-picker">
          <label htmlFor="game">当前游戏</label>
          <select id="game" value={gameId} onChange={(event) => setGameId(event.target.value)}>
            {games.map((game) => (
              <option key={game.id} value={game.id}>
                {game.name} · {game.currentRevision ?? "未发布"}
              </option>
            ))}
          </select>
        </div>
      </header>
      <main>
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button onClick={clearError}>关闭</button>
          </div>
        )}
        <section className="hero-card">
          <div>
            <span className="eyebrow">EVIDENCE-FIRST LORE SEARCH</span>
            <h2>从原文出发，查清一个名字、一段剧情或一条关系。</h2>
            <p>结果带有命中原因、来源和数据版本；问答只引用可定位的片段，没有证据时会明确拒答。</p>
          </div>
          <form className="search-form" onSubmit={runSearch}>
            <input
              aria-label="搜索知识库"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索角色、任务、地区或剧情关键词"
            />
            <button type="submit" disabled={busy || !gameId}>
              检索
            </button>
          </form>
        </section>

        <section className="overview-grid" aria-label="知识库概览">
          <OverviewCard
            label="当前版本"
            value={overview.ready?.currentRevision ?? currentGame?.currentRevision ?? "未发布"}
          />
          <OverviewCard label="索引状态" value={overview.ready?.searchIndex ?? "检查中"} />
          <OverviewCard label="最近文档" value={`${overview.documents.length} 篇`} />
          <OverviewCard label="常用实体" value={`${overview.entities.length} 个`} />
        </section>

        <section className="panel filters-panel">
          <div className="panel-title">
            <div>
              <span className="eyebrow">SEARCH SCOPE</span>
              <h2>检索范围与过滤</h2>
            </div>
            <span className="muted small">命中类型可多选</span>
          </div>
          <div className="filter-row">
            {(["entity", "document", "segment"] as const).map((type) => (
              <label className="check-chip" key={type}>
                <input
                  type="checkbox"
                  checked={types.includes(type)}
                  onChange={() => toggleType(type)}
                />
                {type === "entity" ? "实体" : type === "document" ? "文档" : "片段"}
              </label>
            ))}
            <select
              aria-label="实体类型"
              value={entityType}
              onChange={(event) => setEntityType(event.target.value)}
            >
              <option value="">全部实体类型</option>
              <option value="character">角色</option>
              <option value="faction">阵营</option>
              <option value="region">地区</option>
              <option value="location">地点</option>
              <option value="quest">任务</option>
              <option value="concept">概念</option>
            </select>
            <select
              aria-label="文档类型"
              value={documentType}
              onChange={(event) => setDocumentType(event.target.value)}
            >
              <option value="">全部文档类型</option>
              <option value="lore">设定</option>
              <option value="archon_quest">魔神任务</option>
              <option value="story_quest">传说任务</option>
              <option value="world_quest">世界任务</option>
              <option value="book">书籍</option>
            </select>
            <input
              aria-label="游戏版本过滤"
              value={gameVersion}
              onChange={(event) => setGameVersion(event.target.value)}
              placeholder="游戏版本，例如 5.0"
            />
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
          </div>
        </section>

        <div className="content-grid">
          <section className="panel results-panel">
            <div className="panel-title">
              <h2>检索结果</h2>
              {search && (
                <span>
                  {search.revision || "暂无版本"} · {search.indexStatus}
                </span>
              )}
            </div>
            {!search && (
              <div className="result-empty">
                <p className="muted">输入关键词开始检索。</p>
                <div className="quick-links">
                  {overview.entities.slice(0, 4).map((item) => (
                    <button
                      key={item.id}
                      className="quick-link"
                      onClick={() => openEntity(item.id)}
                    >
                      {item.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {search && (
              <>
                <ResultGroup title="实体" count={search.entities.length}>
                  {search.entities.map((item) => (
                    <button
                      className="result-item"
                      key={item.id}
                      onClick={() => openEntity(item.id, search.revisionId)}
                    >
                      <strong>{item.name}</strong>
                      <span>
                        {item.type} · {item.match ?? "相关"} · {item.aliases.join("、") || "无别名"}
                      </span>
                      <small>
                        {item.sourceKey ?? "无来源键"} · Dataset Revision{" "}
                        {item.revision ?? search.revision}
                      </small>
                    </button>
                  ))}
                </ResultGroup>
                <ResultGroup title="文档" count={search.documents.length}>
                  {search.documents.map((item) => (
                    <button
                      className="result-item"
                      key={item.id}
                      onClick={() => openDocument(item.id, search.revisionId)}
                    >
                      <strong>{item.title}</strong>
                      <span>
                        {item.type} · {item.match ?? "相关"} · {item.gameVersion ?? "版本未知"}
                      </span>
                      <small>
                        {item.sourceKey ?? "无来源键"} · source version {item.sourceVersion ?? "—"}{" "}
                        · Dataset Revision {item.revision ?? search.revision}
                      </small>
                    </button>
                  ))}
                </ResultGroup>
                <ResultGroup title="片段" count={search.segments.length}>
                  {search.segments.map((item) => (
                    <button
                      className="result-item"
                      key={item.segmentId}
                      onClick={() => openDocument(item.id, search.revisionId, item.segmentId)}
                    >
                      <strong>{item.title}</strong>
                      <span>{item.snippet}</span>
                      <small>
                        {item.match ?? "相关"} · source version {item.sourceVersion ?? "—"} ·{" "}
                        Dataset Revision {item.revision ?? search.revision}
                      </small>
                    </button>
                  ))}
                </ResultGroup>
              </>
            )}
          </section>
          <section className="panel detail-panel">
            {entity ? (
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
                <h2>选择一个结果</h2>
                <p>实体页展示关系、文档和主张；文档页支持片段级引用、复制和实体跳转。</p>
              </div>
            )}
          </section>
        </div>

        <section className="panel home-lists">
          <div className="home-list">
            <div className="panel-title">
              <h2>最近文档</h2>
              <span>已发布版本</span>
            </div>
            {overview.documents.map((item) => (
              <button className="link-row" key={item.id} onClick={() => openDocument(item.id)}>
                {item.title}
                <span>
                  {item.type} · {item.gameVersion ?? "版本未知"}
                </span>
              </button>
            ))}
            {!overview.documents.length && <p className="muted small">暂无文档</p>}
          </div>
          <div className="home-list">
            <div className="panel-title">
              <h2>常用实体</h2>
              <span>可进入详情</span>
            </div>
            {overview.entities.map((item) => (
              <button className="link-row" key={item.id} onClick={() => openEntity(item.id)}>
                {item.name}
                <span>
                  {item.type} · {item.aliases.join("、") || "无别名"}
                </span>
              </button>
            ))}
            {!overview.entities.length && <p className="muted small">暂无实体</p>}
          </div>
        </section>

        <section className="panel qa-panel">
          <div className="panel-title">
            <div>
              <span className="eyebrow">EVIDENCE QA</span>
              <h2>向知识库提问</h2>
            </div>
            <span className="muted">答案不会写回正式知识库</span>
          </div>
          <form className="qa-form" onSubmit={ask}>
            <textarea
              aria-label="问答问题"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="例如：某角色与某阵营有什么关系？"
              rows={2}
            />
            <button type="submit" disabled={busy || !gameId}>
              基于证据回答
            </button>
          </form>
          {answer && <AnswerView answer={answer} onCitation={openCitation} onEntity={openEntity} />}
        </section>

        <section className="admin-toggle">
          <button className="secondary-button" onClick={() => setAdminOpen((value) => !value)}>
            {adminOpen ? "收起数据管理" : "打开数据管理"}
          </button>
          {adminOpen && gameId && <AdminPanel gameId={gameId} />}
        </section>
      </main>
      <footer>
        当前部署：{currentGame?.name ?? "加载中"} · 私有本地知识库 · Dataset Revision 由审核后发布
      </footer>
    </div>
  );
}

function OverviewCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="overview-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ResultGroup({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: ReactNode;
}) {
  return (
    <div className="result-group">
      <div className="group-heading">
        <h3>{title}</h3>
        <span>{count}</span>
      </div>
      {count ? children : <p className="muted small">没有匹配结果</p>}
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
        <span className="type-pill">{entity.type}</span>
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
      <h3>结构化属性</h3>
      <pre className="properties-box">{JSON.stringify(entity.properties, null, 2)}</pre>
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
              {doc.type} · {doc.gameVersion ?? "版本未知"}
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
        <span className="type-pill">{document.type}</span>
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

async function copyCitationText(document: DocumentDetail, segmentId: string, body: string) {
  const text = `[Dataset Revision ${document.revision}] ${document.title} (${document.sourceName}) · source version ${document.sourceVersion ?? "—"} · segment ${segmentId}\n${body}`;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard permissions are optional in local deployments.
  }
}

function AdminPanel({ gameId }: { gameId: string }) {
  const [sources, setSources] = useState<AdminSource[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [path, setPath] = useState("");
  const [type, setType] = useState("local_directory");
  const [name, setName] = useState("本地原神资料");
  const [adminToken, setAdminToken] = useState("");
  const [status, setStatus] = useState("");
  const [batchId, setBatchId] = useState("");
  const [batches, setBatches] = useState<AdminBatch[]>([]);
  const [batch, setBatch] = useState<AdminBatch | null>(null);
  const [diff, setDiff] = useState<ImportDiff | null>(null);
  const [selectedDeletions, setSelectedDeletions] = useState<string[]>([]);
  const [releaseNote, setReleaseNote] = useState("Web 管理界面发布");
  const [rollbackReason, setRollbackReason] = useState("Web 管理界面回滚");
  const [revisions, setRevisions] = useState<AdminRevision[]>([]);
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [verification, setVerification] = useState<VerificationRun | null>(null);
  const [conflicts, setConflicts] = useState<ConflictCase[]>([]);
  const [conflictDetail, setConflictDetail] = useState<ConflictDetail | null>(null);
  const [selectedConflictObservationId, setSelectedConflictObservationId] = useState("");
  const [acquisitionStatus, setAcquisitionStatus] = useState<AcquisitionStatus | null>(null);
  const verificationSummary = useMemo(() => {
    if (!verification) return [];
    const labels: Record<VerificationItem["category"], string> = {
      book: "书籍",
      character_story: "角色故事",
      item_description: "物品描述",
    };
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
      return { category, label: labels[category], total: items.length, exact, pending };
    });
  }, [verification]);

  async function refreshAdmin() {
    try {
      const [
        sourceResponse,
        revisionResponse,
        jobResponse,
        conflictResponse,
        importsResponse,
        statusResponse,
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
      ]);
      setSources(sourceResponse.sources);
      setRevisions(revisionResponse.revisions);
      setJobs(jobResponse.jobs);
      setConflicts(conflictResponse.conflicts);
      setBatches(importsResponse.imports);
      setAcquisitionStatus(statusResponse?.status ?? null);
      if (!sourceId && sourceResponse.sources[0]) setSourceId(sourceResponse.sources[0].id);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "管理数据加载失败");
    }
  }

  useEffect(() => {
    void refreshAdmin();
  }, [gameId]);

  useEffect(() => {
    if (!batchId || !batch || !["pending", "running"].includes(batch.status)) return;
    const timer = window.setInterval(() => void refreshBatch(false), 1_500);
    return () => window.clearInterval(timer);
  }, [batchId, batch?.status]);

  async function createSourceAndImport(event: FormEvent) {
    event.preventDefault();
    if (!path.trim()) return;
    setStatus("正在创建快照并生成 Diff…");
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
      setStatus(`导入批次 ${nextBatch.id}：${nextBatch.status}`);
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
          `/api/admin/imports/${selectedBatchId}/diff`,
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
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "核验状态提交失败");
    }
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
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "截图上传失败");
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
    const resolution = window.prompt(
      "请输入裁决理由；请按来源政策选择正式客户端观察，双方原始观察会继续保留",
    );
    if (!resolution?.trim()) return;
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
    try {
      const revision = await api<AdminRevision>(
        `/api/admin/imports/${batchId}/publish`,
        {
          method: "POST",
          body: JSON.stringify({ releaseNote }),
        },
        adminToken,
      );
      setStatus(`发布成功：r${revision.revisionNumber}，索引任务已排队`);
      await refreshAdmin();
      await refreshBatch(false);
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "发布失败");
    }
  }

  async function rollback(revisionId: string) {
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
      await refreshAdmin();
    } catch (reason) {
      setStatus(reason instanceof Error ? reason.message : "回滚失败");
    }
  }

  function downloadVerificationChecklist() {
    if (!verification) return;
    const blob = new Blob([JSON.stringify(verification, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `verification-${verification.batchId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
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
      {acquisitionStatus && (
        <AcquisitionStatusPanel
          status={acquisitionStatus}
          stale={reportMayBeStale(acquisitionStatus, batches)}
        />
      )}
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
        <button type="submit">导入并生成 Diff</button>
      </form>
      {status && (
        <p className="status-line" role="status">
          {status}
        </p>
      )}
      {batch && (
        <section className="admin-section">
          <div className="section-heading">
            <h3>当前批次</h3>
            <button className="secondary-button" onClick={() => void refreshBatch()}>
              刷新批次
            </button>
          </div>
          <p className="muted small">
            {batch.id} · {batch.status} · 成功 {batch.successCount} · 失败 {batch.failureCount}
          </p>
          {batch.errors.length > 0 && (
            <div className="admin-errors">
              {batch.errors.map((item) => (
                <span key={`${item.code}-${item.message}`}>
                  ✕ {item.code}: {item.message}
                </span>
              ))}
            </div>
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
          <div className="admin-actions">
            <button onClick={() => void review()}>审核当前 Diff</button>
            <input
              value={releaseNote}
              onChange={(event) => setReleaseNote(event.target.value)}
              placeholder="发布说明"
            />
            <button onClick={() => void publish()}>发布版本</button>
          </div>
        </section>
      )}
      <label className="batch-picker">
        选择已有导入批次
        <select
          value={batchId}
          onChange={(event) => {
            const nextId = event.target.value;
            setBatchId(nextId);
            setSelectedDeletions([]);
            if (nextId) void refreshBatch(true, nextId);
            else {
              setBatch(null);
              setDiff(null);
              setVerification(null);
            }
          }}
        >
          <option value="">请选择批次</option>
          {batches.map((item) => (
            <option value={item.id} key={item.id}>
              {item.id.slice(0, 8)} · {item.status} · {item.successCount} 条
            </option>
          ))}
        </select>
      </label>
      {verification && (
        <section className="admin-section">
          <div className="section-heading">
            <div>
              <h3>游戏内核验台</h3>
              <span className="muted small">
                {verification.expectedGameVersion} · {verification.expectedLocale} ·{" "}
                {verification.status}
              </span>
            </div>
            <button className="secondary-button" onClick={downloadVerificationChecklist}>
              导出核验清单
            </button>
          </div>
          <div className="verification-summary" aria-label="核验门禁进度">
            {verificationSummary.map((summary) => (
              <div className="verification-summary-card" key={summary.category}>
                <b>{summary.label}</b>
                <span>
                  游戏内逐字一致 {summary.exact}/10 · 当前样本 {summary.total}
                </span>
                <small>{summary.pending} 条待处理</small>
              </div>
            ))}
          </div>
          <p className="muted small verification-hint">
            “尚未解锁”会自动补抽同类别替代记录；内容不一致、版本不一致和未解锁项必须上传截图。
          </p>
          <div className="verification-list">
            {verification.items.map((item) => (
              <div className="verification-row" key={item.id}>
                <span>
                  {item.category} · {item.title}
                </span>
                <small>
                  {item.canonicalKey} · 截图 {item.screenshotCount}
                </small>
                <select
                  value={item.status}
                  aria-label={`${item.canonicalKey}核验状态`}
                  onChange={(event) =>
                    void updateVerification(
                      item,
                      event.target.value as VerificationStatus,
                      item.channel ?? "game_client",
                    )
                  }
                >
                  <option value="not_checked">未核验</option>
                  <option value="exact_match">逐字一致</option>
                  <option value="formatting_only">仅格式差异</option>
                  <option value="mismatch">内容不一致</option>
                  <option value="unavailable_due_unlock">尚未解锁</option>
                  <option value="version_mismatch">版本不一致</option>
                </select>
                <select
                  value={item.channel ?? "game_client"}
                  aria-label={`${item.canonicalKey}核验渠道`}
                  onChange={(event) =>
                    void updateVerification(
                      item,
                      item.status,
                      event.target.value as VerificationChannel,
                    )
                  }
                >
                  <option value="game_client">游戏客户端</option>
                  <option value="hoyowiki">HoYoWiki 辅助</option>
                </select>
                <label className="verification-meta-field">
                  <span>核验版本</span>
                  <input
                    defaultValue={item.checkedGameVersion ?? verification.expectedGameVersion}
                    aria-label={`${item.canonicalKey}核验版本`}
                    placeholder="例如 7.0.0"
                    onBlur={(event) =>
                      void updateVerification(
                        item,
                        item.status,
                        item.channel ?? "game_client",
                        item.note ?? "",
                        event.target.value,
                        item.checkedLocale ?? verification.expectedLocale,
                      )
                    }
                  />
                </label>
                <label className="verification-meta-field">
                  <span>核验语言</span>
                  <input
                    defaultValue={item.checkedLocale ?? verification.expectedLocale}
                    aria-label={`${item.canonicalKey}核验语言`}
                    placeholder="例如 zh-CN"
                    onBlur={(event) =>
                      void updateVerification(
                        item,
                        item.status,
                        item.channel ?? "game_client",
                        item.note ?? "",
                        item.checkedGameVersion ?? verification.expectedGameVersion,
                        event.target.value,
                      )
                    }
                  />
                </label>
                <input
                  defaultValue={item.note ?? ""}
                  aria-label={`${item.canonicalKey}核验备注`}
                  placeholder="备注（可选）"
                  onBlur={(event) =>
                    void updateVerification(
                      item,
                      item.status,
                      item.channel ?? "game_client",
                      event.target.value,
                    )
                  }
                />
                <label className="secondary-button screenshot-button">
                  上传截图
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(event) => void uploadScreenshot(item, event.target.files?.[0])}
                  />
                </label>
                <VerificationProvenance
                  item={item}
                  datasetRevision={verification.datasetRevision}
                  upstreamCommit={verification.upstreamCommit}
                />
              </div>
            ))}
          </div>
        </section>
      )}
      <section className="admin-section">
        <div className="section-heading">
          <h3>待裁决冲突</h3>
          <span className="muted small">{conflicts.length} 项会阻止发布</span>
        </div>
        <p className="muted small verification-hint">
          裁决时请选择采用的来源观察：同版本游戏客户端原文优先于社区转储；官方公告只裁决版本或活动事实；HoYoWiki
          仅作辅助。双方原文和出处会永久保留。
        </p>
        <div className="verification-list">
          {conflicts.map((conflict) => (
            <div className="verification-row" key={conflict.id}>
              <span>{conflict.canonicalKey}</span>
              <small>
                {conflict.kind} · {conflict.gameVersion} · {conflict.locale} ·{" "}
                {conflict.observationIds.length} 个来源观察
              </small>
              <button className="secondary-button" onClick={() => void inspectConflict(conflict)}>
                查看原文
              </button>
              <button className="secondary-button" onClick={() => void resolveConflict(conflict)}>
                记录人工裁决
              </button>
            </div>
          ))}
          {!conflicts.length && <p className="muted small">没有未解决冲突</p>}
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
          </div>
        )}
      </section>
      <section className="admin-section">
        <div className="section-heading">
          <h3>Dataset Revisions</h3>
          <input
            value={rollbackReason}
            onChange={(event) => setRollbackReason(event.target.value)}
            placeholder="回滚原因"
          />
        </div>
        <div className="revision-list">
          {revisions.map((revision) => (
            <div className="revision-row" key={revision.id}>
              <span>
                r{revision.revisionNumber} · {revision.indexStatus}
              </span>
              <small>{revision.releaseNote ?? "无发布说明"}</small>
              {revision.isCurrent ? (
                <b>当前</b>
              ) : (
                <button className="secondary-button" onClick={() => void rollback(revision.id)}>
                  回滚到此版本
                </button>
              )}
            </div>
          ))}
        </div>
        {!revisions.length && <p className="muted small">暂无已发布版本</p>}
      </section>
      <section className="admin-section">
        <div className="section-heading">
          <h3>后台任务</h3>
          <span className="muted small">任务保存在 PostgreSQL，页面刷新后仍可查看</span>
        </div>
        <div className="job-list">
          {jobs.slice(0, 20).map((job) => (
            <div className="job-row" key={job.id}>
              <span>{job.type}</span>
              <b className={`job-${job.status}`}>{job.status}</b>
              <small>
                尝试 {job.attempts}
                {job.error ? ` · ${job.error}` : ""}
              </small>
            </div>
          ))}
        </div>
        {!jobs.length && <p className="muted small">暂无任务</p>}
      </section>
    </div>
  );
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
      <div className="verification-body-block">
        <span>当前导入正文</span>
        <pre>{item.body ?? "来源观察未提供正文"}</pre>
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
  return (
    <div>
      <h4>{title}</h4>
      {values.length ? (
        <ul className="key-list">
          {values.map((value) => (
            <li key={value}>{value}</li>
          ))}
        </ul>
      ) : (
        <p className="muted small">无</p>
      )}
    </div>
  );
}
