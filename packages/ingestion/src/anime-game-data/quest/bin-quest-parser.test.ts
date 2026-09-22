import { describe, expect, it } from "vitest";
import { parseBinQuestFile } from "./bin-quest-parser.js";

describe("parseBinQuestFile", () => {
  it("separates content and exec progress and keeps COMPLETE_TALK on the subquest", () => {
    const record = parseBinQuestFile(
      {
        EBNBLBEIFFJ: [
          {
            KCGAKLCHDCC: 7318906,
            ANBEKNMDKCH: [
              {
                ALBFHGKNMLK: "QUEST_CONTENT_COMPLETE_TALK",
                OPDGHDAADJC: [7311006, 0],
              },
            ],
            HNBPDOIIEKL: [
              {
                ALBFHGKNMLK: "QUEST_EXEC_ADD_QUEST_PROGRESS",
                OPDGHDAADJC: [7318910, 1],
              },
            ],
          },
        ],
      },
      "BinOutput/Quest/73189.json",
      "hash",
    );

    expect(record?.completeTalkIds).toEqual(["7311006"]);
    expect(record?.relationEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromQuestId: "7318906",
          talkId: "7311006",
          relationType: "complete_talk",
        }),
        expect.objectContaining({
          fromQuestId: "7318906",
          toQuestId: "7318910",
          relationType: "add_quest_progress",
          rawRelationType: "QUEST_EXEC_ADD_QUEST_PROGRESS",
        }),
      ]),
    );
    expect(record?.containsSubQuestEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromQuestId: "73189",
          toQuestId: "7318906",
          relationType: "contains_subquest",
        }),
      ]),
    );
    expect(record?.execCounts?.QUEST_EXEC_ADD_QUEST_PROGRESS).toBe(1);
  });

  it("records the expected state and preserves the raw direction", () => {
    const record = parseBinQuestFile(
      {
        EBNBLBEIFFJ: [
          {
            KCGAKLCHDCC: 7301302,
            ANBEKNMDKCH: [
              {
                ALBFHGKNMLK: "QUEST_CONTENT_QUEST_STATE_EQUAL",
                OPDGHDAADJC: [7301906, 3],
              },
            ],
          },
        ],
      },
      "BinOutput/Quest/73013.json",
      "hash",
    );
    expect(record?.relationEdges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromQuestId: "7301302",
          toQuestId: "7301906",
          expectedState: "3",
          relationType: "quest_state_equal",
          derived: false,
        }),
      ]),
    );
  });
});
