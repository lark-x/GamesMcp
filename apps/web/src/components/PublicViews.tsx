import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type {
  ArchiveHomeResponse,
  Citation,
  DocumentSummary,
  EntitySummary,
  EvidenceAnswer,
  SearchResult,
} from "@gip/contracts";
import type { DocumentDetail, EntityDetail } from "@gip/domain";
import { apiFetch } from "../api.js";
import type { QuestDetail, QuestSearchHit } from "../api.js";
import {
  ARCHIVE_CATEGORIES,
  documentTypeLabel,
  entityTypeLabel,
  type ArchiveCategory,
} from "../shared.js";
const questTypeOptions = [
  ["", "全部任务"],
  ["archon_quest", "魔神任务"],
  ["story_quest", "传说任务"],
  ["world_quest", "世界任务"],
  ["event_quest", "活动任务"],
] as const;

function questTypeLabel(type: QuestSearchHit["type"]): string {
  return (
    {
      archon_quest: "魔神任务",
      story_quest: "传说任务",
      world_quest: "世界任务",
      event_quest: "活动任务",
    }[type] ?? type
  );
}

function completenessLabel(value: QuestSearchHit["completeness"]): string {
  return (
    {
      complete: "完整",
      partial: "部分",
      metadata_only: "仅元数据",
    }[value] ?? value
  );
}

function dialogueTypeLabel(type: string): string {
  return (
    {
      dialogue: "对话",
      player_choice: "旅行者选项",
      narration: "旁白",
      objective: "任务目标",
      system_text: "系统文本",
    }[type] ?? "剧情文本"
  );
}

