import { readFile } from "node:fs/promises";
import { rankCandidate, resolveEntityFromCandidates } from "../packages/search/src/index.ts";

type BaselineCase = {
  id: string;
  category: string;
  query: string;
  candidates?: Array<{ kind: string; name: string; aliases: string[]; body: string }>;
  dialogue?: Array<{
    title: string;
    body: string;
    speaker: string | null;
    questTitle: string | null;
    questType: string | null;
  }>;
  resolver?: Array<{ id: string; entityType: string; canonicalName: string; aliases: string[] }>;
  expectTopName?: string;
  expectTopSpeaker?: string;
  expectTopContains?: string;
  expectTier?: string;
  expectMinScore?: number;
  expectAmbiguous?: boolean;
  expectMinCandidates?: number;
  expectMatchedBy?: string;
  expectConfidence?: number;
};

type BaselineFile = {
  cases: BaselineCase[];
  targets: { minPassRate: number };
};

const path =
  process.env.SEARCH_CORE_BASELINE ?? "data/evaluation/genshin/search-core-baseline.json";
const baseline = JSON.parse(await readFile(path, "utf8")) as BaselineFile;
const failures: string[] = [];

for (const item of baseline.cases) {
  if (item.candidates) {
    const ranked = item.candidates
      .map((candidate) => ({
        name: candidate.name,
        ...rankCandidate(item.query, {
          title: candidate.name,
          aliases: candidate.aliases,
          body: candidate.body,
        }),
      }))
      .sort((left, right) => right.score - left.score);
    const top = ranked[0];
    if (item.expectTopName && top?.name !== item.expectTopName)
      failures.push(`${item.id}: top name ${top?.name} != ${item.expectTopName}`);
    if (item.expectMinScore !== undefined && (top?.score ?? 0) < item.expectMinScore)
      failures.push(`${item.id}: score ${top?.score} < ${item.expectMinScore}`);
  }
  if (item.dialogue) {
    const ranked = item.dialogue
      .map((hit) => ({
        speaker: hit.speaker,
        title: hit.title,
        ...rankCandidate(item.query, {
          title: hit.title,
          body: hit.body,
          speaker: hit.speaker,
          questTitle: hit.questTitle,
          questType: hit.questType,
        }),
      }))
      .sort((left, right) => right.score - left.score);
    const top = ranked[0];
    if (item.expectTopSpeaker && top?.speaker !== item.expectTopSpeaker)
      failures.push(`${item.id}: speaker ${top?.speaker} != ${item.expectTopSpeaker}`);
    if (item.expectTopContains && !top?.title.includes(item.expectTopContains))
      failures.push(`${item.id}: title ${top?.title} does not contain ${item.expectTopContains}`);
    if (item.expectMinScore !== undefined && (top?.score ?? 0) < item.expectMinScore)
      failures.push(`${item.id}: score ${top?.score} < ${item.expectMinScore}`);
  }
  if (item.resolver) {
    const resolved = resolveEntityFromCandidates(item.query, item.resolver);
    if (item.expectAmbiguous) {
      const count = resolved?.candidates?.length ?? 0;
      if ((item.expectMinCandidates ?? 0) > count)
        failures.push(`${item.id}: candidates ${count} < ${item.expectMinCandidates}`);
    }
    if (item.expectMatchedBy && resolved?.matchedBy !== item.expectMatchedBy)
      failures.push(`${item.id}: matchedBy ${resolved?.matchedBy} != ${item.expectMatchedBy}`);
    if (item.expectConfidence !== undefined && resolved?.confidence !== item.expectConfidence)
      failures.push(`${item.id}: confidence ${resolved?.confidence} != ${item.expectConfidence}`);
  }
}

const passRate = (baseline.cases.length - failures.length) / Math.max(baseline.cases.length, 1);
console.log(
  JSON.stringify(
    {
      baseline: path,
      cases: baseline.cases.length,
      passed: baseline.cases.length - failures.length,
      passRate: Number(passRate.toFixed(4)),
      target: baseline.targets.minPassRate,
      failures,
    },
    null,
    2,
  ),
);
if (failures.length || passRate < baseline.targets.minPassRate) process.exitCode = 1;
