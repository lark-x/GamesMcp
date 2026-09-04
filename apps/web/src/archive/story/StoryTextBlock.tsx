export type StoryTextNode = {
  nodeKey: string;
  type: string;
  speakerName?: string | null;
  body: string;
};

const speakerlessTypes = new Set(["narration", "system_text"]);

/**
 * Option B: Notion/Obsidian structured comparative layout for story reader.
 * Dialogue nodes render as modern engineering cards with speaker pills,
 * explicit node IDs, and clean typography.
 */
export function StoryTextBlock({ node }: { node: StoryTextNode }) {
  if (!node.body.trim()) return null;

  if (node.type === "player_choice") {
    return (
      <div className="story-choice-card">
        <div className="story-node-header">
          <span className="story-choice-label">旅行者选项分支</span>
          <span className="story-node-id">#{node.nodeKey}</span>
        </div>
        <blockquote className="story-choice">
          <span>{node.body}</span>
        </blockquote>
      </div>
    );
  }

  if (node.type === "objective") {
    return (
      <div className="story-objective-card">
        <p className="story-objective">
          <span className="story-objective-label">任务目标</span>
          {node.body}
        </p>
        <span className="story-node-id">#{node.nodeKey}</span>
      </div>
    );
  }

  if (node.type === "system_text") {
    return (
      <div className="story-system-card">
        <p className="story-system">
          <small>系统</small>
          {node.body}
        </p>
        <span className="story-node-id">#{node.nodeKey}</span>
      </div>
    );
  }

  if (node.type === "narration" || speakerlessTypes.has(node.type)) {
    return (
      <div className="story-narration-card">
        <div className="story-node-header">
          <span className="story-narration-tag">情境旁白</span>
          <span className="story-node-id">#{node.nodeKey}</span>
        </div>
        <p className="story-narration">{node.body}</p>
      </div>
    );
  }

  return (
    <div className="story-node-card">
      <div className="story-node-header">
        {node.speakerName ? (
          <p className="story-speaker">{node.speakerName}</p>
        ) : (
          <span className="story-speaker-empty" />
        )}
        <span className="story-node-id">#{node.nodeKey}</span>
      </div>
      <p className="story-dialogue">{node.body}</p>
    </div>
  );
}
