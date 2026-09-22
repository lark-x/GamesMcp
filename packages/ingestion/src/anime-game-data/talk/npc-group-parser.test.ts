import { describe, expect, it } from "vitest";
import { parseNpcGroupRelations } from "./npc-group-parser.js";

describe("parseNpcGroupRelations", () => {
  it("only treats explicitly typed quest conditions as quest evidence", () => {
    const edges = parseNpcGroupRelations(
      {
        BMFEMALEAIO: [21009],
        OJACLOOEAMG: [
          {
            OIFGMOHKPOI: 2100901,
            FCBOEAHDNOL: [
              { _type: "QUEST_COND_STATE_EQUAL", _param: [21009, 3] },
              { _type: "SOME_OTHER_CONDITION", _param: [999999] },
            ],
          },
        ],
      },
      "BinOutput/Talk/NpcGroup/21009.json",
      "hash",
    );

    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fromQuestId: "21009",
          talkId: "2100901",
          relationType: "npc_group_condition",
          expectedState: "3",
        }),
        expect.objectContaining({
          fromQuestId: "21009",
          talkId: "2100901",
          relationType: "npc_group_trigger",
        }),
      ]),
    );
    expect(edges.some((edge) => edge.fromQuestId === "999999")).toBe(false);
  });
});
