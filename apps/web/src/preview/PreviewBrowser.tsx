import { useEffect, useMemo, useState } from "react";
import type { NormalizedRecord, ReleaseCandidate, ReleaseCandidateDetail } from "@gip/domain";
import { apiFetch } from "../api.js";
import type { QuestDetail, QuestSearchHit } from "../api.js";
import { adminHash, completenessLabel, questTypeLabel, questTypeOptions } from "../shared.js";
type PreviewRecord = NormalizedRecord & {
  displayKind: "entity" | "document";
  displayTitle: string;
  properties?: Record<string, unknown>;
  aliases?: Array<{ value: string }>;
};

const previewCategories = [
  ["all", "全部"],
  ["quests", "剧情任务"],
  ["characters", "角色"],
  ["weapons", "武器"],
  ["artifacts", "圣遗物"],
  ["materials", "材料"],
  ["enemies", "敌人"],
] as const;

const previewPropertyLabels: Record<string, string> = {
  rarity: "星级",
  element: "元素",
  weaponType: "武器类型",
  region: "地区",
  type: "类型",
};

function previewRecordsFromPayload(
  payload: unknown,
  fallbackKind: "entity" | "document" = "entity",
): PreviewRecord[] {
  if (!payload || typeof payload !== "object") return [];
  const object = payload as Record<string, unknown>;
  const rows =
    (Array.isArray(object.records) && object.records) ||
    (Array.isArray(object.normalizedRecords) && object.normalizedRecords) ||
    (Array.isArray(object[fallbackKind === "entity" ? "entities" : "documents"]) &&
      (object[fallbackKind === "entity" ? "entities" : "documents"] as unknown[])) ||
    [];

  return rows.flatMap((row, index) => {
    if (!row || typeof row !== "object") return [];
    const value = row as Record<string, unknown>;
    const kind = value.displayKind === "document" ? "document" : fallbackKind;
    const sourceKey = String(value.sourceKey ?? value.id ?? `${kind}-${index}`);
    const displayTitle = String(value.title ?? value.name ?? sourceKey);
    const metadata =
      value.metadata && typeof value.metadata === "object"
        ? (value.metadata as Record<string, unknown>)
        : {};
    return [
      {
        sourceKey,
        recordType: String(value.recordType ?? value.type ?? kind),
        title: displayTitle,
        body: String(value.body ?? value.snippet ?? value.summary ?? ""),
        entityType:
          kind === "entity" && typeof value.type === "string"
            ? (value.type as NormalizedRecord["entityType"])
            : undefined,
        documentType:
          kind === "document" && typeof value.type === "string"
            ? (value.type as NormalizedRecord["documentType"])
            : undefined,
        gameVersion: typeof value.gameVersion === "string" ? value.gameVersion : undefined,
        metadata,
        properties:
          value.properties && typeof value.properties === "object"
            ? (value.properties as Record<string, unknown>)
            : {},
        aliases: Array.isArray(value.aliases)
          ? value.aliases.flatMap((alias) =>
              alias &&
              typeof alias === "object" &&
              typeof (alias as { value?: unknown }).value === "string"
                ? [{ value: String((alias as { value: string }).value) }]
                : [],
            )
          : [],
        contentHash: String(value.contentHash ?? ""),
        parserVersion: String(value.parserVersion ?? "preview"),
        displayKind: kind,
        displayTitle,
      },
    ];
  });
}

async function loadPreviewRecords(
  buildId: string,
  adminToken: string,
  offset: number,
  limit: number,
  query = "",
  category = "all",
): Promise<{ records: PreviewRecord[]; total: number }> {
  const suffix = query.trim() ? `&q=${encodeURIComponent(query.trim())}` : "";
  const payload = await apiFetch<unknown>(
    `/api/admin/previews/${buildId}/records?kind=all&category=${encodeURIComponent(category)}&limit=${limit}&offset=${offset}${suffix}`,
    {},
    adminToken,
  );
  return {
    records: previewRecordsFromPayload(payload),
    total: Number((payload as { total?: number })?.total ?? 0),
  };
}

