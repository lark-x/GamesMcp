import { describe, expect, it } from "vitest";
import { classifyQuestContentRole } from "./quest-classifier.js";

describe("quest content classification", () => {
  it("does not infer an aggregate from progress, reward, and control hints", () => {
    expect(
      classifyQuestContentRole({
        hasExplicitStoryTalk: false,
        resolvedTalkCount: 0,
        dialogueNodeCount: 0,
        hasSiblingQuestRelations: true,
        hasProgressOrReward: true,
        aggregateEvidenceClasses: ["content_progress", "reward", "no_explicit_story_talk"],
      }),
    ).toBe("unknown");
  });

  it("classifies only an explicit aggregate-child topology as a collection", () => {
    expect(
      classifyQuestContentRole({
        hasExplicitStoryTalk: false,
        resolvedTalkCount: 0,
        dialogueNodeCount: 0,
        aggregateEvidenceClasses: ["aggregate_children"],
      }),
    ).toBe("aggregate");
  });
});
