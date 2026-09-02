import { createHash } from "node:crypto";
import { stableStringify } from "./helpers.js";
import type { ExtractionResult } from "./extractor.js";

export type ExtractorManifest = {
  extractor: string;
  extractorVersion: string;
  upstreamCommit: string;
  gameVersion: string;
  locale: string;
  inputHashes: Record<string, string>;
  discovered: number;
  converted: number;
  failed: number;
  coverage: number;
  warnings: number;
  stats: Record<string, number>;
  contentHash: string;
};

/** Build a deterministic manifest from an extraction result. */
export function buildManifest<T>(
  result: ExtractionResult<T>,
  meta: { upstreamCommit: string; gameVersion: string; locale: string },
): ExtractorManifest {
  const { coverage } = result;
  return {
    extractor: result.extractorId,
    extractorVersion: result.extractorVersion,
    upstreamCommit: meta.upstreamCommit,
    gameVersion: meta.gameVersion,
    locale: meta.locale,
    inputHashes: result.inputHashes,
    discovered: coverage.discovered,
    converted: coverage.converted,
    failed: coverage.failed,
    coverage: coverage.coverage,
    warnings: result.warnings.length,
    stats: result.stats,
    contentHash: createHash("sha256").update(stableStringify(result.records)).digest("hex"),
  };
}
