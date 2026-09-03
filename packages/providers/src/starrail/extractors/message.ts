import type { ExtractorInput, ExtractorResult } from "./shared.js";
import { extractRecordDocuments, firstResolved, formatConversation } from "./shared.js";

export function extractMessageDocuments(input: ExtractorInput): Promise<ExtractorResult> {
  return extractRecordDocuments({
    extractor: input,
    category: "sr_message",
    matchPath: (path) => /message|chat/iu.test(path),
    naturalIdKeys: ["MessageSectionID", "MessageID", "SectionID"],
    titleKeys: ["ContactTextMapHash", "SenderTextMapHash", "TitleTextMapHash", "Contact", "Title"],
    bodyKeys: ["MainTextMapHash", "TextMapHash", "ContentTextMapHash", "MainText", "Content"],
    sourceIdPrefix: "MessageSectionID",
    relativePathFor: (id) => `sr_message/${id}.txt`,
    format: (record, context) => {
      const title =
        firstResolved(record, ["ContactTextMapHash", "Contact", "Title"], context) ?? "短信会话";
      const faction = firstResolved(record, ["FactionTextMapHash", "Faction"], context);
      return formatConversation({
        title: `${title}：短信会话`,
        subtitle: faction ? `阵营：${faction}` : undefined,
        record,
        context,
        containers: ["Messages", "Sections", "Dialogues", "Lines"],
      });
    },
    hierarchy: (id) => ({ parentId: "sr_message", label: "Message", order: id }),
  });
}
