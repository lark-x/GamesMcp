import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PW_PORT ?? 4174);

export default defineConfig({
  testDir: "./apps/web/tests",
  timeout: 30_000,
  use: { baseURL: `http://127.0.0.1:${port}`, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `pnpm --dir apps/web exec vite --host 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}`,
    // Never attach to a server left by another checkout/project.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
