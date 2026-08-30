type BenchmarkProfile = {
  name: "entity" | "fulltext" | "mixed";
  types?: Array<"entity" | "document" | "segment">;
  targetP95Ms: number;
};

const baseUrl = (process.env.API_BASE_URL ?? "http://127.0.0.1:4100").replace(/\/$/, "");
const gameId = process.env.GAME_ID;
const queries = (process.env.BENCHMARK_QUERIES ?? "旅行者,派蒙,蒙德,提瓦特,血亲")
  .split(",")
  .map((query) => query.trim())
  .filter(Boolean);
const iterations = Number(process.env.BENCHMARK_ITERATIONS ?? 5);
const profiles: BenchmarkProfile[] = [
  { name: "entity", types: ["entity"], targetP95Ms: 200 },
  { name: "fulltext", types: ["document", "segment"], targetP95Ms: 500 },
  { name: "mixed", targetP95Ms: 1_000 },
];

if (!gameId) throw new Error("GAME_ID is required");
if (!queries.length || !Number.isInteger(iterations) || iterations < 1)
  throw new Error("Benchmark queries and iterations must be configured");

function percentile(durations: number[], value: number): number {
  const sorted = [...durations].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(value * sorted.length) - 1)] ?? 0;
}

const measurements = new Map<BenchmarkProfile["name"], number[]>();
for (const profile of profiles) measurements.set(profile.name, []);

for (let iteration = 0; iteration < iterations; iteration += 1) {
  for (const profile of profiles) {
    for (const query of queries) {
      const startedAt = performance.now();
      const response = await fetch(`${baseUrl}/api/games/${gameId}/search`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, types: profile.types, limit: 20 }),
      });
      if (!response.ok)
        throw new Error(`${profile.name} search failed for ${query}: ${response.status}`);
      await response.arrayBuffer();
      measurements.get(profile.name)?.push(performance.now() - startedAt);
    }
  }
}

const profilesResult = Object.fromEntries(
  profiles.map((profile) => {
    const durations = measurements.get(profile.name) ?? [];
    return [
      profile.name,
      {
        samples: durations.length,
        targetP95Ms: profile.targetP95Ms,
        p50Ms: Number(percentile(durations, 0.5).toFixed(2)),
        p95Ms: Number(percentile(durations, 0.95).toFixed(2)),
        maxMs: Number(Math.max(...durations, 0).toFixed(2)),
      },
    ];
  }),
);
const allDurations = [...measurements.values()].flat();
const result = {
  baseUrl,
  gameId,
  queryCount: queries.length,
  iterations,
  samples: allDurations.length,
  p50Ms: Number(percentile(allDurations, 0.5).toFixed(2)),
  p95Ms: Number(percentile(allDurations, 0.95).toFixed(2)),
  maxMs: Number(Math.max(...allDurations, 0).toFixed(2)),
  profiles: profilesResult,
};
console.log(JSON.stringify(result, null, 2));

if (process.env.ENFORCE_PERFORMANCE_TARGETS === "1") {
  for (const profile of profiles) {
    const measured = (profilesResult[profile.name] as { p95Ms: number }).p95Ms;
    if (measured > profile.targetP95Ms)
      throw new Error(`${profile.name} P95 target failed: ${measured}ms`);
  }
}
