import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@gip/config": resolve("packages/config/src/index.ts"),
      "@gip/contracts": resolve("packages/contracts/src/index.ts"),
      "@gip/domain": resolve("packages/domain/src/index.ts"),
      "@gip/database": resolve("packages/database/src/index.ts"),
      "@gip/ingestion": resolve("packages/ingestion/src/index.ts"),
      "@gip/retrieval": resolve("packages/retrieval/src/index.ts"),
      "@gip/qa": resolve("packages/qa/src/index.ts"),
    },
  },
  test: {
    include: [
      "packages/**/src/**/*.test.ts",
      "apps/**/src/**/*.test.ts",
      "scripts/anime-game-data-converter.test.ts",
      "scripts/anime-game-data-import-helpers.test.ts",
      "scripts/backup-acquisition.test.ts",
    ],
    environment: "node",
    passWithNoTests: false,
  },
});
