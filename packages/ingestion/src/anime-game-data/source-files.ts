import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { AnimeContext } from "./context.js";

/** A loaded upstream source file with its content hash recorded. */
export type SourceFile<T = unknown> = {
  relativePath: string;
  fileHash: string;
  value: T;
};

/** Load a JSON source file under the upstream dir and record its hash. */
export async function loadSourceJson<T = unknown>(
  ctx: AnimeContext,
  relativePath: string,
): Promise<SourceFile<T>> {
  const absolute = join(ctx.upstreamDir, relativePath);
  const content = await readFile(absolute, "utf8");
  const fileHash = createHash("sha256").update(content).digest("hex");
  ctx.inputHashes[relativePath] = fileHash;
  return { relativePath, fileHash, value: JSON.parse(content) as T };
}
