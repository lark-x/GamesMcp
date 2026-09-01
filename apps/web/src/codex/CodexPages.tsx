import { useEffect, useState } from "react";
import { apiFetch } from "../api.js";

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
