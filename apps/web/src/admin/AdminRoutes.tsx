import { useEffect, useState } from "react";
import { VersionSwitcher } from "../versions/VersionSwitcher.js";
import { api } from "../api.js";
type Candidate = {
  id: string;
  name: string;
  status: string;
  currentBuildId?: string;
  builds?: Array<{ id: string; buildNumber: number; status: string; recordCount: number }>;
};
type Issue = {
  id: string;
  candidateId?: string;
  canonicalKey: string;
  kind: string;
  status: string;
  summary: string;
};
export function AdminRoutes({ initialRoute }: { initialRoute: string }) {
  const [page, setPage] = useState(initialRoute.split("/")[1]?.split("?")[0] || "intake");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [revisions, setRevisions] = useState<Array<Record<string, unknown>>>([]);
  const [source, setSource] = useState("");
  const [gameId, setGameId] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [message, setMessage] = useState("");
  const [issueAction, setIssueAction] = useState<Record<string, string>>({});
  const [evidence, setEvidence] = useState<File | null>(null);
  const [reason, setReason] = useState("");
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
  useEffect(() => {
    if (page !== "intake") return;
    const timer = window.setInterval(() => {
      api
        .imports()
        .then((v) => setMessage(`最近导入任务：${v.imports?.[0] ? "状态已刷新" : "暂无任务"}`))
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [page]);
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
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const created = await api.createImport({ gameId, sourceId, path: source });
                setMessage(`导入任务已创建：${created.id}`);
                setSource("");
              } catch (err) {
                setMessage(`提交失败：${(err as Error).message}`);
              }
            }}
          >
            <label>
              Game ID{" "}
              <input
                required
                value={gameId}
                onChange={(e) => setGameId(e.target.value)}
                placeholder="游戏 UUID"
              />
              Source ID{" "}
              <input
                required
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
                placeholder="来源 UUID"
              />
              来源路径{" "}
              <input
                required
                value={source}
                onChange={(e) => setSource(e.target.value)}
                placeholder="本地路径或 URL"
              />
            </label>
            <button type="submit">创建导入任务</button>
            {message && <p role="status">{message}</p>}
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

              <button
                onClick={() =>
                  api
                    .promote(c.id, { buildId: c.currentBuildId, idempotencyKey: `promote-${c.id}` })
                    .then(() => setMessage("已提交晋级"))
                    .catch((e) => setMessage(`晋级失败：${e.message}`))
                }
              >
                晋级正式版本
              </button>
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
                <select
                  aria-label={`处理动作 ${i.canonicalKey}`}
                  value={issueAction[i.id] ?? "keep_main"}
                  onChange={(e) => setIssueAction((a) => ({ ...a, [i.id]: e.target.value }))}
                >
                  <option value="keep_main">保留主版本</option>
                  <option value="use_incoming">使用导入</option>
                  <option value="manual">人工修改</option>
                  <option value="not_duplicate">非重复</option>
                  <option value="confirm_delete">确认删除</option>
                  <option value="exclude_record">排除记录</option>
                </select>
                <input
                  aria-label={`说明 ${i.canonicalKey}`}
                  placeholder="处理说明（必填）"
                  onChange={(e) =>
                    setIssueAction((a) => ({ ...a, [`${i.id}:note`]: e.target.value }))
                  }
                />
                <button
                  onClick={async () => {
                    const note = issueAction[`${i.id}:note`];
                    if (!note) {
                      setMessage("请填写处理说明");
                      return;
                    }
                    await api.resolve(i.id, issueAction[i.id] ?? "keep_main", note);
                    setIssues((all) => all.filter((x) => x.id !== i.id));
                  }}
                >
                  确认处理并生成新 Build
                </button>
                <label>
                  真实截图证据{" "}
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => setEvidence(e.target.files?.[0] ?? null)}
                  />
                </label>
                <button
                  disabled={!evidence}
                  onClick={async () => {
                    if (!evidence) return;
                    const data = await new Promise<string>((resolve) => {
                      const reader = new FileReader();
                      reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
                      reader.readAsDataURL(evidence);
                    });
                    await api.uploadEvidence(i.id, {
                      mimeType: evidence.type as "image/png",
                      dataBase64: data,
                    });
                    setMessage("证据已上传");
                  }}
                >
                  上传证据
                </button>
                <button
                  disabled={!i.candidateId}
                  onClick={() =>
                    i.candidateId &&
                    api
                      .createPatch(i.candidateId, {
                        issueId: i.id,
                        kind: "manual",
                        note: issueAction[`${i.id}:note`] ?? "",
                      })
                      .then(() => setMessage("已创建 Patch，下一次 Build 将自动生成"))
                      .catch((e) => setMessage(`创建 Patch 失败：${e.message}`))
                  }
                >
                  创建 Patch 并生成 Build N+1
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
              <input
                aria-label={`回滚原因 ${String(r.id ?? i)}`}
                placeholder="回滚原因（必填）"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <button
                disabled={!reason.trim()}
                onClick={() =>
                  api
                    .rollback(String(r.id), reason)
                    .then(() => setMessage("已提交带原因回滚"))
                    .catch((e) => setMessage(`回滚失败：${e.message}`))
                }
              >
                带原因回滚
              </button>
            </article>
          ))}
        </section>
      )}
    </main>
  );
}
