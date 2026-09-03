import type { ReactNode } from "react";

export function ArchiveInspector({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="archive-inspector-inner">
      <h2>{title}</h2>
      {children}
    </div>
  );
}

export function InspectorSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="inspector-section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

export function InspectorField({ label, value }: { label: string; value?: ReactNode }) {
  return (
    <div className="inspector-field">
      <span>{label}</span>
      <strong>{value ?? "—"}</strong>
    </div>
  );
}
