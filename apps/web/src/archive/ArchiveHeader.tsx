import { useEffect, useState } from "react";
import type { GameSummary } from "@gip/contracts";
import { Select, Switch } from "antd";
import { useThemeMode } from "../providers.jsx";
import { ArchiveAvatar } from "./ArchiveAvatar.js";

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

export function ArchiveHeader({
  gameName,
  games,
  gameId,
  selectedRevisionLabel,
  onGameChange,
}: {
  gameName?: string;
  games: GameSummary[];
  gameId: string;
  selectedRevisionLabel?: string;
  onGameChange: (value: string) => void;
}) {
  const [currentHash, setCurrentHash] = useState(() => window.location.hash.replace(/^#\/?/, ""));

  useEffect(() => {
    function onHashChange() {
      setCurrentHash(window.location.hash.replace(/^#\/?/, ""));
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const isStory = currentHash.startsWith("story") || currentHash.startsWith("quests");
  const isData = currentHash.startsWith("archive") || currentHash.startsWith("codex");
  const isText = currentHash.startsWith("text");
  const isSearch = currentHash.startsWith("search");
  const isAsk = currentHash.startsWith("ask");

  return (
    <header className="archive-header" role="banner">
      <div
        className="archive-header-brand"
        onClick={() => (window.location.hash = "")}
        style={{ cursor: "pointer" }}
      >
        <ArchiveAvatar fallbackText="G" label="GamesMcp" size={32} />
        <div>
          <span className="archive-header-title">GamesMcp</span>
          <span className="archive-header-subtitle">
            {gameName ?? "知识档案库"} {selectedRevisionLabel ? `· ${selectedRevisionLabel}` : ""}
          </span>
        </div>
      </div>

      <div className="archive-header-nav">
        <button
          type="button"
          className={`archive-header-link ${isStory ? "active" : ""}`}
          onClick={() => (window.location.hash = "story")}
        >
          剧情档案
        </button>
        <button
          type="button"
          className={`archive-header-link ${isData ? "active" : ""}`}
          onClick={() => (window.location.hash = "archive/characters")}
        >
          游戏资料
        </button>
        <button
          type="button"
          className={`archive-header-link ${isText ? "active" : ""}`}
          onClick={() => (window.location.hash = "text/books")}
        >
          文献文本
        </button>
        <button
          type="button"
          className={`archive-header-link ${isSearch ? "active" : ""}`}
          onClick={() => (window.location.hash = "search")}
        >
          搜索
        </button>
        <button
          type="button"
          className={`archive-header-link ${isAsk ? "active" : ""}`}
          onClick={() => (window.location.hash = "ask")}
        >
          问答
        </button>
      </div>

      <div className="archive-header-actions">
        <div className="archive-game-picker">
          <Select
            id="archive-game-select"
            size="small"
            style={{ minWidth: 160 }}
            value={gameId || undefined}
            onChange={onGameChange}
            options={games.map((game) => ({
              value: game.id,
              label: game.currentRevision ? `${game.name} · ${game.currentRevision}` : game.name,
            }))}
            aria-label="选择游戏"
          />
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
