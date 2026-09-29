import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../api.js";
import { ArchiveAvatar } from "../ArchiveAvatar.js";
import { ArchiveEmpty, ArchiveError, ArchiveLoading } from "../ArchiveStates.js";
import { ArchiveInspector, InspectorField, InspectorSection } from "../ArchiveInspector.js";
import { ArchiveLayout } from "../ArchiveLayout.js";
import { ArchiveGlobalNav, type GlobalNavSection } from "../ArchiveGlobalNav.js";
import { ArchivePagination } from "../ArchivePagination.js";
import type { ArchiveMaterial } from "./material.types.js";
import { isInternalEntry } from "../data/data.types.js";
import { isStarRailGame } from "../../shared.js";

const CATEGORY_LABELS: Record<string, string> = {
  character_development: "角色培养素材",
  weapon_development: "武器强化素材",
  local_specialty: "区域特产",
  currency: "货币",
  consumable: "消耗品",
  quest_item: "任务道具",
  forging: "锻造材料",
  cooking: "食材烹饪",
  furnishing: "摆设素材",
  character_ascension: "角色晋阶材料",
  exp_material: "角色经验材料",
  lightcone_exp: "光锥升级材料",
  relic_exp: "遗器强化材料",
  material: "通用培养材料",
  trace: "行迹材料",
  trace_material: "行迹材料",
  light_cone_ascension: "光锥突破素材",
  lightcone_ascension: "光锥晋阶材料",
  enemy_drop: "敌方掉落",
  weekly_boss: "周本材料",
  synthesis: "合成材料",
  mission: "任务道具",
  precious: "贵重物与货币",
  other: "其他",
};

function categoryLabel(key: string): string {
  return CATEGORY_LABELS[key] ?? key;
}

function stars(rarity?: number | null): string {
  if (!rarity || rarity <= 0) return "★";
  return "★".repeat(Math.min(rarity, 5));
}

const GENSHIN_CATEGORY_ORDER = [
  "character_development",
  "weapon_development",
  "local_specialty",
  "cooking",
  "material",
  "quest_item",
  "precious",
  "currency",
  "gcg",
  "furnishing",
  "other",
];

const STARRAIL_CATEGORY_ORDER = [
  "character_development",
  "consumable",
  "mission",
  "precious",
  "currency",
  "character_ascension",
  "trace",
  "trace_material",
  "exp_material",
  "lightcone_ascension",
  "light_cone_ascension",
  "lightcone_exp",
  "relic_exp",
  "enemy_drop",
  "weekly_boss",
  "synthesis",
  "event",
  "other",
];

const PAGE_SIZE = 60;

