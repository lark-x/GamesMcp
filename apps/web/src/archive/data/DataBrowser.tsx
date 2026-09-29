import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../api.js";
import { isStarRailGame } from "../../shared.js";
import { ArchiveAvatar } from "../ArchiveAvatar.js";
import { ArchiveGlobalNav, type GlobalNavSection } from "../ArchiveGlobalNav.js";
import { ArchiveInspector, InspectorField, InspectorSection } from "../ArchiveInspector.js";
import { ArchiveLayout } from "../ArchiveLayout.js";
import { ArchivePagination } from "../ArchivePagination.js";
import { ArchiveEmpty, ArchiveError, ArchiveLoading } from "../ArchiveStates.js";
import type { DataKind } from "../archive.types.js";
import { isInternalEntry } from "./data.types.js";
import type { DataItemSummary } from "./data.types.js";

function getTerm(gameSlugOrId: string | undefined, kind: DataKind): string {
  const isStarRail = isStarRailGame(gameSlugOrId);
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

// 原神上游武器类型为英文枚举；展示层本地化，不影响星铁命途文案。
const GENSHIN_WEAPON_CN: Record<string, string> = {
  sword: "单手剑",
  claymore: "双手剑",
  polearm: "长柄武器",
  bow: "弓",
  catalyst: "法器",
};

function weaponTypeLabel(value: string, isStarRail: boolean): string {
  if (isStarRail) return value;
  return GENSHIN_WEAPON_CN[value.toLowerCase()] ?? value;
}

/** 从上游行中按候选键名取第一个非空字符串（兼容 snake/camel 两种键风格）。 */
function pickField(raw: UnknownRecord | undefined, keys: string[]): string | undefined {
  if (!raw) return undefined;
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

/** 上游把技能/行迹存成对象数组；只保留有可读名称的条目。 */
function normalizeNamedEntries(
  value: unknown,
): Array<{ id?: number; name?: string; type?: string; description?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const rec = (entry ?? {}) as UnknownRecord;
      const name = typeof rec.name === "string" ? rec.name.trim() : "";
      if (!name) return null;
      return {
        id: typeof rec.id === "number" ? rec.id : undefined,
        name,
        type: typeof rec.type === "string" ? rec.type : undefined,
        description:
          typeof rec.description === "string" && rec.description.trim()
            ? rec.description
            : undefined,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);
}

/** 星魂按 rank 升序展示，并丢掉上游的空条目。 */
function normalizeEidolons(
  value: unknown,
): Array<{ rank?: number; name?: string; description?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const rec = (entry ?? {}) as UnknownRecord;
      const name = typeof rec.name === "string" ? rec.name.trim() : "";
      if (!name) return null;
      return {
        rank: typeof rec.rank === "number" ? rec.rank : undefined,
        name,
        description:
          typeof rec.description === "string" && rec.description.trim()
            ? rec.description
            : undefined,
      };
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null)
    .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
}

/**
 * 提取角色的基础属性数值，按固定顺序呈现。
 */
function normalizeBaseStats(
  profile: UnknownRecord | null,
): Array<{ label: string; value: string }> {
  if (!profile) return [];
  const base = (profile.baseStats ?? profile.base_stats ?? null) as UnknownRecord | null;
  if (!base) return [];

  const candidates: Array<{ label: string; keys: string[] }> = [
    { label: "生命值", keys: ["hp", "hpBase", "baseHp", "maxHp"] },
    { label: "攻击力", keys: ["attack", "attackBase", "baseAttack", "atk"] },
    { label: "防御力", keys: ["defense", "defenseBase", "baseDefense", "def"] },
    { label: "速度", keys: ["speed", "baseSpeed", "spd"] },
    { label: "暴击率", keys: ["critRate", "crit_rate", "criticalRate"] },
    { label: "暴击伤害", keys: ["critDamage", "crit_damage", "criticalDamage"] },
  ];

  const out: Array<{ label: string; value: string }> = [];
  for (const c of candidates) {
    for (const key of c.keys) {
      const v = base[key];
      if (typeof v === "number" || (typeof v === "string" && v.trim())) {
        out.push({ label: c.label, value: String(v) });
        break;
      }
    }
  }
  return out;
}

const PAGE_SIZE = 60;

export function DataBrowser({
  gameId,
  gameSlug,
  dataKind,
  selectedRevision,
  initialItemId,
  onSelectKind,
  onSelectItem,
}: {
  gameId: string;
  gameSlug?: string;
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
  const [activeFilter, setActiveFilter] = useState<string>("");
  const [elementFilter, setElementFilter] = useState<string>("");
  const [weaponTypeFilter, setWeaponTypeFilter] = useState<string>("");
  const [regionFilter, setRegionFilter] = useState<string>("");
  const [rarityFilter, setRarityFilter] = useState<number>(0);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [page, setPage] = useState<number>(0);

  useEffect(() => {
    setActiveFilter("");
    setElementFilter("");
    setWeaponTypeFilter("");
    setRegionFilter("");
    setRarityFilter(0);
    setSearchQuery("");
    setPage(0);
  }, [dataKind]);

  useEffect(() => {
    setPage(0);
  }, [activeFilter, elementFilter, weaponTypeFilter, regionFilter, rarityFilter, searchQuery]);

  const isStarRail = isStarRailGame(gameSlug || gameId);
  const term = getTerm(gameSlug || gameId, dataKind);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const limit =
        dataKind === "achievements" ? "2000" : dataKind === "enemies" ? "1000" : "1000";
      const params = new URLSearchParams({ limit });
      if (selectedRevision) params.set("revisionId", selectedRevision);

      const res = (await apiFetch(
        `/api/games/${encodeURIComponent(gameId)}/codex/${dataKind}?${params.toString()}`,
      )) as UnknownRecord;

      let parsed: DataItemSummary[] = [];
      if (dataKind === "characters" && Array.isArray(res.characters)) {
        parsed = (res.characters as UnknownRecord[]).map((c) => {
          const profile = (c.profile ?? null) as UnknownRecord | null;
          return {
            stableId: String(c.stableId),
            name: String(c.name),
            title: typeof c.title === "string" ? c.title : undefined,
            rarity: typeof c.rarity === "number" ? c.rarity : undefined,
            element: typeof c.element === "string" ? c.element : undefined,
            weaponType: typeof c.weaponType === "string" ? c.weaponType : undefined,
            region: typeof c.region === "string" ? c.region : undefined,
            affiliation: typeof c.affiliation === "string" ? c.affiliation : undefined,
            description:
              typeof c.description === "string"
                ? c.description
                : pickField(c as UnknownRecord, ["desc"]),
            birthday: pickField(c as UnknownRecord, ["birthday"]),
            constellation: pickField(c as UnknownRecord, ["constellation"]),
            skills: normalizeNamedEntries(profile?.skills),
            traces: normalizeNamedEntries(profile?.traces),
            eidolons: normalizeEidolons(profile?.eidolons),
            baseStats: normalizeBaseStats(profile),
            raw: c,
          };
        });
      } else if (dataKind === "weapons" && Array.isArray(res.weapons)) {
        parsed = (res.weapons as UnknownRecord[]).map((w) => ({
          stableId: String(w.stableId),
          name: String(w.name),
          weaponType: typeof w.weaponType === "string" ? w.weaponType : undefined,
          rarity: typeof w.rarity === "number" ? w.rarity : undefined,
          passiveName: pickField(w, ["passiveName", "passive_name"]),
          passiveDescription: pickField(w, ["passiveDescription", "passive_description"]),
          description:
            typeof w.description === "string"
              ? w.description
              : typeof w.passiveDescription === "string"
                ? w.passiveDescription
                : pickField(w as UnknownRecord, ["desc"]),
          raw: w,
        }));
      } else if (dataKind === "artifacts" && Array.isArray(res.sets)) {
        parsed = (res.sets as UnknownRecord[]).map((s) => {
          const prov = (s.provenance ?? null) as UnknownRecord | null;
          const region =
            typeof prov?.region === "string"
              ? prov.region
              : typeof s.region === "string"
                ? s.region
                : undefined;
          return {
            stableId: String(s.stableId),
            name: String(s.name),
            rarity: typeof s.maxRarity === "number" ? s.maxRarity : undefined,
            region,
            category: region,
            description: (() => {
              const lines: string[] = [];
              if (typeof s.twoPieceBonus === "string" && s.twoPieceBonus.trim())
                lines.push(`【2件套】${s.twoPieceBonus}`);
              if (typeof s.fourPieceBonus === "string" && s.fourPieceBonus.trim())
                lines.push(`【4件套】${s.fourPieceBonus}`);
              if (lines.length > 0) return lines.join("\n");
              return typeof s.description === "string" ? s.description : undefined;
            })(),
            raw: s,
          };
        });
      } else if (dataKind === "enemies" && Array.isArray(res.enemies)) {
        parsed = (res.enemies as UnknownRecord[]).map((en) => {
          const profile = (en.profile ?? null) as UnknownRecord | null;
          const weaknesses = Array.isArray(profile?.weaknesses)
            ? (profile?.weaknesses as unknown[]).filter(
                (item): item is string => typeof item === "string",
              )
            : undefined;
          return {
            stableId: String(en.stableId),
            name: String(en.name),
            title: typeof en.title === "string" ? en.title : undefined,
            category: typeof en.category === "string" ? en.category : undefined,
            description:
              typeof en.description === "string"
                ? en.description
                : pickField(en as UnknownRecord, ["desc"]),
            weaknesses,
            raw: en,
          };
        });
      } else if (dataKind === "achievements" && Array.isArray(res.achievements)) {
        parsed = (res.achievements as UnknownRecord[]).map((ac) => {
          const rewardRec = (ac.reward ?? null) as UnknownRecord | null;
          const rewardText =
            typeof rewardRec?.name === "string" && typeof rewardRec?.count === "number"
              ? `${rewardRec.name} × ${rewardRec.count}`
              : typeof ac.reward === "string"
                ? (ac.reward as string)
                : undefined;
          return {
            stableId: String(ac.stableId),
            name: String(ac.name),
            category: typeof ac.category === "string" ? ac.category : undefined,
            description:
              typeof ac.description === "string"
                ? ac.description
                : pickField(ac as UnknownRecord, ["desc"]),
            requirement: pickField(ac as UnknownRecord, ["requirement", "condition"]),
            reward: rewardText,
            raw: ac,
          };
        });
      }

      // 仅展示公开条目，过滤掉未完备哨兵
      const visible = parsed.filter((it) => !isInternalEntry(it.name));
      setItems(visible);

      if (visible.length > 0) {
        const matchedItem = initialItemId
          ? visible.find((it) => it.stableId === initialItemId || it.name === initialItemId)
          : undefined;
        if (matchedItem) {
          setActiveItemId(matchedItem.stableId);
        } else if (!activeItemId || !visible.some((it) => it.stableId === activeItemId)) {
          setActiveItemId(visible[0]?.stableId);
          if (visible[0]) onSelectItem?.(visible[0].stableId);
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

  useEffect(() => {
    if (!initialItemId || items.length === 0) return;
    const match = items.find((it) => it.stableId === initialItemId || it.name === initialItemId);
    if (match) {
      setActiveItemId(match.stableId);
    }
  }, [initialItemId, items]);

  const availableElements = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) {
      if (it.element) s.add(it.element);
    }
    return Array.from(s);
  }, [items]);

  const availableWeaponTypes = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) {
      if (it.weaponType) s.add(it.weaponType);
    }
    return Array.from(s);
  }, [items]);

  const availableRegions = useMemo(() => {
    const s = new Set<string>();
    for (const it of items) {
      if (it.region) s.add(it.region);
    }
    return Array.from(s);
  }, [items]);

  const availableFilters = useMemo(() => {
    if (dataKind === "artifacts") {
      const order = ["蒙德", "璃月", "稻妻", "须弥", "枫丹", "纳塔", "通用初阶"];
      const regions = new Set<string>();
      for (const item of items) {
        if (item.region) regions.add(item.region);
      }
      return Array.from(regions).sort((a, b) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.localeCompare(b, "zh-CN");
      });
    }
    if (dataKind === "enemies") {
      const order = [
        "元素生命",
        "丘丘部落",
        "深渊",
        "愚人众",
        "自律机关",
        "人类势力",
        "异种魔兽",
        "强敌首领",
        "禽鸟",
        "走兽",
        "游鱼",
        "其他野生生物",
      ];
      const categories = new Set<string>();
      for (const item of items) {
        if (item.category) categories.add(item.category);
      }
      return Array.from(categories).sort((a, b) => {
        const ia = order.indexOf(a);
        const ib = order.indexOf(b);
        if (ia !== -1 && ib !== -1) return ia - ib;
        if (ia !== -1) return -1;
        if (ib !== -1) return 1;
        return a.localeCompare(b, "zh-CN");
      });
    }
    if (dataKind === "achievements") {
      const categories = new Map<string, number>();
      for (const item of items) {
        if (item.category) {
          categories.set(item.category, (categories.get(item.category) ?? 0) + 1);
        }
      }
      return Array.from(categories.keys()).sort(
        (a, b) => (categories.get(b) ?? 0) - (categories.get(a) ?? 0),
      );
    }
    return [];
  }, [items, dataKind]);

  const filteredItems = useMemo(() => {
    let result = items;
    if (elementFilter) {
      result = result.filter((it) => it.element === elementFilter);
    }
    if (weaponTypeFilter) {
      result = result.filter((it) => it.weaponType === weaponTypeFilter);
    }
    if (regionFilter) {
      result = result.filter((it) => it.region === regionFilter);
    }
    if (rarityFilter > 0) {
      result = result.filter((it) => (it.rarity ?? 0) === rarityFilter);
    }
    if (activeFilter) {
      if (dataKind === "artifacts") {
        result = result.filter((it) => it.region === activeFilter);
      } else if (dataKind === "enemies" || dataKind === "achievements") {
        result = result.filter((it) => it.category === activeFilter);
      }
    }
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (item) =>
          item.name.toLowerCase().includes(q) ||
          (item.title && item.title.toLowerCase().includes(q)) ||
          (item.element && item.element.toLowerCase().includes(q)) ||
          (item.category && item.category.toLowerCase().includes(q)) ||
          (item.region && item.region.toLowerCase().includes(q)) ||
          (item.description && item.description.toLowerCase().includes(q)),
      );
    }
    return result;
  }, [
    items,
    elementFilter,
    weaponTypeFilter,
    regionFilter,
    rarityFilter,
    activeFilter,
    searchQuery,
    dataKind,
  ]);

  const totalPages = Math.ceil(filteredItems.length / PAGE_SIZE) || 1;
  const safePage = Math.min(page, Math.max(0, totalPages - 1));
  const displayedItems = useMemo(() => {
    const start = safePage * PAGE_SIZE;
    return filteredItems.slice(start, start + PAGE_SIZE);
  }, [filteredItems, safePage]);

  const activeItem = useMemo(
    () => items.find((it) => it.stableId === activeItemId) ?? displayedItems[0] ?? filteredItems[0],
    [items, activeItemId, displayedItems, filteredItems],
  );

  function handleSelectItem(item: DataItemSummary) {
    setActiveItemId(item.stableId);
    onSelectItem?.(item.stableId);
  }

  const categoryTabs: { key: DataKind | "materials"; label: string }[] = [
    { key: "characters", label: "角色" },
    { key: "materials", label: "材料" },
    { key: "weapons", label: getTerm(gameSlug || gameId, "weapons") },
    { key: "artifacts", label: getTerm(gameSlug || gameId, "artifacts") },
    { key: "enemies", label: "敌人" },
    { key: "achievements", label: "成就" },
  ];

  const dataNavSections: GlobalNavSection[] = useMemo(
    () => [
      {
        label: "游戏资料",
        items: [
          {
            key: "characters",
            label: "角色",
            active: dataKind === "characters",
            onSelect: () => onSelectKind("characters"),
          },
          {
            key: "materials",
            label: "材料",
            active: false,
            onSelect: () => (window.location.hash = "archive/materials"),
          },
          {
            key: "weapons",
            label: isStarRail ? "光锥" : "武器",
            active: dataKind === "weapons",
            onSelect: () => onSelectKind("weapons"),
          },
          {
            key: "artifacts",
            label: isStarRail ? "遗器" : "圣遗物",
            active: dataKind === "artifacts",
            onSelect: () => onSelectKind("artifacts"),
          },
          {
            key: "enemies",
            label: "敌人",
            active: dataKind === "enemies",
            onSelect: () => onSelectKind("enemies"),
          },
          {
            key: "achievements",
            label: "成就",
            active: dataKind === "achievements",
            onSelect: () => onSelectKind("achievements"),
          },
        ],
      },
    ],
    [dataKind, onSelectKind, isStarRail],
  );

  function getElementPillClass(elem: string): string {
    const lower = elem.toLowerCase();
    if (lower.includes("火") || lower.includes("pyro") || lower.includes("fire")) return "elem-pyro";
    if (lower.includes("水") || lower.includes("hydro")) return "elem-hydro";
    if (lower.includes("风") || lower.includes("anemo") || lower.includes("wind")) return "elem-anemo";
    if (lower.includes("雷") || lower.includes("electro") || lower.includes("lightning")) return "elem-electro";
    if (lower.includes("草") || lower.includes("dendro")) return "elem-dendro";
    if (lower.includes("冰") || lower.includes("cryo") || lower.includes("ice")) return "elem-cryo";
    if (lower.includes("岩") || lower.includes("geo")) return "elem-geo";
    return "";
  }

  return (
    <ArchiveLayout
      className="archive-frame-no-catalog"
      globalNav={
        <ArchiveGlobalNav
          sections={dataNavSections}
          activeSection="data"
          activeItemKey={dataKind}
        />
      }
      catalog={null}
      main={
        <div className="data-browser-main" role="region" aria-label={`${term}图鉴展厅`}>
          {/* 1. Category Switch Tabs */}
          <div className="data-category-tabs" role="tablist" style={{ marginBottom: "12px" }}>
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

          {/* 2. Multi-Dimensional Filter Hub */}
          <section className="data-filter-hub" aria-label="资料图鉴筛选中枢">
            {/* Row 1: Element Filter (Characters only) */}
            {dataKind === "characters" && availableElements.length > 0 && (
              <div className="data-filter-row">
                <span className="data-filter-label">战斗属性:</span>
                <div className="data-elem-pill-group">
                  <button
                    type="button"
                    className={`data-elem-pill ${!elementFilter ? "is-active" : ""}`}
                    onClick={() => setElementFilter("")}
                  >
                    全部
                  </button>
                  {availableElements.map((elem) => (
                    <button
                      type="button"
                      key={elem}
                      className={`data-elem-pill ${getElementPillClass(elem)} ${
                        elementFilter === elem ? "is-active" : ""
                      }`}
                      onClick={() => setElementFilter(elementFilter === elem ? "" : elem)}
                    >
                      {elem}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Row 1 Alternative: Subcategory Filter (Artifacts, Enemies, Achievements) */}
            {availableFilters.length > 0 && (
              <div className="data-filter-row">
                <span className="data-filter-label">分类目录:</span>
                <div className="data-elem-pill-group">
                  <button
                    type="button"
                    className={`data-elem-pill ${!activeFilter ? "is-active" : ""}`}
                    onClick={() => setActiveFilter("")}
                  >
                    全部
                  </button>
                  {availableFilters.map((filt) => (
                    <button
                      type="button"
                      key={filt}
                      className={`data-elem-pill ${activeFilter === filt ? "is-active" : ""}`}
                      onClick={() => setActiveFilter(activeFilter === filt ? "" : filt)}
                    >
                      {filt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Row 2: Secondary Controls (Weapon, Region, Rarity, Search, View Mode) */}
            <div className="data-filter-subrow">
              <div className="data-filter-left-controls">
                {/* Weapon dropdown (Characters & Weapons) */}
                {(dataKind === "characters" || dataKind === "weapons") &&
                  availableWeaponTypes.length > 0 && (
                    <select
                      className="data-filter-select"
                      value={weaponTypeFilter}
                      onChange={(e) => setWeaponTypeFilter(e.target.value)}
                      aria-label="选择武器类型"
                    >
                      <option value="">全部{isStarRail ? "命途" : "武器"}</option>
                      {availableWeaponTypes.map((wt) => (
                        <option key={wt} value={wt}>
                          {weaponTypeLabel(wt, isStarRail)}
                        </option>
                      ))}
                    </select>
                  )}

                {/* Region dropdown / pills (Characters & Artifacts) */}
                {dataKind === "characters" && availableRegions.length > 0 && (
                  <div className="data-region-pills">
                    <button
                      type="button"
                      className={`data-region-pill ${!regionFilter ? "is-active" : ""}`}
                      onClick={() => setRegionFilter("")}
                    >
                      全地区
                    </button>
                    {availableRegions.slice(0, 6).map((reg) => (
                      <button
                        type="button"
                        key={reg}
                        className={`data-region-pill ${regionFilter === reg ? "is-active" : ""}`}
                        onClick={() => setRegionFilter(regionFilter === reg ? "" : reg)}
                      >
                        {reg}
                      </button>
                    ))}
                  </div>
                )}

                {/* Rarity filter pills */}
                {(dataKind === "characters" || dataKind === "weapons" || dataKind === "artifacts") && (
                  <div className="data-region-pills">
                    <button
                      type="button"
                      className={`data-region-pill ${rarityFilter === 0 ? "is-active" : ""}`}
                      onClick={() => setRarityFilter(0)}
                    >
                      全品质
                    </button>
                    <button
                      type="button"
                      className={`data-region-pill ${rarityFilter === 5 ? "is-active" : ""}`}
                      style={{ color: "var(--badge-5star)" }}
                      onClick={() => setRarityFilter(rarityFilter === 5 ? 0 : 5)}
                    >
                      5 ★★★★★
                    </button>
                    <button
                      type="button"
                      className={`data-region-pill ${rarityFilter === 4 ? "is-active" : ""}`}
                      style={{ color: "var(--badge-4star)" }}
                      onClick={() => setRarityFilter(rarityFilter === 4 ? 0 : 4)}
                    >
                      4 ★★★★
                    </button>
                  </div>
                )}
              </div>

              {/* Right Controls: Search, View Switcher, Total Count */}
              <div className="data-filter-right-controls">
                <span className="material-total-count">
                  共 {filteredItems.length} 条{term}
                  {totalPages > 1 ? ` (第 ${safePage + 1} / ${totalPages} 页)` : ""}
                </span>

                <div className="data-view-switcher" role="radiogroup" aria-label="视图模式">
                  <button
                    type="button"
                    className={`data-view-btn ${viewMode === "grid" ? "is-active" : ""}`}
                    onClick={() => setViewMode("grid")}
                    title="画廊展厅视图"
                    aria-label="画廊展厅视图"
                  >
                    ⊞ 画廊
                  </button>
                  <button
                    type="button"
                    className={`data-view-btn ${viewMode === "list" ? "is-active" : ""}`}
                    onClick={() => setViewMode("list")}
                    title="高密清单视图"
                    aria-label="高密清单视图"
                  >
                    ☰ 清单
                  </button>
                </div>

                <div className="data-search-input-wrap">
                  <input
                    type="search"
                    className="data-search-input"
                    placeholder={`搜索${term}...`}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    aria-label={`搜索${term}`}
                  />
                </div>
              </div>
            </div>
          </section>

          {/* 3. Main Content Canvas */}
          <section className="data-list-panel" aria-busy={loading}>
            {loading && <ArchiveLoading label={`加载${term}中...`} />}
            {error && <ArchiveError message={error} onRetry={loadData} />}
            {!loading && !error && filteredItems.length === 0 && (
              <ArchiveEmpty message={`暂无匹配的${term}`} />
            )}

            {!loading && !error && displayedItems.length > 0 && (
              <>
                {viewMode === "grid" ? (
                  <div className="data-gallery-grid" role="list">
                    {displayedItems.map((item) => {
                      const isSelected = activeItem?.stableId === item.stableId;
                      const rarityLevel = item.rarity ?? 1;
                      return (
                        <div
                          key={item.stableId}
                          role="button"
                          tabIndex={0}
                          aria-selected={isSelected}
                          className={`data-gallery-card rarity-${rarityLevel} ${
                            isSelected ? "is-selected" : ""
                          }`}
                          onClick={() => handleSelectItem(item)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleSelectItem(item);
                            }
                          }}
                        >
                          <div className="data-card-top-row">
                            {item.element ? (
                              <span className="data-tag" style={{ margin: 0 }}>
                                {item.element}
                              </span>
                            ) : item.category ? (
                              <span className="data-tag" style={{ margin: 0 }}>
                                {item.category}
                              </span>
                            ) : (
                              <span />
                            )}
                            {typeof item.rarity === "number" && item.rarity > 0 && (
                              <span className="data-item-stars" title={`${item.rarity}星`}>
                                {"★".repeat(item.rarity)}
                              </span>
                            )}
                          </div>
                          <div className="data-card-body-row">
                            <ArchiveAvatar fallbackText={item.name} label={item.name} size={44} />
                            <div className="data-card-titles">
                              <span className="data-card-name" title={item.name}>
                                {item.name}
                              </span>
                              {(item.title || item.region || item.affiliation) && (
                                <span
                                  className="data-card-subname"
                                  title={item.title || item.region || item.affiliation}
                                >
                                  {item.title || item.region || item.affiliation}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="data-card-bottom-tags">
                            {item.weaponType && (
                              <span className="data-tag" style={{ margin: 0 }}>
                                {weaponTypeLabel(item.weaponType, isStarRail)}
                              </span>
                            )}
                            {item.region && !item.title && (
                              <span className="data-tag" style={{ margin: 0 }}>
                                {item.region}
                              </span>
                            )}
                            {item.baseStats?.[0] && (
                              <span
                                style={{
                                  fontSize: "11px",
                                  color: "var(--archive-muted)",
                                  marginLeft: "auto",
                                }}
                              >
                                {item.baseStats[0].label}: {item.baseStats[0].value}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="data-item-list" role="list">
                    {displayedItems.map((item) => {
                      const isSelected = activeItem?.stableId === item.stableId;
                      return (
                        <button
                          key={item.stableId}
                          type="button"
                          role="listitem"
                          className={`data-item-row ${isSelected ? "selected" : ""}`}
                          data-rarity={item.rarity}
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
                              {item.weaponType && (
                                <span className="data-tag">
                                  {weaponTypeLabel(item.weaponType, isStarRail)}
                                </span>
                              )}
                              {item.category && <span className="data-tag">{item.category}</span>}
                              {item.region && <span className="data-tag">{item.region}</span>}
                              {item.title && <span className="data-item-title-tag">{item.title}</span>}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* 4. Bottom Strict Client Pagination */}
                {totalPages > 1 && (
                  <ArchivePagination
                    current={safePage + 1}
                    limit={PAGE_SIZE}
                    total={filteredItems.length}
                    onPrev={() => setPage((p) => Math.max(0, p - 1))}
                    onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                  />
                )}
              </>
            )}
          </section>
        </div>
      }
      inspector={
        activeItem ? (
          <ArchiveInspector title={`${activeItem.name} 详情`}>
            {/* Header Identity */}
            <div className="material-detail-head">
              <div className="material-detail-avatar-box">
                <ArchiveAvatar fallbackText={activeItem.name} label={activeItem.name} size={54} />
              </div>
              <div className="material-detail-title-wrap">
                <span className="material-detail-name">{activeItem.name}</span>
                <div className="material-detail-meta-row">
                  {typeof activeItem.rarity === "number" && activeItem.rarity > 0 && (
                    <span className={`material-detail-stars rarity-star-${activeItem.rarity}`}>
                      {"★".repeat(activeItem.rarity)}
                    </span>
                  )}
                  {activeItem.element && (
                    <span className="material-detail-tag">{activeItem.element}</span>
                  )}
                  {activeItem.weaponType && (
                    <span className="material-detail-tag">
                      {weaponTypeLabel(activeItem.weaponType, isStarRail)}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <InspectorSection title="基本属性">
              {activeItem.title && <InspectorField label="称号" value={activeItem.title} />}
              {activeItem.region && (
                <InspectorField
                  label={isStarRail ? "所属世界/区域" : "地区/势力"}
                  value={activeItem.region}
                />
              )}
              {activeItem.affiliation && (
                <InspectorField
                  label={isStarRail ? "派系归属" : "归属"}
                  value={activeItem.affiliation}
                />
              )}
              {activeItem.category && <InspectorField label="分类" value={activeItem.category} />}
              {activeItem.birthday && <InspectorField label="生日" value={activeItem.birthday} />}
              {activeItem.constellation && (
                <InspectorField label="命之座" value={activeItem.constellation} />
              )}
            </InspectorSection>

            {activeItem.baseStats && activeItem.baseStats.length > 0 && (
              <InspectorSection title="满级基础数值">
                <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                  {activeItem.baseStats.map((stat) => (
                    <div
                      key={stat.label}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        fontSize: "12px",
                      }}
                    >
                      <span style={{ color: "var(--archive-muted)" }}>{stat.label}</span>
                      <span style={{ fontWeight: 600, color: "var(--archive-text)" }}>
                        {stat.value}
                      </span>
                    </div>
                  ))}
                </div>
              </InspectorSection>
            )}

            {activeItem.weaknesses && activeItem.weaknesses.length > 0 && (
              <InspectorSection title="弱点属性">
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {activeItem.weaknesses.map((w) => (
                    <span key={w} className="data-tag" style={{ margin: 0 }}>
                      {w}
                    </span>
                  ))}
                </div>
              </InspectorSection>
            )}

            {activeItem.skills && activeItem.skills.length > 0 && (
              <InspectorSection title="战斗技能天赋">
                <div className="data-skill-list">
                  {activeItem.skills.map((skill, idx) => (
                    <div
                      className="data-skill-item"
                      key={skill.id ?? idx}
                      style={{ marginBottom: "8px" }}
                    >
                      <div className="data-skill-head">
                        <strong>{skill.name}</strong>
                        {skill.type && <span className="data-tag">{skill.type}</span>}
                      </div>
                      {skill.description && (
                        <p style={{ fontSize: "12px", lineHeight: 1.6, margin: "4px 0 0" }}>
                          {skill.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </InspectorSection>
            )}

            {activeItem.traces && activeItem.traces.length > 0 && (
              <InspectorSection title="额外行迹能力">
                <div className="data-skill-list">
                  {activeItem.traces.map((trace, idx) => (
                    <div
                      className="data-skill-item"
                      key={trace.id ?? idx}
                      style={{ marginBottom: "8px" }}
                    >
                      <div className="data-skill-head">
                        <strong>{trace.name}</strong>
                      </div>
                      {trace.description && (
                        <p style={{ fontSize: "12px", lineHeight: 1.6, margin: "4px 0 0" }}>
                          {trace.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </InspectorSection>
            )}

            {activeItem.eidolons && activeItem.eidolons.length > 0 && (
              <InspectorSection title={isStarRail ? "星魂突破" : "命之座觉醒"}>
                <div className="data-skill-list">
                  {activeItem.eidolons.map((eidolon, idx) => (
                    <div
                      className="data-skill-item"
                      key={eidolon.rank ?? idx}
                      style={{ marginBottom: "8px" }}
                    >
                      <div className="data-skill-head">
                        <strong>
                          {eidolon.rank ? `${eidolon.rank}阶 · ` : ""}
                          {eidolon.name}
                        </strong>
                      </div>
                      {eidolon.description && (
                        <p style={{ fontSize: "12px", lineHeight: 1.6, margin: "4px 0 0" }}>
                          {eidolon.description}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </InspectorSection>
            )}

            {activeItem.passiveName && (
              <InspectorSection title={isStarRail ? "光锥技能" : "武器技能"}>
                <div className="data-article-highlight">
                  <strong>{activeItem.passiveName}</strong>
                  {activeItem.passiveDescription && (
                    <p style={{ margin: "6px 0 0", fontSize: "12px" }}>
                      {activeItem.passiveDescription}
                    </p>
                  )}
                </div>
              </InspectorSection>
            )}

            {activeItem.description && (
              <InspectorSection title="档案背景">
                <p
                  style={{
                    fontSize: "12px",
                    lineHeight: 1.7,
                    color: "var(--archive-text-secondary)",
                    margin: 0,
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {activeItem.description}
                </p>
              </InspectorSection>
            )}

            {activeItem.requirement && (
              <InspectorSection title="达成条件">
                <p className="data-article-highlight">{activeItem.requirement}</p>
              </InspectorSection>
            )}

            {activeItem.reward && (
              <InspectorSection title="成就奖励">
                <p className="data-article-reward">🎁 {activeItem.reward}</p>
              </InspectorSection>
            )}

            <InspectorSection title="关联培养材料">
              <button
                type="button"
                className="material-char-link"
                style={{ width: "100%", justifyContent: "center" }}
                onClick={() => {
                  window.location.hash = "archive/materials";
                }}
              >
                <span>🎒 查看全部养成材料百科 →</span>
              </button>
            </InspectorSection>

            <InspectorSection title="版本与来源">
              <InspectorField label="词条名称" value={activeItem.name} />
              {activeItem.stableId && activeItem.stableId !== "undefined" ? (
                <InspectorField label="Stable ID" value={activeItem.stableId} mono />
              ) : null}
              <InspectorField label="资料分类" value={term} />
              <InspectorField label="关联游戏" value={gameSlug ?? gameId} />
              <InspectorField label="当前版本" value={selectedRevision ?? "published"} />
              <InspectorField label="收录状态" value="已入库规范化" />
            </InspectorSection>
          </ArchiveInspector>
        ) : (
          <ArchiveInspector title={`${term}出处与信息`}>
            <ArchiveEmpty message={`请在左侧选择${term}查看详情`} />
          </ArchiveInspector>
        )
      }
    />
  );
}
