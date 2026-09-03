import type { GameSummary } from "@gip/contracts";
import { Button, Select, Switch } from "antd";
import { useThemeMode } from "../providers.jsx";
import { VersionSwitcher } from "../versions/VersionSwitcher.js";
import type { Overview } from "./ArchiveSidebar.js";

function ThemeToggle() {
  const { mode, toggle } = useThemeMode();
  return (
    <Switch
      checked={mode === "dark"}
      onChange={toggle}
      checkedChildren="暗"
      unCheckedChildren="亮"
      aria-label="切换深色模式"
    />
  );
}

export function LibraryHeader({
  gameName,
  games,
  gameId,
  overview,
  onGameChange,
  onPreview,
  onRevision,
  onCurrent,
  onQuests,
  onMaterials,
  onText,
  onAdminPreview,
}: {
  gameName?: string;
  games: GameSummary[];
  gameId: string;
  overview: Overview;
  onGameChange: (value: string) => void;
  onPreview: (candidateId: string, buildId?: string) => void;
  onRevision: Parameters<typeof VersionSwitcher>[0]["onRevision"];
  onCurrent: () => void;
  onQuests: () => void;
  onMaterials: () => void;
  onText: () => void;
  onAdminPreview: () => void;
}) {
  return (
    <header className="topbar library-topbar">
      <div className="library-brand">
        <span className="brand-mark" aria-hidden="true">
          GI
        </span>
        <div>
          <span className="eyebrow">GAMESMCP ARCHIVE</span>
          <h1>{gameName ? `${gameName}资料库` : "GamesMcp 资料库"}</h1>
        </div>
      </div>
      <div className="library-top-actions">
        <span className="library-data-state">
          <i aria-hidden="true" />
          {overview.ready?.searchIndex === "ready" ? "资料索引可用" : "正在检查资料索引"}
        </span>
        <div className="game-picker">
          <label htmlFor="game">正式版本</label>
          <Select
            id="game"
            style={{ minWidth: 200 }}
            value={gameId || undefined}
            onChange={onGameChange}
            options={games.map((game) => ({
              value: game.id,
              label: `${game.name} · ${game.currentRevision ?? "未发布"}`,
            }))}
          />
        </div>
        <VersionSwitcher onPreview={onPreview} onRevision={onRevision} onCurrent={onCurrent} />
        <Button onClick={onQuests}>剧情档案</Button>
        <Button onClick={onMaterials}>材料</Button>
        <Button onClick={onText}>文本</Button>
        <Button onClick={onAdminPreview}>管理预发布</Button>
        <ThemeToggle />
      </div>
    </header>
  );
}
