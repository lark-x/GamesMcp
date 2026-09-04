import { useEffect, useState } from "react";
import { Select } from "antd";
import { api, type Revision } from "../api.js";

export function VersionSwitcher({
  onPreview,
  onRevision,
  onCurrent,
}: {
  onPreview: (candidateId: string, buildId?: string) => void;
  onRevision?: (revisionId: string, revision?: Revision) => void;
  onCurrent?: () => void;
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

  const options = [
    {
      label: "正式版本",
      options: [
        {
          value: "current",
          label: "正式发布 · Current",
        },
      ],
    },
    ...(revisions.length > 0
      ? [
          {
            label: "历史正式版本",
            options: revisions.map((r) => ({
              value: `revision:${r.id}`,
              label: `${r.version ?? r.id} · ${r.status ?? "published"}`,
            })),
          },
        ]
      : []),
    ...(candidates.length > 0
      ? [
          {
            label: "预发布候选",
            options: candidates.flatMap((c) => [
              {
                value: `candidate:${c.id}`,
                label: `候选 · ${c.name}`,
              },
              ...(c.builds ?? []).map((b) => ({
                value: `candidate:${c.id}:${b.id}`,
                label: `${c.name} · Build ${b.buildNumber}`,
              })),
            ]),
          },
        ]
      : []),
  ];

  function handleChange(val: string) {
    setValue(val);
    if (val.startsWith("candidate:")) {
      const [, c, b] = val.split(":");
      if (c) onPreview(c, b);
    } else if (val === "current") {
      window.location.hash = "";
      onCurrent?.();
    } else if (val.startsWith("revision:")) {
      const revisionId = val.slice(9);
      onRevision?.(
        revisionId,
        revisions.find((revision) => revision.id === revisionId),
      );
    }
  }

  return (
    <div className="archive-version-picker">
      <Select
        size="small"
        style={{ minWidth: 155 }}
        value={value}
        onChange={handleChange}
        options={options}
        aria-label="选择版本"
      />
    </div>
  );
}
