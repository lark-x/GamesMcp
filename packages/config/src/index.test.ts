import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, redactConfig } from "./index.js";

describe("configuration", () => {
  it("uses safe local defaults", () => {
    const config = loadConfig({});
    expect(config.host).toBe("127.0.0.1");
    expect(config.apiPort).toBe(4100);
    expect(config.dataDir).toContain("data");
    expect(config.corsOrigins).toContain("http://localhost:4173");
  });

  it("redacts secrets", () => {
    const config = loadConfig({ LLM_API_KEY: "secret" });
    expect(redactConfig(config).llm.apiKey).toBe("[redacted]");
  });

  it("keeps Istaroth disabled by default", () => {
    expect(loadConfig({}).providers.istaroth?.enabled).toBe(false);
    expect(loadConfig({}).providers.starrail?.enabled).toBe(false);
    expect(loadConfig({}).providers.entries).toMatchObject([
      { id: "istaroth", enabled: false },
      { id: "starrail-local", enabled: false },
    ]);
  });

  it("requires a valid Istaroth URL when the provider is enabled", () => {
    expect(() => loadConfig({ GAMESMCP_ISTAROTH_ENABLED: "true" })).toThrow(
      /GAMESMCP_ISTAROTH_URL is required/u,
    );
    expect(() =>
      loadConfig({ GAMESMCP_ISTAROTH_ENABLED: "true", GAMESMCP_ISTAROTH_URL: "not-a-url" }),
    ).toThrow(/must be a valid URL/u);
  });

  it("supports Genshin only provider config", () => {
    const config = loadConfig({
      GAMESMCP_ISTAROTH_ENABLED: "true",
      GAMESMCP_ISTAROTH_URL: "http://127.0.0.1:8000/mcp",
    });
    expect(config.providers.entries).toMatchObject([
      { id: "istaroth", game: "genshin", enabled: true },
      { id: "starrail-local", game: "starrail", enabled: false },
    ]);
  });

  it("supports StarRail only provider config", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gamesmcp-starrail-"));
    const config = loadConfig({
      GAMESMCP_STARRAIL_ENABLED: "true",
      GAMESMCP_STARRAIL_DATA_DIR: dataDir,
    });
    expect(config.providers.entries).toMatchObject([
      { id: "istaroth", enabled: false },
      { id: "starrail-local", game: "starrail", enabled: true, dataDir },
    ]);
  });

  it("supports both Genshin and StarRail provider config", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "gamesmcp-starrail-"));
    const config = loadConfig({
      GAMESMCP_ISTAROTH_ENABLED: "1",
      GAMESMCP_ISTAROTH_URL: "http://127.0.0.1:8000/mcp",
      GAMESMCP_STARRAIL_ENABLED: "1",
      GAMESMCP_STARRAIL_DATA_DIR: dataDir,
    });
    expect(config.providers.entries.filter((provider) => provider.enabled)).toHaveLength(2);
  });

  it("rejects invalid StarRail data path when enabled", () => {
    expect(() =>
      loadConfig({
        GAMESMCP_STARRAIL_ENABLED: "true",
        GAMESMCP_STARRAIL_DATA_DIR: "/path/that/does/not/exist/gamesmcp-starrail",
      }),
    ).toThrow(/GAMESMCP_STARRAIL_DATA_DIR does not exist/u);
  });
});
