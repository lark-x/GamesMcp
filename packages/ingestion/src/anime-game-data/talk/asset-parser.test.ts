import { describe, expect, it } from "vitest";
import { parseTalkAsset } from "./asset-parser.js";

describe("parseTalkAsset", () => {
  it("uses embedded Talk IDs for hashed or zero-padded filenames", () => {
    const asset = parseTalkAsset(
      JSON.stringify({
        IOKNFDJFGDH: 7009002,
        PFALHAKIILD: [
          {
            OIFGMOHKPOI: 701140201,
            KMLAFCBMFEI: [],
            OACNIBLFFDI: 1,
          },
        ],
      }),
      "BinOutput/Talk/Quest/2357e9f7.json",
      "quest",
    );

    expect(asset.talkId).toBe("7009002");
  });
});
