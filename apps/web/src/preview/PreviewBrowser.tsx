import { useEffect, useState } from "react";
type Row = { sourceKey: string; title?: string; name?: string; body?: string; type?: string };
export function PreviewBrowser({
  candidateId,
  initialBuildId,
}: {
  candidateId: string;
  initialBuildId?: string;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const size = 50;
  useEffect(() => {
    const build = initialBuildId ?? candidateId;
    Promise.all([
      fetch(`/api/admin/previews/${build}/entities?limit=${size}&offset=${page * size}`).then((r) =>
        r.json(),
      ),
      fetch(`/api/admin/previews/${build}/documents?limit=${size}&offset=${page * size}`).then(
        (r) => r.json(),
      ),
    ])
      .then(([a, b]) => {
        setRows([...(a.entities ?? []), ...(b.documents ?? [])]);
        setTotal(Math.max(a.total ?? 0, b.total ?? 0));
      })
      .catch(() => setRows([]));
  }, [candidateId, initialBuildId, page]);
  return (
    <main className="app-shell preview-shell">
      <header className="preview-topbar">
        <span className="preview-badge">PREVIEW</span>
        <h1>预发布资料</h1>
      </header>
      <p className="preview-warning">此内容隔离于正式 Revision 和 MCP。</p>
      <section className="preview-workspace">
        <aside>
          <h2>
            资料列表 <small>{total} 条</small>
          </h2>
          {rows.map((r) => (
            <button className="preview-row" key={r.sourceKey}>
              <strong>{r.title ?? r.name ?? r.sourceKey}</strong>
              <small>{r.sourceKey}</small>
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
          <h2>来源与内容</h2>
          <p>选择资料查看详情并报告问题。</p>
        </article>
      </section>
    </main>
  );
}
