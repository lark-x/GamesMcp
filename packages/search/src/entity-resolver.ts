import type { SearchTierName } from "./ranking.js";
import { normalizeText } from "./ranking.js";

export type EntityMatchTier = "canonical_name" | "alias" | "normalized" | "prefix" | "trigram";

export type ResolvedEntityCandidate = {
  id: string;
  entityType: string;
  canonicalName: string;
  matchedBy: EntityMatchTier;
  confidence: number;
};

export type ResolvedEntity = {
  entityType: string;
  id: string;
  canonicalName: string;
  matchedBy: EntityMatchTier;
  matchedText: string;
  confidence: number;
  candidates?: ResolvedEntityCandidate[];
};

export const STRONG_AMBIGUITY_NAMES = new Set(["旅行者", "空", "荧"]);

export type ResolverCandidate = {
  id: string;
  entityType: string;
  canonicalName: string;
  normalized?: string | null;
  aliases?: string[];
};

export function matchedByForTier(tier: SearchTierName | "none"): ResolvedEntity["matchedBy"] {
  switch (tier) {
    case "exactTitle":
      return "canonical_name";
    case "exactAlias":
      return "alias";
    case "titlePrefix":
      return "prefix";
    case "ftsRank":
      return "normalized";
    default:
      return "trigram";
  }
}

export function confidenceForTier(tier: SearchTierName | "none"): number {
  switch (tier) {
    case "exactTitle":
      return 1;
    case "exactAlias":
      return 0.95;
    case "titlePrefix":
      return 0.8;
    case "ftsRank":
      return 0.6;
    case "trigramTitle":
      return 0.4;
    default:
      return 0.2;
  }
}

export function resolveEntityFromCandidates<T extends ResolverCandidate>(
  query: string,
  candidates: T[],
): ResolvedEntity | null {
  const q = normalizeText(query);
  if (!q) return null;
  type Scored = {
    candidate: T;
    matchedBy: EntityMatchTier;
    matchedText: string;
    confidence: number;
  };
  const scored: Scored[] = [];
  for (const candidate of candidates) {
    const name = normalizeText(candidate.canonicalName);
    if (name === q) {
      scored.push({
        candidate,
        matchedBy: "canonical_name",
        matchedText: candidate.canonicalName,
        confidence: 1,
      });
      continue;
    }
    let aliasHit: Scored | null = null;
    for (const alias of candidate.aliases ?? []) {
      if (normalizeText(alias) === q) {
        aliasHit = { candidate, matchedBy: "alias", matchedText: alias, confidence: 0.95 };
        break;
      }
    }
    if (aliasHit) {
      scored.push(aliasHit);
      continue;
    }
    if ((candidate.normalized ?? name) === q) {
      scored.push({
        candidate,
        matchedBy: "normalized",
        matchedText: candidate.canonicalName,
        confidence: 0.7,
      });
      continue;
    }
    if (name.startsWith(q)) {
      scored.push({
        candidate,
        matchedBy: "prefix",
        matchedText: candidate.canonicalName,
        confidence: 0.6,
      });
    }
  }
  scored.sort((left, right) => right.confidence - left.confidence);
  const top = scored[0];
  if (!top) {
    if (!STRONG_AMBIGUITY_NAMES.has(q) || !candidates.length) return null;
    const first = candidates[0]!;
    return {
      entityType: first.entityType,
      id: first.id,
      canonicalName: first.canonicalName,
      matchedBy: "trigram",
      matchedText: first.canonicalName,
      confidence: 0.2,
      candidates: candidates.map((candidate) => ({
        id: candidate.id,
        entityType: candidate.entityType,
        canonicalName: candidate.canonicalName,
        matchedBy: "trigram",
        confidence: 0.2,
      })),
    };
  }
  const ambiguous = STRONG_AMBIGUITY_NAMES.has(q);
  const result: ResolvedEntity = {
    entityType: top.candidate.entityType,
    id: top.candidate.id,
    canonicalName: top.candidate.canonicalName,
    matchedBy: top.matchedBy,
    matchedText: top.matchedText,
    confidence: top.confidence,
  };
  if (ambiguous && scored.length > 1) {
    result.candidates = scored.map((item) => ({
      ...item.candidate,
      matchedBy: item.matchedBy,
      confidence: item.confidence,
    }));
  }
  return result;
}
