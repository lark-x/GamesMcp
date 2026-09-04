import { useEffect, useRef, useState } from "react";
import type { GameSummary } from "@gip/contracts";
import { ArchiveAvatar } from "./ArchiveAvatar.js";

export function ArchiveHome({
  gameName,
  selectedRevisionLabel,
}: {
  currentGame?: GameSummary;
  gameName?: string;
  selectedRevisionLabel?: string;
}) {
  const [keyword, setKeyword] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (
        e.key === "/" &&
        document.activeElement !== searchInputRef.current &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (keyword.trim()) {
      window.location.hash = `search?q=${encodeURIComponent(keyword.trim())}`;
    } else {
      window.location.hash = "search";
    }
  }

  return (
    <div className="archive-home-container" role="main">
      <div className="archive-home-hero">
        <div className="archive-home-badge">
          <ArchiveAvatar fallbackText="G" label="GamesMcp" size={32} />
          <span>GAMESMCP ARCHIVE</span>
        </div>
        <h1 className="archive-home-title">游戏叙事与知识档案库</h1>
        <p className="archive-home-desc">
          高密度连续长文本叙事排版、全游戏结构化数据百科与文献档案阅读平台。
        </p>

        <form className="archive-home-search-form" onSubmit={handleSearch}>
          <div className="archive-home-search-wrapper">
            <span className="archive-home-search-icon" aria-hidden="true">
              🔍
            </span>
            <input
              ref={searchInputRef}
              type="search"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索剧情、角色、材料、文献或关键词..."
              className="archive-home-search-input"
              aria-label="快速检索档案"
            />
            <kbd className="archive-kbd" title="键盘快捷键 ⌘K 或 /">
              ⌘K
            </kbd>
          </div>
          <button type="submit" className="archive-home-search-button">
            检索
          </button>
        </form>

        <div className="archive-home-status-bar">
          <span>
            当前环境：<strong>{gameName ?? "GamesMcp"}</strong>
          </span>
          <span>
            数据集版本：<strong>{selectedRevisionLabel ?? "正式发布"}</strong>
          </span>
        </div>
      </div>

      <div className="archive-home-portals archive-home-bento">
        {/* 1. 剧情档案 (Bento Large Card - Left Span) */}
        <section
          className="archive-portal-card archive-bento-story"
          onClick={() => (window.location.hash = "story")}
          style={{ cursor: "pointer" }}
        >
          <div className="archive-portal-card-header">
            <div className="archive-portal-icon">📖</div>
            <div className="archive-bento-meta">
              <span className="archive-bento-badge">双栏比照 · 效率叙事</span>
            </div>
          </div>
          <h2>剧情档案 (Story Browser)</h2>
          <p>
            连续剧情正文排版，摒弃气泡式碎化阅读；按系列、章节与任务组织通用多级树，支持台词证据链定位与出处高亮。
          </p>

          <div className="archive-bento-preview-story">
            <div className="archive-bento-story-line">
              <span className="archive-bento-speaker">留云借风真君</span>
              <span className="archive-bento-dialogue">
                “帝君遇刺之事，本仙早已算知七八，璃月七星所行之举，实在荒谬之极！”
              </span>
            </div>
          </div>

          <div className="archive-portal-tags">
            <span>连续叙事流</span>
            <span>任务分层树</span>
            <span>出场人物与出处</span>
            <span>真机原文比照</span>
          </div>
          <button
            type="button"
            className="archive-portal-action"
            onClick={(e) => {
              e.stopPropagation();
              window.location.hash = "story";
            }}
          >
            浏览剧情 →
          </button>
        </section>

        {/* 2. 游戏资料 (Bento Card - Right Top Span) */}
        <section
          className="archive-portal-card archive-bento-data"
          onClick={() => (window.location.hash = "archive/characters")}
          style={{ cursor: "pointer" }}
        >
          <div className="archive-portal-card-header">
            <div className="archive-portal-icon">🛡️</div>
            <div className="archive-bento-meta">
              <span className="archive-bento-badge">结构化百科</span>
            </div>
          </div>
          <h2>游戏资料 (Data Codex)</h2>
          <p>
            结构化游戏百科，包含角色、材料、武器/光锥、圣遗物/遗器、敌人与成就。提供跨字段搜索与无图占位回退。
          </p>
          <div className="archive-portal-sublinks">
            <a href="#archive/characters" onClick={(e) => e.stopPropagation()}>
              角色
            </a>
            <a href="#archive/materials" onClick={(e) => e.stopPropagation()}>
              材料
            </a>
            <a href="#archive/weapons" onClick={(e) => e.stopPropagation()}>
              武器/光锥
            </a>
            <a href="#archive/artifacts" onClick={(e) => e.stopPropagation()}>
              圣遗物/遗器
            </a>
            <a href="#archive/enemies" onClick={(e) => e.stopPropagation()}>
              敌人
            </a>
            <a href="#archive/achievements" onClick={(e) => e.stopPropagation()}>
              成就
            </a>
          </div>
          <button
            type="button"
            className="archive-portal-action"
            onClick={(e) => {
              e.stopPropagation();
              window.location.hash = "archive/characters";
            }}
          >
            查看资料 →
          </button>
        </section>

        {/* 3. 文本档案 (Bento Card - Bottom Left) */}
        <section
          className="archive-portal-card archive-bento-text"
          onClick={() => (window.location.hash = "text/books")}
          style={{ cursor: "pointer" }}
        >
          <div className="archive-portal-card-header">
            <div className="archive-portal-icon">📜</div>
            <div className="archive-bento-meta">
              <span className="archive-bento-badge">文献与典籍</span>
            </div>
          </div>
          <h2>文本档案 (Text Browser)</h2>
          <p>
            沉浸式文献与长篇文档阅读器，多卷书籍分卷浏览，物品设定与角色故事统一归档，保持阅读上下文与章节导航。
          </p>
          <div className="archive-portal-sublinks">
            <a href="#text/books" onClick={(e) => e.stopPropagation()}>
              书籍文献
            </a>
            <a href="#text/items" onClick={(e) => e.stopPropagation()}>
              物品文本
            </a>
            <a href="#text/character-stories" onClick={(e) => e.stopPropagation()}>
              角色故事
            </a>
            <a href="#text/voices" onClick={(e) => e.stopPropagation()}>
              角色语音
            </a>
            <a href="#text/mechanics" onClick={(e) => e.stopPropagation()}>
              机制与教程
            </a>
          </div>
          <button
            type="button"
            className="archive-portal-action"
            onClick={(e) => {
              e.stopPropagation();
              window.location.hash = "text/books";
            }}
          >
            查阅文本 →
          </button>
        </section>

        {/* 4. 智能问答与检索 (Bento Card - Bottom Right) */}
        <section className="archive-portal-card archive-bento-tools archive-portal-tools">
          <div className="archive-portal-card-header">
            <div className="archive-portal-icon">⚡</div>
            <div className="archive-bento-meta">
              <span className="archive-bento-badge">全局索引</span>
            </div>
          </div>
          <h2>检索与问答工具</h2>
          <p>基于版本化证据链的问答系统与全局全文检索，严谨提供原文佐证与出处段落。</p>
          <div className="archive-portal-tool-buttons">
            <button type="button" onClick={() => (window.location.hash = "search")}>
              全局跨库检索
            </button>
            <button type="button" onClick={() => (window.location.hash = "ask")}>
              证据式智能问答
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
