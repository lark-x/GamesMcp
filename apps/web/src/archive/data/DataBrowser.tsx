import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../../api.js";
import { isStarRailGame } from "../../shared.js";
import { ArchiveAvatar } from "../ArchiveAvatar.js";
import { ArchiveGlobalNav, type GlobalNavSection } from "../ArchiveGlobalNav.js";
import { ArchiveInspector, InspectorField, InspectorSection } from "../ArchiveInspector.js";
import { ArchiveLayout } from "../ArchiveLayout.js";
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
function pickField(
  raw: UnknownRecord | undefined,
  keys: string[],
): string | undefined {
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

/** 基础战斗属性：上游用 baseHp/baseAtk 这类键，按游戏习惯给出中文标签。 */
function normalizeBaseStats(
  profile: UnknownRecord | null,
): Array<{ label: string; value: string }> {
  if (!profile) return [];
  const defs: Array<[string, string]> = [
    ["baseHp", "生命值"],
    ["baseAtk", "攻击力"],
    ["baseDef", "防御力"],
    ["baseSpeed", "速度"],
  ];
  const out: Array<{ label: string; value: string }> = [];
  for (const [key, label] of defs) {
    const raw = profile[key];
    if (typeof raw === "number" && Number.isFinite(raw)) {
      out.push({ label, value: String(raw) });
    }
  }
  return out;
}

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

  const isStarRail = isStarRailGame(gameSlug || gameId);
  const term = getTerm(gameSlug || gameId, dataKind);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "100" });
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
        parsed = (res.sets as UnknownRecord[]).map((s) => ({
          stableId: String(s.stableId),
          name: String(s.name),
          rarity: typeof s.maxRarity === "number" ? s.maxRarity : undefined,
          // Planar ornament sets genuinely have no 4-piece effect upstream, so
          // only emit the lines that exist instead of an empty 【4件套】 heading.
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
        }));
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
            category:
              typeof en.category === "string"
                ? en.category
                : typeof en.family === "string"
                  ? en.family
                  : undefined,
            description: typeof en.description === "string" ? en.description : undefined,
            element: typeof en.element === "string" ? en.element : undefined,
            rank: pickField(profile ?? undefined, ["rank"]),
            weaknesses,
            raw: en,
          };
        });
      } else if (dataKind === "achievements" && Array.isArray(res.achievements)) {
        parsed = (res.achievements as UnknownRecord[]).map((a) => {
          const rawDescription = pickField(a, ["description", "desc"]);
          const requirement = typeof a.requirement === "string" ? a.requirement : undefined;
          return {
            stableId: String(a.stableId),
            name: String(a.name),
            category: typeof a.category === "string" ? a.category : undefined,
            requirement,
            reward: a.rewardPrimogems ? `${a.rewardPrimogems} 原石/星琼` : undefined,
            // 上游档案描述常与达成条件相同；相同则只展示达成条件，避免重复。
            description: rawDescription && rawDescription !== requirement ? rawDescription : undefined,
            raw: a,
          };
        });
      }

      setItems(
        parsed.filter(
          (item) =>
            !isInternalEntry(item.name) &&
            // 原神上游 11xxxxxx 角色 ID 段为内部测试/废弃角色，不对外展示。
            !/character\/11\d{6}/.test(
              typeof (item.raw as UnknownRecord | undefined)?.sourceKey === "string"
                ? String((item.raw as UnknownRecord).sourceKey)
                : "",
            ),
        ),
      );
      if (parsed.length > 0) {
        const visible = parsed.filter((item) => !isInternalEntry(item.name));
        if (initialItemId && visible.some((it) => it.stableId === initialItemId)) {
          setActiveItemId(initialItemId);
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

  return (
    <ArchiveLayout
      globalNav={<ArchiveGlobalNav sections={dataNavSections} activeSection="data" />}
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
                          <span className="data-tag">{weaponTypeLabel(item.weaponType, isStarRail)}</span>
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
                      <span className="data-prop-k">{isStarRail ? "战斗属性" : "元素/属性"}</span>
                      <span className="data-prop-v">{activeItem.element}</span>
                    </div>
                  )}
                  {activeItem.weaponType && (
                    <div className="data-prop-pill">
                      <span className="data-prop-k">{isStarRail ? "命途倾向" : "武器类型"}</span>
                      <span className="data-prop-v">{weaponTypeLabel(activeItem.weaponType, isStarRail)}</span>
                    </div>
                  )}
                  {activeItem.region && (
                    <div className="data-prop-pill">
                      <span className="data-prop-k">{isStarRail ? "所属世界/区域" : "地区/势力"}</span>
                      <span className="data-prop-v">{activeItem.region}</span>
                    </div>
                  )}
                  {activeItem.affiliation && (
                    <div className="data-prop-pill">
                      <span className="data-prop-k">{isStarRail ? "派系归属" : "归属"}</span>
                      <span className="data-prop-v">{activeItem.affiliation}</span>
                    </div>
                  )}
                  {activeItem.category && (
                    <div className="data-prop-pill">
                      <span className="data-prop-k">分类</span>
                      <span className="data-prop-v">{activeItem.category}</span>
                    </div>
                  )}
                  {activeItem.rank && (
                    <div className="data-prop-pill">
                      <span className="data-prop-k">等级</span>
                      <span className="data-prop-v">{activeItem.rank}</span>
                    </div>
                  )}
                  {activeItem.birthday && (
                    <div className="data-prop-pill">
                      <span className="data-prop-k">生日</span>
                      <span className="data-prop-v">{activeItem.birthday}</span>
                    </div>
                  )}
                  {activeItem.constellation && (
                    <div className="data-prop-pill">
                      <span className="data-prop-k">命之座</span>
                      <span className="data-prop-v">{activeItem.constellation}</span>
                    </div>
                  )}
                </div>
              </header>

              {activeItem.weaknesses && activeItem.weaknesses.length > 0 && (
                <section className="data-article-section">
                  <h2>弱点属性</h2>
                  <div className="data-article-props">
                    {activeItem.weaknesses.map((weakness) => (
                      <div key={weakness} className="data-prop-pill">
                        <span className="data-prop-v">{weakness}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {activeItem.baseStats && activeItem.baseStats.length > 0 && (
                <section className="data-article-section">
                  <h2>基础属性</h2>
                  <div className="data-article-props">
                    {activeItem.baseStats.map((stat) => (
                      <div key={stat.label} className="data-prop-pill">
                        <span className="data-prop-k">{stat.label}</span>
                        <span className="data-prop-v">{stat.value}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {activeItem.skills && activeItem.skills.length > 0 && (
                <section className="data-article-section">
                  <h2>技能</h2>
                  <div className="data-skill-list">
                    {activeItem.skills.map((skill, idx) => (
                      <div className="data-skill-item" key={skill.id ?? idx}>
                        <div className="data-skill-head">
                          <strong>{skill.name}</strong>
                          {skill.type && <span className="data-tag">{skill.type}</span>}
                        </div>
                        {skill.description && <p>{skill.description}</p>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {activeItem.traces && activeItem.traces.length > 0 && (
                <section className="data-article-section">
                  <h2>行迹</h2>
                  <div className="data-skill-list">
                    {activeItem.traces.map((trace, idx) => (
                      <div className="data-skill-item" key={trace.id ?? idx}>
                        <div className="data-skill-head">
                          <strong>{trace.name}</strong>
                        </div>
                        {trace.description && <p>{trace.description}</p>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {activeItem.eidolons && activeItem.eidolons.length > 0 && (
                <section className="data-article-section">
                  <h2>星魂</h2>
                  <div className="data-skill-list">
                    {activeItem.eidolons.map((eidolon, idx) => (
                      <div className="data-skill-item" key={eidolon.rank ?? idx}>
                        <div className="data-skill-head">
                          <strong>
                            {eidolon.rank ? `${eidolon.rank} 星魂 · ` : ""}
                            {eidolon.name}
                          </strong>
                        </div>
                        {eidolon.description && <p>{eidolon.description}</p>}
                      </div>
                    ))}
                  </div>
                </section>
              )}

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

              {activeItem.passiveName && (
                <section className="data-article-section">
                  <h2>{isStarRail ? "光锥技能" : "武器技能"}</h2>
                  <div className="data-article-highlight">
                    <strong>{activeItem.passiveName}</strong>
                    {activeItem.passiveDescription ? (
                      <p style={{ margin: "6px 0 0" }}>{activeItem.passiveDescription}</p>
                    ) : null}
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
              {activeItem.stableId && activeItem.stableId !== "undefined" ? (
                <InspectorField label="Stable ID" value={activeItem.stableId} mono />
              ) : null}
              <InspectorField label="资料分类" value={term} />
              <InspectorField label="关联游戏" value={gameSlug ?? gameId} />
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
