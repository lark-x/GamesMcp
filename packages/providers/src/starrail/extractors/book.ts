import type { ExtractorInput, ExtractorResult } from "./shared.js";
import { extractRecordDocuments, firstResolved } from "./shared.js";

export function extractBookDocuments(input: ExtractorInput): Promise<ExtractorResult> {
  return extractRecordDocuments({
    extractor: input,
    category: "sr_book",
    matchPath: (path) => /book|readable|localbook|pamphlet/iu.test(path),
    naturalIdKeys: ["BookID", "BookSeriesID", "ReadableID"],
    titleKeys: ["BookNameTextMapHash", "TitleTextMapHash", "NameTextMapHash", "BookName", "Title"],
    bodyKeys: ["ContentTextMapHash", "DescTextMapHash", "TextMapHash", "Content", "Desc", "Text"],
    sourceIdPrefix: "BookID",
    relativePathFor: (id) => `sr_book/${id}.txt`,
    format: (record, context) => {
      const title =
        firstResolved(
          record,
          ["BookNameTextMapHash", "TitleTextMapHash", "BookName", "Title"],
          context,
        ) ?? "书籍";
      const series = firstResolved(
        record,
        ["BookSeriesTextMapHash", "SeriesTextMapHash", "Series"],
        context,
      );
      const body = firstResolved(
        record,
        ["ContentTextMapHash", "Content", "Text", "DescTextMapHash"],
        context,
      );
      return [`# ${title}`, series ? `系列：${series}` : undefined, "", body]
        .filter((line): line is string => typeof line === "string")
        .join("\n");
    },
    hierarchy: (id, record) => ({
      parentId: record.BookSeriesID ? `sr_book_series:${String(record.BookSeriesID)}` : "sr_book",
      label: "Book",
      order: id,
    }),
  });
}
