import { describe, expect, it } from "vitest";
import { runStarRailIngestion } from "./ingest-starrail-full.js";

describe("StarRail ingestion write guards", () => {
  it("rejects limited and fixture writes before connecting to the database", async () => {
    const databaseUrl = "postgres://invalid/never-connect";
    await expect(runStarRailIngestion({ databaseUrl, dryRun: false, limit: 1 })).rejects.toThrow(
      "--limit",
    );
    await expect(
      runStarRailIngestion({ databaseUrl, dryRun: false, fixture: true }),
    ).rejects.toThrow("dry-run only");
    await expect(runStarRailIngestion({ databaseUrl, dryRun: false })).rejects.toThrow(
      "source directory is required",
    );
  });
});
