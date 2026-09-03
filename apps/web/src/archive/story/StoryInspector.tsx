import { ArchiveAvatar } from "../ArchiveAvatar.js";
import { InspectorField, InspectorSection, ArchiveInspector } from "../ArchiveInspector.js";
import { questTypeLabel } from "../../shared.js";
import type { QuestDetail } from "../../api.js";

export function StoryInspector({ quest }: { quest: QuestDetail | null }) {
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
          <p className="muted">暂无</p>
        )}
      </InspectorSection>
      <InspectorSection title="前置 / 后续">
        <p className="muted">
          前置任务：{quest.prerequisites.length ? quest.prerequisites.join("、") : "暂无"}
        </p>
        <p className="muted">子任务 {quest.subquests.length} 个</p>
      </InspectorSection>
      <InspectorSection title="来源">
        <InspectorField
          label="数据来源"
          value={quest.citations[0]?.sourceName ?? "TurnBasedGameData"}
        />
        <InspectorField label="Document ID" value={<code>{quest.documentId || "—"}</code>} />
        <InspectorField label="Revision" value={<code>{quest.revision || "—"}</code>} />
      </InspectorSection>
    </ArchiveInspector>
  );
}
