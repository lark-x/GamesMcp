import { useEffect, useState } from "react";
export function VersionSwitcher({ onPreview }: { onPreview: (id: string) => void }) {
  const [candidates, setCandidates] = useState<
    Array<{
      id: string;
      name: string;
      status: string;
      builds?: Array<{ id: string; buildNumber: number }>;
    }>
  >([]);
  useEffect(() => {
    fetch("/api/admin/release-candidates")
      .then((r) => (r.ok ? r.json() : { candidates: [] }))
      .then(async (v) =>
        setCandidates(
          await Promise.all(
            (v.candidates ?? []).map(async (c: { id: string }) => {
              const d = await fetch(`/api/admin/release-candidates/${c.id}`);
              const value = await d.json();
              return value.candidate ?? value;
            }),
          ),
        ),
      )
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
        <optgroup label="历史正式版本">
          <option disabled>由正式版本历史查看</option>
        </optgroup>
        <optgroup label="预发布 Candidate / Build">
          {candidates.flatMap((c) => [
            <option key={c.id} value={c.id}>
              Candidate · {c.name} · {c.status}
            </option>,
            ...(c.builds ?? []).map((b) => (
              <option key={b.id} value={c.id}>
                {c.name} · Build {b.buildNumber}
              </option>
            )),
          ])}
        </optgroup>
      </select>
    </label>
  );
}
