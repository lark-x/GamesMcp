import { describe, expect, it } from "vitest";
import { classifyDialogueResolution } from "./quest-classifier.js";

describe("quest dialogue classification", () => {
  it("does not treat multiple resolved Talk IDs as an ambiguous asset", () => {
    expect(
      classifyDialogueResolution({
        contentRole: "story",
        talkReferenceCount: 3,
        talkAssetCount: 1,
        dialogueNodeCount: 3,
        expectedTalkIds: ["a", "b", "c"],
        resolvedTalkIds: ["a", "b", "c"],
        missingTalkIds: [],
        ambiguousTalkIds: [],
      }),
    ).toBe("resolved");
  });

  it("marks a narrative task with only part of its Talk assets as partial", () => {
    expect(
      classifyDialogueResolution({
        contentRole: "story",
        talkReferenceCount: 3,
        talkAssetCount: 1,
        dialogueNodeCount: 2,
        expectedTalkIds: ["a", "b", "c"],
        resolvedTalkIds: ["a", "b"],
        missingTalkIds: ["c"],
        ambiguousTalkIds: [],
      }),
    ).toBe("partial");
  });

  it("keeps source-free metadata tasks out of the missing-dialogue bucket", () => {
    expect(
      classifyDialogueResolution({
        contentRole: "metadata",
        talkReferenceCount: 0,
        talkAssetCount: 0,
        dialogueNodeCount: 0,
      }),
    ).toBe("not_applicable");
  });
});
