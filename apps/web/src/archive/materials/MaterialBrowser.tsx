import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../api.js";
import { ArchiveAvatar } from "../ArchiveAvatar.js";
import { ArchiveEmpty, ArchiveError, ArchiveLoading } from "../ArchiveStates.js";
import { ArchiveLayout } from "../ArchiveLayout.js";
import { ArchiveGlobalNav, type GlobalNavSection } from "../ArchiveGlobalNav.js";
import { InspectorField, InspectorSection, ArchiveInspector } from "../ArchiveInspector.js";
import type { ArchiveMaterial } from "./material.types.js";

const CATEGORY_LABELS: Record<string, string> = {
  character_development: "角色培养",
  character_ascension: "角色晋阶",
  weapon_development: "武器培养",
  weapon_ascension: "武器晋阶",
  local_specialty: "区域特产",
  currency: "货币",
  consumable: "消耗品",
  quest_item: "任务道具",
  forging: "锻造",
  cooking: "料理",
  furnishing: "摆设",
  other: "其他",
};

function categoryLabel(category: string) {
  return CATEGORY_LABELS[category] ?? category;
}

function stars(rarity?: number | null) {
  return rarity ? "★".repeat(rarity) : "";
}

/**
 * Material browser: category -> list -> detail, backed by the unified
 * /codex/materials API. Images fall back to the shared initial avatar.
 */
