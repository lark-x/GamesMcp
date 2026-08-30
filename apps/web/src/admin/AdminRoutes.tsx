import { useState } from "react";
import { VersionSwitcher } from "../versions/VersionSwitcher.js";
export function AdminRoutes({ initialRoute }: { initialRoute: string }) {
  const [page, setPage] = useState(initialRoute.split("/")[1] || "intake");
  const pages = [
    ["intake", "导入"],
    ["preview", "预发布分支"],
    ["issues", "待处理问题"],
    ["history", "正式版本历史"],
  ] as const;
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
          <button
            key={id}
            className={page === id ? "active" : ""}
            onClick={() => {
              setPage(id);
              window.location.hash = `admin/${id}`;
            }}
          >
            {label}
          </button>
        ))}
      </nav>
      <section className="admin-page">
        {page === "preview" || page === "issues" ? (
          <p className="process-note">
            流程：导入 → Candidate → 不可变 Build → 检查问题 → 原子激活正式 Revision。
          </p>
        ) : null}
        <h2>{pages.find(([id]) => id === page)?.[1]}</h2>
        <p>此页面连接预发布 Candidate、Build、Issue 和正式 Revision 数据。</p>
      </section>
    </main>
  );
}
