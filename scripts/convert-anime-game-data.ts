import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  CONVERTER_VERSION,
  DEFAULT_LOCALE,
  convertAnimeGameData,
  writeConversionResult,
} from "./anime-game-data-converter.js";
import { isPathInside, runStoragePreflight } from "./check-data-storage.js";
import { loadConfig } from "../packages/config/src/index.ts";

const execFileAsync = promisify(execFile);
const configuredDataRoot = loadConfig().dataDir;
const upstreamDir = resolve(
  process.env.ANIME_GAME_DATA_DIR ?? join(configuredDataRoot, "upstream", "AnimeGameData"),
);
const language = process.env.ANIME_GAME_LANGUAGE ?? "CHS";

if (language !== "CHS") {
  throw new Error("The AnimeGameData converter supports ANIME_GAME_LANGUAGE=CHS only");
}

async function gitMetadata(): Promise<{
  commit: string;
  commitDate: string;
  subject: string;
}> {
  try {
    const { stdout } = await execFileAsync("git", ["log", "-1", "--format=%H%n%aI%n%s"], {
      cwd: upstreamDir,
    });
    const [commit = "unknown", commitDate = "unknown", subject = "unknown"] = stdout
      .trim()
      .split("\n");
    return { commit, commitDate, subject };
  } catch {
    return { commit: "unknown", commitDate: "unknown", subject: "unknown" };
  }
}

function inferGameVersion(subject: string): string {
  return /(?:CNRELWin|OSRELWin)(\d+\.\d+\.\d+)/.exec(subject)?.[1] ?? "unknown";
}

async function main(): Promise<void> {
  const preflight = await runStoragePreflight();
  if (!preflight.ok) throw new Error(preflight.errors.join("; "));
  if (!isPathInside(upstreamDir, preflight.config.externalVolumePath))
    throw new Error(
      `AnimeGameData upstream checkout must stay on the external volume: ${upstreamDir}`,
    );
  try {
    await access(upstreamDir);
  } catch {
    throw new Error(
      `AnimeGameData upstream checkout not found at ${upstreamDir}. Set ANIME_GAME_DATA_DIR to an explicit checkout.`,
    );
  }
  const git = await gitMetadata();
  const gameVersion = process.env.ANIME_GAME_VERSION ?? inferGameVersion(git.subject);
  const outputRoot = resolve(
    process.env.ANIME_GAME_OUTPUT_DIR ??
      join(configuredDataRoot, "imports", "normalized", "anime-game-data", git.commit, "zh-CN"),
  );
  if (!isPathInside(outputRoot, preflight.config.dataRoot))
    throw new Error(`AnimeGameData output must stay under the external data root: ${outputRoot}`);
  const result = await convertAnimeGameData({
    upstreamDir,
    language,
    context: {
      upstreamCommit: git.commit,
      upstreamCommitDate: git.commitDate,
      upstreamVersion: process.env.ANIME_GAME_VERSION ?? git.subject,
      upstreamVersionLabel: git.subject,
      gameVersion,
      locale: DEFAULT_LOCALE,
      language: "CHS",
      converterVersion: CONVERTER_VERSION,
    },
  });
  const manifest = await writeConversionResult(result, outputRoot);
  console.log(JSON.stringify(manifest, null, 2));
}

await main();
