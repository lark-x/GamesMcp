import { ArchiveAvatar } from "./ArchiveAvatar.js";
import type { ArchiveSection } from "./archive.types.js";

export type GlobalNavSection = {
  label: string;
  items: Array<{
    key: string;
    label: string;
    active?: boolean;
    onSelect: () => void;
  }>;
};

export function ArchiveGlobalNav({
  gameLabel = "GamesMcp",
  revisionLabel = "published",
  sections,
  activeSection,
}: {
  gameLabel?: string;
  revisionLabel?: string;
  sections?: GlobalNavSection[];
  activeSection?: ArchiveSection;
}) {
  const defaultSections: GlobalNavSection[] = [
    {
      label: "核心板块",
      items: [
        {
          key: "home",
          label: "首页",
          active: activeSection === "home",
          onSelect: () => (window.location.hash = ""),
        },
        {
          key: "story",
          label: "剧情档案",
          active: activeSection === "story",
          onSelect: () => (window.location.hash = "story"),
        },
        {
          key: "data",
          label: "游戏资料",
          active: activeSection === "data",
          onSelect: () => (window.location.hash = "archive/characters"),
        },
        {
          key: "materials",
          label: "材料百科",
          active: activeSection === "materials",
          onSelect: () => (window.location.hash = "archive/materials"),
        },
        {
          key: "text",
          label: "文献文本",
          active: activeSection === "text",
          onSelect: () => (window.location.hash = "text/books"),
        },
      ],
    },
    {
      label: "检索与工具",
      items: [
        {
          key: "search",
          label: "全局搜索",
          active: activeSection === "search",
          onSelect: () => (window.location.hash = "search"),
        },
        {
          key: "ask",
          label: "证据问答",
          active: activeSection === "ask",
          onSelect: () => (window.location.hash = "ask"),
        },
      ],
    },
  ];

  const renderSections = sections && sections.length > 0 ? sections : defaultSections;

  return (
    <div className="archive-nav-inner" role="navigation" aria-label="全局导航">
      <div
        className="archive-nav-brand"
        onClick={() => (window.location.hash = "")}
        style={{ cursor: "pointer" }}
      >
        <ArchiveAvatar fallbackText="G" label="GamesMcp" size={34} />
        <div>
          <strong>GamesMcp</strong>
          <small>
            {gameLabel} · {revisionLabel}
          </small>
        </div>
      </div>
      {renderSections.map((section) => (
        <section key={section.label}>
          <h3>{section.label}</h3>
          <ul>
            {section.items.map((item) => (
              <li key={item.key}>
                <button
                  type="button"
                  className={item.active ? "is-active" : ""}
                  aria-current={item.active ? "page" : undefined}
                  onClick={item.onSelect}
                >
                  {item.label}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
