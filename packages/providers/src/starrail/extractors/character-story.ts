import type { ExtractorInput, ExtractorResult } from "./shared.js";
import { extractRecordDocuments, firstResolved } from "./shared.js";

export function extractCharacterStoryDocuments(input: ExtractorInput): Promise<ExtractorResult> {
  return extractRecordDocuments({
    extractor: input,
    category: "sr_character_story",
    matchPath: (path) => /avatar.*story|character.*story|fetter|profile/iu.test(path),
    naturalIdKeys: ["StoryID", "AvatarID", "CharacterID"],
    titleKeys: [
      "AvatarNameTextMapHash",
      "CharacterNameTextMapHash",
      "NameTextMapHash",
      "AvatarName",
      "Name",
    ],
    bodyKeys: [
      "StoryTextMapHash",
      "ContentTextMapHash",
      "DescTextMapHash",
      "Story",
      "Content",
      "Desc",
    ],
    sourceIdPrefix: "AvatarID",
    relativePathFor: (id) => `sr_character_story/${id}.txt`,
    format: (record, context) => {
      const character =
        firstResolved(record, ["AvatarNameTextMapHash", "AvatarName", "Name"], context) ?? "角色";
      const section = firstResolved(
        record,
        ["StoryTitleTextMapHash", "TitleTextMapHash", "Title"],
        context,
      );
      const story = firstResolved(
        record,
        ["StoryTextMapHash", "Story", "ContentTextMapHash", "Content"],
        context,
      );
      return [`# ${character}`, section ? `## ${section}` : undefined, "", story]
        .filter((line): line is string => typeof line === "string")
        .join("\n");
    },
    hierarchy: (id, record) => ({
      parentId: record.AvatarID ? `sr_character:${String(record.AvatarID)}` : "sr_character_story",
      label: "Character Story",
      order: id,
    }),
  });
}
