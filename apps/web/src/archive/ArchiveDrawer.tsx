import { useEffect, type ReactNode } from "react";

export function ArchiveDrawer({
  isOpen,
  onClose,
  title,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="archive-drawer-backdrop" onClick={onClose}>
      <div
        className="archive-drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="archive-drawer-header">
          <h3>{title}</h3>
          <button
            type="button"
            className="archive-drawer-close"
            onClick={onClose}
            aria-label="关闭抽屉"
          >
            ✕
          </button>
        </header>
        <div className="archive-drawer-body">{children}</div>
      </div>
    </div>
  );
}
