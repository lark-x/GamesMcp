import { execFileSync } from "node:child_process";
import { realpath } from "node:fs/promises";

export interface StarRailSourceSnapshot {
  source: "turn-based-game-data";
  ref: string;
  path: string;
  acquiredAt: string;
}

export async function readStarRailSourceSnapshot(dataDir: string): Promise<StarRailSourceSnapshot> {
  const path = await realpath(dataDir);
  return {
    source: "turn-based-game-data",
    ref: readGitCommit(path),
    path,
    acquiredAt: new Date().toISOString(),
  };
}

function readGitCommit(path: string): string {
  try {
    return execFileSync("git", ["-C", path, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}
