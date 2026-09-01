export type McpResponseBudget = {
  maxItems: number;
  maxCharsPerExcerpt: number;
  maxBytes: number;
};

export const DEFAULT_MCP_RESPONSE_BUDGET: McpResponseBudget = {
  maxItems: 10,
  maxCharsPerExcerpt: 500,
  maxBytes: 10_240,
};

export type ShapedHit = {
  title?: string;
  excerpt?: string;
};

export type ShapedPage = {
  items: ShapedHit[];
  truncated: boolean;
  estimatedBytes: number;
};

function excerpt(text: string, maxChars: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  return clean.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…";
}

/**
 * Token-aware result shaping for MCP-sized responses: bounded item count,
 * bounded excerpts, and a hard byte ceiling that keeps whole items.
 */
export function shapeForBudget(
  hits: ShapedHit[],
  budget: McpResponseBudget = DEFAULT_MCP_RESPONSE_BUDGET,
): ShapedPage {
  const shaped = hits.slice(0, budget.maxItems).map((hit) => ({
    ...hit,
    excerpt:
      hit.excerpt === undefined ? undefined : excerpt(hit.excerpt, budget.maxCharsPerExcerpt),
  }));
  let bytes = 0;
  const items: ShapedHit[] = [];
  let truncated = shaped.length < hits.length;
  for (const hit of shaped) {
    const size = Buffer.byteLength(JSON.stringify(hit), "utf8");
    if (bytes + size > budget.maxBytes) {
      truncated = true;
      break;
    }
    bytes += size;
    items.push(hit);
  }
  return { items, truncated, estimatedBytes: bytes };
}
