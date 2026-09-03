import type { ExtractorInput, ExtractorResult } from "./shared.js";
import { extractRecordDocuments, firstResolved } from "./shared.js";

export function extractVoiceLineDocuments(input: ExtractorInput): Promise<ExtractorResult> {
  return extractRecordDocuments({
    extractor: input,
    category: "sr_voiceline",
    matchPath: (path) => /voice|voiceline/iu.test(path),
    naturalIdKeys: ["VoiceID", "AvatarID", "CharacterID"],
    titleKeys: ["AvatarNameTextMapHash", "CharacterNameTextMapHash", "AvatarName", "Name"],
    bodyKeys: ["VoiceTextMapHash", "TextMapHash", "ContentTextMapHash", "Voice", "Text", "Content"],
    sourceIdPrefix: "VoiceID",
    relativePathFor: (id) => `sr_voiceline/${id}.txt`,
    format: (record, context) => {
      const character =
        firstResolved(record, ["AvatarNameTextMapHash", "AvatarName", "Name"], context) ??
        "角色语音";
      const title = firstResolved(
        record,
        ["VoiceTitleTextMapHash", "TitleTextMapHash", "Title"],
        context,
      );
      const voice = firstResolved(
        record,
        ["VoiceTextMapHash", "TextMapHash", "Voice", "Text"],
        context,
      );
      return [`# ${character}：角色语音`, title ? `## ${title}` : undefined, "", voice]
        .filter((line): line is string => typeof line === "string")
        .join("\n");
    },
    hierarchy: (id, record) => ({
      parentId: record.AvatarID ? `sr_character:${String(record.AvatarID)}` : "sr_voiceline",
      label: "Voice Line",
      order: id,
    }),
  });
}
