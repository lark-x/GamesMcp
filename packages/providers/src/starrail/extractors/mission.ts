import type { ExtractorInput, ExtractorResult } from "./shared.js";
import { extractRecordDocuments, firstResolved, formatConversation } from "./shared.js";

export function extractMissionDocuments(input: ExtractorInput): Promise<ExtractorResult> {
  return extractRecordDocuments({
    extractor: input,
    category: "sr_mission",
    matchPath: (path) => /(?:^|\/)Story\/Mission\//iu.test(path),
    naturalIdKeys: ["MissionID", "MainMissionID"],
    titleKeys: ["TitleTextMapHash", "MissionNameTextMapHash", "NameTextMapHash", "Title", "Name"],
    bodyKeys: ["DescTextMapHash", "ContentTextMapHash", "TextMapHash", "Desc", "Content"],
    sourceIdPrefix: "MissionID",
    relativePathFor: (id) => `sr_mission/${id}.txt`,
    format: (record, context) =>
      formatConversation({
        title: firstResolved(record, ["TitleTextMapHash", "Title", "Name"], context) ?? "任务",
        subtitle: `MissionID：${String(record.MissionID ?? record.MainMissionID ?? "unknown")}`,
        record,
        context,
        containers: ["Talks", "Dialogues", "Dialogs", "Sentences", "Sections"],
      }),
    hierarchy: (id) => ({ parentId: "sr_mission", label: "Mission", order: id }),
  });
}
