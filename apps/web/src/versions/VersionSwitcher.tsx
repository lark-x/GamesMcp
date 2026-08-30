import { useEffect, useState } from "react";
export function VersionSwitcher({ onPreview }: { onPreview: (id: string) => void }) {
  const [candidates, setCandidates] = useState<Array<{ id: string; name: string; status: string }>>(
    [],
  );
  useEffect(() => {
    fetch("/api/admin/release-candidates")
      .then((r) => (r.ok ? r.json() : { candidates: [] }))
      .then((v) => setCandidates(v.candidates ?? []))
      .catch(() => undefined);
  }, []);
  return (
    <label className="version-switcher">
      版本{" "}
      <select
        defaultValue="current"
        onChange={(e) => e.target.value !== "current" && onPreview(e.target.value)}
      >
        <option value="current">正式 · Current</option>
        <option disabled>历史版本</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            预发布 · {c.name} · {c.status}
          </option>
        ))}
      </select>
    </label>
  );
}
