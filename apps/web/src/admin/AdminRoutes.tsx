import { useEffect, useState } from "react";
import { VersionSwitcher } from "../versions/VersionSwitcher.js";
type Candidate = {
  id: string;
  name: string;
  status: string;
  currentBuildId?: string;
  builds?: Array<{ id: string; buildNumber: number; status: string; recordCount: number }>;
};
type Issue = { id: string; canonicalKey: string; kind: string; status: string; summary: string };
export function AdminRoutes({ initialRoute }: { initialRoute: string }) {
  const [page, setPage] = useState(initialRoute.split("/")[1]?.split("?")[0] || "intake");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [revisions, setRevisions] = useState<Array<Record<string, unknown>>>([]);
  useEffect(() => {
    fetch("/api/admin/release-candidates")
      .then((r) => r.json())
      .then((v) => setCandidates(v.candidates ?? []))
      .catch(() => undefined);
    fetch("/api/admin/review-issues")
      .then((r) => r.json())
      .then((v) => setIssues(v.issues ?? []))
      .catch(() => undefined);
    fetch("/api/admin/revisions")
      .then((r) => r.json())
      .then((v) => setRevisions(v.revisions ?? []))
      .catch(() => undefined);
  }, []);
  const pages = [
    ["intake", "导入"],
    ["preview", "预发布分支"],
    ["issues", "待处理问题"],
    ["history", "正式版本历史"],
  ] as const;
  const go = (id: string) => {
    setPage(id);
    window.location.hash = `admin/${id}`;
  };
  return (
    <main className="app-shell admin-shell">
      <header className="topbar">
        <h1>管理后台</h1>
        <VersionSwitcher
          onPreview={(id) => {
            window.location.hash = `preview/${id}`;
          }}
        />
      </header>
      <nav className="admin-nav">
        {pages.map(([id, label]) => (
          <button key={id} className={page === id ? "active" : ""} onClick={() => go(id)}>
            {label}
          </button>
        ))}
      </nav>
      {page === "preview" || page === "issues" ? (
        <p className="process-note">
          流程：导入 → Candidate → Build → 检查问题 → 原子激活正式 Revision。
        </p>
      ) : null}
      {page === "intake" && (
        <section className="admin-page">
          <h2>导入</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
            }}
          >
            <label>
              来源路径 <input required placeholder="合法公开资料路径或 URL" />
            </label>
            <button type="submit">创建导入任务</button>
          </form>
          <p>导入完成后 Worker 会自动聚合 Candidate 并生成 Build。</p>
        </section>
      )}
      {page === "preview" && (
        <section className="admin-page">
          <h2>预发布分支</h2>
          {candidates.map((c) => (
            <article key={c.id}>
              <h3>
                {c.name} · {c.status}
              </h3>
              {c.builds?.map((b) => (
                <p key={b.id}>
                  Build {b.buildNumber} · {b.status} · {b.recordCount} 条{" "}
                  <button
                    onClick={() => {
                      window.location.hash = `preview/${c.id}/${b.id}`;
                    }}
                  >
                    预览
                  </button>
                </p>
              ))}
            </article>
          ))}
        </section>
      )}
      {page === "issues" && (
        <section className="admin-page">
          <h2>待处理问题</h2>
          {issues.length ? (
            issues.map((i) => (
              <article key={i.id}>
                <strong>
                  {i.kind} · {i.canonicalKey}
                </strong>
                <p>
                  {i.summary} · {i.status}
                </p>
                <button
                  onClick={() =>
                    fetch(`/api/admin/review-issues/${i.id}/resolve`, { method: "POST" }).then(() =>
                      setIssues((all) => all.filter((x) => x.id !== i.id)),
                    )
                  }
                >
                  处理问题
                </button>
              </article>
            ))
          ) : (
            <p>当前没有待处理问题。</p>
          )}
        </section>
      )}
      {page === "history" && (
        <section className="admin-page">
          <h2>正式版本历史</h2>
          {revisions.map((r, i) => (
            <article key={String(r.id ?? i)}>
              <strong>{String(r.version ?? r.id ?? "Revision")}</strong>
              <p>
                {String(r.releaseNote ?? "")} · Manifest {String(r.manifestId ?? "—")}
              </p>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
