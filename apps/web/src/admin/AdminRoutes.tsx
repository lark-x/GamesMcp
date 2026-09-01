import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Layout as AntdLayout,
  Badge,
  Button,
  Collapse,
  Empty,
  Layout,
  Menu,
  Modal,
  Select,
  Space,
  Steps,
  Switch,
  Table,
  Tag,
  Typography,
  Upload,
} from "antd";
import { CloudUploadOutlined, RollbackOutlined } from "@ant-design/icons";
import { useThemeMode } from "../providers.jsx";
import {
  api,
  type Candidate,
  type CandidateCheck,
  type CandidateReadiness,
  type GameSummary,
  type ImportSummary,
  type Issue,
  type ReviewEvidence,
  type Revision,
  type SourceSummary,
} from "../api.js";
import { VersionSwitcher } from "../versions/VersionSwitcher.js";

type AdminPage = "intake" | "preview" | "issues" | "history";

const statusLabel: Record<string, string> = {
  pending: "等待处理",
  running: "导入中",
  staged: "已暂存",
  review_required: "已生成预发布",
  preview_ready: "可预览",
  ready_to_promote: "等待发布",
  published: "已发布",
  promoted: "已发布",
  failed: "失败",
  cancelled: "已取消",
  ready: "就绪",
  open: "待处理",
  reopened: "重新打开",
  resolved: "已处理",
};

const gateLabels: Record<string, string> = {
  candidate_build_missing: "尚未生成 Build",
  candidate_checksum_invalid: "内容校验和不匹配",
  candidate_index_not_ready: "预发布索引未就绪",
  manifest_missing: "缺少内容 Manifest",
  manifest_invalid: "Manifest 与 Build 内容不一致",
  candidate_base_stale: "正式版本已变化，需要重新构建",
  candidate_batch_has_errors: "导入批次存在错误",
  source_snapshot_missing: "缺少来源快照",
  deletions_unconfirmed: "存在未确认删除",
  review_issue_open: "仍有待处理问题",
  candidate_check_failed: "自动检查未通过",
  open_conflicts: "仍有来源冲突",
};

function pageFromRoute(route: string): AdminPage {
  const value = route.split("/")[1]?.split("?")[0];
  return ["intake", "preview", "issues", "history"].includes(value ?? "")
    ? (value as AdminPage)
    : "intake";
}

function formatTime(value?: string | null) {
  if (!value) return "—";
  const time = new Date(value);
  return Number.isNaN(time.getTime()) ? "—" : time.toLocaleString("zh-CN", { hour12: false });
}

function fileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("截图读取失败"));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

function ThemeToggle() {
  const { mode, toggle } = useThemeMode();
  return (
    <Switch
      checked={mode === "dark"}
      onChange={toggle}
      checkedChildren="暗"
      unCheckedChildren="亮"
    />
  );
}

