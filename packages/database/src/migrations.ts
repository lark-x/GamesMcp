import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** The single migration registry used by runtime and integration tests. */
export async function listMigrationUrls(): Promise<URL[]> {
  const directory = resolve(dirname(fileURLToPath(import.meta.url)), "migrations");
  const names = (await readdir(directory))
    .filter((name) => /^\d{4}_.+\.sql$/.test(name))
    .sort((a, b) => a.localeCompare(b, "en"));
  if (!names.length) throw new Error(`No database migrations found in ${directory}`);
  return names.map((name) => pathToFileURL(resolve(directory, name)));
}
