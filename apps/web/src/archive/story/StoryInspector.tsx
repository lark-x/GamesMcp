import { useState } from "react";
import { ArchiveAvatar } from "../ArchiveAvatar.js";
import { InspectorField, InspectorSection, ArchiveInspector } from "../ArchiveInspector.js";
import { questTypeLabel } from "../../shared.js";
import type { QuestDetail } from "../../api.js";

export function StoryInspector({
  quest,
  onSelectCitation,
}: {
  quest: QuestDetail | null;
  onSelectCitation?: (dialogueNodeKey: string) => void;
}) {
  const [citationsExpanded, setCitationsExpanded] = useState(false);

  if (!quest) {
    return (
      <ArchiveInspector title="任务信息">
        <p className="muted">选择任务后展示任务信息、出场角色与来源。</p>
      </ArchiveInspector>
    );
  }

  const localeLabel = quest.locale === "en" ? "English" : "简体中文";

  return (
    <ArchiveInspector title="任务信息">
      <InspectorSection title="基本信息">
        <InspectorField label="任务类型" value={questTypeLabel(quest.type)} />
        <InspectorField label="任务集" value={quest.series || quest.chapter || "—"} />
        <InspectorField label="语言" value={localeLabel} />
        <InspectorField label="游戏版本" value={quest.gameVersion ?? "未知"} />
      </InspectorSection>

      <InspectorSection title="出场角色">
        {quest.participants.length ? (
          <div className="archive-avatar-row">
            {quest.participants.slice(0, 6).map((participant) => (
              <span className="archive-avatar-chip" key={participant.id}>
                <ArchiveAvatar
                  fallbackText={participant.name.slice(0, 1)}
                  seed={participant.id}
                  label={participant.name}
                  size={30}
                />
                <small>{participant.name}</small>
              </span>
            ))}
            {quest.participants.length > 6 ? (
              <span className="archive-avatar-more">+{quest.participants.length - 6}</span>
            ) : null}
          </div>
        ) : (
          <p className="muted">暂无出场角色数据</p>
        )}
      </InspectorSection>

      <InspectorSection title="前置 / 后续">
        <InspectorField
          label="前置任务"
          value={quest.prerequisites.length ? quest.prerequisites.join("、") : "暂无"}
        />
        <InspectorField label="后续任务" value="暂无后续任务数据" />
      </InspectorSection>

      <InspectorSection title="地点">
        <p className="muted">暂无地点数据</p>
      </InspectorSection>

      <InspectorSection title="来源">
        <InspectorField
          label="数据来源"
          value={quest.citations[0]?.sourceName ?? "来源未解析"}
        />
        <InspectorField label="Document ID" value={<code>{quest.documentId || "—"}</code>} />
        <InspectorField label="Revision" value={<code>{quest.revision || "—"}</code>} />

        <div className="story-citation-box">
          <div className="story-citation-header">
            <span>引用依据 {quest.citations.length} 条</span>
            {quest.citations.length > 0 ? (
              <button
                type="button"
                className="story-citation-toggle"
                onClick={() => setCitationsExpanded((prev) => !prev)}
              >
                {citationsExpanded ? "收起引用" : "展开引用"}
              </button>
            ) : null}
          </div>

          {citationsExpanded && quest.citations.length > 0 ? (
            <ul className="story-citation-list" role="list">
              {quest.citations.map((citation, idx) => (
                <li key={idx} className="story-citation-item">
                  <button
                    type="button"
                    disabled={!citation.dialogueNodeKey}
                    className="story-citation-btn"
                    onClick={() =>
                      citation.dialogueNodeKey && onSelectCitation?.(citation.dialogueNodeKey)
                    }
                  >
                    <strong>{citation.sourceName ?? "来源未解析"}</strong>
                    <small>
                      文档: {citation.documentId} · 版本: {citation.revision}
                    </small>
                    {citation.dialogueNodeKey ? (
                      <span className="story-citation-link">定位正文台词</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </InspectorSection>
    </ArchiveInspector>
  );
}
