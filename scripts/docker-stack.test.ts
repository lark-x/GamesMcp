import { describe, expect, it } from "vitest";
import {
  composeArgs,
  missingRequiredEnv,
  parseInvocation,
  resolveDataDir,
} from "./docker-stack.ts";

describe("parseInvocation", () => {
  it("defaults to deploy without providers", () => {
    expect(parseInvocation([])).toEqual({
      action: "deploy",
      withProviders: false,
      service: undefined,
    });
  });

  it("parses deploy --with-providers", () => {
    expect(parseInvocation(["deploy", "--with-providers"])).toEqual({
      action: "deploy",
      withProviders: true,
      service: undefined,
    });
  });

  it("accepts a single service for logs", () => {
    expect(parseInvocation(["logs", "mcp"])).toEqual({
      action: "logs",
      withProviders: false,
      service: "mcp",
    });
  });

  it("rejects an unknown action", () => {
    expect(() => parseInvocation(["nope"])).toThrow(/未知操作/u);
  });

  it("rejects --with-providers outside deploy", () => {
    expect(() => parseInvocation(["stop", "--with-providers"])).toThrow(/仅适用于 deploy/u);
  });

  it("rejects extra positional arguments for logs", () => {
    expect(() => parseInvocation(["logs", "mcp", "api"])).toThrow(/最多接受一个服务名/u);
  });

  it("rejects unknown flags", () => {
    expect(() => parseInvocation(["deploy", "--force"])).toThrow(/未知参数/u);
  });
});

describe("missingRequiredEnv", () => {
  const complete = {
    DATA_DIR: "/data",
    ISTAROTH_IMAGE: "example/istaroth:1.2.3",
    MCP_AUTH_TOKEN: "token",
  };

  it("accepts a complete environment", () => {
    expect(missingRequiredEnv(complete, "deploy")).toEqual([]);
  });

  it("requires DATA_DIR and ISTAROTH_IMAGE for every action", () => {
    expect(missingRequiredEnv({}, "stop")).toEqual(["DATA_DIR", "ISTAROTH_IMAGE"]);
  });

  it("requires the bearer token only for deploy", () => {
    const withoutToken = { DATA_DIR: "/data", ISTAROTH_IMAGE: "img:1" };
    expect(missingRequiredEnv(withoutToken, "stop")).toEqual([]);
    expect(missingRequiredEnv(withoutToken, "status")).toEqual([]);
    expect(missingRequiredEnv(withoutToken, "logs")).toEqual([]);
    expect(missingRequiredEnv(withoutToken, "deploy")).toEqual(["MCP_AUTH_TOKEN"]);
  });

  it("treats blank values as missing", () => {
    expect(missingRequiredEnv({ ...complete, MCP_AUTH_TOKEN: "   " }, "deploy")).toEqual([
      "MCP_AUTH_TOKEN",
    ]);
  });
});

describe("composeArgs", () => {
  it("pins the env file before the compose file", () => {
    expect(composeArgs(["up", "-d", "mcp"])).toEqual([
      "compose",
      "--env-file",
      ".env",
      "-f",
      "docker-compose.yml",
      "up",
      "-d",
      "mcp",
    ]);
  });

  it("honours overrides", () => {
    expect(
      composeArgs(["ps"], { composeFile: "docker-compose.prod.yml", envFile: ".env.ci" }),
    ).toEqual(["compose", "--env-file", ".env.ci", "-f", "docker-compose.prod.yml", "ps"]);
  });
});

describe("resolveDataDir", () => {
  it("keeps an absolute Windows path on Windows", () => {
    expect(resolveDataDir("F:/Project/GamesMcp/data", "C:/repo", "win32")).toBe(
      "F:/Project/GamesMcp/data",
    );
  });

  it("keeps an absolute POSIX path on macOS", () => {
    expect(resolveDataDir("/Volumes/Lark/GamesMcp/data", "/repo", "darwin")).toBe(
      "/Volumes/Lark/GamesMcp/data",
    );
  });

  it("resolves a relative path against the working directory", () => {
    expect(resolveDataDir("./data", "/repo", "darwin")).toBe("/repo/data");
  });

  it("refuses a Windows drive path on macOS instead of creating a junk directory", () => {
    expect(() => resolveDataDir("F:/Project/GamesMcp/data", "/repo", "darwin")).toThrow(
      /Windows 路径/u,
    );
    expect(() => resolveDataDir("F:\\Project\\GamesMcp\\data", "/repo", "linux")).toThrow(
      /Windows 路径/u,
    );
  });
});
