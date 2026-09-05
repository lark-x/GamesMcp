import type { StoryCatalogFilters, StoryEntry, StoryTreeNode } from "../archive.types.js";

export type { StoryCatalogFilters, StoryEntry, StoryTreeNode };

export type ProtagonistGame = "genshin" | "starrail";
export type ProtagonistGender = "male" | "female";
export type TravelerGender = ProtagonistGender;

export interface ProtagonistPreferences {
  game: ProtagonistGame;
  gender: ProtagonistGender;
  nickname: string;
}

export type TravelerPreferences = ProtagonistPreferences;

export const DEFAULT_GENSHIN_PREFS: ProtagonistPreferences = {
  game: "genshin",
  gender: "male",
  nickname: "旅行者",
};

export const DEFAULT_STARRAIL_PREFS: ProtagonistPreferences = {
  game: "starrail",
  gender: "male",
  nickname: "开拓者",
};

export const DEFAULT_TRAVELER_PREFS = DEFAULT_GENSHIN_PREFS;

const GENSHIN_STORAGE_KEY = "games_mcp_traveler_prefs";
const STARRAIL_STORAGE_KEY = "games_mcp_starrail_prefs";

export function loadProtagonistPreferences(isStarRail = false): ProtagonistPreferences {
  const key = isStarRail ? STARRAIL_STORAGE_KEY : GENSHIN_STORAGE_KEY;
  const defaultPrefs = isStarRail ? DEFAULT_STARRAIL_PREFS : DEFAULT_GENSHIN_PREFS;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaultPrefs;
    const parsed = JSON.parse(raw);
    const fallbackNick = isStarRail ? "开拓者" : "旅行者";
    return {
      game: isStarRail ? "starrail" : "genshin",
      gender: parsed.gender === "female" ? "female" : "male",
      nickname:
        typeof parsed.nickname === "string" && parsed.nickname.trim()
          ? parsed.nickname.trim()
          : fallbackNick,
    };
  } catch {
    return defaultPrefs;
  }
}

export function saveProtagonistPreferences(prefs: ProtagonistPreferences): void {
  const key = prefs.game === "starrail" ? STARRAIL_STORAGE_KEY : GENSHIN_STORAGE_KEY;
  try {
    localStorage.setItem(key, JSON.stringify(prefs));
  } catch {
    // ignore
  }
}

export function loadTravelerPreferences(): TravelerPreferences {
  return loadProtagonistPreferences(false);
}

export function saveTravelerPreferences(prefs: TravelerPreferences): void {
  saveProtagonistPreferences(prefs);
}

