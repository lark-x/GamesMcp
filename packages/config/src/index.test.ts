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
});
