import { execFileSync } from "node:child_process";
import { realpath } from "node:fs/promises";
import { normalize } from "node:path";

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
    const root = execFileSync("git", ["-C", path, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    // Fixtures and unpacked exports must not inherit GamesMcp's commit.
    // Git reports forward slashes and a possibly different casing than
    // realpath on Windows, so compare normalized forms instead of raw strings.
    if (!samePath(root, path)) return "unknown";
    return execFileSync("git", ["-C", path, "rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function samePath(left: string, right: string): boolean {
  const normalizeCase = (value: string) =>
    process.platform === "win32"
      ? normalize(value)
          .replace(/[\\/]+$/u, "")
          .toLowerCase()
      : normalize(value).replace(/\/+$/u, "");
  return normalizeCase(left) === normalizeCase(right);
}
