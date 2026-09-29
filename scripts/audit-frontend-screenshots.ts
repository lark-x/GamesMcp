import { spawn } from "node:child_process";
import { mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const CHROME_PATH =
  process.env.CHROME_BIN ??
  (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "google-chrome");

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:4173";
const OUTPUT_DIR = resolve(process.cwd(), "screenshots/audit");

const ROUTES = [
  { name: "01_home", hash: "" },
  { name: "02_story", hash: "#story" },
  { name: "03_archive_characters", hash: "#archive/characters" },
  { name: "04_archive_weapons", hash: "#archive/weapons" },
  { name: "05_archive_artifacts", hash: "#archive/artifacts" },
  { name: "06_archive_enemies", hash: "#archive/enemies" },
  { name: "07_archive_achievements", hash: "#archive/achievements" },
  { name: "08_archive_materials", hash: "#archive/materials" },
  { name: "09_text_books", hash: "#text/books" },
  { name: "10_search", hash: "#search" },
  { name: "11_ask", hash: "#ask" },
];

function captureScreenshot(url: string, outputPath: string): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const args = [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--window-size=1440,900",
      "--virtual-time-budget=4000",
      `--screenshot=${outputPath}`,
      url,
    ];
    const proc = spawn(CHROME_PATH, args, { stdio: "ignore" });
    proc.on("close", (code) => {
      if (code === 0 && existsSync(outputPath)) {
        resolvePromise();
      } else {
        rejectPromise(new Error(`Failed to capture ${url} (exit code ${code})`));
      }
    });
    proc.on("error", rejectPromise);
  });
}

async function run() {
  console.log(`[audit-frontend-screenshots] Checking Chrome: ${CHROME_PATH}`);
  if (!existsSync(CHROME_PATH)) {
    console.error(`Chrome binary not found at: ${CHROME_PATH}`);
    process.exit(1);
  }

  if (!existsSync(OUTPUT_DIR)) {
    mkdirSync(OUTPUT_DIR, { recursive: true });
  }

  console.log(`[audit-frontend-screenshots] Base URL: ${BASE_URL}`);
  console.log(`[audit-frontend-screenshots] Output directory: ${OUTPUT_DIR}\n`);

  let successCount = 0;
  for (const route of ROUTES) {
    const targetUrl = `${BASE_URL}/${route.hash}`;
    const outputFile = resolve(OUTPUT_DIR, `${route.name}.png`);
    process.stdout.write(`Capturing ${route.name.padEnd(25)} -> ${targetUrl} ... `);
    const start = Date.now();
    try {
      await captureScreenshot(targetUrl, outputFile);
      const elapsed = ((Date.now() - start) / 1000).toFixed(2);
      console.log(`OK (${elapsed}s)`);
      successCount++;
    } catch (err: unknown) {
      console.log(`FAILED: ${(err as Error).message}`);
    }
  }

  console.log(`\nCompleted: ${successCount} / ${ROUTES.length} screenshots saved to ${OUTPUT_DIR}`);
  if (successCount < ROUTES.length) {
    process.exit(1);
  }
}

void run();
