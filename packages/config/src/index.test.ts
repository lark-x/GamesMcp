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
  });

  it("requires a valid Istaroth URL when the provider is enabled", () => {
    expect(() => loadConfig({ GAMESMCP_ISTAROTH_ENABLED: "true" })).toThrow(
      /GAMESMCP_ISTAROTH_URL is required/u,
    );
    expect(() =>
      loadConfig({ GAMESMCP_ISTAROTH_ENABLED: "true", GAMESMCP_ISTAROTH_URL: "not-a-url" }),
    ).toThrow(/must be a valid URL/u);
  });
});
