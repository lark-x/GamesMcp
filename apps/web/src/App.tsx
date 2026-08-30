import { useEffect, useState } from "react";
import { AdminRoutes } from "./admin/AdminRoutes.js";
import { PreviewBrowser } from "./preview/PreviewBrowser.js";
import { VersionSwitcher } from "./versions/VersionSwitcher.js";

export function App() {
  const [route, setRoute] = useState(() => window.location.hash.slice(1));
  useEffect(() => {
    const update = () => setRoute(window.location.hash.slice(1));
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  const preview = route.match(/^preview\/([^/]+)(?:\/([^/]+))?/);
  if (preview) return <PreviewBrowser candidateId={preview[1]} initialBuildId={preview[2]} />;
  if (route.startsWith("admin")) return <AdminRoutes initialRoute={route} />;
  return (
    <main className="app-shell public-shell">
      <header className="topbar">
        <h1>Game Intelligence</h1>
        <VersionSwitcher
          onPreview={(id) => {
            window.location.hash = `preview/${id}`;
          }}
        />
      </header>
      <section className="hero">
        <span className="eyebrow">CURRENT REVISION</span>
        <h2>探索已发布的游戏资料</h2>
        <p>正式内容通过不可变 Manifest 和索引后公开。预发布内容始终隔离并持续标记 PREVIEW。</p>
      </section>
    </main>
  );
}