export function AdminRoutes({ initialRoute }: { initialRoute: string }) {
  const [page, setPage] = useState<AdminPage>(() => pageFromRoute(initialRoute));
  const [games, setGames] = useState<GameSummary[]>([]);
  const [gameId, setGameId] = useState("");
  const [sources, setSources] = useState<SourceSummary[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [sourcePath, setSourcePath] = useState("");
  const [imports, setImports] = useState<ImportSummary[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [readiness, setReadiness] = useState<Record<string, CandidateReadiness>>({});
  const [checks, setChecks] = useState<Record<string, CandidateCheck[]>>({});
  const [issues, setIssues] = useState<Issue[]>([]);
  const [evidence, setEvidence] = useState<Record<string, ReviewEvidence[]>>({});
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [releaseNotes, setReleaseNotes] = useState<Record<string, string>>({});
  const [rollbackReasons, setRollbackReasons] = useState<Record<string, string>>({});
  const [issueAction, setIssueAction] = useState<Record<string, string>>({});
  const [evidenceFiles, setEvidenceFiles] = useState<Record<string, File | null>>({});
  const [evidenceUploaded, setEvidenceUploaded] = useState<Record<string, boolean>>({});
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [rollbackTarget, setRollbackTarget] = useState<Revision | null>(null);

  useEffect(() => setPage(pageFromRoute(initialRoute)), [initialRoute]);
  useEffect(() => {
    const syncPageFromHash = () => setPage(pageFromRoute(window.location.hash.slice(1)));
    window.addEventListener("hashchange", syncPageFromHash);
    return () => window.removeEventListener("hashchange", syncPageFromHash);
  }, []);

  const refreshCandidates = useCallback(async (selectedGameId?: string) => {
    const details = (await api.candidates(selectedGameId, true)).candidates ?? [];
    setCandidates(details);
    setReadiness(
      Object.fromEntries(
        details
          .filter((item) => item.readiness)
          .map((item) => [item.id, item.readiness as CandidateReadiness]),
      ),
    );
    setChecks(Object.fromEntries(details.map((item) => [item.id, item.checks ?? []])));
    return details;
  }, []);

  const refreshIssues = useCallback(async () => {
    const all = (await api.issues()).issues ?? [];
    const active = all.filter((issue) => issue.status === "open" || issue.status === "reopened");
    setIssues(active);
  }, []);

  const loadEvidence = useCallback(async (issueId: string) => {
    try {
      const result = await api.evidence(issueId);
      setEvidence((all) => ({ ...all, [issueId]: result.evidence ?? [] }));
    } catch {
      setEvidence((all) => ({ ...all, [issueId]: [] }));
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.games(), api.issues(), api.revisions()])
      .then(async ([gameResult, issueResult, revisionResult]) => {
        if (cancelled) return;
        setGames(gameResult.games ?? []);
        setRevisions(revisionResult.revisions ?? []);
        setIssues(
          (issueResult.issues ?? []).filter(
            (issue) => issue.status === "open" || issue.status === "reopened",
          ),
        );
        if (gameResult.games[0]) setGameId((current) => current || gameResult.games[0]!.id);
        await refreshCandidates(gameResult.games[0]?.id);
      })
      .catch((error) => setMessage(`管理数据加载失败：${(error as Error).message}`))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [refreshCandidates]);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    Promise.all([api.sources(gameId), api.imports(gameId), api.revisions(gameId)])
      .then(([sourceResult, importResult, revisionResult]) => {
        if (cancelled) return;
        setSources(sourceResult.sources ?? []);
        setImports(importResult.imports ?? []);
        setRevisions(revisionResult.revisions ?? []);
        setSourceId((current) =>
          sourceResult.sources.some((source) => source.id === current)
            ? current
            : (importResult.imports[0]?.sourceId ?? sourceResult.sources[0]?.id ?? ""),
        );
      })
      .catch((error) => setMessage(`游戏资料加载失败：${(error as Error).message}`));
    refreshCandidates(gameId).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [gameId, refreshCandidates]);

  useEffect(() => {
    if (page !== "issues") return;
    refreshIssues().catch((error) => setMessage(`问题列表加载失败：${(error as Error).message}`));
  }, [page, refreshIssues]);

  useEffect(() => {
    if (page !== "intake" || !gameId) return;
    const hasActiveImport = imports.some(
      (item) => item.status === "pending" || item.status === "running",
    );
    if (!hasActiveImport) return;
    const timer = window.setInterval(() => {
      api
        .imports(gameId)
        .then((result) => setImports(result.imports ?? []))
        .catch(() => undefined);
      refreshCandidates(gameId).catch(() => undefined);
    }, 4_000);
    return () => window.clearInterval(timer);
  }, [gameId, page, refreshCandidates]);

  const sourceById = useMemo(
    () => new Map(sources.map((source) => [source.id, source])),
    [sources],
  );
  const currentRevision = revisions.find((revision) => revision.isCurrent);

  const go = (target: AdminPage) => {
    setMessage("");
    setPage(target);
    window.location.hash = `admin/${target}`;
  };

  const navItems = [
    { key: "intake", label: "导入数据" },
    { key: "preview", label: "预发布与发布" },
    { key: "issues", label: "问题审核" },
    { key: "history", label: "版本历史" },
  ] as const;

  return (
    <AntdLayout style={{ minHeight: "100vh" }}>
      <Layout.Sider
        theme="light"
        breakpoint="lg"
        collapsedWidth="0"
        width={220}
        style={{ borderRight: "1px solid rgba(0,0,0,0.06)" }}
      >
        <div style={{ padding: "20px 16px 12px", fontWeight: 700, letterSpacing: "0.06em" }}>
          资料版本管理
        </div>
        <Menu
          mode="inline"
          selectedKeys={[page]}
          items={navItems.map((item) => ({
            key: item.key,
            label:
              item.key === "issues" && issues.length > 0 ? (
                <Badge count={issues.length} size="small" offset={[8, 0]}>
                  {item.label}
                </Badge>
              ) : (
                item.label
              ),
          }))}
          onClick={({ key }) => go(key as AdminPage)}
        />
      </Layout.Sider>
      <AntdLayout>
        <header
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 24px",
            background: "rgba(255,255,255,0.65)",
            backdropFilter: "blur(8px)",
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}
        >
          <Space>
            <Button
              type="text"
              icon={<RollbackOutlined />}
              onClick={() => (window.location.hash = "")}
            >
              返回资料库
            </Button>
          </Space>
          <Space>
            <VersionSwitcher
              onPreview={(candidateId, buildId) => {
                window.location.hash = `preview/${candidateId}${buildId ? `/${buildId}` : ""}`;
              }}
            />
            <ThemeToggle />
          </Space>
        </header>
        <div style={{ padding: "20px 24px 48px", maxWidth: 1200, width: "100%", margin: "0 auto" }}>
          {page === "preview" && (
            <Steps
              size="small"
              aria-label="预发布与发布流程"
              items={[
                { title: "选择预发布分支" },
                { title: "浏览 Build" },
                { title: "处理阻塞问题" },
                { title: "发布正式 Revision" },
              ]}
              style={{ marginBottom: 20 }}
            />
          )}
          {page === "issues" && (
            <Steps
              size="small"
              aria-label="问题审核流程"
              items={[
                { title: "查看问题" },
                { title: "上传截图" },
                { title: "选择处理动作" },
                { title: "生成 Patch" },
              ]}
              style={{ marginBottom: 20 }}
            />
          )}

          {message && (
            <Typography.Paragraph role="status" style={{ marginBottom: 16 }}>
              {message}
            </Typography.Paragraph>
          )}
          {loading && (
            <Typography.Paragraph role="status" type="secondary" style={{ marginBottom: 16 }}>
              正在加载管理数据…
            </Typography.Paragraph>
          )}

          {page === "intake" && (
            <section className="admin-page" aria-labelledby="intake-heading">
              <div className="admin-page-heading">
                <div>
                  <span className="eyebrow">IMPORT</span>
                  <h2 id="intake-heading">导入数据</h2>
                  <p>选择已经登记的游戏和来源，系统会在后台解析并自动生成预发布 Build。</p>
                </div>
              </div>
              <form
                className="admin-form-card"
                onSubmit={async (event) => {
                  event.preventDefault();
                  setMessage("正在创建导入任务…");
                  try {
                    if (uploadFiles.length > 0) {
                      const created = await api.createImportUpload({
                        gameId,
                        sourceId,
                        files: await Promise.all(
                          uploadFiles.map(async (file) => ({
                            name: file.name,
                            contentBase64: await fileAsBase64(file),
                          })),
                        ),
                      });
                      setMessage(`导入任务已创建：${created.id}。Worker 将自动生成预发布 Build。`);
                      setUploadFiles([]);
                    } else {
                      const created = await api.createImport({
                        gameId,
                        sourceId,
                        path: sourcePath,
                      });
                      setMessage(`导入任务已创建：${created.id}。Worker 将自动生成预发布 Build。`);
                      setSourcePath("");
                    }
                    setImports((await api.imports(gameId)).imports ?? []);
                  } catch (error) {
                    setMessage(`提交失败：${(error as Error).message}`);
                  }
                }}
              >
                <label>
                  游戏
                  <Select
                    showSearch
                    style={{ minWidth: 240 }}
                    value={gameId || undefined}
                    placeholder="请选择游戏"
                    onChange={(value) => setGameId(value)}
                    options={games.map((game) => ({ value: game.id, label: game.name }))}
                  />
                </label>
                <label>
                  数据来源
                  <Select
                    showSearch
                    style={{ minWidth: 240 }}
                    value={sourceId || undefined}
                    placeholder="请选择来源"
                    onChange={(value) => setSourceId(value)}
                    options={sources.map((item) => ({
                      value: item.id,
                      label: `${item.name} · ${item.type}`,
                    }))}
                  />
                </label>
                <div className="admin-form-wide">
                  <Upload.Dragger
                    multiple
                    accept=".json,.md,.markdown,.txt,.text"
                    beforeUpload={() => false}
                    fileList={[]}
                    onChange={({ fileList }) => {
                      setUploadFiles(fileList.map((entry) => entry.originFileObj as File));
                    }}
                  >
                    <p className="ant-upload-drag-icon">
                      <CloudUploadOutlined />
                    </p>
                    <p className="ant-upload-text">点击或拖拽文件到此处</p>
                    <p className="ant-upload-hint">
                      支持 JSON / Markdown / 文本，可多选；单文件不超过 20MB
                    </p>
                  </Upload.Dragger>
                  {uploadFiles.length > 0 && (
                    <Typography.Text type="secondary">
                      已选择 {uploadFiles.length} 个文件
                    </Typography.Text>
                  )}
                </div>
                <Collapse
                  ghost
                  items={[
                    {
                      key: "advanced",
                      label: "高级：导入服务器本地路径",
                      children: (
                        <label className="admin-form-wide">
                          来源文件或目录
                          <input
                            value={sourcePath}
                            onChange={(event) => setSourcePath(event.target.value)}
                            placeholder="/path/to/data/imports/...（仅限导入根目录内）"
                          />
                        </label>
                      ),
                    },
                  ]}
                />
                {sourceById.get(sourceId)?.licenseNote && (
                  <p className="admin-form-wide source-license">
                    许可说明：{sourceById.get(sourceId)?.licenseNote}
                  </p>
                )}
                <Button
                  type="primary"
                  htmlType="submit"
                  icon={<CloudUploadOutlined />}
                  disabled={
                    !gameId || !sourceId || (uploadFiles.length === 0 && !sourcePath.trim())
                  }
                >
                  创建导入任务
                </Button>
              </form>

              <div className="admin-section-heading">
                <h3>最近导入任务</h3>
                <span>{imports.length} 个任务</span>
              </div>
              <Table
                size="small"
                rowKey="id"
                dataSource={imports.slice(0, 12)}
                pagination={false}
                locale={{ emptyText: <Empty description="还没有导入任务，先创建第一条导入任务" /> }}
                columns={[
                  {
                    title: "来源",
                    dataIndex: "sourceId",
                    render: (value: string) => sourceById.get(value)?.name ?? "已登记来源",
                  },
                  {
                    title: "状态",
                    dataIndex: "status",
                    render: (value: string) => (
                      <Tag
                        color={
                          value === "failed" ? "red" : value === "running" ? "blue" : "default"
                        }
                      >
                        {statusLabel[value] ?? value}
                      </Tag>
                    ),
                  },
                  { title: "成功", dataIndex: "successCount", width: 70 },
                  { title: "失败", dataIndex: "failureCount", width: 70 },
                  {
                    title: "警告",
                    dataIndex: "warnings",
                    width: 70,
                    render: (value?: unknown[]) => value?.length ?? 0,
                  },
                  {
                    title: "创建时间",
                    dataIndex: "createdAt",
                    render: (value: string) => formatTime(value),
                  },
                  {
                    title: "操作",
                    dataIndex: "id",
                    render: (value: string, record: ImportSummary) => {
                      const candidate = candidates.find((entry) =>
                        entry.importBatchIds?.includes(record.id),
                      );
                      return candidate ? (
                        <Button
                          size="small"
                          onClick={() =>
                            (window.location.hash = `preview/${candidate.id}/${candidate.currentBuildId ?? ""}`)
                          }
                        >
                          打开预发布版本
                        </Button>
                      ) : null;
                    },
                  },
                ]}
              />
            </section>
          )}

          {page === "preview" && (
            <section className="admin-page" aria-labelledby="preview-heading">
              <div className="admin-page-heading">
                <div>
                  <span className="eyebrow">CANDIDATE BUILDS</span>
                  <h2 id="preview-heading">预发布与发布</h2>
                  <p>
                    预发布可以自由浏览；只有当前 Build 的所有门禁通过后，才允许生成正式 Revision。
                  </p>
                </div>
                <Button
                  onClick={() => refreshCandidates(gameId).then(() => setMessage("发布状态已刷新"))}
                >
                  刷新状态
                </Button>
              </div>
              <div className="candidate-list">
                {candidates.length ? (
                  candidates.map((candidate) => {
                    const candidateReadiness = readiness[candidate.id];
                    const currentBuild =
                      candidate.builds?.find((build) => build.id === candidate.currentBuildId) ??
                      candidate.builds?.[0];
                    const candidateChecks = checks[candidate.id] ?? [];
                    const canPromote = Boolean(
                      candidateReadiness?.ready &&
                      currentBuild?.contentChecksum &&
                      releaseNotes[candidate.id]?.trim(),
                    );
                    return (
                      <article className="candidate-card" key={candidate.id}>
                        <header>
                          <div>
                            <span className="eyebrow">
                              {candidateReadiness?.ready ? "READY TO RELEASE" : "PREVIEW"}
                            </span>
                            <h3>{candidate.name}</h3>
                            <p>
                              {statusLabel[candidate.status] ?? candidate.status} · 当前 Build{" "}
                              {currentBuild?.buildNumber ?? "—"} · {currentBuild?.recordCount ?? 0}{" "}
                              条
                            </p>
                          </div>
                          <span
                            className={`readiness-badge ${candidateReadiness?.ready ? "ready" : "blocked"}`}
                          >
                            {candidateReadiness?.ready
                              ? "门禁已通过"
                              : `${candidateReadiness?.blockingReasons.length ?? 0} 项阻塞`}
                          </span>
                        </header>

                        <div className="build-strip" aria-label={`${candidate.name} Build 历史`}>
                          {(candidate.builds ?? []).map((build) => (
                            <button
                              key={build.id}
                              className={build.id === candidate.currentBuildId ? "active" : ""}
                              onClick={() =>
                                (window.location.hash = `preview/${candidate.id}/${build.id}`)
                              }
                            >
                              <strong>Build {build.buildNumber}</strong>
                              <span>
                                {build.recordCount} 条 · {statusLabel[build.status] ?? build.status}
                              </span>
                            </button>
                          ))}
                        </div>

                        <div className="release-gates">
                          <div className={currentBuild?.manifestId ? "gate-pass" : "gate-block"}>
                            <strong>Manifest</strong>
                            <span>{currentBuild?.manifestId ? "已绑定" : "缺失"}</span>
                          </div>
                          <div
                            className={currentBuild?.contentChecksum ? "gate-pass" : "gate-block"}
                          >
                            <strong>内容校验和</strong>
                            <span>
                              {currentBuild?.contentChecksum
                                ? `${currentBuild.contentChecksum.slice(0, 12)}…`
                                : "缺失"}
                            </span>
                          </div>
                          <div
                            className={
                              currentBuild?.indexStatus === "ready" ? "gate-pass" : "gate-block"
                            }
                          >
                            <strong>预发布索引</strong>
                            <span>
                              {currentBuild?.indexStatus === "ready"
                                ? "就绪"
                                : (currentBuild?.indexStatus ?? "未知")}
                            </span>
                          </div>
                          <div
                            className={
                              candidateReadiness?.blockingReasons.some(
                                (reason) => reason.code === "review_issue_open",
                              )
                                ? "gate-block"
                                : "gate-pass"
                            }
                          >
                            <strong>开放问题</strong>
                            <span>
                              {candidateReadiness?.blockingReasons.filter(
                                (reason) => reason.code === "review_issue_open",
                              ).length ?? 0}{" "}
                              条
                            </span>
                          </div>
                        </div>

                        {candidateReadiness && !candidateReadiness.ready && (
                          <div className="blocker-list">
                            <strong>发布前必须处理</strong>
                            <ul>
                              {candidateReadiness.blockingReasons.map((reason, index) => (
                                <li key={`${reason.code}-${index}`}>
                                  <span>{gateLabels[reason.code] ?? reason.code}</span>
                                  <small>{reason.message}</small>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {candidateChecks.length > 0 && (
                          <details className="check-details">
                            <summary>自动检查记录（{candidateChecks.length}）</summary>
                            {candidateChecks.map((check) => (
                              <p key={check.id}>
                                <span className={`status-pill status-${check.status}`}>
                                  {check.status}
                                </span>{" "}
                                {check.checkType} · {check.message ?? "无补充说明"}
                              </p>
                            ))}
                          </details>
                        )}

                        <div className="candidate-actions">
                          <Button
                            disabled={!currentBuild}
                            onClick={() =>
                              currentBuild &&
                              (window.location.hash = `preview/${candidate.id}/${currentBuild.id}`)
                            }
                          >
                            在资料库中浏览当前 Build
                          </Button>
                          <Button onClick={() => go("issues")}>处理问题</Button>
                        </div>
                        <div className="promote-panel">
                          <label>
                            发布说明
                            <input
                              value={releaseNotes[candidate.id] ?? ""}
                              onChange={(event) =>
                                setReleaseNotes((all) => ({
                                  ...all,
                                  [candidate.id]: event.target.value,
                                }))
                              }
                              placeholder="说明本次正式版本包含的内容（必填）"
                            />
                          </label>
                          <Button
                            disabled={!canPromote}
                            onClick={async () => {
                              if (!currentBuild || !candidateReadiness?.ready) return;
                              setMessage("正在创建正式 Revision…");
                              try {
                                await api.promote(candidate.id, {
                                  buildId: currentBuild.id,
                                  contentChecksum: currentBuild.contentChecksum,
                                  expectedCurrentRevisionId: currentRevision?.id ?? null,
                                  releaseNote: releaseNotes[candidate.id]?.trim(),
                                  idempotencyKey: `promote-${candidate.id}-${currentBuild.id}`,
                                });
                                setMessage(
                                  "已提交正式发布。Worker 完成索引和原子激活后，MCP 才会切换到新 Revision。",
                                );
                                await refreshCandidates(gameId);
                              } catch (error) {
                                setMessage(`发布失败：${(error as Error).message}`);
                              }
                            }}
                          >
                            发布为正式 Revision
                          </Button>
                          {!candidateReadiness?.ready && (
                            <small>按钮已锁定：请先处理上方所有阻塞项。</small>
                          )}
                          {candidateReadiness?.ready && !releaseNotes[candidate.id]?.trim() && (
                            <small>填写发布说明后才能发布。</small>
                          )}
                        </div>
                      </article>
                    );
                  })
                ) : (
                  <div className="empty-state">
                    <strong>还没有预发布分支</strong>
                    <p>完成一次导入后，系统会自动在这里创建 Candidate 和 Build。</p>
                    <Button type="primary" onClick={() => go("intake")}>
                      前往导入
                    </Button>
                  </div>
                )}
              </div>
            </section>
          )}

          {page === "issues" && (
            <section className="admin-page" aria-labelledby="issues-heading">
              <div className="admin-page-heading">
                <div>
                  <span className="eyebrow">REVIEW QUEUE</span>
                  <h2 id="issues-heading">问题审核</h2>
                  <p>只处理真正发现的问题，不需要逐条核对全部预发布数据。</p>
                </div>
                <Button onClick={() => refreshIssues().then(() => setMessage("问题列表已刷新"))}>
                  刷新问题
                </Button>
              </div>
              <div className="issue-list">
                {issues.length ? (
                  issues.map((issue) => {
                    const action = issueAction[issue.id] ?? "use_incoming";
                    const uploaded =
                      evidenceUploaded[issue.id] || Boolean(evidence[issue.id]?.length);
                    const note = issueAction[`${issue.id}:note`] ?? "";
                    const version = issueAction[`${issue.id}:version`] ?? "";
                    const locale = issueAction[`${issue.id}:locale`] ?? "zh-CN";
                    const field = issueAction[`${issue.id}:field`] ?? "";
                    const value = issueAction[`${issue.id}:value`] ?? "";
                    const canPatch = Boolean(
                      issue.candidateId &&
                      uploaded &&
                      (action !== "manual" || (field.trim() && value.trim())),
                    );
                    return (
                      <article className="issue-card" key={issue.id}>
                        <header>
                          <div>
                            <span className="eyebrow">{issue.kind}</span>
                            <h3>{String(issue.details?.title ?? issue.canonicalKey)}</h3>
                            <code>{issue.canonicalKey}</code>
                          </div>
                          <span className="status-pill status-open">
                            {statusLabel[issue.status] ?? issue.status}
                          </span>
                        </header>
                        <p className="issue-summary">{issue.summary}</p>
                        {issue.candidateId && evidence[issue.id] === undefined && (
                          <Button
                            size="small"
                            className="load-evidence-button"
                            onClick={() => void loadEvidence(issue.id)}
                          >
                            加载已有证据
                          </Button>
                        )}
                        {Object.keys(issue.details ?? {}).length > 0 && (
                          <details>
                            <summary>问题上下文</summary>
                            <pre>{JSON.stringify(issue.details, null, 2)}</pre>
                          </details>
                        )}

                        <div className="review-form">
                          <label>
                            处理动作
                            <select
                              aria-label={`处理动作 ${issue.canonicalKey}`}
                              value={action}
                              onChange={(event) =>
                                setIssueAction((all) => ({
                                  ...all,
                                  [issue.id]: event.target.value,
                                }))
                              }
                            >
                              <option value="use_incoming">采用预发布内容</option>
                              <option value="keep_main">保留当前正式内容</option>
                              <option value="manual">人工修改字段</option>
                              <option value="not_duplicate">确认不是重复记录</option>
                              <option value="confirm_delete">确认删除</option>
                              <option value="exclude_record">从本次版本排除</option>
                            </select>
                          </label>
                          {action === "manual" && (
                            <>
                              <label>
                                修改字段
                                <input
                                  aria-label={`修改字段 ${issue.canonicalKey}`}
                                  value={field}
                                  onChange={(event) =>
                                    setIssueAction((all) => ({
                                      ...all,
                                      [`${issue.id}:field`]: event.target.value,
                                    }))
                                  }
                                  placeholder="例如 title 或 metadata.rarity"
                                />
                              </label>
                              <label className="admin-form-wide">
                                修改后的值
                                <textarea
                                  aria-label={`修改内容 ${issue.canonicalKey}`}
                                  value={value}
                                  onChange={(event) =>
                                    setIssueAction((all) => ({
                                      ...all,
                                      [`${issue.id}:value`]: event.target.value,
                                    }))
                                  }
                                />
                              </label>
                            </>
                          )}
                          <label>
                            核对的游戏版本
                            <input
                              aria-label={`核对版本 ${issue.canonicalKey}`}
                              value={version}
                              onChange={(event) =>
                                setIssueAction((all) => ({
                                  ...all,
                                  [`${issue.id}:version`]: event.target.value,
                                }))
                              }
                              placeholder="例如 7.0"
                            />
                          </label>
                          <label>
                            核对语言
                            <input
                              aria-label={`核对语言 ${issue.canonicalKey}`}
                              value={locale}
                              onChange={(event) =>
                                setIssueAction((all) => ({
                                  ...all,
                                  [`${issue.id}:locale`]: event.target.value,
                                }))
                              }
                            />
                          </label>
                          <label className="admin-form-wide">
                            截图说明
                            <textarea
                              aria-label={`说明 ${issue.canonicalKey}`}
                              value={note}
                              onChange={(event) =>
                                setIssueAction((all) => ({
                                  ...all,
                                  [`${issue.id}:note`]: event.target.value,
                                }))
                              }
                              placeholder="说明截图中可以核实的字段（必填）"
                            />
                          </label>
                          <div
                            className={
                              evidenceFiles[issue.id]
                                ? "admin-form-wide evidence-picker is-hidden"
                                : "admin-form-wide evidence-picker is-visible"
                            }
                          >
                            游戏内截图（PNG、JPEG 或 WebP，最大 5 MB）
                            {!evidenceFiles[issue.id] && (
                              <input
                                className="evidence-file-input"
                                type="file"
                                accept="image/png,image/jpeg,image/webp"
                                onChange={(event) => {
                                  const file = event.target.files?.[0] ?? null;
                                  setEvidenceFiles((all) => ({ ...all, [issue.id]: file }));
                                  setEvidenceUploaded((all) => ({ ...all, [issue.id]: false }));
                                }}
                              />
                            )}
                            {evidenceFiles[issue.id] && !evidenceUploaded[issue.id] && (
                              <span>{evidenceFiles[issue.id]?.name}</span>
                            )}
                          </div>
                        </div>

                        {evidence[issue.id]?.length ? (
                          <div className="evidence-list">
                            <strong>已上传证据</strong>
                            {(evidence[issue.id] ?? []).map((item) => (
                              <a
                                key={item.id}
                                href={`/api/admin/review-evidence/${item.id}`}
                                target="_blank"
                                rel="noreferrer"
                              >
                                {item.checkedGameVersion} · {item.checkedLocale} · {item.note}
                              </a>
                            ))}
                          </div>
                        ) : null}
                        <div className="issue-actions admin-form-wide">
                          <Button
                            disabled={
                              !evidenceFiles[issue.id] ||
                              !version.trim() ||
                              !locale.trim() ||
                              !note.trim()
                            }
                            onClick={async () => {
                              const file = evidenceFiles[issue.id];
                              if (!file) return;
                              try {
                                const uploadedEvidence = (await api.uploadEvidence(issue.id, {
                                  mimeType: file.type as "image/png" | "image/jpeg" | "image/webp",
                                  dataBase64: await fileAsBase64(file),
                                  checkedGameVersion: version.trim(),
                                  checkedLocale: locale.trim(),
                                  note: note.trim(),
                                })) as ReviewEvidence;
                                setEvidence((all) => ({
                                  ...all,
                                  [issue.id]: [uploadedEvidence, ...(all[issue.id] ?? [])],
                                }));
                                setEvidenceUploaded((all) => ({ ...all, [issue.id]: true }));
                                setMessage("截图证据已上传，可以生成 Patch。");
                              } catch (error) {
                                setMessage(`证据上传失败：${(error as Error).message}`);
                              }
                            }}
                          >
                            上传截图证据
                          </Button>
                          <Button
                            disabled={!canPatch}
                            onClick={async () => {
                              if (!issue.candidateId) return;
                              try {
                                const result = (await api.createPatch(issue.candidateId, {
                                  issueId: issue.id,
                                  canonicalKey: issue.canonicalKey,
                                  action,
                                  ...(action === "manual"
                                    ? { fieldPath: field.trim(), manualValue: value }
                                    : {}),
                                })) as { build?: { id: string; buildNumber: number } };
                                if (!result.build) throw new Error("服务端没有返回新 Build");
                                setMessage(
                                  `问题已应用到 Build ${result.build.buildNumber}。旧 Build 保持不变。`,
                                );
                                await refreshIssues();
                                await refreshCandidates(gameId);
                                window.location.hash = `preview/${issue.candidateId}/${result.build.id}`;
                              } catch (error) {
                                setMessage(`创建 Patch 失败：${(error as Error).message}`);
                              }
                            }}
                          >
                            生成 Patch 与 Build N+1
                          </Button>
                        </div>
                        {!uploaded && (
                          <small className="blocking-hint">
                            必须先上传真实游戏内截图，才能提交处理结果。
                          </small>
                        )}
                      </article>
                    );
                  })
                ) : (
                  <div className="empty-state">
                    <strong>没有待处理问题</strong>
                    <p>可以返回预发布页面检查门禁并准备发布。</p>
                    <Button onClick={() => go("preview")}>返回预发布与发布</Button>
                  </div>
                )}
              </div>
            </section>
          )}

          {page === "history" && (
            <section className="admin-page" aria-labelledby="history-heading">
              <div className="admin-page-heading">
                <div>
                  <span className="eyebrow">REVISIONS</span>
                  <h2 id="history-heading">正式版本历史</h2>
                  <p>MCP 默认只读取标记为 Current 且索引就绪的正式 Revision。</p>
                </div>
              </div>
              <div className="revision-list">
                {revisions.length ? (
                  revisions.map((revision) => {
                    const canRollback =
                      revision.lifecycleStatus === "published" &&
                      revision.indexStatus === "ready" &&
                      Boolean(revision.manifestId) &&
                      !revision.isCurrent;
                    return (
                      <article className="revision-card" key={revision.id}>
                        <header>
                          <div>
                            <span className="eyebrow">
                              REVISION {revision.revisionNumber ?? "—"}
                            </span>
                            <h3>正式版本 #{revision.revisionNumber ?? revision.id.slice(0, 8)}</h3>
                          </div>
                          {revision.isCurrent && (
                            <span className="readiness-badge ready">MCP Current</span>
                          )}
                        </header>
                        <dl className="revision-facts">
                          <div>
                            <dt>状态</dt>
                            <dd>{revision.lifecycleStatus ?? revision.status ?? "—"}</dd>
                          </div>
                          <div>
                            <dt>索引</dt>
                            <dd>{revision.indexStatus ?? "—"}</dd>
                          </div>
                          <div>
                            <dt>Manifest</dt>
                            <dd>
                              {revision.manifestId ? `${revision.manifestId.slice(0, 8)}…` : "缺失"}
                            </dd>
                          </div>
                          <div>
                            <dt>发布时间</dt>
                            <dd>{formatTime(revision.publishedAt)}</dd>
                          </div>
                        </dl>
                        <p>{revision.releaseNote || "未填写发布说明"}</p>
                        {canRollback && (
                          <div className="rollback-panel">
                            <input
                              aria-label={`回滚原因 ${revision.id}`}
                              value={rollbackReasons[revision.id] ?? ""}
                              onChange={(event) =>
                                setRollbackReasons((all) => ({
                                  ...all,
                                  [revision.id]: event.target.value,
                                }))
                              }
                              placeholder="填写切换回该版本的原因（必填）"
                            />
                            <button
                              type="button"
                              className="rollback-button"
                              disabled={!rollbackReasons[revision.id]?.trim()}
                              onClick={() => setRollbackTarget(revision)}
                            >
                              切换到此 Revision
                            </button>
                          </div>
                        )}
                      </article>
                    );
                  })
                ) : (
                  <div className="empty-state">
                    <strong>尚未发布正式版本</strong>
                    <p>预发布 Candidate 通过门禁并完成发布后，Revision 会出现在这里。</p>
                    <Button onClick={() => go("preview")}>查看预发布版本</Button>
                  </div>
                )}
              </div>
            </section>
          )}
          <Modal
            title="确认切换正式版本"
            open={Boolean(rollbackTarget)}
            onCancel={() => setRollbackTarget(null)}
            onOk={async () => {
              const revision = rollbackTarget;
              if (!revision) return;
              try {
                await api.rollback(revision.id, rollbackReasons[revision.id]!.trim());
                setMessage(`已切换到正式版本 #${revision.revisionNumber ?? revision.id}`);
                setRevisions((await api.revisions(gameId)).revisions);
              } catch (error) {
                setMessage(`回滚失败：${(error as Error).message}`);
              } finally {
                setRollbackTarget(null);
              }
            }}
            okText="确认切换"
            okButtonProps={{
              danger: true,
              disabled: !rollbackTarget || !rollbackReasons[rollbackTarget.id]?.trim(),
            }}
          >
            <Typography.Paragraph>
              即将把 MCP 正式数据切换到 Revision #{rollbackTarget?.revisionNumber}。
              此操作会立即影响所有读者，请确认已填写切换原因。
            </Typography.Paragraph>
          </Modal>
        </div>
      </AntdLayout>
    </AntdLayout>
  );
}