export function MaterialBrowser({
  gameId,
  gameName,
  revisionLabel,
  selectedRevision,
  initialMaterialId,
  onMaterialIdChange,
}: {
  gameId: string;
  gameName: string;
  revisionLabel: string;
  selectedRevision?: string;
  initialMaterialId?: string;
  onHome: () => void;
  onOpenStory: () => void;
  onOpenText: () => void;
  onMaterialIdChange?: (id: string | undefined, mode?: "push" | "replace") => void;
}) {
  const [materials, setMaterials] = useState<ArchiveMaterial[]>([]);
  const [total, setTotal] = useState<number>(0);
  const [serverCategories, setServerCategories] = useState<
    Array<{
      key: string;
      label: string;
      count: number;
      subcategories?: Array<{ key: string; label: string; count: number }>;
    }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("character_development");
  const [activeSubcategory, setActiveSubcategory] = useState("");
  const [activeRarity, setActiveRarity] = useState<number>(0); // 0: 全部, 5: 5星, 4: 4星, 3: 3星, 1: 1~2星
  const [selected, setSelected] = useState<ArchiveMaterial | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [viewMode, setViewMode] = useState<"list" | "grid">("grid");

  const isStarRail = isStarRailGame(gameId, gameName);

  const loadMaterials = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Pull catalog for the active category (up to 1500 items, sufficient for entire category)
      const params = new URLSearchParams({ limit: "1500", offset: "0" });
      if (selectedRevision) params.set("revisionId", selectedRevision);
      if (query.trim()) params.set("q", query.trim());
      if (activeCategory) params.set("category", activeCategory);
      const result = await apiFetch<{
        materials: ArchiveMaterial[];
        total?: number;
        categories?: Array<{
          key: string;
          label: string;
          count: number;
          subcategories?: Array<{ key: string; label: string; count: number }>;
        }>;
      }>(`/api/games/${gameId}/codex/materials?${params.toString()}`);
      // Filter internal placeholder entries
      setMaterials((result.materials ?? []).filter((m) => !isInternalEntry(m.name)));
      setTotal(result.total ?? result.materials?.length ?? 0);
      if (result.categories) {
        setServerCategories(result.categories);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "材料列表加载失败");
    } finally {
      setLoading(false);
    }
  }, [gameId, selectedRevision, query, activeCategory]);

  useEffect(() => {
    void loadMaterials();
  }, [loadMaterials]);

  const sortedCategories = useMemo(() => {
    const orderList = isStarRail ? STARRAIL_CATEGORY_ORDER : GENSHIN_CATEGORY_ORDER;
    return [...serverCategories].sort((a, b) => {
      const idxA = orderList.indexOf(a.key);
      const idxB = orderList.indexOf(b.key);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return b.count - a.count;
    });
  }, [serverCategories, isStarRail]);

  const allMaterialsCount = useMemo(() => {
    if (serverCategories.length > 0) {
      return serverCategories.reduce((sum, c) => sum + c.count, 0);
    }
    return total;
  }, [serverCategories, total]);

  const currentCategoryEntry = useMemo(
    () => serverCategories.find((c) => c.key === activeCategory),
    [serverCategories, activeCategory],
  );
  const subcategories = currentCategoryEntry?.subcategories ?? [];

  // Deduplicate materials by name, category and rarity to prevent constellation clutter
  const deduplicatedMaterials = useMemo(() => {
    const seen = new Set<string>();
    const list: ArchiveMaterial[] = [];
    for (const m of materials) {
      const key = `${m.name}__${m.category}__${m.rarity ?? 0}`;
      if (!seen.has(key)) {
        seen.add(key);
        list.push(m);
      }
    }
    return list;
  }, [materials]);

  // Client-side filtering by subcategory and rarity over the entire category dataset
  const filteredMaterials = useMemo(() => {
    return deduplicatedMaterials.filter((m) => {
      if (activeSubcategory && m.subcategory !== activeSubcategory) return false;
      if (activeRarity === 5) return m.rarity === 5;
      if (activeRarity === 4) return m.rarity === 4;
      if (activeRarity === 3) return m.rarity === 3;
      if (activeRarity === 1) return (m.rarity ?? 0) <= 2;
      return true;
    });
  }, [deduplicatedMaterials, activeSubcategory, activeRarity]);

  // Strict page calculation: guarantees exactly PAGE_SIZE (60) items per full page
  const totalPages = Math.ceil(filteredMaterials.length / PAGE_SIZE) || 1;
  const safePage = Math.min(currentPage, totalPages - 1);

  const displayedMaterials = useMemo(() => {
    const start = safePage * PAGE_SIZE;
    return filteredMaterials.slice(start, start + PAGE_SIZE);
  }, [filteredMaterials, safePage]);

  // Reset to first page whenever filtering conditions change
  useEffect(() => {
    setCurrentPage(0);
  }, [activeCategory, activeSubcategory, activeRarity, query]);

  const loadMaterialDetail = useCallback(
    async (id: string) => {
      setDetailLoading(true);
      try {
        const params = new URLSearchParams();
        if (selectedRevision) params.set("revisionId", selectedRevision);
        const result = await apiFetch<{ material: ArchiveMaterial }>(
          `/api/games/${gameId}/codex/materials/${encodeURIComponent(id)}?${params.toString()}`,
        );
        setSelected(result.material);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "材料详情加载失败");
      } finally {
        setDetailLoading(false);
      }
    },
    [gameId, selectedRevision],
  );

  const handleSelectMaterial = useCallback(
    (material: ArchiveMaterial) => {
      setSelected(material);
      onMaterialIdChange?.(material.stableId, "push");
      void loadMaterialDetail(material.stableId);
    },
    [onMaterialIdChange, loadMaterialDetail],
  );

  useEffect(() => {
    if (!initialMaterialId) {
      if (displayedMaterials.length > 0 && !selected) {
        const first = displayedMaterials[0];
        if (first) {
          setSelected(first);
          void loadMaterialDetail(first.stableId);
        }
      }
      return;
    }
    void loadMaterialDetail(initialMaterialId);
  }, [initialMaterialId, loadMaterialDetail]);

  // Auto select first material when filters change and current selection is missing
  useEffect(() => {
    if (displayedMaterials.length > 0) {
      if (!selected || !displayedMaterials.some((m) => m.stableId === selected.stableId)) {
        const first = displayedMaterials[0];
        if (first) {
          setSelected(first);
          void loadMaterialDetail(first.stableId);
        }
      }
    }
  }, [displayedMaterials]);

  const sections: GlobalNavSection[] = useMemo(
    () => [
      {
        label: "游戏资料",
        items: [
          {
            key: "characters",
            label: "角色",
            onSelect: () => (window.location.hash = "archive/characters"),
          },
          {
            key: "materials",
            label: "材料",
            active: true,
            onSelect: () => {
              if (window.location.hash !== "#archive/materials") {
                window.location.hash = "archive/materials";
              }
            },
          },
          {
            key: "weapons",
            label: isStarRail ? "光锥" : "武器",
            onSelect: () => (window.location.hash = "archive/weapons"),
          },
          {
            key: "artifacts",
            label: isStarRail ? "遗器" : "圣遗物",
            onSelect: () => (window.location.hash = "archive/artifacts"),
          },
          {
            key: "enemies",
            label: "敌人",
            onSelect: () => (window.location.hash = "archive/enemies"),
          },
          {
            key: "achievements",
            label: "成就",
            onSelect: () => (window.location.hash = "archive/achievements"),
          },
        ],
      },
    ],
    [isStarRail],
  );

  return (
    <ArchiveLayout
      noCatalog={true}
      globalNav={
        <ArchiveGlobalNav gameLabel={gameName} revisionLabel={revisionLabel} sections={sections} />
      }
      main={
        <div className="material-browser-container">
          {/* 1. Integrated Multi-Dimensional Filter Hub */}
          <section className="material-filter-hub" aria-label="材料综合检索与筛选">
            {/* Level 1 Category Tabs */}
            <div className="material-filter-row">
              <span className="material-filter-label">一级分类</span>
              <div className="material-pills-wrap" role="tablist" aria-label="材料大类">
                <button
                  type="button"
                  role="tab"
                  aria-selected={!activeCategory}
                  className={`material-filter-pill ${!activeCategory ? "is-active" : ""}`}
                  onClick={() => {
                    setActiveCategory("");
                    setActiveSubcategory("");
                  }}
                >
                  <span>全部材料</span>
                  <span className="material-pill-count">{allMaterialsCount}</span>
                </button>
                {sortedCategories.map((cat) => (
                  <button
                    type="button"
                    key={cat.key}
                    role="tab"
                    aria-selected={activeCategory === cat.key}
                    className={`material-filter-pill ${activeCategory === cat.key ? "is-active" : ""}`}
                    onClick={() => {
                      setActiveCategory(cat.key);
                      setActiveSubcategory("");
                    }}
                  >
                    <span>{cat.label || categoryLabel(cat.key)}</span>
                    <span className="material-pill-count">{cat.count}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Level 2 Subcategory Pills (Dynamic) */}
            {subcategories.length > 0 && (
              <div className="material-filter-row material-filter-row-sub">
                <span className="material-filter-label">二级子类</span>
                <div className="material-pills-wrap" role="tablist" aria-label="材料子分类">
                  <button
                    type="button"
                    role="tab"
                    aria-selected={!activeSubcategory}
                    className={`material-sub-pill ${!activeSubcategory ? "is-active" : ""}`}
                    onClick={() => {
                      setActiveSubcategory("");
                    }}
                  >
                    <span>全部{currentCategoryEntry?.label ?? categoryLabel(activeCategory)}</span>
                    <span className="material-pill-count">{currentCategoryEntry?.count ?? 0}</span>
                  </button>
                  {subcategories.map((sub) => (
                    <button
                      type="button"
                      key={sub.key}
                      role="tab"
                      aria-selected={activeSubcategory === sub.key}
                      className={`material-sub-pill ${activeSubcategory === sub.key ? "is-active" : ""}`}
                      onClick={() => {
                        setActiveSubcategory(sub.key);
                      }}
                    >
                      <span>{sub.label}</span>
                      <span className="material-pill-count">{sub.count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Control Bar (Rarity, Search, View Mode) */}
            <div className="material-filter-controls">
              {/* Rarity Segmented Control */}
              <div className="material-rarity-group">
                <span className="material-filter-label-inline">稀有度</span>
                <div className="material-rarity-bar" role="radiogroup" aria-label="稀有度筛选">
                  {[
                    { value: 0, label: "全部", cls: "" },
                    { value: 5, label: "★★★★★ 5星", cls: "rarity-opt-5" },
                    { value: 4, label: "★★★★ 4星", cls: "rarity-opt-4" },
                    { value: 3, label: "★★★ 3星", cls: "rarity-opt-3" },
                    { value: 1, label: "★ 1-2星", cls: "rarity-opt-1" },
                  ].map((opt) => (
                    <button
                      type="button"
                      key={opt.value}
                      className={`material-rarity-btn ${activeRarity === opt.value ? "is-active" : ""} ${opt.cls}`}
                      onClick={() => setActiveRarity(opt.value)}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Standard Search Box */}
              <div className="material-search-box">
                <span className="material-search-icon" aria-hidden="true">🔍</span>
                <input
                  type="search"
                  aria-label="搜索材料"
                  placeholder="搜索材料名称、用途、来源…"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                  }}
                />
                {query && (
                  <button
                    type="button"
                    className="material-search-clear"
                    aria-label="清空搜索"
                    onClick={() => {
                      setQuery("");
                    }}
                  >
                    ✕
                  </button>
                )}
              </div>

              {/* Total Count & View Mode Switcher */}
              <div className="material-view-actions">
                <span className="material-total-count">
                  共 {filteredMaterials.length} 条材料{totalPages > 1 ? `（第 ${safePage + 1} / ${totalPages} 页）` : ""}
                </span>
                <div className="data-view-switcher" role="radiogroup" aria-label="视图模式">
                  <button
                    type="button"
                    className={`data-view-btn ${viewMode === "grid" ? "is-active" : ""}`}
                    onClick={() => setViewMode("grid")}
                    title="背包图鉴视图"
                    aria-label="背包图鉴视图"
                  >
                    ⊞ 图鉴
                  </button>
                  <button
                    type="button"
                    className={`data-view-btn ${viewMode === "list" ? "is-active" : ""}`}
                    onClick={() => setViewMode("list")}
                    title="紧凑列表视图"
                    aria-label="紧凑列表视图"
                  >
                    ☰ 列表
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* 2. Main Content Canvas */}
          <section className="material-list-panel" aria-busy={loading || detailLoading}>
            {error ? (
              <ArchiveError
                message="资料加载失败"
                detail={error}
                onRetry={() => {
                  void loadMaterials();
                  if (selected) void loadMaterialDetail(selected.stableId);
                }}
              />
            ) : null}

            {loading ? (
              <ArchiveLoading label="材料加载中" />
            ) : displayedMaterials.length ? (
              <>
                {viewMode === "grid" ? (
                  <div className="material-inventory-grid" role="list">
                    {displayedMaterials.map((material) => {
                      const isSelected = selected?.stableId === material.stableId;
                      const rarityLevel = material.rarity ?? 1;
                      return (
                        <div
                          key={material.stableId}
                          role="button"
                          tabIndex={0}
                          aria-selected={isSelected}
                          aria-label={`${material.name} (${rarityLevel}星)`}
                          className={`material-inventory-tile rarity-${rarityLevel} ${
                            isSelected ? "is-selected" : ""
                          }`}
                          onClick={() => handleSelectMaterial(material)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleSelectMaterial(material);
                            }
                          }}
                        >
                          <div className="material-tile-avatar-wrap">
                            <ArchiveAvatar
                              fallbackText={material.name.slice(0, 1)}
                              seed={material.stableId}
                              label={material.name}
                              size={44}
                            />
                          </div>
                          <div className="material-tile-stars" aria-hidden="true">
                            {stars(material.rarity)}
                          </div>
                          <div className="material-tile-nameplate" title={material.name}>
                            <span className="material-tile-name">{material.name}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="material-list" role="list">
                    {displayedMaterials.map((material) => {
                      const isSelected = selected?.stableId === material.stableId;
                      const rarityLevel = material.rarity ?? 1;
                      return (
                        <button
                          type="button"
                          role="listitem"
                          key={material.stableId}
                          className={`material-row rarity-border-${rarityLevel} ${
                            isSelected ? "is-active" : ""
                          }`}
                          onClick={() => handleSelectMaterial(material)}
                        >
                          <ArchiveAvatar
                            fallbackText={material.name.slice(0, 1)}
                            seed={material.stableId}
                            label={material.name}
                            size={36}
                          />
                          <span className="material-row-body">
                            <strong>{material.name}</strong>
                            <span className="material-row-tags">
                              <small className="material-category-tag">
                                {material.categoryLabel ?? categoryLabel(material.category)}
                              </small>
                              {material.subcategoryLabel ? (
                                <small className="material-subcategory-tag">
                                  {material.subcategoryLabel}
                                </small>
                              ) : null}
                            </span>
                          </span>
                          <span
                            className="material-rarity"
                            aria-label={`星级 ${material.rarity ?? 0}`}
                          >
                            {stars(material.rarity)}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}

                {totalPages > 1 && (
                  <ArchivePagination
                    current={safePage + 1}
                    limit={PAGE_SIZE}
                    hasMore={safePage + 1 < totalPages}
                    disabled={loading}
                    onPrev={() => setCurrentPage((prev) => Math.max(0, prev - 1))}
                    onNext={() => setCurrentPage((prev) => Math.min(totalPages - 1, prev + 1))}
                  />
                )}
              </>
            ) : (
              <ArchiveEmpty
                title="没有找到匹配的材料"
                detail="尝试清除稀有度筛选、重置二级分类或切换搜索关键词。"
              />
            )}
          </section>
        </div>
      }
      inspector={
        <ArchiveInspector title="材料详情">
          {!selected ? (
            <p className="muted">选择材料查看详情、获取方式与用途。</p>
          ) : (
            <>
              {/* Header Hero Banner */}
              <div className="material-detail-head">
                <div
                  className={`material-detail-avatar-box rarity-${selected.rarity ?? 1}`}
                  aria-hidden="true"
                >
                  <ArchiveAvatar
                    fallbackText={selected.name.slice(0, 1)}
                    seed={selected.stableId}
                    label={selected.name}
                    size={44}
                  />
                </div>
                <div className="material-detail-title-wrap">
                  <strong className="material-detail-name" title={selected.name}>
                    {selected.name}
                  </strong>
                  <div className="material-detail-meta-row">
                    <span
                      className={`material-detail-stars rarity-star-${selected.rarity ?? 1}`}
                      aria-label={`${selected.rarity ?? 1}星`}
                    >
                      {stars(selected.rarity)}
                    </span>
                    {(selected.subcategoryLabel || selected.categoryLabel) && (
                      <span className="material-detail-tag">
                        {selected.subcategoryLabel ??
                          selected.categoryLabel ??
                          categoryLabel(selected.category)}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Description Section */}
              <InspectorSection title="档案描述">
                {selected.description ? (
                  <div className="material-desc-card">
                    <p className="material-description">{selected.description}</p>
                  </div>
                ) : (
                  <p className="muted">暂无描述</p>
                )}
              </InspectorSection>

              {/* Drop Locations / Sources Section */}
              <InspectorSection title="📍 获取途径 / 掉落秘境">
                {selected.sources?.length ? (
                  <div className="material-source-card">
                    <ul className="material-source-list">
                      {selected.sources.map((source) => (
                        <li key={source}>
                          <span className="material-source-icon" aria-hidden="true">
                            ⚔️
                          </span>
                          <span>{source}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="muted">暂无来源信息</p>
                )}
              </InspectorSection>

              {/* Used by Characters Section (Interactive Links) */}
              <InspectorSection title="👥 培养用途 (谁需要此材料?)">
                {selected.usedBy?.length ? (
                  <div className="material-used-by-section">
                    <div className="material-used-by-hint">
                      <span>点击角色卡片直达档案</span>
                      <span aria-hidden="true">→</span>
                    </div>
                    <div className="material-used-by-grid">
                      {selected.usedBy.map((characterName) => (
                        <button
                          type="button"
                          key={characterName}
                          className="material-character-chip"
                          title={`查看「${characterName}」角色档案`}
                          onClick={() => {
                            window.location.hash = `archive/characters/${encodeURIComponent(characterName)}`;
                          }}
                        >
                          <ArchiveAvatar
                            fallbackText={characterName.slice(0, 1)}
                            seed={characterName}
                            label={characterName}
                            size={28}
                          />
                          <div className="material-character-chip-info">
                            <span className="material-character-name">{characterName}</span>
                            <span className="material-character-role">突破 / 天赋</span>
                          </div>
                          <span className="material-chip-arrow" aria-hidden="true">
                            ›
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="muted">暂无关联角色</p>
                )}
              </InspectorSection>

              {/* Metadata & Classification Section */}
              <InspectorSection title="分类与系统信息">
                <InspectorField
                  label="官方大类"
                  value={selected.categoryLabel ?? categoryLabel(selected.category)}
                />
                {selected.subcategoryLabel ? (
                  <InspectorField label="二级子类" value={selected.subcategoryLabel} />
                ) : null}
                {selected.gameVersion ? (
                  <InspectorField label="游戏版本" value={selected.gameVersion} />
                ) : null}
                <InspectorField label="Stable ID" value={<code>{selected.stableId}</code>} />
                {selected.revisionId && (
                  <InspectorField label="Revision" value={<code>{selected.revisionId}</code>} />
                )}
              </InspectorSection>
            </>
          )}
        </ArchiveInspector>
      }
    />
  );
}
