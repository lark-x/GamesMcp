import type { GameDocumentResponse, GameKnowledgeHit, GameKnowledgeSearchMode } from "../types.js";
import { GameProviderError } from "../errors.js";
import type { McpToolResult } from "./client.js";

const RAW_DEBUG_LIMIT = 2_000;

export function searchBudgetFromLimit(limit: number): number {
  return Math.min(Math.max(limit, 1), 10) * 4;
}

export function adaptSearchResult(input: {
  game: string;
  provider: string;
  mode: GameKnowledgeSearchMode;
  limit: number;
  result: McpToolResult;
}): { hits: GameKnowledgeHit[]; rawExcerpt?: string; truncated: boolean } {
  const structured = structuredPayload(input.result);
  const rawText = textPayload(input.result);
  const candidates = structuredHits(structured).length
    ? structuredHits(structured)
    : parseTextHits(rawText, input.limit);
  const hits = candidates.slice(0, input.limit).map((candidate, index) => {
    const documentId = stringFrom(candidate, [
      "documentId",
      "document_id",
      "file_id",
      "fileId",
      "id",
    ]);
    const path = stringFrom(candidate, ["path", "file_path", "source_path"]);
    const title = stringFrom(candidate, ["title", "name", "file_name"]);
    const excerpt =
      stringFrom(candidate, ["excerpt", "chunk", "content", "text", "body"]) ??
      rawText.slice(0, 800);
    return {
      game: input.game,
      provider: input.provider,
      documentId: documentId ?? path ?? `provider-result-${index + 1}`,
      title: title ?? path,
      excerpt: excerpt.slice(0, 1_200),
      category: stringFrom(candidate, ["category", "type"]),
      path,
      score: numberFrom(candidate, ["score", "rank"]),
      metadata: metadataFrom(candidate),
      citation: {
        provider: input.provider,
        sourceId: documentId ?? path,
        path,
      },
    };
  });
  if (!hits.length && rawText)
    return {
      hits: [
        {
          game: input.game,
          provider: input.provider,
          documentId: "provider-response",
          excerpt: rawText.slice(0, 1_200),
          citation: { provider: input.provider },
        },
      ],
      rawExcerpt: rawText.slice(0, RAW_DEBUG_LIMIT),
      truncated: rawText.length > RAW_DEBUG_LIMIT,
    };
  return {
    hits,
    rawExcerpt: rawText ? rawText.slice(0, RAW_DEBUG_LIMIT) : undefined,
    truncated: candidates.length > input.limit || rawText.length > RAW_DEBUG_LIMIT,
  };
}

export function adaptDocumentResult(input: {
  game: string;
  provider: string;
  documentId: string;
  cursor: number;
  limit: number;
  result: McpToolResult;
}): GameDocumentResponse {
  const structured = structuredPayload(input.result);
  const content = stringFrom(structured, ["content", "text", "body"]) ?? textPayload(input.result);
  if (!content) throw new GameProviderError("provider_bad_response");
  const lines = content.split(/\r?\n/u);
  const page = lines.slice(input.cursor, input.cursor + input.limit);
  const nextCursor = input.cursor + page.length;
  const hasMore = nextCursor < lines.length;
  return {
    game: input.game,
    provider: input.provider,
    documentId: input.documentId,
    title: stringFrom(structured, ["title", "name"]),
    content: page.join("\n").slice(0, 12_000),
    cursor: input.cursor,
    returnedLines: page.length,
    hasMore,
    nextCursor: hasMore ? nextCursor : null,
    truncated: hasMore || page.join("\n").length > 12_000,
    metadata: metadataFrom(structured),
  };
}

export function adaptHierarchyResult(input: {
  game: string;
  provider: string;
  documentId: string;
  result: McpToolResult;
}) {
  const structured = structuredPayload(input.result);
  const rawText = textPayload(input.result);
  const hierarchy = structured ?? safeJson(rawText) ?? rawText.slice(0, 12_000);
  return {
    game: input.game,
    provider: input.provider,
    documentId: input.documentId,
    hierarchy,
    truncated: rawText.length > 12_000,
  };
}

function structuredPayload(result: McpToolResult): unknown {
  return result.structuredContent ?? result.structured_content;
}

function textPayload(result: McpToolResult): string {
  return (
    result.content
      ?.filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text)
      .join("\n")
      .trim() ?? ""
  );
}

function structuredHits(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];
  for (const key of ["hits", "results", "documents", "items"]) {
    const candidate = value[key];
    if (Array.isArray(candidate)) return candidate.filter(isRecord);
  }
  return [];
}

function parseTextHits(text: string, limit: number): Record<string, unknown>[] {
  if (!text) return [];

  if (text.includes("#######")) {
    const sections = text
      .split(/(?:^|\n)#{10,}\s*\n/u)
      .map((s) => s.trim())
      .filter(
        (s) => s && !s.startsWith("查询 '") && !s.startsWith('查询"') && !s.startsWith("查询"),
      );
    if (sections.length > 0) {
      return sections.slice(0, Math.max(limit, 1)).map((section, index) => {
        const fileId =
          /(?:文件ID|file[_ -]?id|id)[:：]\s*([a-f0-9]+)/iu.exec(section)?.[1] ??
          /(?:document[_ -]?id)[:：]\s*([^\s,，]+)/iu.exec(section)?.[1];
        const score = /(?:相关性分数|score|rank)[:：]\s*([0-9.]+)/iu.exec(section)?.[1];
        const title =
          /(?:^|\n)#\s+(?!文件\s+\d+|【注意)([^\n]+)/u.exec(section)?.[1]?.trim() ??
          /(?:title|标题)[:：]\s*([^\n]+)/iu.exec(section)?.[1]?.trim();
        return {
          documentId: fileId ?? `text-block-${index + 1}`,
          title,
          excerpt: section,
          score: score ? Number(score) : undefined,
        };
      });
    }
  }

  const blocks = text
    .split(/\n{2,}/u)
    .map((block) => block.trim())
    .filter(Boolean)
    .slice(0, Math.max(limit, 1));
  return blocks.map((block, index) => {
    const documentId =
      /(?:document[_ -]?id|file[_ -]?id|id)[:：]\s*([^\s,，]+)/iu.exec(block)?.[1] ??
      /(?:path|file)[:：]\s*([^\n]+)/iu.exec(block)?.[1];
    const title = /(?:title|标题)[:：]\s*([^\n]+)/iu.exec(block)?.[1];
    const scoreText = /(?:score|rank)[:：]\s*([0-9.]+)/iu.exec(block)?.[1];
    return {
      documentId: documentId ?? `text-block-${index + 1}`,
      title,
      excerpt: block,
      score: scoreText ? Number(scoreText) : undefined,
    };
  });
}

function stringFrom(value: unknown, keys: string[]): string | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of keys) {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    if (typeof candidate === "number") return String(candidate);
  }
  return undefined;
}

function numberFrom(value: unknown, keys: string[]): number | undefined {
  if (!isRecord(value)) return undefined;
  for (const key of keys) {
    const candidate = Number(value[key]);
    if (Number.isFinite(candidate)) return candidate;
  }
  return undefined;
}

function metadataFrom(value: unknown): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined;
  const metadata = value.metadata;
  if (isRecord(metadata)) return metadata;
  return undefined;
}

function safeJson(text: string): unknown {
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
