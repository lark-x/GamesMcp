export type GameSummary = { id: string; slug: string; name: string; status: string };
export type SourceSummary = {
  id: string;
  name: string;
  type: string;
  pathLabel?: string;
  licenseNote?: string | null;
};
export type ImportSummary = {
  id: string;
  gameId: string;
  sourceId: string;
  status: string;
  successCount: number;
  failureCount: number;
  warnings?: unknown[];
  errors?: unknown[];
  createdAt: string;
  completedAt?: string | null;
};
export type Build = {
  id: string;
  buildNumber: number;
  status: string;
  recordCount: number;
  contentChecksum: string;
  manifestId?: string | null;
  indexStatus?: string;
  createdAt?: string;
};
export type BlockingReasonInfo = { code: string; message?: string };
export type Candidate = {
  id: string;
  gameId: string;
  name: string;
  status: string;
  currentBuildId?: string | null;
  baseRevisionId?: string | null;
  importBatchIds?: string[];
  builds?: Build[];
  readiness?: { ready: boolean; blockingReasons?: BlockingReasonInfo[] };
  checks?: CandidateCheck[];
};
export type Issue = {
  id: string;
  candidateId?: string;
  detectedBuildId?: string;
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
  blocking?: boolean;
  details?: Record<string, unknown>;
};
export type BlockingReason = {
  code: string;
  message: string;
  details?: Record<string, unknown>;
};
export type CandidateReadiness = {
  candidateId: string;
  buildId?: string;
  contentChecksum?: string;
  ready: boolean;
  blockingReasons: BlockingReason[];
};
export type CandidateCheck = {
  id: string;
  candidateId: string;
  buildId?: string | null;
  checkType: string;
  status: "pending" | "passed" | "blocked" | "failed";
  message?: string | null;
  checkedAt?: string | null;
};
export type ReviewEvidence = {
  id: string;
  issueId: string;
  mimeType: string;
  checkedGameVersion: string;
  checkedLocale: string;
  note: string;
  createdAt: string;
};
export type Revision = {
  id: string;
  gameId?: string;
  revisionNumber?: number;
  version?: string;
  lifecycleStatus?: string;
  status?: string;
  releaseNote?: string;
  manifestId?: string;
  indexId?: string;
  indexStatus?: string;
  isCurrent?: boolean;
  publishedAt?: string;
};
export type QuestSearchHit = {
  questKey: string;
  mainQuestId: string;
  title: string;
  type:
    | "archon_quest"
    | "story_quest"
    | "world_quest"
    | "event_quest"
    | "commission"
    | "hangout"
    | "other";
  chapter?: string | null;
  series?: string | null;
  completeness: "complete" | "partial" | "metadata_only";
  locale: string;
  documentId: string;
  revision: string;
  match?: string;
};
export type QuestDetail = QuestSearchHit & {
  gameVersion?: string | null;
  subquests: Array<{
    subquestKey: string;
    subquestId: string | number;
    title: string;
    objective?: string;
    order: number;
    completeness: "complete" | "partial" | "metadata_only";
  }>;
  dialogueNodes: Array<{
    nodeKey: string;
    nodeId: string | number;
    type: string;
    subquestKey?: string;
    speakerKey?: string;
    speakerName?: string;
    body: string;
    segmentId?: string | null;
    order?: number;
  }>;
  dialogueEdges: Array<{
    fromNodeKey: string;
    toNodeKey: string;
    type: string;
    optionText?: string;
  }>;
  participants: Array<{ id: string; sourceKey?: string | null; name: string; type: string }>;
  prerequisites: string[];
  citations: Array<{
    documentId: string;
    locale: string;
    questKey: string;
    subquestKey?: string;
    dialogueNodeKey?: string;
    segmentId?: string | null;
    sourceKey?: string;
    sourceName?: string;
    sourceSnapshotId?: string | null;
    revision: string;
  }>;
  warnings: string[];
  totalDialogueNodes?: number;
  loadedDialogueNodes?: number;
  hasMore?: boolean;
  nextCursor?: string | null;
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
  const text = await r.text();
  let data: unknown = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {};
  }
  if (!r.ok) {
    if (r.status === 401)
      throw new Error("需要管理员令牌：请在管理后台右上角设置 ADMIN_TOKEN 对应的访问令牌");
    const error = data as {
      error?: { message?: string; code?: string; details?: unknown };
      message?: string;
    };
    const detailText =
      error.error?.details != null ? ` (${JSON.stringify(error.error.details)})` : "";
    throw new Error(
      `${error.error?.code ? `${error.error.code}: ${error.error?.message ?? ""}` : (error.error?.message ?? error.message ?? `${r.status} ${r.statusText}`)}${detailText}`,
    );
  }
  return data as T;
}

export const apiFetch = <T>(path: string, init?: RequestInit, adminToken?: string): Promise<T> =>
  request<T>(path, withAdminToken(init, adminToken));

function withAdminToken(init: RequestInit | undefined, adminToken?: string): RequestInit {
  if (!adminToken?.trim()) return init ?? {};
  const headers = new Headers(init?.headers);
  headers.set("authorization", "Bearer " + adminToken.trim());
  return { ...(init ?? {}), headers };
}

