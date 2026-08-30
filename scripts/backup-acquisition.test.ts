import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveOutputRoot } from "./backup-acquisition.ts";

const environmentKeys = [
  "ANIME_GAME_OUTPUT_DIR",
  "ANIME_GAME_COMMIT",
  "ANIME_GAME_DATA_DIR",
  "ANIME_GAME_LOCALE",
] as const;
const originalEnvironment = new Map(environmentKeys.map((key) => [key, process.env[key]] as const));
const temporaryDirectories: string[] = [];

afterEach(async () => {
  for (const key of environmentKeys) {
    const value = originalEnvironment.get(key);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("resolveOutputRoot", () => {
  it("prefers an explicit output directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "gip-backup-path-"));
    temporaryDirectories.push(root);
    process.env.ANIME_GAME_OUTPUT_DIR = join(root, "explicit");
    expect(await resolveOutputRoot(root)).toBe(join(root, "explicit"));
  });

  it("follows the configured checkout Commit", async () => {
    const root = await mkdtemp(join(tmpdir(), "gip-backup-path-"));
    temporaryDirectories.push(root);
    process.env.ANIME_GAME_COMMIT = "fixture-commit";
    process.env.ANIME_GAME_LOCALE = "zh-CN";
    expect(await resolveOutputRoot(root)).toBe(
      join(root, "imports", "normalized", "anime-game-data", "fixture-commit", "zh-CN"),
    );
  });

  it("accepts one manifest when Git metadata is unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "gip-backup-path-"));
    temporaryDirectories.push(root);
    const snapshot = join(
      root,
      "imports",
      "normalized",
      "anime-game-data",
      "fixture-snapshot",
      "zh-CN",
    );
    await mkdir(snapshot, { recursive: true });
    await writeFile(join(snapshot, "manifest.json"), "{}\n");
    process.env.ANIME_GAME_DATA_DIR = join(root, "missing-upstream");
    expect(await resolveOutputRoot(root)).toBe(snapshot);
  });

  it("rejects ambiguous snapshots when Git metadata is unavailable", async () => {
    const root = await mkdtemp(join(tmpdir(), "gip-backup-path-"));
    temporaryDirectories.push(root);
    const parent = join(root, "imports", "normalized", "anime-game-data");
    for (const name of ["fixture-a", "fixture-b"]) {
      const snapshot = join(parent, name, "zh-CN");
      await mkdir(snapshot, { recursive: true });
      await writeFile(join(snapshot, "manifest.json"), "{}\n");
    }
    process.env.ANIME_GAME_DATA_DIR = join(root, "missing-upstream");
    await expect(resolveOutputRoot(root)).rejects.toThrow(/Could not uniquely determine/);
  });
});
