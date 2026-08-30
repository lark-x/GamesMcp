import { useEffect, useState } from "react";
type RecordRow = {
  sourceKey: string;
  displayKind: "entity" | "document";
  type: string;
  title: string;
  body: string;
  metadata: Record<string, unknown>;
  contentHash: string;
  parserVersion: string;
};
type Candidate = {
  id: string;
  name: string;
  status: string;
  currentBuildId?: string | null;
  builds: Array<{ id: string; buildNumber: number; status: string; recordCount: number }>;
};
export function PreviewBrowser({
  candidateId,
  initialBuildId,
}: {
  candidateId: string;
  initialBuildId?: string;
}) {
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [buildId, setBuildId] = useState(initialBuildId ?? "");
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [selected, setSelected] = useState<RecordRow | null>(null);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "entity" | "document">("all");
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const size = 50;
  useEffect(() => {
    setLoading(true); setError(""); fetch(`/api/admin/release-candidates/${candidateId}`)
      .then((r) => r.json())
      .then((v) => {
        const c = v.candidate ?? v;
        setCandidate(c);
        setBuildId(initialBuildId ?? c.currentBuildId ?? c.builds?.[0]?.id ?? "");
      }).catch(e=>setError(e.message)).finally(()=>setLoading(false));
  }, [candidateId, initialBuildId]);
  useEffect(() => {
    if (!buildId) return;
    const params = new URLSearchParams({ limit: String(size), offset: String(page * size), kind });
    if (query) params.set("q", query);
    setLoading(true); setError(""); fetch(`/api/admin/previews/${buildId}/records?${params}`)
      .then((r) => r.json())
      .then((v) => {
        setRows(v.records ?? []);
        setTotal(v.total ?? 0);
        setSelected(v.records?.[0] ?? null);
      }).catch(e=>setError(e.message)).finally(()=>setLoading(false));
  }, [buildId, kind, page, query]);
  const updateUrl = (next: string) => {
    setBuildId(next);
    setPage(0);
    window.history.replaceState(null, "", `#preview/${candidateId}/${next}`);
  };
  const report = async () => {
    if (!selected) return;
    await fetch("/api/admin/review-issues", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        candidateId,
        buildId,
        canonicalKey: selected.sourceKey,
        title: selected.title,
      }),
    });
    window.location.hash = `admin/issues?candidateId=${candidateId}&buildId=${buildId}&canonicalKey=${encodeURIComponent(selected.sourceKey)}`;
  };
  return (
    <main className="app-shell preview-shell">
      <header className="preview-topbar">
        <span className="preview-badge">PREVIEW</span>
        <h1>{candidate?.name ?? "预发布"}</h1>
        <button
          onClick={() => {
            window.location.hash = "admin/preview";
          }}
        >
          返回预发布分支
        </button>
      </header>
      <p className="preview-warning">预发布数据与正式 Revision、MCP 完全隔离。</p>
      <section className="preview-version-bar">
        <label>
          Candidate{" "}
          <select value={candidateId} onChange={e=>{window.location.hash=`preview/${e.target.value}`;}}>
            <option value={candidateId}>{candidate?.name ?? candidateId}</option>
          </select>
        </label>
        <label>
          Build{" "}
          <select value={buildId} onChange={(e) => updateUrl(e.target.value)}>
            {candidate?.builds?.map((b) => (
              <option key={b.id} value={b.id}>
                Build {b.buildNumber} · {b.status} · {b.recordCount} 条
              </option>
            ))}
          </select>
        </label>
      </section>
      <section className="preview-workspace">
        <aside>
          <input
            aria-label="搜索预发布资料"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
            placeholder="搜索标题、正文或 key"
          />
          <div>
            {(["all", "entity", "document"] as const).map((v) => (
              <button
                key={v}
                className={kind === v ? "active" : ""}
                onClick={() => {
                  setKind(v);
                  setPage(0);
                }}
              >
                {v === "all" ? "全部" : v === "entity" ? "实体" : "文档"}
              </button>
            ))}
          </div>
          <h2>
            资料列表 <small>{total} 条</small>
          </h2>
          {loading && <p role="status">加载中…</p>}{error && <p role="alert">加载失败：{error}</p>}{!loading && !error && !rows.length && <p>暂无匹配记录。</p>}{rows.map((r) => (
            <button className="preview-row" key={r.sourceKey} onClick={() => setSelected(r)}>
              <strong>{r.title}</strong>
              <small>
                {r.displayKind} · {r.sourceKey}
              </small>
            </button>
          ))}
          <nav className="preview-pagination">
            <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
              上一页
            </button>
            <span>
              {total
                ? `${page * size + 1}–${Math.min((page + 1) * size, total)} / ${total}`
                : "0 / 0"}
            </span>
            <button disabled={(page + 1) * size >= total} onClick={() => setPage((p) => p + 1)}>
              下一页
            </button>
          </nav>
        </aside>
        <article>
          {selected ? (
            <>
              <h2>{selected.title}</h2>
              <p>{selected.body}</p>
              <details>
                <summary>来源与技术信息</summary>
                <p>
                  source key: {selected.sourceKey}
                  <br />
                  hash: {selected.contentHash}
                  <br />
                  parser: {selected.parserVersion}
                </p>
              </details>
              <button onClick={() => void report()}>报告问题</button>
            </>
          ) : (
            <p>该 Build 暂无记录。</p>
          )}
        </article>
      </section>
    </main>
  );
}
