import type { ArchiveHomeResponse } from "@gip/contracts";
import { Segmented } from "antd";
import { ARCHIVE_CATEGORIES, type ArchiveCategory } from "../shared.js";

export type ResultType = "entity" | "document" | "segment";

export type Overview = {
  ready: { status: string; currentRevision?: string; searchIndex?: string } | null;
  home: ArchiveHomeResponse | null;
  sources: Array<{ id: string; name: string; type: string }>;
};

export function ArchiveSidebar({
  activeCategory,
  types,
  entityType,
  documentType,
  gameVersion,
  sourceId,
  overview,
  visibleRevisionLabel,
  onCategory,
  onTypesChange,
  onEntityTypeChange,
  onDocumentTypeChange,
  onGameVersionChange,
  onSourceChange,
}: {
  activeCategory: string;
  types: ResultType[];
  entityType: string;
  documentType: string;
  gameVersion: string;
  sourceId: string;
  overview: Overview;
  visibleRevisionLabel: string;
  onCategory: (category: ArchiveCategory) => void;
  onTypesChange: (types: ResultType[]) => void;
  onEntityTypeChange: (value: string) => void;
  onDocumentTypeChange: (value: string) => void;
  onGameVersionChange: (value: string) => void;
  onSourceChange: (value: string) => void;
}) {
  return (
    <aside className="archive-sidebar" aria-label="资料分类和筛选">
      <section className="sidebar-section">
        <div className="sidebar-heading">
          <span>资料分类</span>
          {activeCategory === "custom" && <small>自定义</small>}
        </div>
        <nav className="category-nav" aria-label="资料分类">
          {ARCHIVE_CATEGORIES.map((category) => (
            <button
              type="button"
              key={category.id}
              className={activeCategory === category.id ? "is-active" : ""}
              onClick={() => onCategory(category)}
              aria-pressed={activeCategory === category.id}
            >
              <span className="category-marker" aria-hidden="true">
                {category.marker}
              </span>
              <span>
                <strong>{category.label}</strong>
                <small>{category.description}</small>
              </span>
            </button>
          ))}
        </nav>
      </section>

      <section className="sidebar-section filter-section">
        <div className="sidebar-heading">
          <span>结果范围</span>
          <small>可多选</small>
        </div>
        <div className="scope-options">
          <Segmented
            aria-label="结果范围"
            block
            multiple
            value={types as unknown as never}
            onChange={(value) =>
              onTypesChange((Array.isArray(value) ? value : [value]) as ResultType[])
            }
            options={[
              { label: "实体", value: "entity" },
              { label: "文档", value: "document" },
              { label: "片段", value: "segment" },
            ]}
          />
        </div>
        <label className="filter-field">
          <span>实体类型</span>
          <select
            aria-label="实体类型"
            value={entityType}
            onChange={(event) => onEntityTypeChange(event.target.value)}
          >
            <option value="">全部实体类型</option>
            <option value="character">角色</option>
            <option value="faction">阵营</option>
            <option value="npc">NPC</option>
            <option value="region">地区</option>
            <option value="location">地点</option>
            <option value="quest">任务</option>
            <option value="concept">概念</option>
          </select>
        </label>
        <label className="filter-field">
          <span>文档类型</span>
          <select
            aria-label="文档类型"
            value={documentType}
            onChange={(event) => onDocumentTypeChange(event.target.value)}
          >
            <option value="">全部文档类型</option>
            <option value="lore">设定</option>
            <option value="archon_quest">魔神任务</option>
            <option value="story_quest">传说任务</option>
            <option value="world_quest">世界任务</option>
            <option value="event_quest">活动任务</option>
            <option value="book">书籍</option>
          </select>
        </label>
        <label className="filter-field">
          <span>游戏版本</span>
          <input
            aria-label="游戏版本过滤"
            value={gameVersion}
            onChange={(event) => onGameVersionChange(event.target.value)}
            placeholder="例如 5.0"
          />
        </label>
        <label className="filter-field">
          <span>资料来源</span>
          <select
            aria-label="来源过滤"
            value={sourceId}
            onChange={(event) => onSourceChange(event.target.value)}
          >
            <option value="">全部来源</option>
            {overview.sources.map((source) => (
              <option value={source.id} key={source.id}>
                {source.name} · {source.type}
              </option>
            ))}
          </select>
        </label>
      </section>

      <section className="sidebar-version" aria-label="资料版本">
        <span>当前资料版本</span>
        <strong>{visibleRevisionLabel}</strong>
        <small>{overview.ready?.searchIndex ?? "索引状态检查中"}</small>
      </section>
    </aside>
  );
}
