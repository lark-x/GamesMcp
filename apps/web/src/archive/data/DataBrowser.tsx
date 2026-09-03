import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../api.js";
import { ArchiveAvatar } from "../ArchiveAvatar.js";
import { ArchiveGlobalNav } from "../ArchiveGlobalNav.js";
import { ArchiveInspector, InspectorField, InspectorSection } from "../ArchiveInspector.js";
import { ArchiveLayout } from "../ArchiveLayout.js";
import { ArchiveEmpty, ArchiveError, ArchiveLoading } from "../ArchiveStates.js";
import type { DataKind } from "../archive.types.js";
import type { DataItemSummary } from "./data.types.js";

function getTerm(gameId: string, kind: DataKind): string {
  const isStarRail = gameId.toLowerCase().includes("starrail");
  switch (kind) {
    case "characters":
      return "角色";
    case "weapons":
      return isStarRail ? "光锥" : "武器";
    case "artifacts":
      return isStarRail ? "遗器" : "圣遗物";
    case "enemies":
      return "敌人";
    case "achievements":
      return "成就";
    default:
      return "资料";
  }
}

type UnknownRecord = Record<string, unknown>;

export function DataBrowser({
  gameId,
  dataKind,
  selectedRevision,
  initialItemId,
  onSelectKind,
  onSelectItem,
}: {
  gameId: string;
  dataKind: DataKind;
  selectedRevision?: string;
  initialItemId?: string;
  onSelectKind: (kind: DataKind) => void;
  onSelectItem?: (id: string | undefined) => void;
}) {
  const [items, setItems] = useState<DataItemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeItemId, setActiveItemId] = useState<string | undefined>(initialItemId);

  const term = getTerm(gameId, dataKind);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (selectedRevision) params.set("revisionId", selectedRevision);

      let res: UnknownRecord = {};
      try {
        res = (await apiFetch(
          `/api/games/${encodeURIComponent(gameId)}/codex/${dataKind}?${params.toString()}`,
        )) as UnknownRecord;
      } catch {
        // Fallback to genshin struct route if codex alias is not ready
        res = (await apiFetch(
          `/api/games/${encodeURIComponent(gameId)}/genshin/${dataKind}?${params.toString()}`,
        )) as UnknownRecord;
      }

      let parsed: DataItemSummary[] = [];
      if (dataKind === "characters" && Array.isArray(res.characters)) {
        parsed = (res.characters as UnknownRecord[]).map((c) => ({
          stableId: String(c.stableId),
          name: String(c.name),
          title: typeof c.title === "string" ? c.title : undefined,
          rarity: typeof c.rarity === "number" ? c.rarity : undefined,
          element: typeof c.element === "string" ? c.element : undefined,
          weaponType: typeof c.weaponType === "string" ? c.weaponType : undefined,
          region: typeof c.region === "string" ? c.region : undefined,
          affiliation: typeof c.affiliation === "string" ? c.affiliation : undefined,
          description: typeof c.description === "string" ? c.description : undefined,
          raw: c,
        }));
      } else if (dataKind === "weapons" && Array.isArray(res.weapons)) {
        parsed = (res.weapons as UnknownRecord[]).map((w) => ({
          stableId: String(w.stableId),
          name: String(w.name),
          weaponType: typeof w.weaponType === "string" ? w.weaponType : undefined,
          rarity: typeof w.rarity === "number" ? w.rarity : undefined,
          description:
            typeof w.description === "string"
              ? w.description
              : typeof w.passiveDescription === "string"
                ? w.passiveDescription
                : undefined,
          raw: w,
        }));
      } else if (dataKind === "artifacts" && Array.isArray(res.sets)) {
        parsed = (res.sets as UnknownRecord[]).map((s) => ({
          stableId: String(s.stableId),
          name: String(s.name),
          rarity: typeof s.maxRarity === "number" ? s.maxRarity : undefined,
          description: s.twoPieceBonus
            ? `【2件套】${s.twoPieceBonus}\n【4件套】${s.fourPieceBonus ?? ""}`
            : typeof s.description === "string"
              ? s.description
              : undefined,
          raw: s,
        }));
      } else if (dataKind === "enemies" && Array.isArray(res.enemies)) {
        parsed = (res.enemies as UnknownRecord[]).map((en) => ({
          stableId: String(en.stableId),
          name: String(en.name),
          category:
            typeof en.category === "string"
              ? en.category
              : typeof en.family === "string"
                ? en.family
                : undefined,
          description: typeof en.description === "string" ? en.description : undefined,
          raw: en,
        }));
      } else if (dataKind === "achievements" && Array.isArray(res.achievements)) {
        parsed = (res.achievements as UnknownRecord[]).map((a) => ({
          stableId: String(a.stableId),
          name: String(a.name),
          category: typeof a.category === "string" ? a.category : undefined,
          requirement: typeof a.requirement === "string" ? a.requirement : undefined,
          reward: a.rewardPrimogems ? `${a.rewardPrimogems} 原石/星琼` : undefined,
          description: typeof a.requirement === "string" ? a.requirement : undefined,
          raw: a,
        }));
      }

      setItems(parsed);
      if (parsed.length > 0) {
        if (initialItemId && parsed.some((it) => it.stableId === initialItemId)) {
          setActiveItemId(initialItemId);
        } else if (!activeItemId || !parsed.some((it) => it.stableId === activeItemId)) {
          setActiveItemId(parsed[0].stableId);
          onSelectItem?.(parsed[0].stableId);
        }
      } else {
        setActiveItemId(undefined);
      }
    } catch (err: unknown) {
      setError((err as Error).message || "加载资料失败");
    } finally {
      setLoading(false);
    }
  }, [gameId, dataKind, selectedRevision, initialItemId, activeItemId, onSelectItem]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const filteredItems = useMemo(() => {
    if (!searchQuery.trim()) return items;
    const q = searchQuery.toLowerCase();
    return items.filter(
      (item) =>
        item.name.toLowerCase().includes(q) ||
        (item.title && item.title.toLowerCase().includes(q)) ||
        (item.element && item.element.toLowerCase().includes(q)) ||
        (item.category && item.category.toLowerCase().includes(q)) ||
        (item.description && item.description.toLowerCase().includes(q)),
    );
  }, [items, searchQuery]);

  const activeItem = useMemo(
    () => items.find((it) => it.stableId === activeItemId) ?? filteredItems[0],
    [items, activeItemId, filteredItems],
  );

  function handleSelectItem(item: DataItemSummary) {
    setActiveItemId(item.stableId);
    onSelectItem?.(item.stableId);
  }

  const categoryTabs: { key: DataKind | "materials"; label: string }[] = [
    { key: "characters", label: "角色" },
    { key: "materials", label: "材料" },
    { key: "weapons", label: getTerm(gameId, "weapons") },
    { key: "artifacts", label: getTerm(gameId, "artifacts") },
    { key: "enemies", label: "敌人" },
    { key: "achievements", label: "成就" },
  ];

  return (
    <ArchiveLayout
      globalNav={<ArchiveGlobalNav activeSection="data" />}
      catalog={
        <div className="data-catalog" role="region" aria-label={`${term}目录`}>
          <div className="data-catalog-header">
            <div className="data-category-tabs" role="tablist">
              {categoryTabs.map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  aria-selected={tab.key === dataKind}
                  className={`data-category-tab ${tab.key === dataKind ? "active" : ""}`}
                  onClick={() => {
                    if (tab.key === "materials") {
                      window.location.hash = "archive/materials";
                    } else {
                      onSelectKind(tab.key);
                    }
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="data-search-box">
              <input
                type="search"
                className="data-search-input"
                placeholder={`搜索${term}（${items.length}条）...`}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label={`搜索${term}`}
              />
            </div>
          </div>

          <div className="data-item-list" role="list">
            {loading && <ArchiveLoading label={`加载${term}中...`} />}
            {error && <ArchiveError message={error} onRetry={loadData} />}
            {!loading && !error && filteredItems.length === 0 && (
              <ArchiveEmpty message={`暂无匹配的${term}`} />
            )}
            {!loading &&
              !error &&
              filteredItems.map((item) => {
                const isSelected = activeItem?.stableId === item.stableId;
                return (
                  <button
                    key={item.stableId}
                    type="button"
                    role="listitem"
                    className={`data-item-row ${isSelected ? "selected" : ""}`}
                    onClick={() => handleSelectItem(item)}
                  >
                    <ArchiveAvatar fallbackText={item.name} label={item.name} size={36} />
                    <div className="data-item-info">
                      <div className="data-item-title-line">
                        <span className="data-item-name">{item.name}</span>
                        {typeof item.rarity === "number" && item.rarity > 0 && (
                          <span className="data-item-stars" title={`${item.rarity}星`}>
                            {"★".repeat(item.rarity)}
                          </span>
                        )}
                      </div>
                      <div className="data-item-subtext">
                        {item.element && <span className="data-tag">{item.element}</span>}
                        {item.weaponType && <span className="data-tag">{item.weaponType}</span>}
                        {item.category && <span className="data-tag">{item.category}</span>}
                        {item.region && <span className="data-tag">{item.region}</span>}
                        {item.title && <span className="data-item-title-tag">{item.title}</span>}
                      </div>
                    </div>
                  </button>
                );
              })}
          </div>
        </div>
      }
      main={
        <div className="data-detail-pane" role="region" aria-label="资料详情">
          {activeItem ? (
            <article className="data-article">
              <header className="data-article-header">
                <div className="data-article-title-row">
                  <ArchiveAvatar fallbackText={activeItem.name} label={activeItem.name} size={56} />
                  <div>
                    <h1 className="data-article-title">{activeItem.name}</h1>
                    {activeItem.title && (
                      <p className="data-article-subtitle">{activeItem.title}</p>
                    )}
                    {typeof activeItem.rarity === "number" && activeItem.rarity > 0 && (
                      <div className="data-article-stars">
                        {"★".repeat(activeItem.rarity)} 稀有度
                      </div>
                    )}
                  </div>
                </div>

                <div className="data-article-props">
                  {activeItem.element && (
                    <div className="data-prop-pill">
                      <span className="data-prop-k">元素/属性</span>
                      <span className="data-prop-v">{activeItem.element}</span>
                    </div>
                  )}
                  {activeItem.weaponType && (
                    <div className="data-prop-pill">
                      <span className="data-prop-k">类型</span>
                      <span className="data-prop-v">{activeItem.weaponType}</span>
                    </div>
                  )}
                  {activeItem.region && (
                    <div className="data-prop-pill">
                      <span className="data-prop-k">地区/势力</span>
                      <span className="data-prop-v">{activeItem.region}</span>
                    </div>
                  )}
                  {activeItem.affiliation && (
                    <div className="data-prop-pill">
                      <span className="data-prop-k">归属</span>
                      <span className="data-prop-v">{activeItem.affiliation}</span>
                    </div>
                  )}
                  {activeItem.category && (
                    <div className="data-prop-pill">
                      <span className="data-prop-k">分类</span>
                      <span className="data-prop-v">{activeItem.category}</span>
                    </div>
                  )}
                </div>
              </header>

              {activeItem.description && (
                <section className="data-article-section">
                  <h2>档案描述</h2>
                  <div className="data-article-desc">
                    {activeItem.description.split("\n").map((line, idx) => (
                      <p key={idx}>{line}</p>
                    ))}
                  </div>
                </section>
              )}

              {activeItem.requirement && (
                <section className="data-article-section">
                  <h2>达成条件</h2>
                  <p className="data-article-highlight">{activeItem.requirement}</p>
                </section>
              )}

              {activeItem.reward && (
                <section className="data-article-section">
                  <h2>成就奖励</h2>
                  <p className="data-article-reward">🎁 {activeItem.reward}</p>
                </section>
              )}

              {activeItem.raw && (
                <section className="data-article-section data-article-extra">
                  <h2>详细属性</h2>
                  <div className="data-raw-fields">
                    {Object.entries(activeItem.raw)
                      .filter(
                        ([k, v]) =>
                          !["stableId", "name", "description", "raw"].includes(k) &&
                          v !== null &&
                          v !== undefined &&
                          typeof v !== "object",
                      )
                      .map(([k, v]) => (
                        <div key={k} className="data-raw-row">
                          <span className="data-raw-key">{k}:</span>
                          <span className="data-raw-value">{String(v)}</span>
                        </div>
                      ))}
                  </div>
                </section>
              )}
            </article>
          ) : (
            <ArchiveEmpty message={`请在左侧列表选择${term}查看详情`} />
          )}
        </div>
      }
      inspector={
        activeItem ? (
          <ArchiveInspector title={`${term}出处与信息`}>
            <InspectorSection title="基础元数据">
              <InspectorField label="词条名称" value={activeItem.name} />
              <InspectorField label="Stable ID" value={activeItem.stableId} mono />
              <InspectorField label="资料分类" value={term} />
              <InspectorField label="关联游戏" value={gameId} />
            </InspectorSection>
            <InspectorSection title="版本与来源">
              <InspectorField label="当前版本" value={selectedRevision ?? "published"} />
              <InspectorField label="收录状态" value="已入库规范化" />
            </InspectorSection>
          </ArchiveInspector>
        ) : null
      }
    />
  );
}
