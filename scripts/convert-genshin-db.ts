import { resolve } from "node:path";
import { convertSnapshot, writeSnapshot } from "./genshin-db-adapter.js";

const root = resolve(process.env.GENSHIN_DB_DIR ?? "data/upstream/genshin-db");
const output = resolve(process.env.GENSHIN_DB_OUTPUT_DIR ?? "data/imports/normalized/genshin-db");
const sample = process.env.GENSHIN_DB_SAMPLE ? Number(process.env.GENSHIN_DB_SAMPLE) : undefined;
const result = await convertSnapshot(root, {
  locale: process.env.GENSHIN_DB_LOCALE ?? "en",
  samplePerCategory: sample,
});
await writeSnapshot(result, output);
console.log(JSON.stringify(result.manifest, null, 2));
