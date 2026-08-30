import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { runStoragePreflight } from "./check-data-storage.js";

const execFileAsync = promisify(execFile);

const preflight = await runStoragePreflight();
if (!preflight.ok) {
  console.error(`Storage preflight failed: ${preflight.errors.join("; ")}`);
  process.exitCode = 1;
} else {
  const result = await execFileAsync("docker", ["compose", "up", "-d", "postgres"], {
    encoding: "utf8",
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}
