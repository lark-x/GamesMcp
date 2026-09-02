import type { SearchMatchType } from "./port.js";

/**
 * Deterministic lexical ranking tiers for the shared search core.
 *
 * Scores are tiered so that a title-level exact match always outranks a body
 * level match regardless of query overlap ratios. Character overlap must never
 * dominate ranking; it only feeds the weakest trigram tiers.
 */

export function normalizeText(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase("zh-CN");
}

export const SEARCH_TIERS = {
  exactTitle: 10,
  exactAlias: 9,
  titlePrefix: 8,
  ftsRank: 6,
  trigramTitle: 5,
  bodyFts: 4,
  bodyTrigram: 2,
} as const;

/**
 * Match classes emitted by the SQL search port. The tier gap is deliberately
 * larger than the bounded database rank so exact and prefix hits stay ahead
 * of FTS and trigram fallbacks.
 */
export const SEARCH_MATCH_TYPE_TIERS = {
  exact: SEARCH_TIERS.exactTitle,
  prefix: SEARCH_TIERS.titlePrefix,
  fts: SEARCH_TIERS.ftsRank,
  trgm: SEARCH_TIERS.bodyTrigram,
} as const;

export function scoreSearchMatch(matchType: SearchMatchType, rank = 0): number {
  const boundedRank = Number.isFinite(rank) ? Math.min(Math.max(rank, 0), 1) : 0;
  return SEARCH_MATCH_TYPE_TIERS[matchType] + boundedRank;
}

export type SearchTierName = keyof typeof SEARCH_TIERS;

export const DIALOGUE_BOOSTS = {
  speakerExact: 3,
  questTitleMatch: 2,
  importantQuestType: 1,
} as const;

export type DialogueBoostName = keyof typeof DIALOGUE_BOOSTS;

export const IMPORTANT_QUEST_TYPES = new Set(["archon_quest", "story_quest"]);

/** Character-overlap ratio kept only for the weakest trigram tiers. */
export function characterOverlap(query: string, value: string): number {
  const q = normalizeText(query);
  const v = normalizeText(value);
  if (!q) return 0;
  const chars = [...q];
  const overlap = chars.filter((char) => v.indexOf(char) >= 0).length;
  return overlap / chars.length;
}

export type TieredScore = {
  score: number;
  tier: SearchTierName | "none";
};

export function scoreTitleField(query: string, title: string): TieredScore {
  const q = normalizeText(query);
  const t = normalizeText(title);
  if (!q) return { score: 0, tier: "none" };
  if (t === q) return { score: SEARCH_TIERS.exactTitle, tier: "exactTitle" };
  if (t.startsWith(q)) return { score: SEARCH_TIERS.titlePrefix, tier: "titlePrefix" };
  if (t.indexOf(q) >= 0) return { score: SEARCH_TIERS.ftsRank, tier: "ftsRank" };
  return { score: 0, tier: "none" };
}

export function scoreAliasField(query: string, alias: string): TieredScore {
  const q = normalizeText(query);
  const a = normalizeText(alias);
  if (!q) return { score: 0, tier: "none" };
  if (a === q) return { score: SEARCH_TIERS.exactAlias, tier: "exactAlias" };
  if (a.startsWith(q)) return { score: SEARCH_TIERS.titlePrefix, tier: "titlePrefix" };
  if (a.indexOf(q) >= 0) return { score: SEARCH_TIERS.ftsRank, tier: "ftsRank" };
  return { score: 0, tier: "none" };
}

export function scoreBodyField(query: string, body: string): TieredScore {
  const q = normalizeText(query);
  const b = normalizeText(body);
  if (!q) return { score: 0, tier: "none" };
  if (b.indexOf(q) >= 0) return { score: SEARCH_TIERS.bodyFts, tier: "bodyFts" };
  const overlap = characterOverlap(query, body);
  if (overlap >= 0.6)
    return { score: SEARCH_TIERS.bodyTrigram + overlap * 0.5, tier: "bodyTrigram" };
  return { score: 0, tier: "none" };
}

export type RankingInput = {
  title: string;
  aliases?: string[];
  body?: string;
  speaker?: string | null;
  questTitle?: string | null;
  questType?: string | null;
};

export type RankingResult = TieredScore & {
  matchedBy: SearchTierName | "bodyTrigram" | "none";
};

/** Rank a candidate with dialogue boosts applied on top of field tiers. */
/**
 * Compatibility ranking for legacy in-memory adapters and unit tests. The
 * production SQL adapter supplies `SearchMatchType` and rank directly, so
 * this local fallback is not used to decide PostgreSQL search matches.
 */
export function rankCandidate(query: string, input: RankingInput): RankingResult {
  let best = scoreTitleField(query, input.title);
  let matchedBy: SearchTierName | "bodyTrigram" | "none" = best.tier;
  for (const alias of input.aliases ?? []) {
    const aliasScore = scoreAliasField(query, alias);
    if (aliasScore.score > best.score) best = aliasScore;
  }
  if (best.tier === "none" || best.score < SEARCH_TIERS.bodyFts) {
    const bodyScore = input.body
      ? scoreBodyField(query, input.body)
      : { score: 0, tier: "none" as const };
    if (bodyScore.score > best.score) {
      best = bodyScore;
      matchedBy = "bodyTrigram";
    }
  }
  let score = best.score;
  if (input.speaker && normalizeText(input.speaker) === normalizeText(query)) {
    score += DIALOGUE_BOOSTS.speakerExact;
    matchedBy = matchedBy === "none" ? "ftsRank" : matchedBy;
  }
  if (input.questTitle && normalizeText(input.questTitle).indexOf(normalizeText(query)) >= 0) {
    score += DIALOGUE_BOOSTS.questTitleMatch;
  }
  if (input.questType && IMPORTANT_QUEST_TYPES.has(input.questType)) {
    score += DIALOGUE_BOOSTS.importantQuestType;
  }
  return { score, tier: best.tier, matchedBy };
}
