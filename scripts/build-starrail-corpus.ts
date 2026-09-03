import { resolve } from "node:path";
import { buildStarRailIstarothCorpus } from "../packages/providers/src/starrail/corpus/build.js";

const args = parseArgs(process.argv.slice(2));
const sourceDir = args.source ?? process.env.GAMESMCP_STARRAIL_DATA_DIR;
const outputDir =
  args.output ?? process.env.STARRAIL_CORPUS_OUTPUT ?? "data/generated/starrail/istaroth/chs";
const locale = args.locale ?? process.env.STARRAIL_CORPUS_LOCALE ?? "CHS";

if (!sourceDir) {
  console.error("Missing --source or GAMESMCP_STARRAIL_DATA_DIR");
  process.exit(1);
}

const result = await buildStarRailIstarothCorpus({
  sourceDir: resolve(sourceDir),
  outputDir: resolve(outputDir),
  locale,
});

console.log(
  JSON.stringify({
    ok: true,
    output: resolve(outputDir),
    documents: result.metadata.stats.documents,
    categories: result.metadata.stats.categories,
    sourceCommit: result.sourceCommit,
    issues: result.metadata.issues.length,
  }),
);

function parseArgs(values: string[]): Record<string, string | undefined> {
  const parsed: Record<string, string | undefined> = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    parsed[value.slice(2)] = values[index + 1];
    index += 1;
  }
  return parsed;
}
