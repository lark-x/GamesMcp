import { loadConfig } from "../packages/config/src/index.ts";
import {
  createDatabase,
  createPool,
  SqlKnowledgeRepository,
} from "../packages/database/src/index.ts";
import { runStoragePreflight } from "./check-data-storage.js";

const categories = [
  "book",
  "character_story",
  "item_description",
  "mechanism",
  "quest",
  "structured",
] as const;
type Category = (typeof categories)[number];

function flag(name: string): string | undefined {
  const prefix = `--${name}=`;
  const item = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return item?.slice(prefix.length);
}

const confirmDeletions = process.argv.includes("--confirm-deletions");
const config = loadConfig();
const preflight = await runStoragePreflight();
if (!preflight.ok) throw new Error(preflight.errors.join("; "));

const pool = createPool(config.databaseUrl);
const repository = new SqlKnowledgeRepository(createDatabase(pool), config.dataDir);
try {
  const game = (await repository.listGames()).find(
    (candidate) => candidate.slug === "genshin-impact",
  );
  if (!game) throw new Error("Seed the genshin-impact game before preparing a candidate");

  const sources = await repository.listSources(game.id);
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  // Candidate selection only needs batch metadata. Loading every historical
  // staged JSONB payload here can materialize multiple generations of the
  // full quest export before the selected batches are read by the builder.
  const imports = await repository.listImports(game.id, { includePayload: false, limit: 5000 });
  const selected = new Map<Category, Array<(typeof imports)[number]>>();
  for (const batch of imports) {
    if (batch.status === "cancelled") continue;
    const parserType = sourceById.get(batch.sourceId)?.parserType;
    const category = parserType?.replace(/^anime-game-data:/, "") as Category | undefined;
    if (!category || !categories.includes(category)) continue;
    if (batch.successCount <= 0) continue;
    const candidates = selected.get(category) ?? [];
    candidates.push(batch);
    selected.set(category, candidates);
  }
  const missing = categories.filter((category) => !selected.has(category));
  if (missing.length)
    throw new Error(`Missing latest AnimeGameData import batches: ${missing.join(", ")}`);

  const selectedBatches = categories.flatMap((category) => {
    const candidates = selected.get(category)!;
    const newest = candidates[0]!;
    // Large imports may be stored as several batches sharing one immutable
    // source snapshot.  Keep that complete generation together, while
    // ignoring older snapshots from prior imports of the same category.
    if (!newest.sourceSnapshotId) return [newest];
    return candidates.filter(
      (candidate) =>
        candidate.sourceId === newest.sourceId &&
        candidate.sourceSnapshotId === newest.sourceSnapshotId,
    );
  });
  const confirmed = [] as Array<{ id: string; deletionCount: number }>;
  for (const batch of selectedBatches) {
    const deletions = batch.diff?.deletionCandidates ?? [];
    if (!confirmDeletions || !deletions.length) continue;
    if (batch.status !== "review_required" && batch.status !== "staged")
      throw new Error(`Import ${batch.id} cannot confirm deletions from state ${batch.status}`);
    await repository.reviewImport(
      batch.id,
      true,
      "Confirmed for the fixed AnimeGameData candidate; formal data is unchanged.",
      deletions,
    );
    confirmed.push({ id: batch.id, deletionCount: deletions.length });
  }

  const candidate = await repository.createReleaseCandidate({
    gameId: game.id,
    name: flag("name") ?? "AnimeGameData 7.0.0 · 双语剧情与资料（预发布）",
    importBatchIds: selectedBatches.map((batch) => batch.id),
  });
  const build = await repository.buildReleaseCandidate(candidate.id);
  const readiness = await repository.getReleaseCandidateReadiness(candidate.id);
  console.log(
    JSON.stringify(
      {
        game: { id: game.id, name: game.name },
        candidate: { id: candidate.id, name: candidate.name },
        build: {
          id: build.id,
          buildNumber: build.buildNumber,
          recordCount: build.recordCount,
          contentChecksum: build.contentChecksum,
          manifestId: build.manifestId,
        },
        batches: selectedBatches.map((batch) => ({
          id: batch.id,
          category: sourceById.get(batch.sourceId)?.parserType?.replace("anime-game-data:", ""),
          records: batch.successCount,
        })),
        confirmedDeletions: confirmed,
        readiness,
        previewOnly: true,
        currentRevisionUnchanged: true,
      },
      null,
      2,
    ),
  );
} finally {
  await pool.end();
}
