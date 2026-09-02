import { useEffect, useState } from "react";
import type { ArchiveHomeResponse } from "@gip/contracts";
import type { DocumentDetail } from "@gip/domain";
import { apiFetch } from "../api.js";
import {
  mapBookListResponse,
  mapCharacterStoryListResponse,
  mapMechanicsResponse,
  mapSectionReadResponse,
  mapTextItemDetailResponse,
  mapTextItemListResponse,
  mapVoiceListResponse,
  type CodexBook,
  type CodexBookCatalog,
  type CodexBookVolume,
  type CodexCharacterStory,
  type CodexCharacterStoryCatalog,
  type CodexCharacterStoryGroup,
  type CodexMechanicsResult,
  type CodexSectionRead,
  type CodexTextItem,
  type CodexVoiceCatalog,
} from "./mappers.js";

export type CodexCharacter = {
  stableId: string;
  name: string;
  title?: string | null;
  rarity?: number | null;
  element?: string | null;
  weaponType?: string | null;
  region?: string | null;
  affiliation?: string | null;
  description?: string | null;
};

export type CodexMaterial = {
  stableId: string;
  name: string;
  category: string;
  rarity?: number | null;
  description?: string | null;
  sources?: string[];
  usedBy?: string[];
};

export type CodexWeapon = {
  stableId: string;
  name: string;
  weaponType: string;
  rarity: number;
  baseAttack?: number | null;
  subStat?: string | null;
  passiveName?: string | null;
  passiveDescription?: string | null;
  description?: string | null;
};

export type CodexArtifact = {
  stableId: string;
  name: string;
  slot?: string | null;
  rarity?: number | null;
  description?: string | null;
};

export type CodexArtifactSet = {
  stableId: string;
  name: string;
  maxRarity?: number | null;
  twoPieceBonus?: string | null;
  fourPieceBonus?: string | null;
  pieces?: string[];
};

export type CodexAchievement = {
  stableId: string;
  name: string;
  category: string;
  requirement?: string | null;
  rewardPrimogems?: number | null;
  hidden?: boolean;
};

export type CodexEnemy = {
  stableId: string;
  name: string;
  category: string;
  family?: string | null;
  description?: string | null;
};

type ListResponse = { gameId: string; revisionId: string | null } & Record<string, unknown>;