export function MaterialBrowser({
  gameId,
  gameName,
  revisionLabel,
  selectedRevision,
  initialMaterialId,
  onHome,
  onOpenStory,
  onOpenText,
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
  onMaterialIdChange?: (id: string | undefined) => void;
}) {
  const [materials, setMaterials] = useState<ArchiveMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("");
  const [selected, setSelected] = useState<ArchiveMaterial | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    const params = new URLSearchParams({ limit: "100" });
    if (selectedRevision) params.set("revisionId", selectedRevision);
    apiFetch<{ materials: ArchiveMaterial[] }>(
      `/api/games/${gameId}/codex/materials?${params.toString()}`,
    )
      .then((result) => {
        if (!cancelled) setMaterials(result.materials ?? []);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "材料列表加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [gameId, selectedRevision]);

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const material of materials) {
      counts.set(material.category, (counts.get(material.category) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [materials]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return materials.filter((material) => {
      if (activeCategory && material.category !== activeCategory) return false;
      if (!keyword) return true;
      return (
        material.name.toLowerCase().includes(keyword) ||
        (material.description ?? "").toLowerCase().includes(keyword)
      );
    });
  }, [materials, query, activeCategory]);

  useEffect(() => {
    if (!initialMaterialId) {
      setSelected(null);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    const params = new URLSearchParams();
    if (selectedRevision) params.set("revisionId", selectedRevision);
    apiFetch<{ material: ArchiveMaterial }>(
      `/api/games/${gameId}/codex/materials/${encodeURIComponent(initialMaterialId)}?${params.toString()}`,
    )
      .then((result) => {
        if (!cancelled) setSelected(result.material);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "材料详情加载失败");
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [initialMaterialId, gameId, selectedRevision]);

  const sections: GlobalNavSection[] = useMemo(
    () => [
      {
        label: "浏览",
        items: [
          { key: "home", label: "首页", onSelect: onHome },
          { key: "story", label: "剧情档案", onSelect: onOpenStory },
          { key: "materials", label: "材料", active: true, onSelect: onHome },
          { key: "text", label: "文本", onSelect: onOpenText },
        ],
      },
    ],
    [onHome, onOpenStory, onOpenText],
  );

  return (
    <ArchiveLayout
      wide
      globalNav={
        <ArchiveGlobalNav gameLabel={gameName} revisionLabel={revisionLabel} sections={sections} />
      }
      catalog={
        <div className="material-catalog">
          <input
            aria-label="搜索材料"
            placeholder="搜索材料名称、用途、来源…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <nav aria-label="材料分类">
            <button
              type="button"
              className={!activeCategory ? "is-active" : ""}
              onClick={() => setActiveCategory("")}
            >
              全部材料
            </button>
            {categories.map(([category, count]) => (
              <button
                type="button"
                key={category}
                className={activeCategory === category ? "is-active" : ""}
                onClick={() => setActiveCategory(category)}
              >
                {categoryLabel(category)}
                <small> {count}</small>
              </button>
            ))}
          </nav>
        </div>
      }
      main={
        <section className="material-list-panel" aria-busy={loading || detailLoading}>
          {error ? (
            <ArchiveError message="资料加载失败" detail={error} onRetry={() => setError("")} />
          ) : null}
          {loading ? (
            <ArchiveLoading label="材料加载中" />
          ) : filtered.length ? (
            <div className="material-list" role="list">
              {filtered.map((material) => (
                <button
                  type="button"
                  role="listitem"
                  key={material.stableId}
                  className={
                    "material-row " + (selected?.stableId === material.stableId ? "is-active" : "")
                  }
                  onClick={() => {
                    onMaterialIdChange?.(material.stableId);
                    setSelected(material);
                  }}
                >
                  <ArchiveAvatar
                    fallbackText={material.name.slice(0, 1)}
                    seed={material.stableId}
                    label={material.name}
                    size={32}
                  />
                  <span className="material-row-body">
                    <strong>{material.name}</strong>
                    <small>{categoryLabel(material.category)}</small>
                  </span>
                  <span className="material-rarity" aria-label={`星级 ${material.rarity ?? 0}`}>
                    {stars(material.rarity)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <ArchiveEmpty title="当前版本没有可浏览的材料" detail="尝试清除筛选或切换关键词。" />
          )}
        </section>
      }
      inspector={
        <ArchiveInspector title="材料详情">
          {!selected ? (
            <p className="muted">选择材料查看详情、获取方式与用途。</p>
          ) : (
            <>
              <div className="material-detail-head">
                <ArchiveAvatar
                  fallbackText={selected.name.slice(0, 1)}
                  seed={selected.stableId}
                  label={selected.name}
                  size={44}
                />
                <div>
                  <strong>{selected.name}</strong>
                  <span className="material-rarity">{stars(selected.rarity)}</span>
                </div>
              </div>
              <InspectorSection title="分类">
                <InspectorField label="分类" value={categoryLabel(selected.category)} />
                {selected.gameVersion ? (
                  <InspectorField label="游戏版本" value={selected.gameVersion} />
                ) : null}
              </InspectorSection>
              <InspectorSection title="描述">
                {selected.description ? (
                  <p className="material-description">{selected.description}</p>
                ) : (
                  <p className="muted">暂无描述</p>
                )}
              </InspectorSection>
              <InspectorSection title="获取方式">
                {selected.sources?.length ? (
                  <ul className="material-source-list">
                    {selected.sources.map((source) => (
                      <li key={source}>{source}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">暂无来源</p>
                )}
              </InspectorSection>
              <InspectorSection title="用途">
                {selected.usedBy?.length ? (
                  <div className="archive-avatar-row">
                    {selected.usedBy.map((used) => (
                      <span className="archive-avatar-chip" key={used}>
                        <ArchiveAvatar
                          fallbackText={used.slice(0, 1)}
                          seed={used}
                          label={used}
                          size={28}
                        />
                        <small>{used}</small>
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="muted">暂无关联</p>
                )}
              </InspectorSection>
              <InspectorSection title="来源">
                <InspectorField label="数据来源" value="TurnBasedGameData" />
                <InspectorField label="Stable ID" value={<code>{selected.stableId}</code>} />
                <InspectorField
                  label="Revision"
                  value={<code>{selected.revisionId ?? selectedRevision ?? "当前发布"}</code>}
                />
              </InspectorSection>
            </>
          )}
        </ArchiveInspector>
      }
    />
  );
}