export const api = {
  games: () => request<{ games: GameSummary[] }>("/api/games"),
  sources: (gameId?: string) =>
    request<{ sources: SourceSummary[] }>(
      `/api/admin/sources${gameId ? `?gameId=${encodeURIComponent(gameId)}` : ""}`,
    ),
  imports: (gameId?: string) =>
    request<{ imports: ImportSummary[] }>(
      `/api/admin/imports${gameId ? `?gameId=${encodeURIComponent(gameId)}` : ""}`,
    ),
  createImport: (input: { gameId: string; sourceId: string; path?: string }) =>
    request<{ id: string; batchId?: string }>("/api/admin/imports", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  createImportUpload: (input: {
    gameId: string;
    sourceId: string;
    files: Array<{ name: string; contentBase64: string }>;
  }) =>
    request<{ id: string; batchId?: string }>("/api/admin/imports", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  importStatus: (id: string) => request<Record<string, unknown>>(`/api/admin/imports/${id}`),
  candidates: (gameId?: string, includeDetail = true) =>
    request<{ candidates: Candidate[] }>(
      `/api/admin/release-candidates?include=${includeDetail ? "detail" : "summary"}${gameId ? `&gameId=${encodeURIComponent(gameId)}` : ""}`,
    ),
  candidate: (id: string) =>
    request<{ candidate: Candidate }>(`/api/admin/release-candidates/${id}`),
  candidateReadiness: (id: string) =>
    request<CandidateReadiness>(`/api/admin/release-candidates/${id}/readiness`),
  candidateChecks: (id: string) =>
    request<{ checks: CandidateCheck[] }>(`/api/admin/release-candidates/${id}/checks`),
  candidateIssues: (id: string) =>
    request<{ issues: Issue[] }>(`/api/admin/release-candidates/${id}/issues`),
  build: (id: string) =>
    request<Record<string, unknown>>(`/api/admin/release-candidates/${id}/builds`, {
      method: "POST",
      body: "{}",
    }),
  readiness: (id: string) => api.candidateReadiness(id),
  promote: (
    candidateId: string,
    input: {
      buildId: string;
      contentChecksum: string;
      expectedCurrentRevisionId?: string | null;
      releaseNote?: string;
      idempotencyKey: string;
    },
  ) =>
    request(`/api/admin/release-candidates/${candidateId}/promote`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  createPatch: (candidateId: string, input: Record<string, unknown>) =>
    request(`/api/admin/release-candidates/${candidateId}/patches`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  issues: (status?: "open" | "resolved" | "reopened") =>
    request<{ issues: Issue[] }>(`/api/admin/review-issues${status ? `?status=${status}` : ""}`),
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
    input: {
      mimeType: "image/png" | "image/jpeg" | "image/webp";
      dataBase64: string;
      checkedGameVersion: string;
      checkedLocale: string;
      note: string;
    },
  ) =>
    request(`/api/admin/review-issues/${itemId}/evidence`, {
      method: "POST",
      body: JSON.stringify(input),
    }),
  evidence: (issueId: string) =>
    request<{ evidence: ReviewEvidence[] }>(`/api/admin/review-issues/${issueId}/evidence`),
  resolve: (id: string, action: string, note: string) =>
    request(`/api/admin/review-issues/${id}/resolve`, {
      method: "POST",
      body: JSON.stringify({ action, note }),
    }),
  revisions: (gameId?: string) =>
    request<{ revisions: Revision[] }>(
      `/api/admin/revisions${gameId ? `?gameId=${encodeURIComponent(gameId)}` : ""}`,
    ),
  rollback: (id: string, reason: string) =>
    request(`/api/admin/revisions/${id}/rollback`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  quests: (
    gameId: string,
    input: {
      q?: string;
      locale?: string;
      type?: QuestSearchHit["type"];
      gameVersion?: string;
      revisionId?: string;
      limit?: number;
    } = {},
  ) => {
    const params = new URLSearchParams();
    if (input.q) params.set("q", input.q);
    if (input.locale) params.set("locale", input.locale);
    if (input.type) params.set("type", input.type);
    if (input.gameVersion) params.set("gameVersion", input.gameVersion);
    if (input.revisionId) params.set("revisionId", input.revisionId);
    if (input.limit) params.set("limit", String(input.limit));
    const query = params.toString();
    return request<{ quests: QuestSearchHit[] }>(
      `/api/games/${gameId}/quests${query ? `?${query}` : ""}`,
    );
  },
  quest: (
    gameId: string,
    questId: string,
    input: {
      locale?: string;
      subquestId?: string;
      cursor?: string;
      revisionId?: string;
      limit?: number;
    } = {},
  ) => {
    const params = new URLSearchParams();
    if (input.locale) params.set("locale", input.locale);
    if (input.subquestId) params.set("subquestId", input.subquestId);
    if (input.cursor) params.set("cursor", input.cursor);
    if (input.revisionId) params.set("revisionId", input.revisionId);
    if (input.limit) params.set("limit", String(input.limit));
    const query = params.toString();
    return request<{ quest: QuestDetail }>(
      `/api/games/${gameId}/quests/${encodeURIComponent(questId)}${query ? `?${query}` : ""}`,
    );
  },
};
