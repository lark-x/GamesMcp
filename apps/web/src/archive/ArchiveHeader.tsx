import { useEffect, useState } from "react";
import type { GameSummary } from "@gip/contracts";
import { useThemeMode } from "../providers.jsx";
import { ArchiveAvatar } from "./ArchiveAvatar.js";

function ThemeToggle() {
  const { mode, toggle } = useThemeMode();
  return (
    <button
      type="button"
      className="archive-theme-switch-btn"
      onClick={toggle}
      role="switch"
      aria-checked={mode === "dark"}
      aria-label="切换深色/浅色模式"
      title={`当前为${mode === "dark" ? "深色" : "浅色"}模式，点击切换`}
    >
      <span className="archive-theme-switch-slider">
        <span className="archive-theme-switch-icon">
          {mode === "dark" ? "🌙" : "☀️"}
        </span>
      </span>
      <span className="archive-theme-switch-text">
        {mode === "dark" ? "暗" : "亮"}
      </span>
    </button>
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
        <button
          type="button"
          className="archive-header-quick-search-btn"
          onClick={() => (window.location.hash = "search")}
          title="全局快速检索 (⌘K 或 Ctrl+K)"
          aria-label="全局快速检索"
        >
          <span className="archive-quick-search-icon" aria-hidden="true">🔍</span>
          <span className="archive-quick-search-text">搜索...</span>
          <kbd className="archive-kbd">⌘K</kbd>
        </button>
        <div className="archive-game-picker">
          <div className="archive-game-select-container">
            <span className="archive-game-select-icon" aria-hidden="true">🎮</span>
            <select
              id="archive-game-select"
              className="archive-game-native-select"
              value={gameId || ""}
              onChange={(e) => onGameChange(e.target.value)}
              aria-label="选择游戏"
            >
              {games.map((game) => (
                <option key={game.id} value={game.id}>
                  {game.currentRevision ? `${game.name} · ${game.currentRevision}` : game.name}
                </option>
              ))}
            </select>
            <span className="archive-game-select-caret" aria-hidden="true">▾</span>
          </div>
        </div>
        <ThemeToggle />
      </div>
    </header>
  );
}
