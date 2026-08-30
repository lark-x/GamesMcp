export type Build = { id: string; buildNumber: number; status: string; recordCount: number };
export type Candidate = {
  id: string;
  name: string;
  status: string;
  currentBuildId?: string | null;
  builds?: Build[];
};
export type Issue = {
  id: string;
  candidateId?: string;
  buildId?: string;
  canonicalKey: string;
  kind: string;
  status: string;
  summary: string;
  base?: unknown;
  main?: unknown;
  incoming?: unknown;
  preview?: unknown;
  source?: unknown;
  contentHash?: string;
};
export type Revision = {
  id: string;
  version?: string;
  status?: string;
  releaseNote?: string;
  manifestId?: string;
  indexId?: string;
};
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = localStorage.getItem("gip.adminToken");
  const r = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json() as Promise<T>;
}
export const api = {
  games: () => request<{ games: unknown[] }>("/api/games"),
  sources: (gameId?: string) =>
    request<{ sources: unknown[] }>(gameId ? `/api/games/${gameId}/sources` : "/api/admin/sources"),
  imports: () => request<{ imports: unknown[] }>("/api/admin/imports"),
  createImport: (input: { gameId: string; sourceId: string; path: string }) =>
    request<{ id: string; batchId?: string }>("/api/admin/imports", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  importStatus: (id: string) => request<Record<string, unknown>>(`/api/admin/imports/${id}`),
  candidates: () => request<{ candidates: Candidate[] }>("/api/admin/release-candidates"),
  candidate: (id: string) =>
    request<{ candidate: Candidate }>(`/api/admin/release-candidates/${id}`),
  candidateReadiness: (id: string) =>
    request<Record<string, unknown>>(`/api/admin/release-candidates/${id}/readiness`),
  candidateChecks: (id: string) =>
    request<Record<string, unknown>>(`/api/admin/release-candidates/${id}/checks`),
  candidateIssues: (id: string) =>
    request<{ issues: Issue[] }>(`/api/admin/release-candidates/${id}/issues`),
  build: (id: string) =>
    request<Record<string, unknown>>(`/api/admin/release-candidates/${id}/builds`, {
      method: "POST",
      body: "{}",
    }),
  readiness: (id: string) =>
    request<Record<string, unknown>>(`/api/admin/release-candidates/${id}/readiness`),
  promote: (candidateId: string, input: Record<string, unknown>) =>
    request(`/api/admin/release-candidates/${candidateId}/promote`, { method: "POST", body: JSON.stringify(input) }),
  createPatch: (candidateId: string, input: Record<string, unknown>) =>
    request(`/api/admin/release-candidates/${candidateId}/patches`, { method: "POST", body: JSON.stringify(input) }),
  issues: () => request<{ issues: Issue[] }>("/api/admin/review-issues"),
  issue: (id: string) => request<{ issue: Issue }>(`/api/admin/review-issues/${id}`),
  patches: (candidateId: string) =>
    request<Record<string, unknown>>(`/api/admin/release-candidates/${candidateId}/patches`),
  createIssue: (candidateId: string, input: Record<string, unknown>) =>
    request(`/api/admin/release-candidates/${candidateId}/issues`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  uploadEvidence: (
    itemId: string,
    input: { mimeType: "image/png" | "image/jpeg" | "image/webp"; dataBase64: string },
  ) =>
    request(`/api/admin/verification/items/${itemId}/screenshots`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  resolve: (id: string, action: string, note: string) =>
    request(`/api/admin/review-issues/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ action, note }),
    }),
  revisions: () => request<{ revisions: Revision[] }>("/api/admin/revisions"),
  rollback: (id: string, reason: string) =>
    request(`/api/admin/revisions/${id}/rollback`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
};
