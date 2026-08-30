import { useEffect, useState } from "react";
import { api, Candidate, Revision } from "../api.js";
export function VersionSwitcher({
  onPreview,
}: {
  onPreview: (candidateId: string, buildId?: string) => void;
}) {
  const [candidates, setCandidates] = useState<
    Array<{
      id: string;
      name: string;
      status: string;
      builds?: Array<{ id: string; buildNumber: number }>;
    }>
  >([]);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [value, setValue] = useState("current");
  useEffect(() => {
    Promise.all([api.candidates(), api.revisions()])
      .then(async ([v, r]) => {
        setRevisions(r.revisions ?? []);
        setCandidates(
          await Promise.all(
            (v.candidates ?? []).map((c) => api.candidate(c.id).then((x) => x.candidate)),
          ),
        );
      })
      .catch(() => undefined);
  }, []);
  return (
    <label className="version-switcher">
      版本{" "}
      <select
        value={value}
        onChange={(e) => {
          const v = e.target.value;
          setValue(v);
          if (v.startsWith("candidate:")) {
            const [, c, b] = v.split(":");
            onPreview(c, b);
          } else if (v === "current") {
            window.location.hash = "";
          } else if (v.startsWith("revision:")) {
            window.location.hash = `revision/${v.slice(9)}`;
          }
        }}
      >
        <option value="current">正式 · Current</option>
        <optgroup label="历史正式版本">
          {revisions.map((r) => (
            <option key={r.id} value={`revision:${r.id}`}>
              {r.version ?? r.id} · {r.status ?? "published"}
            </option>
          ))}
        </optgroup>
        <optgroup label="预发布 Candidate / Build">
          {candidates.flatMap((c) => [
            <option key={c.id} value={`candidate:${c.id}`}>
              Candidate · {c.name} · {c.status}
            </option>,
            ...(c.builds ?? []).map((b) => (
              <option key={b.id} value={`candidate:${c.id}:${b.id}`}>
                {c.name} · Build {b.buildNumber}
              </option>
            )),
          ])}
        </optgroup>
      </select>
    </label>
  );
}