export function QuestReader({
  gameId,
  gameName,
  revisionLabel,
  selectedRevision,
  onBack,
}: {
  gameId: string;
  gameName: string;
  revisionLabel: string;
  selectedRevision?: string;
  onBack: () => void;
}) {
  const [query, setQuery] = useState("");
  const [locale, setLocale] = useState("zh-CN");
  const [questType, setQuestType] = useState("");
  const [quests, setQuests] = useState<QuestSearchHit[]>([]);
  const [selectedQuest, setSelectedQuest] = useState<QuestDetail | null>(null);
  const [selectedSubquestKey, setSelectedSubquestKey] = useState<string | undefined>();
  const [cursor, setCursor] = useState<string | null | undefined>();
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");

  async function searchQuests(event?: FormEvent) {
    event?.preventDefault();
    setError("");
    setLoading(true);
    const previousQuestKey = selectedQuest?.questKey;
    try {
      const params = new URLSearchParams({ locale, limit: "30" });
      if (query.trim()) params.set("q", query.trim());
      if (questType) params.set("type", questType);
      if (selectedRevision) params.set("revisionId", selectedRevision);
      const result = await apiFetch<{ quests: QuestSearchHit[] }>(
        `/api/games/${gameId}/quests?${params.toString()}`,
      );
      setQuests(result.quests);
      setCursor(undefined);
      setSelectedQuest(null);
      if (previousQuestKey) {
        const previous = result.quests.find((item) => item.questKey === previousQuestKey);
        if (previous) void openQuest(previous, undefined, selectedSubquestKey);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "任务列表加载失败");
    } finally {
      setLoading(false);
    }
  }

  async function openQuest(
    hit: QuestSearchHit,
    nextCursor?: string | null,
    subquestKey: string | undefined = selectedSubquestKey,
  ) {
    setError("");
    setDetailLoading(true);
    try {
      const params = new URLSearchParams({ locale, limit: "100" });
      if (selectedRevision) params.set("revisionId", selectedRevision);
      if (nextCursor) params.set("cursor", nextCursor);
      if (subquestKey) params.set("subquestId", subquestKey);
      const result = await apiFetch<{ quest: QuestDetail }>(
        `/api/games/${gameId}/quests/${encodeURIComponent(hit.questKey)}?${params.toString()}`,
      );
      setSelectedQuest((current) =>
        nextCursor && current
          ? {
              ...result.quest,
              dialogueNodes: [...current.dialogueNodes, ...result.quest.dialogueNodes],
              dialogueEdges: [...current.dialogueEdges, ...result.quest.dialogueEdges],
              citations: [...current.citations, ...result.quest.citations],
              loadedDialogueNodes:
                (current.loadedDialogueNodes ?? current.dialogueNodes.length) +
                (result.quest.loadedDialogueNodes ?? result.quest.dialogueNodes.length),
            }
          : result.quest,
      );
      setCursor(result.quest.nextCursor);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "任务详情加载失败");
    } finally {
      setDetailLoading(false);
    }
  }

  useEffect(() => {
    void searchQuests();
  }, [gameId, locale, questType, selectedRevision]);

  const selectedHit =
    selectedQuest && quests.find((quest) => quest.questKey === selectedQuest.questKey);

  return (
    <div className="app-shell quest-reader-shell">
      <header className="topbar library-topbar">
        <div className="library-brand">
          <span className="brand-mark" aria-hidden="true">
            任
          </span>
          <div>
            <span className="eyebrow">QUEST READER</span>
            <h1>剧情任务阅读器</h1>
          </div>
        </div>
        <div className="library-top-actions">
          <span className="library-data-state">
            {gameName} · {revisionLabel}
          </span>
          <button className="secondary-button" onClick={onBack}>
            返回资料库
          </button>
        </div>
      </header>
      {error && (
        <div className="error-banner" role="alert">
          <span>{error}</span>
          <button onClick={() => setError("")}>关闭</button>
        </div>
      )}
      <main className="quest-reader-layout">
        <aside className="panel quest-catalog-panel">
          <form className="quest-filter-form" onSubmit={searchQuests}>
            <label>
              <span>关键词</span>
              <input
                aria-label="搜索任务"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="任务名、章节或台词"
              />
            </label>
            <label>
              <span>语言</span>
              <select
                aria-label="任务语言"
                value={locale}
                onChange={(event) => setLocale(event.target.value)}
              >
                <option value="zh-CN">简体中文</option>
                <option value="en">English</option>
              </select>
            </label>
            <label>
              <span>类型</span>
              <select
                aria-label="任务类型"
                value={questType}
                onChange={(event) => setQuestType(event.target.value)}
              >
                {questTypeOptions.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={loading}>
              {loading ? "搜索中…" : "搜索任务"}
            </button>
          </form>
          <div className="quest-result-list" aria-busy={loading}>
            {quests.map((quest) => (
              <button
                type="button"
                key={`${quest.questKey}:${quest.locale}`}
                className={selectedQuest?.questKey === quest.questKey ? "is-active" : ""}
                onClick={() => {
                  setSelectedSubquestKey(undefined);
                  void openQuest(quest, undefined, undefined);
                }}
              >
                <strong>{quest.title}</strong>
                <span>
                  {questTypeLabel(quest.type)} · {completenessLabel(quest.completeness)}
                </span>
                <small>{quest.locale === "en" ? "English" : "简体中文"}</small>
              </button>
            ))}
            {!loading && !quests.length && (
              <ArchiveEmpty title="没有任务结果" detail="尝试切换语言、类型或缩短关键词。" />
            )}
          </div>
        </aside>
        <section className="panel quest-detail-panel" aria-busy={detailLoading}>
          {!selectedQuest ? (
            <div className="empty-detail">
              <span className="detail-mark">◇</span>
              <h2>选择一个任务开始阅读</h2>
              <p>任务详情会显示子任务、对话、分支和参与角色。</p>
            </div>
          ) : (
            <article className="quest-document">
              <div className="detail-header">
                <span className="type-pill">{questTypeLabel(selectedQuest.type)}</span>
                <h2>{selectedQuest.title}</h2>
                <p>
                  {completenessLabel(selectedQuest.completeness)} ·{" "}
                  {selectedQuest.locale === "en" ? "English" : "简体中文"}
                </p>
              </div>
              {selectedQuest.warnings.length > 0 && (
                <div className="inline-warning" role="status">
                  <strong>读取警告</strong>
                  <span>{selectedQuest.warnings.join("；")}</span>
                </div>
              )}
              <section className="quest-summary-grid">
                <div>
                  <h3>子任务</h3>
                  {selectedQuest.subquests.length ? (
                    selectedQuest.subquests.map((subquest) => (
                      <button
                        type="button"
                        className={`quest-subquest ${selectedSubquestKey === subquest.subquestKey ? "is-active" : ""}`}
                        key={subquest.subquestKey}
                        onClick={() => {
                          setSelectedSubquestKey(subquest.subquestKey);
                          if (selectedHit)
                            void openQuest(selectedHit, undefined, subquest.subquestKey);
                        }}
                      >
                        <strong>{subquest.title}</strong>
                        <small>{subquest.objective ?? "无目标文本"}</small>
                      </button>
                    ))
                  ) : (
                    <p className="muted">暂无子任务</p>
                  )}
                </div>
                <div>
                  <h3>参与者与关系</h3>
                  <p className="muted">
                    {selectedQuest.participants.map((item) => item.name).join("、") || "暂无"}
                  </p>
                  <p className="muted">
                    前置任务：
                    {selectedQuest.prerequisites.length
                      ? `${selectedQuest.prerequisites.length} 项`
                      : "暂无"}
                    ；本页分支 {selectedQuest.dialogueEdges.length} 条
                  </p>
                </div>
              </section>
              <h3>对话</h3>
              <div className="quest-dialogue-list">
                {selectedQuest.dialogueNodes
                  .filter((node) => node.body.trim() && node.type !== "system_text")
                  .map((node) => (
                    <article
                      id={node.nodeKey}
                      className={`quest-dialogue-node ${node.type}`}
                      key={node.nodeKey}
                    >
                      <header>
                        <strong>
                          {node.speakerName ?? (node.type === "narration" ? "旁白" : "未知")}
                        </strong>
                        <small>{dialogueTypeLabel(node.type)}</small>
                      </header>
                      <p>{node.body}</p>
                    </article>
                  ))}
              </div>
              {selectedQuest.dialogueEdges.length > 0 && (
                <section className="quest-branch-list" aria-label="任务分支">
                  <h3>分支与选择</h3>
                  <ul>
                    {selectedQuest.dialogueEdges.map((edge, index) => {
                      const target = selectedQuest.dialogueNodes.find(
                        (node) => node.nodeKey === edge.toNodeKey,
                      );
                      return (
                        <li key={`${edge.fromNodeKey}:${edge.toNodeKey}:${index}`}>
                          <span>{edge.optionText ?? dialogueTypeLabel(edge.type)}</span>
                          <small>
                            {target?.speakerName ? `${target.speakerName}：` : ""}
                            {target?.body ?? "后续节点未加载"}
                          </small>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
              <p className="quest-page-status" role="status">
                已加载 {selectedQuest.loadedDialogueNodes ?? selectedQuest.dialogueNodes.length} /{" "}
                {selectedQuest.totalDialogueNodes ?? selectedQuest.dialogueNodes.length} 条对话
              </p>
              <div className="quest-reader-actions">
                <button
                  type="button"
                  disabled={!cursor || detailLoading || !selectedHit}
                  onClick={() => selectedHit && void openQuest(selectedHit, cursor)}
                >
                  {cursor ? "读取下一页对话" : "已到末尾"}
                </button>
              </div>
            </article>
          )}
        </section>
      </main>
    </div>
  );
}

export function LoadingCards() {
  return (
    <div className="loading-card-grid" role="status" aria-label="资料加载中">
      {[0, 1, 2, 3].map((item) => (
        <div className="loading-card" key={item}>
          <span />
          <i />
          <i />
        </div>
      ))}
    </div>
  );
}

export function ArchiveHome({
  home,
  onEntity,
  onDocument,
  onCategory,
}: {
  home: ArchiveHomeResponse | null;
  onEntity: (id: string) => void;
  onDocument: (id: string) => void;
  onCategory: (category: ArchiveCategory) => void;
}) {
  const categories = home?.categories ?? [];
  return (
    <div className="archive-home">
      <section className="archive-home-section">
        <div className="section-title-row">
          <div>
            <span className="eyebrow">EXPLORE</span>
            <h3>按主题浏览</h3>
          </div>
          <small>{home ? `${home.locale} · ${home.revision}` : "按游戏内资料分类浏览"}</small>
        </div>
        <div className="topic-card-grid">
          {categories.map((category) => {
            const definition = ARCHIVE_CATEGORIES.find((item) => item.id === category.id);
            return (
              <button
                type="button"
                className="topic-card"
                key={category.id}
                onClick={() => definition && onCategory(definition)}
              >
                <span className="topic-marker" aria-hidden="true">
                  {definition?.marker ?? "·"}
                </span>
                <span>
                  <strong>{category.label}</strong>
                  <small>{category.description}</small>
                </span>
                <em>{category.count}</em>
                <b aria-hidden="true">›</b>
              </button>
            );
          })}
        </div>
      </section>

      <section className="archive-home-section">
        <div className="section-title-row">
          <div>
            <span className="eyebrow">CURATED ENTRIES</span>
            <h3>分类索引</h3>
          </div>
          <small>首页只展示有意义的游戏名称</small>
        </div>
        <div className="archive-category-preview-grid">
          {categories.map((category) => (
            <section className="archive-category-preview" key={category.id}>
              <div className="section-title-row compact">
                <h4>{category.label}</h4>
                <button
                  type="button"
                  onClick={() => {
                    const definition = ARCHIVE_CATEGORIES.find((item) => item.id === category.id);
                    if (definition) onCategory(definition);
                  }}
                >
                  查看全部
                </button>
              </div>
              {category.entries.length ? (
                <div className="archive-name-list">
                  {category.entries.map((entry) => (
                    <button
                      type="button"
                      key={`${entry.kind}:${entry.id}`}
                      onClick={() =>
                        entry.kind === "entity" ? onEntity(entry.id) : onDocument(entry.id)
                      }
                    >
                      <span>{entry.name}</span>
                      <b aria-hidden="true">›</b>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted">暂无已发布资料</p>
              )}
            </section>
          ))}
        </div>
      </section>
    </div>
  );
}

export function SearchResultFeed({
  search,
  onEntity,
  onDocument,
}: {
  search: SearchResult;
  onEntity: (id: string, revisionId?: string) => void;
  onDocument: (id: string, revisionId?: string, segmentId?: string) => void;
}) {
  const total = search.entities.length + search.documents.length + search.segments.length;
  if (!total) {
    return (
      <ArchiveEmpty
        title="没有找到匹配资料"
        detail="可以尝试缩短关键词、切换资料分类，或清除版本与来源筛选。"
      />
    );
  }
  return (
    <div className="search-result-feed">
      <div className="search-revision-line">
        <span>检索基于 {search.revision || "当前版本"}</span>
        <small>索引状态：{search.indexStatus}</small>
      </div>
      {search.entities.length > 0 && (
        <section className="search-result-group">
          <div className="section-title-row compact">
            <h3>实体</h3>
            <span>{search.entities.length}</span>
          </div>
          <div className="archive-card-grid">
            {search.entities.map((item) => (
              <EntityResultCard
                key={item.id}
                item={item}
                onOpen={() => onEntity(item.id, search.revisionId)}
              />
            ))}
          </div>
        </section>
      )}
      {search.documents.length > 0 && (
        <section className="search-result-group">
          <div className="section-title-row compact">
            <h3>文档</h3>
            <span>{search.documents.length}</span>
          </div>
          <div className="archive-card-grid">
            {search.documents.map((item) => (
              <DocumentResultCard
                key={item.id}
                item={item}
                onOpen={() => onDocument(item.id, search.revisionId)}
              />
            ))}
          </div>
        </section>
      )}
      {search.segments.length > 0 && (
        <section className="search-result-group">
          <div className="section-title-row compact">
            <h3>原文片段</h3>
            <span>{search.segments.length}</span>
          </div>
          <div className="segment-result-list">
            {search.segments.map((item) => (
              <button
                type="button"
                className="segment-result-card"
                key={item.segmentId}
                onClick={() => onDocument(item.id, search.revisionId, item.segmentId)}
              >
                <span className="result-type-row">
                  <b>原文片段</b>
                  <small>{documentTypeLabel(item.type)}</small>
                </span>
                <strong>{item.title}</strong>
                <p>{item.snippet || "点击查看完整原文与上下文。"}</p>
                <span className="result-metadata">
                  <small>{item.match ?? "正文命中"}</small>
                  <small>{item.gameVersion ?? item.revision ?? search.revision}</small>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function EntityResultCard({ item, onOpen }: { item: EntitySummary; onOpen: () => void }) {
  return (
    <button type="button" className="archive-result-card entity-result-card" onClick={onOpen}>
      <span className="result-card-emblem" aria-hidden="true">
        {item.name.slice(0, 1)}
      </span>
      <span className="result-card-body">
        <span className="result-type-row">
          <b>{entityTypeLabel(item.type)}</b>
          {item.match && <small>{item.match}</small>}
        </span>
        <strong>{item.name}</strong>
        <p>{item.summary || item.aliases.join(" · ") || "点击查看属性、关系和相关文档。"}</p>
        <span className="result-metadata">
          <small>{item.aliases.slice(0, 2).join(" · ") || "无其他别名"}</small>
          <small>{item.revision ?? "当前版本"}</small>
        </span>
      </span>
    </button>
  );
}

function DocumentResultCard({ item, onOpen }: { item: DocumentSummary; onOpen: () => void }) {
  return (
    <button type="button" className="archive-result-card document-result-card" onClick={onOpen}>
      <span className="result-card-emblem" aria-hidden="true">
        文
      </span>
      <span className="result-card-body">
        <span className="result-type-row">
          <b>{documentTypeLabel(item.type)}</b>
          {item.match && <small>{item.match}</small>}
        </span>
        <strong>{item.title}</strong>
        <p>{item.snippet || "点击阅读完整内容、章节目录和资料出处。"}</p>
        <span className="result-metadata">
          <small>{item.gameVersion ?? "游戏版本未知"}</small>
          <small>{item.revision ?? "当前版本"}</small>
        </span>
      </span>
    </button>
  );
}

function ArchiveEmpty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="archive-empty">
      <span aria-hidden="true">◇</span>
      <strong>{title}</strong>
      <p>{detail}</p>
    </div>
  );
}

export function EntityView({
  entity,
  onEntity,
  onDocument,
  onCitation,
}: {
  entity: EntityDetail;
  onEntity: (id: string, revisionId?: string) => void;
  onDocument: (id: string, revisionId?: string, segmentId?: string) => void;
  onCitation: (citation: Citation) => void;
}) {
  return (
    <article>
      <div className="detail-header">
        <span className="type-pill">{entityTypeLabel(entity.type)}</span>
        <h2>{entity.name}</h2>
        <p>{entity.summary || "暂无摘要"}</p>
        <div className="chips">
          {entity.aliases.map((alias) => (
            <span key={alias}>{alias}</span>
          ))}
        </div>
      </div>
      <details className="properties-details">
        <summary>查看结构化属性 JSON</summary>
        <pre className="properties-box">{JSON.stringify(entity.properties, null, 2)}</pre>
      </details>
      <h3>关系</h3>
      {entity.relationships.length ? (
        <ul className="relationship-list">
          {entity.relationships.map((relation) => (
            <li key={relation.id}>
              <button className="inline-link" onClick={() => onEntity(relation.subjectId)}>
                {relation.subjectName}
              </button>
              <b>{relation.predicate}</b>
              <button className="inline-link" onClick={() => onEntity(relation.objectId)}>
                {relation.objectName}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">暂无已发布关系</p>
      )}
      <h3>相关文档</h3>
      {entity.documents.length ? (
        entity.documents.map((doc) => (
          <button className="link-row" key={doc.id} onClick={() => onDocument(doc.id)}>
            {doc.title}
            <span>
              {documentTypeLabel(doc.type)} · {doc.gameVersion ?? "版本未知"}
            </span>
          </button>
        ))
      ) : (
        <p className="muted">暂无相关文档</p>
      )}
      {entity.claims.length > 0 && (
        <>
          <h3>证据主张</h3>
          {entity.claims.map((claim) => (
            <div className={`claim-card claim-${claim.status}`} key={claim.id}>
              <strong>{claim.status}</strong>
              <p>{claim.statement}</p>
              <small>
                {claim.evidence.length} 条证据 · 置信度 {claim.confidence ?? "未知"}
              </small>
              {claim.evidence.map((item) => (
                <button
                  className="citation-card"
                  key={item.id}
                  onClick={() =>
                    onCitation({
                      documentId: item.documentId,
                      documentTitle: item.documentTitle,
                      segmentId: item.segmentId,
                      quote: item.quote,
                      sourceName: "—",
                      gameVersion: null,
                      datasetRevision: entity.revision ?? "",
                    })
                  }
                >
                  <span>引用 · {item.documentTitle}</span>
                  <small>{item.quote}</small>
                </button>
              ))}
            </div>
          ))}
        </>
      )}
    </article>
  );
}

export function DocumentView({
  document,
  activeSegmentId,
  onEntity,
  onCopy,
}: {
  document: DocumentDetail;
  activeSegmentId?: string;
  onEntity: (id: string) => void;
  onCopy: (document: DocumentDetail, segmentId: string, body: string) => void;
}) {
  useEffect(() => {
    if (!activeSegmentId) return;
    globalThis.document
      .getElementById(activeSegmentId)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeSegmentId, document]);
  return (
    <article>
      <div className="detail-header">
        <span className="type-pill">{documentTypeLabel(document.type)}</span>
        <h2>{document.title}</h2>
        <p>
          {document.sourceName} · {document.gameVersion ?? "游戏版本未知"} · Dataset Revision{" "}
          {document.revision}
        </p>
      </div>
      {document.provenance && (
        <details className="provenance-panel">
          <summary>查看完整出处</summary>
          <dl>
            <dt>Dataset Revision</dt>
            <dd>{document.provenance.datasetRevision ?? document.revision ?? "—"}</dd>
            <dt>Source Snapshot</dt>
            <dd>{document.provenance.sourceSnapshotId ?? "—"}</dd>
            <dt>Canonical Key</dt>
            <dd>{document.provenance.canonicalKey ?? document.sourceKey ?? "—"}</dd>
            <dt>上游仓库</dt>
            <dd>{document.provenance.upstreamSource ?? "—"}</dd>
            <dt>Commit / 版本</dt>
            <dd>
              {document.provenance.upstreamCommit ?? "—"} ·{" "}
              {document.provenance.upstreamVersionLabel ?? "—"}
            </dd>
            <dt>语言</dt>
            <dd>{document.provenance.locale ?? "—"}</dd>
            <dt>相对文件</dt>
            <dd>
              {document.provenance.sourceFiles?.join(" · ") ||
                document.provenance.readableFile ||
                "—"}
            </dd>
            <dt>上游 ID</dt>
            <dd>{JSON.stringify(document.provenance.upstreamIds ?? {})}</dd>
            <dt>字段映射</dt>
            <dd>{JSON.stringify(document.provenance.lineage ?? {})}</dd>
            <dt>TextMap Hash</dt>
            <dd>{JSON.stringify(document.provenance.textMapHashes ?? {})}</dd>
            <dt>正文哈希</dt>
            <dd>
              normalized: {document.provenance.normalizedContentHash ?? "—"}
              <br />
              raw: {document.provenance.rawContentHash ?? "—"}
            </dd>
            <dt>转换步骤</dt>
            <dd>{document.provenance.transforms?.join(" → ") || "—"}</dd>
          </dl>
        </details>
      )}
      <div className="document-body">
        <nav className="document-toc" aria-label="文档目录">
          {document.segments.map((segment) => (
            <a key={segment.id} href={`#${segment.id}`}>
              片段 {segment.ordinal + 1}
              {segment.headingPath.length ? ` · ${segment.headingPath.join(" / ")}` : ""}
            </a>
          ))}
        </nav>
        {document.segments.map((segment) => (
          <section
            className={`document-segment ${activeSegmentId === segment.id ? "is-active" : ""}`}
            id={segment.id}
            key={segment.id}
          >
            <div className="segment-toolbar">
              <span className="segment-label">片段 {segment.ordinal + 1}</span>
              <button
                className="copy-button"
                onClick={() => onCopy(document, segment.id, segment.body)}
              >
                复制引用
              </button>
            </div>
            {segment.headingPath.length > 0 && <h3>{segment.headingPath.join(" / ")}</h3>}
            <p>{segment.body}</p>
            {segment.mentions.length > 0 && (
              <div className="mention-row" aria-label="片段中的实体">
                {segment.mentions.map((mention) => (
                  <button
                    className="mention"
                    key={`${mention.entityId}-${mention.startOffset}`}
                    onClick={() => onEntity(mention.entityId)}
                  >
                    {mention.name}
                  </button>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
    </article>
  );
}

export function AnswerView({
  answer,
  onCitation,
  onEntity,
}: {
  answer: EvidenceAnswer;
  onCitation: (citation: Citation) => void;
  onEntity: (id: string) => void;
}) {
  return (
    <div className="answer-view">
      <div className="answer-summary">
        <span className={`confidence confidence-${answer.confidence}`}>{answer.confidence}</span>
        <span>Dataset Revision {answer.datasetRevision}</span>
      </div>
      <p className="answer-text">{answer.answer}</p>
      {answer.warnings.length > 0 && (
        <div className="warning-list">
          {answer.warnings.map((warning) => (
            <span key={warning}>⚠ {warning}</span>
          ))}
        </div>
      )}
      <h3>引用（点击跳转原文）</h3>
      <div className="citation-grid">
        {answer.citations.map((citation, index) => (
          <button
            className="citation-card"
            key={`${citation.segmentId}-${index}`}
            onClick={() => onCitation(citation)}
          >
            <span>
              [S{index + 1}] {citation.documentTitle}
            </span>
            <small>
              {citation.quote} · {citation.sourceName} · {citation.gameVersion ?? "版本未知"} ·
              source version {citation.sourceVersion ?? "—"}
            </small>
          </button>
        ))}
      </div>
      {answer.relatedEntities.length > 0 && (
        <>
          <h3>相关实体</h3>
          <div className="chips entity-chips">
            {answer.relatedEntities.map((item) => (
              <button key={item.id} className="entity-chip" onClick={() => onEntity(item.id)}>
                {item.name} · {item.type}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export async function copyCitationText(document: DocumentDetail, segmentId: string, body: string) {
  const text = `[Dataset Revision ${document.revision}] ${document.title} (${document.sourceName}) · source version ${document.sourceVersion ?? "—"} · segment ${segmentId}\n${body}`;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard permissions are optional in local deployments.
  }
}