async function loadPreviewQuests(
  buildId: string,
  adminToken: string,
  query = "",
  locale = "zh-CN",
  questType = "",
): Promise<QuestSearchHit[]> {
  const params = new URLSearchParams({ locale, limit: "50" });
  if (query.trim()) params.set("q", query.trim());
  if (questType) params.set("type", questType);
  const payload = await apiFetch<{ quests: QuestSearchHit[] }>(
    `/api/admin/previews/${buildId}/quests?${params.toString()}`,
    {},
    adminToken,
  );
  return payload.quests;
}

async function loadPreviewQuest(
  buildId: string,
  adminToken: string,
  questId: string,
  locale = "zh-CN",
  cursor?: string | null,
): Promise<QuestDetail> {
  const params = new URLSearchParams({ locale, limit: "100" });
  if (cursor) params.set("cursor", cursor);
  const payload = await apiFetch<{ quest: QuestDetail }>(
    `/api/admin/previews/${buildId}/quests/${encodeURIComponent(questId)}?${params.toString()}`,
    {},
    adminToken,
  );
  return payload.quest;
}

export function PreviewBrowser({
  gameId,
  candidateId,
  initialBuildId,
}: {
  gameId: string;
  candidateId: string;
  initialBuildId?: string;
}) {
  const [adminToken, setAdminToken] = useState(
    () => window.localStorage.getItem("gip.adminToken") ?? "",
  );
  const [candidates, setCandidates] = useState<ReleaseCandidate[]>([]);
  const [candidate, setCandidate] = useState<ReleaseCandidateDetail | null>(null);
  const [buildId, setBuildId] = useState(initialBuildId ?? "");
  const [records, setRecords] = useState<PreviewRecord[]>([]);
  const [selectedKey, setSelectedKey] = useState("");
  const [previewQuests, setPreviewQuests] = useState<QuestSearchHit[]>([]);
  const [selectedPreviewQuest, setSelectedPreviewQuest] = useState<QuestDetail | null>(null);
  const [questCursor, setQuestCursor] = useState<string | null | undefined>();
  const [questLocale, setQuestLocale] = useState("zh-CN");
  const [questType, setQuestType] = useState("");
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"all" | "entity" | "document">("all");
  const [category, setCategory] = useState("all");
  const [page, setPage] = useState(0);
  const pageSize = 50;
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const showingQuestPreview = category === "quests";

  useEffect(() => {
    window.localStorage.setItem("gip.adminToken", adminToken);
  }, [adminToken]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    Promise.all([
      apiFetch<{ candidates: ReleaseCandidate[] }>(
        `/api/admin/release-candidates?gameId=${encodeURIComponent(gameId)}`,
        {},
        adminToken,
      ),
      apiFetch<ReleaseCandidateDetail | { candidate: ReleaseCandidateDetail }>(
        `/api/admin/release-candidates/${candidateId}`,
        {},
        adminToken,
      ),
    ])
      .then(([candidateResponse, detailResponse]) => {
        if (cancelled) return;
        const detail = "candidate" in detailResponse ? detailResponse.candidate : detailResponse;
        setCandidates(candidateResponse.candidates);
        setCandidate(detail);
        const nextBuildId =
          initialBuildId ??
          detail.currentBuildId ??
          [...(detail.builds ?? [])].sort((left, right) => right.buildNumber - left.buildNumber)[0]
            ?.id ??
          "";
        setBuildId(nextBuildId);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "预发布候选加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [adminToken, candidateId, gameId, initialBuildId]);

  useEffect(() => {
    if (!buildId || showingQuestPreview) {
      setRecords([]);
      setSelectedKey("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    loadPreviewRecords(buildId, adminToken, page * pageSize, pageSize, query, category)
      .then(({ records: nextRecords, total: nextTotal }) => {
        if (cancelled) return;
        setRecords(nextRecords);
        setTotal(nextTotal);
        setSelectedKey((current) =>
          nextRecords.some((record) => record.sourceKey === current)
            ? current
            : (nextRecords[0]?.sourceKey ?? ""),
        );
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setRecords([]);
          setError(
            reason instanceof Error
              ? reason.message
              : "这个 Build 暂时无法预览，请返回发布页重新构建。",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [adminToken, buildId, category, page, query, showingQuestPreview]);

  useEffect(() => {
    if (!buildId || !showingQuestPreview) {
      setPreviewQuests([]);
      setSelectedPreviewQuest(null);
      setQuestCursor(undefined);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    loadPreviewQuests(buildId, adminToken, query, questLocale, questType)
      .then((nextQuests) => {
        if (cancelled) return;
        setPreviewQuests(nextQuests);
        setSelectedPreviewQuest(null);
        setQuestCursor(undefined);
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setPreviewQuests([]);
          setError(reason instanceof Error ? reason.message : "预发布任务加载失败");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [adminToken, buildId, query, questLocale, questType, showingQuestPreview]);

  useEffect(() => setPage(0), [buildId, query, kind, category]);

  const selectedBuild = candidate?.builds.find((build) => build.id === buildId);
  const visibleRecords = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return records.filter(
      (record) =>
        (kind === "all" || record.displayKind === kind) &&
        (!normalizedQuery ||
          `${record.displayTitle} ${record.sourceKey} ${record.body ?? ""}`
            .toLocaleLowerCase()
            .includes(normalizedQuery)),
    );
  }, [kind, query, records]);
  const selectedRecord =
    visibleRecords.find((record) => record.sourceKey === selectedKey) ?? visibleRecords[0];

  function openCandidate(nextCandidateId: string) {
    if (!nextCandidateId) return;
    window.location.hash = `preview/${encodeURIComponent(nextCandidateId)}`;
  }

  function openBuild(nextBuildId: string) {
    setBuildId(nextBuildId);
    setSelectedKey("");
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${window.location.search}#preview/${encodeURIComponent(candidateId)}/${encodeURIComponent(nextBuildId)}`,
    );
  }

  async function reportRecord(record: PreviewRecord) {
    const params = new URLSearchParams({
      candidateId,
      buildId,
      canonicalKey: record.sourceKey,
      title: record.displayTitle,
    });
    const batchId = candidate?.importBatchIds?.[0];
    if (batchId) params.set("batchId", batchId);
    try {
      await apiFetch(
        `/api/admin/release-candidates/${candidateId}/issues`,
        {
          method: "POST",
          body: JSON.stringify({
            buildId,
            canonicalKey: record.sourceKey,
            summary: `预发布资料可能有误：${record.displayTitle}`,
            details: {
              title: record.displayTitle,
              displayKind: record.displayKind,
              batchId,
            },
          }),
        },
        adminToken,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "问题创建失败");
      return;
    }
    window.location.hash = adminHash("issues", params);
  }

  async function openPreviewQuest(hit: QuestSearchHit, nextCursor?: string | null) {
    if (!buildId) return;
    setError("");
    setLoading(true);
    try {
      const quest = await loadPreviewQuest(
        buildId,
        adminToken,
        hit.questKey,
        questLocale,
        nextCursor,
      );
      setSelectedPreviewQuest((current) =>
        nextCursor && current
          ? {
              ...quest,
              dialogueNodes: [...current.dialogueNodes, ...quest.dialogueNodes],
              dialogueEdges: [...current.dialogueEdges, ...quest.dialogueEdges],
              citations: [...current.citations, ...quest.citations],
            }
          : quest,
      );
      setQuestCursor(quest.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "预发布任务详情加载失败");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app-shell preview-shell">
      <header className="preview-topbar">
        <div className="preview-brand">
          <span className="preview-badge">PREVIEW</span>
          <div>
            <span className="eyebrow">RELEASE CANDIDATE</span>
            <h1>{candidate?.name ?? "预发布查看"}</h1>
          </div>
        </div>
        <div className="preview-top-actions">
          <button
            className="secondary-button"
            onClick={() => (window.location.hash = "admin/preview")}
          >
            返回预发布分支
          </button>
          <button className="secondary-button" onClick={() => (window.location.hash = "")}>
            查看正式资料库
          </button>
        </div>
      </header>

      <div className="preview-warning" role="status">
        <strong>这是预发布数据，当前正式 MCP 不会读取此 Build</strong>
        <span>只有在发布管理页明确晋级后，数据才会成为正式 Revision。</span>
      </div>

      <section className="preview-version-bar" aria-label="预发布版本切换">
        <label>
          候选版本
          <select value={candidateId} onChange={(event) => openCandidate(event.target.value)}>
            {candidates.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.status}
              </option>
            ))}
          </select>
        </label>
        <label>
          预发布 Build
          <select value={buildId} onChange={(event) => openBuild(event.target.value)}>
            <option value="">请选择 Build</option>
            {candidate?.builds
              ?.slice()
              .sort((left, right) => right.buildNumber - left.buildNumber)
              .map((build) => (
                <option key={build.id} value={build.id}>
                  Build {build.buildNumber} · {build.status} · {build.recordCount} 条
                </option>
              ))}
          </select>
        </label>
        <div className="preview-build-facts">
          <span>状态：{selectedBuild?.status ?? "未选择"}</span>
          <span>校验：{selectedBuild?.contentChecksum?.slice(0, 12) ?? "—"}</span>
          <span>记录：{selectedBuild?.recordCount ?? 0}</span>
        </div>
        <label className="preview-token-field">
          管理 Token
          <input
            type="password"
            value={adminToken}
            onChange={(event) => setAdminToken(event.target.value)}
            placeholder="开发环境可留空"
          />
        </label>
      </section>

      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")}>关闭</button>
        </div>
      )}

      <main className="preview-workspace">
        <aside className="preview-record-list">
          <div className="preview-search-tools">
            <input
              aria-label="搜索预发布资料"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索标题、正文或 Canonical Key"
            />
            <div className="preview-kind-filter" aria-label="预发布资料类型">
              {(["all", "entity", "document"] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  className={kind === value ? "is-active" : ""}
                  disabled={showingQuestPreview}
                  onClick={() => setKind(value)}
                >
                  {value === "all" ? "全部" : value === "entity" ? "实体" : "文档"}
                </button>
              ))}
            </div>
            <div className="preview-category-filter" aria-label="预发布资料分类">
              {previewCategories.map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={category === value ? "is-active" : ""}
                  onClick={() => setCategory(value)}
                >
                  {label}
                </button>
              ))}
            </div>
            {showingQuestPreview && (
              <div className="preview-category-filter" aria-label="预发布任务筛选">
                <select
                  aria-label="预发布任务语言"
                  value={questLocale}
                  onChange={(event) => setQuestLocale(event.target.value)}
                >
                  <option value="zh-CN">简体中文</option>
                  <option value="en">English</option>
                </select>
                <select
                  aria-label="预发布任务类型"
                  value={questType}
                  onChange={(event) => setQuestType(event.target.value)}
                >
                  {questTypeOptions.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <div className="preview-list-heading">
            <b>{showingQuestPreview ? "当前 Build 任务" : "当前 Build 资料"}</b>
            <span>{showingQuestPreview ? previewQuests.length : visibleRecords.length} 条</span>
          </div>
          <div className="preview-record-scroll" aria-busy={loading}>
            {loading ? (
              <div className="preview-empty">正在读取隔离的预发布数据…</div>
            ) : showingQuestPreview ? (
              previewQuests.map((quest) => (
                <button
                  type="button"
                  key={`${quest.questKey}-${quest.locale}`}
                  className={selectedPreviewQuest?.questKey === quest.questKey ? "is-active" : ""}
                  onClick={() => void openPreviewQuest(quest)}
                >
                  <span>{questTypeLabel(quest.type)}</span>
                  <strong>{quest.title}</strong>
                  <small>
                    {quest.questKey} · {quest.locale} · {completenessLabel(quest.completeness)}
                  </small>
                </button>
              ))
            ) : (
              visibleRecords.map((record) => (
                <button
                  type="button"
                  key={`${record.displayKind}-${record.sourceKey}`}
                  className={selectedRecord?.sourceKey === record.sourceKey ? "is-active" : ""}
                  onClick={() => setSelectedKey(record.sourceKey)}
                >
                  <span>{record.displayKind === "entity" ? "实体" : "文档"}</span>
                  <strong>{record.displayTitle}</strong>
                  <small>{record.sourceKey}</small>
                </button>
              ))
            )}
            {!loading && !showingQuestPreview && !visibleRecords.length && (
              <div className="preview-empty">
                <b>没有符合条件的资料</b>
                <span>可以更换 Build、类型或搜索条件。</span>
              </div>
            )}
            {!loading && showingQuestPreview && !previewQuests.length && (
              <div className="preview-empty">
                <b>没有符合条件的任务</b>
                <span>可以切换语言、任务类型或搜索条件。</span>
              </div>
            )}
          </div>
          {!showingQuestPreview && (
            <nav className="preview-pagination" aria-label="预发布资料分页">
              <button
                type="button"
                className="secondary-button"
                disabled={page === 0 || loading}
                onClick={() => setPage((value) => Math.max(0, value - 1))}
              >
                上一页
              </button>
              <span>
                {total
                  ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, total)} / ${total}`
                  : "0 / 0"}
              </span>
              <button
                type="button"
                className="secondary-button"
                disabled={loading || (page + 1) * pageSize >= total}
                onClick={() => setPage((value) => value + 1)}
              >
                下一页
              </button>
            </nav>
          )}
        </aside>

        <section className="preview-record-detail">
          {showingQuestPreview ? (
            selectedPreviewQuest ? (
              <>
                <header>
                  <div>
                    <span className="eyebrow">QUEST PREVIEW</span>
                    <h2>{selectedPreviewQuest.title}</h2>
                    <small>
                      {selectedPreviewQuest.questKey} · {selectedPreviewQuest.locale} ·{" "}
                      {selectedPreviewQuest.revision}
                    </small>
                  </div>
                </header>
                <div className="preview-record-meta">
                  <span>{questTypeLabel(selectedPreviewQuest.type)}</span>
                  <span>{completenessLabel(selectedPreviewQuest.completeness)}</span>
                  <span>本页对话：{selectedPreviewQuest.dialogueNodes.length}</span>
                </div>
                {selectedPreviewQuest.warnings.length > 0 && (
                  <div className="inline-warning" role="status">
                    <strong>读取警告</strong>
                    <span>{selectedPreviewQuest.warnings.join("；")}</span>
                  </div>
                )}
                <section className="quest-summary-grid">
                  <div>
                    <h3>子任务</h3>
                    {selectedPreviewQuest.subquests.slice(0, 12).map((subquest) => (
                      <div className="quest-subquest" key={subquest.subquestKey}>
                        <strong>{subquest.title}</strong>
                        <small>{subquest.objective ?? "无目标文本"}</small>
                      </div>
                    ))}
                  </div>
                  <div>
                    <h3>参与者与关系</h3>
                    <p className="muted">
                      {selectedPreviewQuest.participants.map((item) => item.name).join("、") ||
                        "暂无"}
                    </p>
                    <p className="muted">
                      前置任务：{selectedPreviewQuest.prerequisites.join("、") || "暂无"}
                      ；本页分支边 {selectedPreviewQuest.dialogueEdges.length} 条
                    </p>
                  </div>
                </section>
                <h3>对话</h3>
                <div className="quest-dialogue-list">
                  {selectedPreviewQuest.dialogueNodes.map((node) => (
                    <article
                      id={node.nodeKey}
                      className={`quest-dialogue-node ${node.type}`}
                      key={node.nodeKey}
                    >
                      <header>
                        <strong>
                          {node.speakerName ?? (node.type === "narration" ? "旁白" : "未知")}
                        </strong>
                        <small>
                          {node.type} · {node.nodeKey}
                        </small>
                      </header>
                      <p>{node.body}</p>
                    </article>
                  ))}
                </div>
                <div className="quest-reader-actions">
                  <button
                    type="button"
                    disabled={!questCursor || loading}
                    onClick={() =>
                      selectedPreviewQuest &&
                      void openPreviewQuest(
                        {
                          questKey: selectedPreviewQuest.questKey,
                          mainQuestId: selectedPreviewQuest.questKey.replace(/^quest\//, ""),
                          title: selectedPreviewQuest.title,
                          type: selectedPreviewQuest.type,
                          completeness: selectedPreviewQuest.completeness,
                          locale: selectedPreviewQuest.locale,
                          documentId: selectedPreviewQuest.documentId,
                          revision: selectedPreviewQuest.revision,
                        },
                        questCursor,
                      )
                    }
                  >
                    {questCursor ? "读取下一页对话" : "已到末尾"}
                  </button>
                </div>
              </>
            ) : (
              <div className="preview-empty preview-detail-empty">
                <b>请选择一个预发布任务</b>
                <span>这里会按当前 Build 的结构化任务图显示子任务、对话和分支。</span>
              </div>
            )
          ) : selectedRecord ? (
            <>
              <header>
                <div>
                  <span className="eyebrow">{selectedRecord.displayKind.toUpperCase()}</span>
                  <h2>{selectedRecord.displayTitle}</h2>
                  <small>{selectedRecord.sourceKey}</small>
                </div>
                <button
                  className="report-issue-button"
                  onClick={() => reportRecord(selectedRecord)}
                >
                  报告问题
                </button>
              </header>
              <div className="preview-record-meta">
                <span>游戏版本：{selectedRecord.gameVersion ?? "未标注"}</span>
                <span>解析器：{selectedRecord.parserVersion}</span>
                <span>内容哈希：{selectedRecord.contentHash.slice(0, 16) || "未提供"}</span>
              </div>
              <article className="preview-record-body">
                {selectedRecord.body ? (
                  selectedRecord.body
                    .split(/\n{2,}/)
                    .map((paragraph, index) => <p key={index}>{paragraph}</p>)
                ) : (
                  <p className="muted">这条资料没有可显示的正文。</p>
                )}
              </article>
              {selectedRecord.properties && Object.keys(selectedRecord.properties).length > 0 && (
                <section className="preview-properties" aria-label="条目属性">
                  <h3>基础属性</h3>
                  <dl>
                    {Object.entries(selectedRecord.properties).map(([key, value]) => (
                      <div key={key}>
                        <dt>{previewPropertyLabels[key] ?? key}</dt>
                        <dd>{Array.isArray(value) ? value.join("、") : String(value)}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
              <section className="preview-source-card" aria-label="数据来源">
                <h3>数据来源</h3>
                <span>{String(selectedRecord.metadata.upstreamSource ?? "未标注")}</span>
                <span>
                  上游提交：
                  {String(selectedRecord.metadata.upstreamCommit ?? "未标注").slice(0, 12)}
                </span>
                <span>语言：{String(selectedRecord.metadata.locale ?? "未标注")}</span>
                <span>许可：{String(selectedRecord.metadata.codeLicense ?? "未标注")}</span>
              </section>
              <footer className="preview-evidence-note">
                <strong>发现内容错误？</strong>
                <span>点击“报告问题”会定位对应审核项；提交修正时必须上传游戏内截图。</span>
              </footer>
            </>
          ) : (
            <div className="preview-empty preview-detail-empty">
              <b>请选择一条资料</b>
              <span>这里会显示当前预发布 Build 的内容，不会读取正式 MCP 数据。</span>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
