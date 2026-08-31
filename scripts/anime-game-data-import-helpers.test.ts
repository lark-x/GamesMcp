import { describe, expect, it } from "vitest";
import { failureSourceKey, manifestFailureIssues } from "./anime-game-data-import-helpers.js";

describe("AnimeGameData import failure mapping", () => {
  it("maps each converter category to its canonical key", () => {
    expect(failureSourceKey("book", "7999")).toBe("book/7999");
    expect(failureSourceKey("character_story", "10001:103")).toBe("character/10001/story/103");
    expect(failureSourceKey("item_description", "30002")).toBe("item-codex/30002");
    expect(failureSourceKey("quest", "1001")).toBe("quest/1001");
    expect(failureSourceKey("quest", "quest/1001")).toBe("quest/1001");
    expect(failureSourceKey("character_story", "10001")).toBeUndefined();
  });

  it("turns explicit Manifest failures into blocking validation issues", () => {
    const manifest = {
      failures: [
        { category: "book", upstreamId: "7999", reason: "document_missing" },
        { category: "character_story", upstreamId: "10001:103", reason: "title_missing" },
        { category: "unknown", upstreamId: "x", reason: "ignored" },
      ],
    };
    expect(manifestFailureIssues(manifest)).toEqual([
      {
        severity: "error",
        code: "anime_conversion_document_missing",
        message: "AnimeGameData conversion failed: document_missing",
        sourceKey: "book/7999",
      },
      {
        severity: "error",
        code: "anime_conversion_title_missing",
        message: "AnimeGameData conversion failed: title_missing",
        sourceKey: "character/10001/story/103",
      },
    ]);
    expect(manifestFailureIssues(manifest, "book")).toEqual([
      {
        severity: "error",
        code: "anime_conversion_document_missing",
        message: "AnimeGameData conversion failed: document_missing",
        sourceKey: "book/7999",
      },
    ]);
  });

  it("turns quest Manifest failures into blocking validation issues", () => {
    expect(
      manifestFailureIssues(
        {
          failures: [{ sourceKey: "quest/1001/locale/zh-CN", reason: "dangling_dialogue_edge" }],
        },
        "quest",
      ),
    ).toEqual([
      {
        severity: "error",
        code: "anime_conversion_dangling_dialogue_edge",
        message: "AnimeGameData conversion failed: dangling_dialogue_edge",
        sourceKey: "quest/1001/locale/zh-CN",
      },
    ]);
  });
});
