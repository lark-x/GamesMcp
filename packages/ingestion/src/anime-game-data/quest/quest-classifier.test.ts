import { describe, expect, it } from "vitest";
import { classifyDialogueResolution, classifyQuestContentRole } from "./quest-classifier.js";

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

describe("dialogue resolution graph invariants", () => {
  const base = {
    contentRole: "story" as const,
    hasNarrativeSource: true,
    talkReferenceCount: 1,
    talkAssetCount: 1,
    dialogueNodeCount: 2,
    expectedTalkIds: ["t1"],
    resolvedTalkIds: ["t1"],
  };

  it("treats dangling edges alone as graph_incomplete", () => {
    expect(classifyDialogueResolution({ ...base, danglingEdgeCount: 1 })).toBe("graph_incomplete");
  });

  it("treats a cycle alone as graph_incomplete", () => {
    expect(classifyDialogueResolution({ ...base, cycle: true })).toBe("graph_incomplete");
  });

  it("treats a rootless component alone as graph_incomplete", () => {
    expect(classifyDialogueResolution({ ...base, graphHasNoRoot: true })).toBe("graph_incomplete");
  });

  it("still resolves a structurally sound graph", () => {
    expect(classifyDialogueResolution(base)).toBe("resolved");
  });

  it("keeps missing text ranked above structural defects", () => {
    expect(
      classifyDialogueResolution({ ...base, missingTextCount: 1, cycle: true }),
    ).toBe("dialogue_text_missing");
  });
});
