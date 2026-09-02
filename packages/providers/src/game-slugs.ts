const GAME_SLUG_ALIASES: Record<string, string> = {
  genshin: "genshin",
  "genshin-impact": "genshin",
  genshin_impact: "genshin",
  starrail: "starrail",
  "star-rail": "starrail",
  "honkai-star-rail": "starrail",
  hsr: "starrail",
};

export function normalizeGameSlug(gameSlug: string): string {
  const normalized = gameSlug.trim().toLowerCase();
  return GAME_SLUG_ALIASES[normalized] ?? normalized;
}
