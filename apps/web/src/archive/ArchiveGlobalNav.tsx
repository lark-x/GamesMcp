import { ArchiveAvatar } from "./ArchiveAvatar.js";

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
  gameLabel,
  revisionLabel,
  sections,
}: {
  gameLabel: string;
  revisionLabel: string;
  sections: GlobalNavSection[];
}) {
  return (
    <div className="archive-nav-inner">
      <div className="archive-nav-brand">
        <ArchiveAvatar fallbackText="G" label="GamesMcp" size={34} />
        <div>
          <strong>GamesMcp</strong>
          <small>
            {gameLabel} · {revisionLabel}
          </small>
        </div>
      </div>
      {sections.map((section) => (
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
