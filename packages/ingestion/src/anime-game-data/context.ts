import { createHash } from "node:crypto";
import { TextResolver } from "./text-resolver.js";

/** Shared execution context handed to every extractor. */
export type AnimeContext = {
  /** Absolute path to the AnimeGameData checkout. */
  upstreamDir: string;
  upstreamCommit: string;
  upstreamVersion: string;
  gameVersion: string;
  locale: string;
  textResolver: TextResolver;
  /** SHA-256 per consumed source file, relative to upstreamDir. */
  inputHashes: Record<string, string>;
};

export function hashInput(relativePath: string, content: string): string {
  return createHash("sha256").update(`${relativePath}\u0000${content}`).digest("hex");
}
