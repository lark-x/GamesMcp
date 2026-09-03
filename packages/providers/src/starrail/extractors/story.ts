import type { ExtractorInput, ExtractorResult } from "./shared.js";
import { extractRecordDocuments, firstResolved, formatConversation } from "./shared.js";

export function extractStoryDocuments(input: ExtractorInput): Promise<ExtractorResult> {
  return extractRecordDocuments({
    extractor: input,
    category: "sr_story",
    matchPath: (path) => /(?:^|\/)Story\//iu.test(path) && !/(?:^|\/)Story\/Mission\//iu.test(path),
    naturalIdKeys: ["StoryID", "SectionID", "TalkSentenceID"],
    titleKeys: ["TitleTextMapHash", "StoryNameTextMapHash", "NameTextMapHash", "Title", "Name"],
    bodyKeys: ["ContentTextMapHash", "TextMapHash", "DescTextMapHash", "Content", "Text", "Desc"],
    sourceIdPrefix: "StoryID",
    relativePathFor: (id) => `sr_story/${id}.txt`,
    format: (record, context) =>
      formatConversation({
        title: firstResolved(record, ["TitleTextMapHash", "Title", "Name"], context) ?? "剧情片段",
        record,
        context,
        containers: ["Talks", "Dialogues", "Dialogs", "Sentences", "Sections", "Lines"],
      }),
    hierarchy: (id) => ({ parentId: "sr_story", label: "Story", order: id }),
  });
}