function useCodexList<T>(
  gameId: string,
  kind: string,
): { items: T[]; error: string; loading: boolean } {
  const [items, setItems] = useState<T[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<ListResponse>(`/api/games/${gameId}/genshin/${kind}`)
      .then((result) => {
        if (cancelled) return;
        const listKey = ["artifactSets"].includes(kind)
          ? "artifactSets"
          : kind.endsWith("s")
            ? kind
            : `${kind}s`;
        const value = (result as Record<string, unknown>)[listKey];
        setItems(Array.isArray(value) ? (value as T[]) : []);
        setError("");
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, kind]);
  return { items, error, loading };
}

const ELEMENT_LABELS: Record<string, string> = {
  pyro: "火",
  hydro: "水",
  anemo: "风",
  electro: "雷",
  dendro: "草",
  cryo: "冰",
  geo: "岩",
};

function rarityStars(rarity?: number | null): string {
  return rarity ? "★".repeat(rarity) : "";
}

function ListGrid({
  items,
  error,
  loading,
}: {
  items: Array<{ key: string; title: string; subtitle?: string; body?: string }>;
  error: string;
  loading: boolean;
}) {
  if (loading) return <div className="codex-loading">加载中…</div>;
  if (error)
    return (
      <div className="error-banner" role="alert">
        {error}
      </div>
    );
  if (!items.length) return <div className="codex-empty">暂无数据</div>;
  return (
    <div className="codex-grid">
      {items.map((item) => (
        <article key={item.key} className="codex-card">
          <header>
            <h3>{item.title}</h3>
            {item.subtitle && <span className="codex-subtitle">{item.subtitle}</span>}
          </header>
          {item.body && <p>{item.body}</p>}
        </article>
      ))}
    </div>
  );
}

export function CodexCharactersPage({ gameId }: { gameId: string }) {
  const { items, error, loading } = useCodexList<CodexCharacter>(gameId, "characters");
  return (
    <section>
      <h2>角色</h2>
      <ListGrid
        loading={loading}
        error={error}
        items={items.map((character) => ({
          key: character.stableId,
          title: `${character.name}${character.title ? ` · ${character.title}` : ""}`,
          subtitle: [
            ELEMENT_LABELS[character.element ?? ""] ?? character.element,
            character.weaponType,
            rarityStars(character.rarity),
          ]
            .filter(Boolean)
            .join(" / "),
          body: character.description ?? undefined,
        }))}
      />
    </section>
  );
}

export function CodexMaterialsPage({ gameId }: { gameId: string }) {
  const { items, error, loading } = useCodexList<CodexMaterial>(gameId, "materials");
  return (
    <section>
      <h2>材料</h2>
      <ListGrid
        loading={loading}
        error={error}
        items={items.map((material) => ({
          key: material.stableId,
          title: material.name,
          subtitle: [material.category, rarityStars(material.rarity)].filter(Boolean).join(" / "),
          body: material.description ?? undefined,
        }))}
      />
    </section>
  );
}

export function CodexWeaponsPage({ gameId }: { gameId: string }) {
  const { items, error, loading } = useCodexList<CodexWeapon>(gameId, "weapons");
  return (
    <section>
      <h2>武器</h2>
      <ListGrid
        loading={loading}
        error={error}
        items={items.map((weapon) => ({
          key: weapon.stableId,
          title: weapon.name,
          subtitle: [weapon.weaponType, rarityStars(weapon.rarity)].filter(Boolean).join(" / "),
          body: weapon.description ?? undefined,
        }))}
      />
    </section>
  );
}

export function CodexArtifactsPage({ gameId }: { gameId: string }) {
  const artifacts = useCodexList<CodexArtifact>(gameId, "artifacts");
  const sets = useCodexList<CodexArtifactSet>(gameId, "artifactSets");
  return (
    <section>
      <h2>圣遗物</h2>
      {sets.items.length > 0 && (
        <div className="codex-set-list">
          {sets.items.map((set) => (
            <article key={set.stableId} className="codex-card">
              <header>
                <h3>{set.name}</h3>
                <span className="codex-subtitle">{rarityStars(set.maxRarity)}</span>
              </header>
              {set.twoPieceBonus && <p>二件套：{set.twoPieceBonus}</p>}
              {set.fourPieceBonus && <p>四件套：{set.fourPieceBonus}</p>}
            </article>
          ))}
        </div>
      )}
      <ListGrid
        loading={artifacts.loading}
        error={artifacts.error}
        items={artifacts.items.map((artifact) => ({
          key: artifact.stableId,
          title: artifact.name,
          subtitle: [artifact.slot, rarityStars(artifact.rarity)].filter(Boolean).join(" / "),
          body: artifact.description ?? undefined,
        }))}
      />
    </section>
  );
}

export function CodexAchievementsPage({ gameId }: { gameId: string }) {
  const { items, error, loading } = useCodexList<CodexAchievement>(gameId, "achievements");
  return (
    <section>
      <h2>成就</h2>
      <ListGrid
        loading={loading}
        error={error}
        items={items.map((achievement) => ({
          key: achievement.stableId,
          title: `${achievement.name}${achievement.hidden ? "（隐藏）" : ""}`,
          subtitle: achievement.category,
          body: achievement.requirement ?? undefined,
        }))}
      />
    </section>
  );
}

export function CodexEnemiesPage({ gameId }: { gameId: string }) {
  const { items, error, loading } = useCodexList<CodexEnemy>(gameId, "enemies");
  return (
    <section>
      <h2>敌人</h2>
      <ListGrid
        loading={loading}
        error={error}
        items={items.map((enemy) => ({
          key: enemy.stableId,
          title: enemy.name,
          subtitle: [enemy.category, enemy.family].filter(Boolean).join(" / "),
          body: enemy.description ?? undefined,
        }))}
      />
    </section>
  );
}

/** Voice rows are read from the real voice corpus; an empty source stays explicit. */
export function CodexVoicesPage({
  gameId,
  home,
  revisionId,
}: {
  gameId?: string;
  home?: ArchiveHomeResponse | null;
  revisionId?: string;
}) {
  const [catalog, setCatalog] = useState<CodexVoiceCatalog | null>(null);
  const [loading, setLoading] = useState(Boolean(gameId));
  const [error, setError] = useState("");

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ locale: "zh-CN", limit: "100" });
    if (revisionId) params.set("revisionId", revisionId);
    apiFetch<unknown>("/api/games/" + gameId + "/text/voices?" + params.toString())
      .then((value) => {
        if (!cancelled) setCatalog(mapVoiceListResponse(value));
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "语音列表加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, revisionId]);

  const fallbackCategory = home?.categories.find((item) => item.id === "voices");
  const fallback = fallbackCategory
    ? mapVoiceListResponse({
        gameId: home?.gameId,
        revisionId: home?.revisionId,
        locale: home.locale,
        count: fallbackCategory.count,
        voices: fallbackCategory.entries,
        corpusStatus: fallbackCategory.count ? "available" : "voice_source_missing",
      })
    : null;
  const view = catalog ?? fallback;

  return (
    <section>
      <div className="codex-page-heading">
        <div>
          <h2>角色语音</h2>
          <p className="codex-subtitle">
            {view?.count ?? 0} 条语音文本 · {view?.locale ?? "zh-CN"}
          </p>
        </div>
        <small className="corpus-status">corpusStatus: {view?.corpusStatus ?? "loading"}</small>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <div className="codex-loading">加载语音语料状态中…</div>
      ) : view?.corpusStatus !== "available" && !view?.voices.length ? (
        <div className="codex-empty codex-status-empty">
          <strong>当前没有可读取的角色语音语料</strong>
          <p>
            corpusStatus: {view?.corpusStatus ?? "voice_source_missing"}。固定上游快照没有
            AvatarVoice 正文源，因此此页不展示占位语音或假数据。
          </p>
          {view?.note && <small>{view.note}</small>}
        </div>
      ) : !view?.voices.length ? (
        <div className="codex-empty">暂无已发布语音文本</div>
      ) : (
        <div className="codex-grid">
          {view.voices.map((entry) => (
            <article className="codex-card" key={entry.id}>
              <header>
                <h3>{entry.name}</h3>
                <span className="codex-subtitle">{entry.locale ?? view.locale}</span>
              </header>
              <p className="codex-subtitle">来源记录：{entry.id}</p>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function documentPath(gameId: string, documentId: string, revisionId?: string): string {
  const suffix = revisionId ? "?revisionId=" + encodeURIComponent(revisionId) : "";
  return "/api/games/" + gameId + "/documents/" + encodeURIComponent(documentId) + suffix;
}

function sectionPath(
  gameId: string,
  documentId: string,
  section: string | undefined,
  revisionId?: string,
): string {
  const params = new URLSearchParams();
  if (section) params.set("section", section);
  params.set("max_chars", "8000");
  if (revisionId) params.set("revisionId", revisionId);
  return (
    "/api/games/" +
    gameId +
    "/text/documents/" +
    encodeURIComponent(documentId) +
    "/section?" +
    params.toString()
  );
}

function catalogVolumeEntries(catalog: CodexBookCatalog | null): Array<{
  book: CodexBook;
  volume: CodexBookVolume;
}> {
  return catalog?.books.flatMap((book) => book.volumes.map((volume) => ({ book, volume }))) ?? [];
}

function TextDocumentReader({
  textDocument,
  activeSegmentId,
  sectionRead,
  sectionLoading,
  onSegment,
}: {
  textDocument: DocumentDetail;
  activeSegmentId?: string;
  sectionRead: CodexSectionRead | null;
  sectionLoading: boolean;
  onSegment: (segment: DocumentDetail["segments"][number]) => void;
}) {
  useEffect(() => {
    if (!activeSegmentId) return;
    globalThis.document
      .getElementById("codex-segment-" + activeSegmentId)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [activeSegmentId, textDocument]);

  return (
    <article className="codex-reader-document">
      <header className="detail-header">
        <span className="type-pill">{textDocument.type === "book" ? "书籍" : "角色故事"}</span>
        <h2>{textDocument.title}</h2>
        <p>
          {textDocument.sourceName} · {textDocument.gameVersion ?? "游戏版本未知"} · Dataset
          Revision {textDocument.revision || "—"}
        </p>
      </header>
      <div className="codex-reader-body">
        <nav className="codex-reader-toc" aria-label="卷与章节目录">
          <strong>章节导航</strong>
          {textDocument.segments.map((segment) => (
            <button
              type="button"
              key={segment.id}
              className={activeSegmentId === segment.id ? "is-active" : ""}
              onClick={() => onSegment(segment)}
            >
              <span>片段 {segment.ordinal + 1}</span>
              <small>{segment.headingPath.join(" / ") || "正文"}</small>
            </button>
          ))}
        </nav>
        <div className="codex-reader-content">
          {!textDocument.segments.length && <p className="muted">暂无可定位的正文片段。</p>}
          {textDocument.segments.map((segment) => (
            <section
              className={
                "codex-reader-segment " + (activeSegmentId === segment.id ? "is-active" : "")
              }
              id={"codex-segment-" + segment.id}
              key={segment.id}
            >
              <div className="segment-toolbar">
                <span className="segment-label">片段 {segment.ordinal + 1}</span>
                <button type="button" className="copy-button" onClick={() => onSegment(segment)}>
                  定位并读取
                </button>
              </div>
              {segment.headingPath.length > 0 && <h3>{segment.headingPath.join(" / ")}</h3>}
              <p>{segment.body}</p>
              <div className="codex-citation" aria-label="正文引用">
                <strong>引用</strong>
                <span>
                  documentId={textDocument.id} · segmentId={segment.id} · revision=
                  {textDocument.revision || "—"} · locale={textDocument.locale ?? "—"}
                </span>
                <small>来源：{textDocument.sourceName}</small>
              </div>
            </section>
          ))}
        </div>
      </div>
      {sectionLoading && <div className="codex-loading">正在读取定位章节…</div>}
      {sectionRead && (
        <section className="codex-section-read" aria-label="章节读取结果">
          <div className="section-title-row compact">
            <h3>章节读取结果</h3>
            <small>{sectionRead.headingPath.join(" / ") || "全文"}</small>
          </div>
          <p>{sectionRead.body}</p>
          <div className="codex-citation">
            <strong>readSection 引用</strong>
            {sectionRead.citations.map((citation, index) => (
              <span key={citation.documentId + ":" + (citation.segmentId ?? index)}>
                documentId={citation.documentId} · segmentId={citation.segmentId ?? "—"} · revision=
                {citation.revision || sectionRead.revision} · locale={citation.locale}
              </span>
            ))}
          </div>
        </section>
      )}
    </article>
  );
}

export function CodexBooksPage({ gameId, revisionId }: { gameId: string; revisionId?: string }) {
  const [catalog, setCatalog] = useState<CodexBookCatalog | null>(null);
  const [selectedVolumeId, setSelectedVolumeId] = useState("");
  const [textDocument, setTextDocument] = useState<DocumentDetail | null>(null);
  const [activeSegmentId, setActiveSegmentId] = useState<string>();
  const [sectionRead, setSectionRead] = useState<CodexSectionRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [error, setError] = useState("");
  const [sectionError, setSectionError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ locale: "zh-CN", limit: "100" });
    if (revisionId) params.set("revisionId", revisionId);
    apiFetch<unknown>("/api/games/" + gameId + "/text/books?" + params.toString())
      .then((value) => {
        if (cancelled) return;
        const next = mapBookListResponse(value);
        setCatalog(next);
        const entries = catalogVolumeEntries(next);
        setSelectedVolumeId((current) =>
          current && entries.some((entry) => entry.volume.stableId === current)
            ? current
            : (entries[0]?.volume.stableId ?? ""),
        );
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "书籍列表加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, revisionId]);

  const selected = catalogVolumeEntries(catalog).find(
    (entry) => entry.volume.stableId === selectedVolumeId,
  )?.volume;

  useEffect(() => {
    if (!selected) {
      setTextDocument(null);
      return;
    }
    let cancelled = false;
    setDocumentLoading(true);
    setSectionRead(null);
    setSectionError("");
    apiFetch<{ document: DocumentDetail }>(documentPath(gameId, selected.documentId, revisionId))
      .then((result) => {
        if (!cancelled) {
          setTextDocument(result.document);
          setActiveSegmentId(undefined);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "书籍正文加载失败");
      })
      .finally(() => {
        if (!cancelled) setDocumentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, revisionId, selected?.documentId]);

  async function readSegment(segment: DocumentDetail["segments"][number]) {
    if (!textDocument) return;
    setActiveSegmentId(segment.id);
    setSectionRead(null);
    setSectionError("");
    setSectionLoading(true);
    try {
      setSectionRead(
        mapSectionReadResponse(
          await apiFetch<unknown>(
            sectionPath(gameId, textDocument.id, segment.headingPath.at(-1), revisionId),
          ),
        ),
      );
    } catch (reason) {
      setSectionError(reason instanceof Error ? reason.message : "章节定位读取失败");
    } finally {
      setSectionLoading(false);
    }
  }

  return (
    <section>
      <div className="codex-page-heading">
        <div>
          <h2>书籍阅读器</h2>
          <p className="codex-subtitle">
            {catalog?.totalVolumes ?? 0} 卷 · {catalog?.locale ?? "zh-CN"} ·{" "}
            {catalog?.revisionId ?? revisionId ?? "当前发布"}
          </p>
        </div>
        <small>每卷正文均保留 segment 与 revision 引用</small>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {sectionError && (
        <div className="inline-warning" role="status">
          <strong>章节定位暂不可用</strong>
          <span>{sectionError}</span>
        </div>
      )}
      {loading ? (
        <div className="codex-loading">加载书籍目录中…</div>
      ) : !catalog?.books.length ? (
        <div className="codex-empty">暂无已发布书籍文本</div>
      ) : (
        <div className="codex-reader-layout">
          <aside className="codex-reader-sidebar" aria-label="书籍卷目录">
            {catalog.books.map((book) => (
              <section key={book.stableId}>
                <h3>{book.title}</h3>
                <small>{book.bookStableId}</small>
                {book.volumes.map((volume) => (
                  <button
                    type="button"
                    key={volume.stableId}
                    className={selectedVolumeId === volume.stableId ? "is-active" : ""}
                    onClick={() => setSelectedVolumeId(volume.stableId)}
                  >
                    <strong>{volume.volume == null ? "卷" : "第 " + volume.volume + " 卷"}</strong>
                    <span>{volume.title}</span>
                    <small>{volume.segmentCount || "—"} 个片段</small>
                  </button>
                ))}
              </section>
            ))}
          </aside>
          <section className="codex-reader-main" aria-busy={documentLoading}>
            {documentLoading ? (
              <div className="codex-loading">加载正文中…</div>
            ) : textDocument ? (
              <TextDocumentReader
                textDocument={textDocument}
                activeSegmentId={activeSegmentId}
                sectionRead={sectionRead}
                sectionLoading={sectionLoading}
                onSegment={(segment) => void readSegment(segment)}
              />
            ) : (
              <div className="empty-detail">选择一卷开始阅读。</div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}

export function CodexCharacterStoriesPage({
  gameId,
  revisionId,
}: {
  gameId: string;
  revisionId?: string;
}) {
  const [catalog, setCatalog] = useState<CodexCharacterStoryCatalog | null>(null);
  const [selectedStoryId, setSelectedStoryId] = useState("");
  const [textDocument, setTextDocument] = useState<DocumentDetail | null>(null);
  const [activeSegmentId, setActiveSegmentId] = useState<string>();
  const [sectionRead, setSectionRead] = useState<CodexSectionRead | null>(null);
  const [loading, setLoading] = useState(true);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [sectionLoading, setSectionLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ locale: "zh-CN", limit: "500" });
    if (revisionId) params.set("revisionId", revisionId);
    apiFetch<unknown>("/api/games/" + gameId + "/text/character-stories?" + params.toString())
      .then((value) => {
        if (cancelled) return;
        const next = mapCharacterStoryListResponse(value);
        setCatalog(next);
        const first = next.characters[0]?.stories[0];
        const available = next.characters.some((group) =>
          group.stories.some((story) => story.stableId === selectedStoryId),
        );
        setSelectedStoryId((current) => {
          const stillAvailable = next.characters.some((group) =>
            group.stories.some((story) => story.stableId === current),
          );
          return stillAvailable ? current : (first?.stableId ?? "");
        });
        if (!available && !first) setSelectedStoryId("");
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "角色故事列表加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, revisionId]);

  const selected = catalog?.characters
    .flatMap((group) => group.stories)
    .find((story) => story.stableId === selectedStoryId);

  useEffect(() => {
    if (!selected) {
      setTextDocument(null);
      return;
    }
    let cancelled = false;
    setDocumentLoading(true);
    setSectionRead(null);
    apiFetch<{ document: DocumentDetail }>(documentPath(gameId, selected.documentId, revisionId))
      .then((result) => {
        if (!cancelled) {
          setTextDocument(result.document);
          setActiveSegmentId(undefined);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "角色故事正文加载失败");
      })
      .finally(() => {
        if (!cancelled) setDocumentLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, revisionId, selected?.documentId]);

  async function readSegment(segment: DocumentDetail["segments"][number]) {
    if (!textDocument) return;
    setActiveSegmentId(segment.id);
    setSectionRead(null);
    setSectionLoading(true);
    try {
      setSectionRead(
        mapSectionReadResponse(
          await apiFetch<unknown>(
            sectionPath(gameId, textDocument.id, segment.headingPath.at(-1), revisionId),
          ),
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "角色故事章节读取失败");
    } finally {
      setSectionLoading(false);
    }
  }

  return (
    <section>
      <div className="codex-page-heading">
        <div>
          <h2>角色故事</h2>
          <p className="codex-subtitle">
            {catalog?.totalStories ?? 0} 条 FetterStory 文本 · {catalog?.locale ?? "zh-CN"}
          </p>
        </div>
        <small className="corpus-status">
          按角色聚合 · corpusStatus: {catalog?.corpusStatus ?? "loading"}
        </small>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <div className="codex-loading">加载角色故事目录中…</div>
      ) : !catalog?.characters.length ? (
        <div className="codex-empty">暂无已发布角色故事文本</div>
      ) : (
        <div className="codex-reader-layout">
          <aside className="codex-reader-sidebar" aria-label="角色故事目录">
            {catalog.characters.map((group: CodexCharacterStoryGroup) => (
              <section key={group.characterStableId}>
                <h3>{group.characterName}</h3>
                <small>{group.characterStableId}</small>
                {group.stories.map((story: CodexCharacterStory) => (
                  <button
                    type="button"
                    key={story.stableId}
                    className={selectedStoryId === story.stableId ? "is-active" : ""}
                    onClick={() => setSelectedStoryId(story.stableId)}
                  >
                    <strong>{story.title}</strong>
                    <small>故事 {story.storyKey}</small>
                  </button>
                ))}
              </section>
            ))}
          </aside>
          <section className="codex-reader-main" aria-busy={documentLoading}>
            {documentLoading ? (
              <div className="codex-loading">加载正文中…</div>
            ) : textDocument ? (
              <TextDocumentReader
                textDocument={textDocument}
                activeSegmentId={activeSegmentId}
                sectionRead={sectionRead}
                sectionLoading={sectionLoading}
                onSegment={(segment) => void readSegment(segment)}
              />
            ) : (
              <div className="empty-detail">选择一条故事开始阅读。</div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}

function itemCategoryLabel(category: string): string {
  return (
    {
      character_development: "角色培养",
      weapon_development: "武器培养",
      local_specialty: "区域特产",
      currency: "货币",
      consumable: "消耗品",
      quest_item: "任务道具",
      forging: "锻造",
      cooking: "料理",
      furnishing: "摆设",
      other: "其他",
    }[category] ?? category
  );
}

export function CodexItemsPage({ gameId, revisionId }: { gameId: string; revisionId?: string }) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<CodexTextItem[]>([]);
  const [selected, setSelected] = useState<CodexTextItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");

  async function loadItems(nextQuery = query) {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ limit: "50" });
    if (nextQuery.trim()) params.set("query", nextQuery.trim());
    if (revisionId) params.set("revisionId", revisionId);
    try {
      const result = mapTextItemListResponse(
        await apiFetch<unknown>("/api/games/" + gameId + "/text/items?" + params.toString()),
      );
      setItems(result.items);
      setSelected((current) =>
        current && result.items.some((item) => item.stableId === current.stableId) ? current : null,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "物品文本列表加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadItems("");
  }, [gameId, revisionId]);

  async function openItem(item: CodexTextItem) {
    setSelected(item);
    setDetailLoading(true);
    setError("");
    try {
      const suffix = revisionId ? "?revisionId=" + encodeURIComponent(revisionId) : "";
      const detail = mapTextItemDetailResponse(
        await apiFetch<unknown>(
          "/api/games/" + gameId + "/text/items/" + encodeURIComponent(item.stableId) + suffix,
        ),
      );
      if (detail) setSelected(detail);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "物品文本详情加载失败");
    } finally {
      setDetailLoading(false);
    }
  }

  return (
    <section>
      <div className="codex-page-heading">
        <div>
          <h2>物品文本</h2>
          <p className="codex-subtitle">从 /text/items 读取物品描述与文本来源</p>
        </div>
        <small>{items.length} 条当前结果</small>
      </div>
      <form
        className="codex-filter-form"
        onSubmit={(event) => {
          event.preventDefault();
          void loadItems();
        }}
      >
        <label>
          <span>搜索物品</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="留空浏览物品文本"
            aria-label="搜索物品文本"
          />
        </label>
        <button type="submit" disabled={loading}>
          {loading ? "加载中…" : "搜索"}
        </button>
      </form>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      <div className="codex-list-detail-layout">
        <div>
          {loading ? (
            <div className="codex-loading">加载物品文本中…</div>
          ) : !items.length ? (
            <div className="codex-empty">没有匹配的物品文本</div>
          ) : (
            <div className="codex-grid">
              {items.map((item) => (
                <button
                  type="button"
                  className={
                    "codex-card codex-card-button " +
                    (selected?.stableId === item.stableId ? "is-active" : "")
                  }
                  key={item.stableId}
                  onClick={() => void openItem(item)}
                >
                  <header>
                    <h3>{item.name}</h3>
                    <span className="codex-subtitle">
                      {item.rarity ? "★".repeat(item.rarity) : ""}
                    </span>
                  </header>
                  <p className="codex-subtitle">{itemCategoryLabel(item.category)}</p>
                  <p>{item.description || "暂无描述文本"}</p>
                </button>
              ))}
            </div>
          )}
        </div>
        <aside className="codex-detail-card" aria-busy={detailLoading}>
          {!selected ? (
            <div className="empty-detail">选择一件物品查看完整文本。</div>
          ) : (
            <article>
              <span className="type-pill">{itemCategoryLabel(selected.category)}</span>
              <h2>{selected.name}</h2>
              <p>{selected.description || "暂无描述文本"}</p>
              {selected.sources.length > 0 && (
                <>
                  <h3>来源</h3>
                  <p>{selected.sources.join("、")}</p>
                </>
              )}
              {selected.usedBy.length > 0 && (
                <>
                  <h3>用于</h3>
                  <p>{selected.usedBy.join("、")}</p>
                </>
              )}
              <div className="codex-citation" aria-label="物品文本引用">
                <strong>文本引用</strong>
                <span>stableId={selected.stableId}</span>
                <span>sourceKey={selected.sourceKey ?? "—"}</span>
                <span>revision={selected.revisionId ?? revisionId ?? "当前发布"}</span>
              </div>
            </article>
          )}
        </aside>
      </div>
    </section>
  );
}

export function CodexMechanicsPage({
  gameId,
  revisionId,
  title = "教程与机制",
}: {
  gameId: string;
  revisionId?: string;
  title?: string;
}) {
  const [query, setQuery] = useState("机制");
  const [result, setResult] = useState<CodexMechanicsResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function loadMechanics(nextQuery = query) {
    setLoading(true);
    setError("");
    const params = new URLSearchParams({
      query: nextQuery.trim() || "机制",
      limit: "20",
    });
    if (revisionId) params.set("revisionId", revisionId);
    try {
      setResult(
        mapMechanicsResponse(
          await apiFetch<unknown>("/api/games/" + gameId + "/text/mechanics?" + params.toString()),
        ),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "教程与机制状态加载失败");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMechanics("机制");
  }, [gameId, revisionId]);

  return (
    <section>
      <div className="codex-page-heading">
        <div>
          <h2>{title}</h2>
          <p className="codex-subtitle">只展示官方/游戏内教程与机制正文，不替代社区攻略。</p>
        </div>
        <small className="corpus-status">corpusStatus: {result?.corpusStatus ?? "loading"}</small>
      </div>
      <form
        className="codex-filter-form"
        onSubmit={(event) => {
          event.preventDefault();
          void loadMechanics();
        }}
      >
        <label>
          <span>检索机制</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="搜索教程与机制"
          />
        </label>
        <button type="submit" disabled={loading}>
          {loading ? "读取中…" : "检索"}
        </button>
      </form>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {loading ? (
        <div className="codex-loading">读取语料状态中…</div>
      ) : (
        <div className="codex-status-panel">
          <strong>语料状态：{result?.corpusStatus ?? "mechanism_source_empty"}</strong>
          {result?.note && <p>{result.note}</p>}
          {!result?.hits.length ? (
            <p>当前没有可展示的教程/机制正文，不生成或填充假数据。</p>
          ) : (
            <div className="codex-grid">
              {result.hits.map((hit, index) => (
                <article className="codex-card" key={hit.title + ":" + index}>
                  <h3>{hit.title}</h3>
                  <p>{hit.excerpt || "暂无正文摘录"}</p>
                </article>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
