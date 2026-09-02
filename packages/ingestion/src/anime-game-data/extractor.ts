import type { AnimeContext } from "./context.js";

/** Per-extraction warning entry; warnings never abort the run. */
export type ExtractionWarning = {
  code: string;
  message: string;
  upstreamId?: string;
};

/** Per-record failure; failures are counted and reported, never silent. */
export type ExtractionFailure = {
  code: string;
  message: string;
  upstreamId?: string;
};

export type ExtractionCoverage = {
  /** Rows discovered in the upstream source. */
  discovered: number;
  /** Rows successfully converted. */
  converted: number;
  /** Rows that failed conversion. */
  failed: number;
  coverage: number;
};

export type ExtractionResult<T> = {
  extractorId: string;
  extractorVersion: string;
  records: T[];
  warnings: ExtractionWarning[];
  failures: ExtractionFailure[];
  coverage: ExtractionCoverage;
  /** Per-field unresolved counts, e.g. { missingTitle: 3 }. */
  fieldCoverage: Record<string, number>;
  inputHashes: Record<string, string>;
  stats: Record<string, number>;
};

/**
 * Every new text domain must be ingested through an AnimeTextExtractor;
 * large converters must not keep growing by adding new domains inline.
 */
export interface AnimeTextExtractor<T> {
  id: string;
  version: string;
  /** Upstream paths relative to the upstream checkout root. */
  requiredInputs: string[];
  extract(ctx: AnimeContext): Promise<ExtractionResult<T>>;
}
