import type { ProtagonistPreferences } from "./story.types.js";
import { DEFAULT_GENSHIN_PREFS } from "./story.types.js";
import { formatStoryText } from "./story-format.js";

export type StoryTextNode = {
  nodeKey: string;
  type: string;
  speakerName?: string | null;
  body: string;
};

const speakerlessTypes = new Set(["narration", "system_text"]);

function getSpeakerBadgeClass(speakerName?: string | null): string {
  if (!speakerName) return "story-speaker-badge";
  const name = speakerName.trim();
  const lower = name.toLowerCase();

  // Genshin
  if (name === "派蒙" || lower === "paimon") {
    return "story-speaker-badge speaker-paimon";
  }
  if (
    name === "旅行者" ||
    name === "空" ||
    name === "荧" ||
    lower === "traveler" ||
    lower === "aether" ||
    lower === "lumine"
  ) {
    return "story-speaker-badge speaker-traveler";
  }

  // Star Rail astral express crew
  if (name === "三月七" || lower.includes("march 7") || lower.includes("march7")) {
    return "story-speaker-badge speaker-march7th";
  }
  if (name === "丹恒" || lower.includes("dan heng") || lower.includes("danheng")) {
    return "story-speaker-badge speaker-danheng";
  }
  if (name === "帕姆" || lower.includes("pom-pom") || lower.includes("pompom")) {
    return "story-speaker-badge speaker-pompom";
  }
  if (name === "姬子" || lower.includes("himeko")) {
    return "story-speaker-badge speaker-himeko";
  }
  if (name === "瓦尔特" || name === "瓦尔特·杨" || lower.includes("welt")) {
    return "story-speaker-badge speaker-welt";
  }
  if (
    name === "开拓者" ||
    name === "穹" ||
    name === "星" ||
    lower.includes("trailblazer") ||
    lower === "caelus" ||
    lower === "stelle"
  ) {
    return "story-speaker-badge speaker-trailblazer";
  }

  return "story-speaker-badge";
}

function resolveSpeakerName(
  speakerName: string | null | undefined,
  prefs: ProtagonistPreferences,
): string {
  if (!speakerName) return "";
  const trimmed = speakerName.trim();
  const lower = trimmed.toLowerCase();

  if (prefs.game === "starrail") {
    if (
      trimmed === "开拓者" ||
      trimmed === "穹" ||
      trimmed === "星" ||
      lower.includes("trailblazer") ||
      lower === "caelus" ||
      lower === "stelle"
    ) {
      if (prefs.nickname && prefs.nickname !== "开拓者") {
        return prefs.nickname;
      }
      return prefs.gender === "male" ? "穹" : "星";
    }
    return trimmed;
  }

  // Genshin
  if (
    trimmed === "旅行者" ||
    trimmed === "空" ||
    trimmed === "荧" ||
    lower === "traveler"
  ) {
    if (prefs.nickname && prefs.nickname !== "旅行者") {
      return prefs.nickname;
    }
    return prefs.gender === "male" ? "空" : "荧";
  }
  return trimmed;
}

function shortNodeKey(fullKey: string): string {
  const parts = fullKey.split("/");
  return parts[parts.length - 1] || fullKey;
}

/**
 * Option A: Immersive Script & Novel Reader format (沉浸式剧本纪行模式).
 * Fluid dialogue stream with character badges, literary stage directions,
 * native <ruby> furigana rendering, and dynamic Traveler / Trailblazer preferences.
 */
export function StoryTextBlock({
  node,
  prefs = DEFAULT_GENSHIN_PREFS,
}: {
  node: StoryTextNode;
  prefs?: ProtagonistPreferences;
}) {
  if (!node.body.trim()) return null;

  if (node.type === "player_choice") {
    const isStarRail = prefs.game === "starrail";
    const defaultNick = isStarRail ? "开拓者" : "旅行者";
    const prefix =
      prefs.nickname && prefs.nickname !== defaultNick
        ? `${prefs.nickname}选项`
        : isStarRail
        ? prefs.gender === "male"
          ? "穹选项"
          : "星选项"
        : prefs.gender === "male"
        ? "空选项"
        : "荧选项";

    return (
      <div className="story-script-choice">
        <span className="story-choice-diamond" aria-hidden="true">◆</span>
        <span className="story-choice-prefix">{prefix}</span>
        <span className="story-choice-text">{formatStoryText(node.body, prefs)}</span>
        <span className="story-script-node-id" title={`分支节点: #${node.nodeKey}`}>
          #{shortNodeKey(node.nodeKey)}
        </span>
      </div>
    );
  }

  if (node.type === "objective") {
    return (
      <div className="story-script-objective">
        <span className="story-objective-badge">任务目标</span>
        <span className="story-objective-text">{formatStoryText(node.body, prefs)}</span>
        <span className="story-script-node-id" title={`目标节点: #${node.nodeKey}`}>
          #{shortNodeKey(node.nodeKey)}
        </span>
      </div>
    );
  }

  if (node.type === "system_text") {
    return (
      <div className="story-script-system">
        <span className="story-system-icon" aria-hidden="true">ⓘ</span>
        <span className="story-system-text">{formatStoryText(node.body, prefs)}</span>
        <span className="story-script-node-id" title={`系统节点: #${node.nodeKey}`}>
          #{shortNodeKey(node.nodeKey)}
        </span>
      </div>
    );
  }

  if (node.type === "narration" || speakerlessTypes.has(node.type)) {
    return (
      <div className="story-script-narration">
        <span className="story-narration-glyph" aria-hidden="true">❖</span>
        <div className="story-narration-content">
          <p className="story-narration-text">{formatStoryText(node.body, prefs)}</p>
        </div>
        <span className="story-script-node-id" title={`旁白节点: #${node.nodeKey}`}>
          #{shortNodeKey(node.nodeKey)}
        </span>
      </div>
    );
  }

  const resolvedSpeaker = resolveSpeakerName(node.speakerName, prefs);

  return (
    <div className="story-script-row">
      <div className="story-script-speaker-col">
        {resolvedSpeaker ? (
          <span className={getSpeakerBadgeClass(node.speakerName)}>{resolvedSpeaker}</span>
        ) : (
          <span className="story-speaker-empty" />
        )}
      </div>
      <div className="story-script-body-col">
        <p className="story-script-text">{formatStoryText(node.body, prefs)}</p>
      </div>
      <span className="story-script-node-id" title={`对白节点: #${node.nodeKey}`}>
        #{shortNodeKey(node.nodeKey)}
      </span>
    </div>
  );
}
