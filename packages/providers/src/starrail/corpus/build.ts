import { buildStarRailInventory } from "../source/inventory.js";
import { readStarRailSourceSnapshot } from "../source/snapshot.js";
import { StarRailTextMapResolver } from "../source/textmap.js";
import {
  extractBookDocuments,
  extractCharacterStoryDocuments,
  extractItemLoreDocuments,
  extractMessageDocuments,
  extractMissionDocuments,
  extractStoryDocuments,
  extractTrainVisitorDocuments,
  extractVoiceLineDocuments,
} from "../extractors/index.js";
import { writeStarRailIstarothCorpus } from "./writer.js";
import type { StarRailCorpusBuildResult, StarRailCorpusDocument } from "./types.js";

export async function buildStarRailIstarothCorpus(input: {
  sourceDir: string;
  outputDir: string;
  locale?: string;
  generatedAt?: string;
}): Promise<StarRailCorpusBuildResult> {
  const locale = input.locale ?? "CHS";
  const snapshot = await readStarRailSourceSnapshot(input.sourceDir);
  const inventory = await buildStarRailInventory({
    dataDir: input.sourceDir,
    sourceRef: snapshot.ref,
  });
  const resolver = new StarRailTextMapResolver({
    dataDir: input.sourceDir,
    inventory,
    locale,
  });
  await resolver.load();
  const extractorInput = {
    dataDir: input.sourceDir,
    sourceRef: snapshot.ref,
    inventory,
    resolver,
    locale,
  };
  const extracted = await Promise.all([
    extractMissionDocuments(extractorInput),
    extractStoryDocuments(extractorInput),
    extractMessageDocuments(extractorInput),
    extractTrainVisitorDocuments(extractorInput),
    extractBookDocuments(extractorInput),
    extractCharacterStoryDocuments(extractorInput),
    extractVoiceLineDocuments(extractorInput),
    extractItemLoreDocuments(extractorInput),
  ]);
  const documents = dedupeByPath(extracted.flatMap((result) => result.documents));
  return await writeStarRailIstarothCorpus({
    outputDir: input.outputDir,
    locale,
    sourceCommit: snapshot.ref,
    generatedAt: input.generatedAt,
    documents,
    issues: extracted.flatMap((result) => result.issues),
    unresolvedText: extracted.reduce((sum, result) => sum + result.unresolvedText, 0),
    duplicateRejected:
      extracted.reduce((sum, result) => sum + result.documents.length, 0) - documents.length,
  });
}

function dedupeByPath(documents: StarRailCorpusDocument[]): StarRailCorpusDocument[] {
  const seen = new Set<string>();
  return documents.filter((document) => {
    if (seen.has(document.relativePath)) return false;
    seen.add(document.relativePath);
    return true;
  });
}
