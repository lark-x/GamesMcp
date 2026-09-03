import type { ExtractorInput, ExtractorResult } from "./shared.js";
import { extractRecordDocuments, firstResolved, formatConversation } from "./shared.js";

export function extractTrainVisitorDocuments(input: ExtractorInput): Promise<ExtractorResult> {
  return extractRecordDocuments({
    extractor: input,
    category: "sr_train_visitor",
    matchPath: (path) => /train.*visitor|visitor.*train|TrainVisitor/iu.test(path),
    naturalIdKeys: ["VisitorID", "TrainVisitorID", "AvatarID"],
    titleKeys: ["TitleTextMapHash", "AvatarNameTextMapHash", "NameTextMapHash", "Title", "Name"],
    bodyKeys: ["TextMapHash", "ContentTextMapHash", "Text", "Content"],
    sourceIdPrefix: "VisitorID",
    relativePathFor: (id) => `sr_train_visitor/${id}.txt`,
    format: (record, context) =>
      formatConversation({
        title: firstResolved(record, ["TitleTextMapHash", "Title", "Name"], context) ?? "列车访客",
        record,
        context,
        containers: ["Talks", "Dialogues", "Dialogs", "Sentences", "Sections", "Lines"],
      }),
    hierarchy: (id) => ({ parentId: "sr_train_visitor", label: "Train Visitor", order: id }),
  });
}
