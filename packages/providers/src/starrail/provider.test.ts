import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { StarRailLocalProvider } from "./provider.js";

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "gamesmcp-starrail-provider-"));
  await mkdir(join(root, "TextMap"), { recursive: true });
  await mkdir(join(root, "Story", "Mission"), { recursive: true });
  await mkdir(join(root, "ExcelOutput"), { recursive: true });
  await writeFile(
    join(root, "TextMap", "TextMapCHS.json"),
    JSON.stringify({
      "1001": "星穹列车正在开拓新的世界。",
      "1002": "雅利洛-VI 的星核危机仍影响贝洛伯格。",
      "1003": "仙舟联盟追猎丰饶孽物。",
    }),
    "utf8",
  );
  await writeFile(
    join(root, "Story", "Mission", "Belobog.json"),
    JSON.stringify({
      MissionID: 1,
      Title: "雅利洛-VI",
      Dialogue: [
        { Text: "开拓者抵达雅利洛-VI，调查星核造成的寒潮。" },
        { Text: "贝洛伯格上下层围绕存护与生存产生冲突。" },
      ],
    }),
    "utf8",
  );
  await writeFile(
    join(root, "ExcelOutput", "AvatarConfig.json"),
    JSON.stringify([{ Name: "三月七", Desc: "星穹列车成员，使用冰属性力量。" }]),
    "utf8",
  );
  return root;
}

describe("StarRailLocalProvider", () => {
  it("builds inventory, resolves CHS TextMap and searches local corpus", async () => {
    const dataDir = await fixture();
    const provider = new StarRailLocalProvider({
      dataDir,
      inventoryOutput: join(dataDir, "inventory.json"),
    });

    await expect(provider.health()).resolves.toMatchObject({
      id: "starrail-local",
      game: "starrail",
      status: "available",
    });
    const summary = await provider.getSourceSummary();
    expect(summary.inventory.files).toBeGreaterThanOrEqual(3);
    expect(summary.textMap.totalKeys).toBe(3);
    expect(summary.textMap.resolvedSample).toBe(3);
    expect(summary.documents).toBeGreaterThanOrEqual(3);

    const response = await provider.search({
      game: "starrail",
      query: "雅利洛 星核",
      mode: "hybrid",
      limit: 3,
    });
    expect(response.hits[0]).toMatchObject({
      game: "starrail",
      provider: "starrail-local",
    });
    expect(response.hits.some((hit) => hit.excerpt.includes("星核"))).toBe(true);
    expect(response.hits.every((hit) => hit.metadata?.retrievalBackend)).toBe(true);
  });

  it("reads documents with pagination and stable ids", async () => {
    const dataDir = await fixture();
    const provider = new StarRailLocalProvider({ dataDir });
    const search = await provider.search({ game: "hsr", query: "贝洛伯格", limit: 1 });
    const documentId = search.hits[0]?.documentId;
    expect(documentId).toMatch(/^starrail\//u);

    const document = await provider.getDocument({
      game: "starrail",
      documentId: documentId ?? "",
      cursor: 0,
      limit: 1,
    });
    expect(document.game).toBe("starrail");
    expect(document.provider).toBe("starrail-local");
    expect(document.returnedLines).toBe(1);
  });

  it("reports unavailable when source path is missing", async () => {
    const provider = new StarRailLocalProvider({ dataDir: "/missing/starrail/data" });
    await expect(provider.health()).resolves.toMatchObject({ status: "unavailable" });
  });
});
