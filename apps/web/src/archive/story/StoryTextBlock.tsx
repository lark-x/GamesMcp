import { Fragment } from "react";

export type StoryTextNode = {
  nodeKey: string;
  type: string;
  speakerName?: string | null;
  body: string;
};

const speakerlessTypes = new Set(["narration", "system_text"]);

/**
 * Continuous prose rendering for story text. Dialogue lines keep a small
 * speaker label; narration stays plain; choices render as a light quote
 * block; objectives and system text render as inline labels. No bubbles.
 */
export function StoryTextBlock({ node }: { node: StoryTextNode }) {
  if (!node.body.trim()) return null;
  if (node.type === "player_choice") {
    return (
      <blockquote className="story-choice">
        <span className="story-choice-label">选择</span>
        <span>{node.body}</span>
      </blockquote>
    );
  }
  if (node.type === "objective") {
    return (
      <p className="story-objective">
        <span className="story-objective-label">任务目标</span>
        {node.body}
      </p>
    );
  }
  if (node.type === "system_text") {
    return (
      <p className="story-system">
        <small>系统</small>
        {node.body}
      </p>
    );
  }
  if (node.type === "narration" || speakerlessTypes.has(node.type)) {
    return <p className="story-narration">{node.body}</p>;
  }
  return (
    <Fragment>
      {node.speakerName ? <p className="story-speaker">{node.speakerName}</p> : null}
      <p className="story-dialogue">{node.body}</p>
    </Fragment>
  );
}
