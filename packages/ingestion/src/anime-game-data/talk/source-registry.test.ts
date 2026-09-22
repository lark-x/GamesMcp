import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildTalkSourceRegistry } from "./source-registry.js";

describe("Talk source registry", () => {
  it("finds an embedded talk id when the filename is hashed", async () => {
    const root = await mkdtemp(join(tmpdir(), "gamesmcp-talk-registry-"));
    try {
      const directory = join(root, "BinOutput", "Talk", "Npc");
      await mkdir(directory, { recursive: true });
      await writeFile(
        join(directory, "abcdef12.json"),
        JSON.stringify({
          IOKNFDJFGDH: 7223601,
          PFALHAKIILD: [
            {
              OIFGMOHKPOI: 722360101,
              OACNIBLFFDI: 1001,
              KMLAFCBMFEI: [],
            },
          ],
        }),
      );
      const registry = await buildTalkSourceRegistry(root, {
        parseKinds: ["quest"],
        concurrency: 1,
      });
      const assets = await registry.findAssets("7223601");
      expect(assets).toHaveLength(1);
      expect(assets[0]?.relativePath).toContain("abcdef12.json");
      expect(registry.coverage.metadataScannedFiles).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
