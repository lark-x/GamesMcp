import type { ReactNode } from "react";

/**
 * Common three-pane archive shell. Catalog / inspector are optional so the
 * same frame serves story, material, and text browsers.
 */
export function ArchiveLayout({
  globalNav,
  catalog,
  main,
  inspector,
  wide = false,
  noCatalog = false,
}: {
  globalNav?: ReactNode;
  catalog?: ReactNode;
  main: ReactNode;
  inspector?: ReactNode;
  /** Material layout stacks list+detail in main; give it extra room. */
  wide?: boolean;
  noCatalog?: boolean;
}) {
  const frameClasses = [
    "archive-frame",
    wide ? "archive-frame-wide" : "",
    !globalNav ? "archive-frame-no-globalnav" : "",
    noCatalog || !catalog ? "archive-frame-no-catalog" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={frameClasses}>
      {globalNav ? (
        <nav className="archive-globalnav" aria-label="全局主导航">
          {globalNav}
        </nav>
      ) : null}
      {catalog ? (
        <aside className="archive-catalog" aria-label="目录">
          {catalog}
        </aside>
      ) : null}
      <main className="archive-main" aria-label="正文内容">
        {main}
      </main>
      {inspector ? (
        <aside className="archive-inspector" aria-label="详情信息">
          {inspector}
        </aside>
      ) : null}
    </div>
  );
}
