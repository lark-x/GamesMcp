import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertPathInsideImportRoot, resolveImportRoot } from "./index.js";

describe("assertPathInsideImportRoot", () => {
  it("allows paths inside the import root", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gip-data-"));
    const inside = join(dataDir, "imports", "fixture.json");
    await mkdir(join(dataDir, "imports"), { recursive: true });
    expect(assertPathInsideImportRoot(inside, dataDir)).toBe(inside);
  });

  it("rejects paths outside the import root", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gip-data-"));
    // A path on a different drive (Windows) or an absolute POSIX path (Linux/macOS)
    // both resolve outside the import root.
    const outside = process.platform === "win32" ? "Q:\\elsewhere\\x.json" : "/etc/passwd";
    expect(() => assertPathInsideImportRoot(outside, dataDir)).toThrowError(/import root/i);
    expect(() =>
      assertPathInsideImportRoot(join(dataDir, "elsewhere", "x.json"), dataDir),
    ).toThrowError(/import root/i);
  });

  it("rejects traversal attempts that escape the import root", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gip-data-"));
    const sneaky = join(dataDir, "imports", "..", "..", "secrets.json");
    expect(() => assertPathInsideImportRoot(sneaky, dataDir)).toThrowError(/import root/i);
  });

  it("exposes the deterministic import root", () => {
    // resolve() is platform-aware: on Windows "/srv/data" resolves against the
    // current drive, matching the implementation's own normalization.
    const expected = resolve("/srv/data", "imports");
    expect(resolveImportRoot("/srv/data")).toBe(expected);
  });
});
