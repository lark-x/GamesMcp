import { resolve } from "node:path";
import { validateStarRailIstarothCorpus } from "../packages/providers/src/starrail/corpus/validator.js";

const args = parseArgs(process.argv.slice(2));
const corpusDir =
  args.corpus ??
  args.output ??
  process.env.STARRAIL_CORPUS_OUTPUT ??
  "data/generated/starrail/istaroth/chs";

const report = await validateStarRailIstarothCorpus({ corpusDir: resolve(corpusDir) });
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);

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
