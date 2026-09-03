import { resolve } from "node:path";
import { normalizeStarRailText, hasLikelyNarrativeText } from "../corpus/normalizer.js";
import type { ExtractorInput, ExtractorResult } from "./shared.js";
import { extractRecordDocuments, firstResolved, readSafeJsonFile } from "./shared.js";

export async function extractBookDocuments(input: ExtractorInput): Promise<ExtractorResult> {
  const localbookItem = input.inventory.items.find(
    (i) => i.path === "ExcelOutput/LocalbookConfig.json",
  );
  if (localbookItem) {
    const seriesItem = input.inventory.items.find(
      (i) => i.path === "ExcelOutput/BookSeriesConfig.json",
    );
    const seriesMap = new Map<number, { title: string; comments?: string }>();
    if (seriesItem) {
      const seriesList = await readSafeJsonFile<Array<Record<string, unknown>>>(
        resolve(input.dataDir, seriesItem.path),
      );
      if (Array.isArray(seriesList)) {
        for (const s of seriesList) {
          const seriesId = Number(s.BookSeriesID);
          const resolveHash = (val: unknown): string | null => {
            if (!val || typeof val !== "object") return null;
            const hash = (val as Record<string, unknown>).Hash;
            return hash ? input.resolver.resolve(hash as string | number) : null;
          };
          const title = resolveHash(s.BookSeries) ?? `系列 ${seriesId}`;
          const comments = resolveHash(s.BookSeriesComments) ?? undefined;
          if (seriesId) seriesMap.set(seriesId, { title, comments });
        }
      }
    }

    const books = await readSafeJsonFile<Array<Record<string, unknown>>>(
      resolve(input.dataDir, localbookItem.path),
    );
    if (Array.isArray(books)) {
      const result: ExtractorResult = { documents: [], issues: [], unresolvedText: 0 };
      for (const b of books) {
        const id = Number(b.BookID);
        if (!Number.isInteger(id)) continue;
        const seriesId = Number(b.BookSeriesID);
        const seriesInfo = seriesMap.get(seriesId);

        const resolveHash = (val: unknown): string | null => {
          if (!val || typeof val !== "object") return null;
          const hash = (val as Record<string, unknown>).Hash;
          return hash ? input.resolver.resolve(hash as string | number) : null;
        };

        const bookName = resolveHash(b.BookInsideName) ?? `书籍 ${id}`;
        const title = seriesInfo?.title ? `${seriesInfo.title}：${bookName}` : bookName;
        const bookContent = resolveHash(b.BookContent);

        if (!bookContent) {
          result.unresolvedText += 1;
          result.issues.push({
            code: "book_unresolved",
            message: `Could not resolve book content for BookID ${id}`,
            sourcePath: localbookItem.path,
            sourceId: String(id),
          });
          continue;
        }

        const lines = [`# ${title}`];
        if (seriesInfo?.title) lines.push(`系列：${seriesInfo.title}`);
        if (seriesInfo?.comments) lines.push(`系列介绍：${seriesInfo.comments}`);
        lines.push("", bookContent);

        const content = normalizeStarRailText(lines.join("\n"));
        if (!hasLikelyNarrativeText(content)) {
          result.issues.push({
            code: "empty_or_non_narrative_document",
            message: `Skipped non-narrative book document`,
            sourcePath: localbookItem.path,
            sourceId: String(id),
          });
          continue;
        }

        result.documents.push({
          category: "sr_book",
          id,
          relativePath: `sr_book/${id}.txt`,
          title,
          content,
          sourceFiles: [localbookItem.path, ...(seriesItem ? [seriesItem.path] : [])],
          sourceIds: [`BookID:${id}`],
          metadata: {
            source: "turn-based-game-data",
            sourceCommit: input.sourceRef,
            sourcePath: localbookItem.path,
          },
          hierarchy: {
            parentId: seriesId ? `sr_book_series:${seriesId}` : "sr_book",
            label: "Book",
            order: Number(b.BookSeriesInsideID) || id,
          },
        });
      }
      return result;
    }
  }

  // Fallback for fixture
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
