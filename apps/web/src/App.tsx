import { useEffect, useMemo, useState } from "react";
import type { GameSummary } from "@gip/contracts";
import { apiFetch } from "./api.js";
import { ArchiveApp } from "./archive/ArchiveApp.js";

type GameResponse = { games: GameSummary[] };

export function App() {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [gameId, setGameId] = useState(() => {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      return urlParams.get("gameId") || urlParams.get("game") || localStorage.getItem("gip_active_game") || "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    let cancelled = false;
    async function loadGames() {
      try {
        const response = await apiFetch<GameResponse>("/api/games");
        if (cancelled) return;
        setGames(response.games);
        if (response.games.length > 0) {
          const match = response.games.find((g) => g.id === gameId || g.slug === gameId);
          if (match) {
            setGameId(match.id);
          } else if (!gameId) {
            setGameId(response.games[0].id);
          }
        }
      } catch {
        // network or server error handled gracefully
      }
    }
    loadGames();
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  const currentGame = useMemo(
    () => games.find((g) => g.id === gameId) ?? games[0],
    [games, gameId],
  );

  return (
    <ArchiveApp
      gameId={gameId}
      games={games}
      currentGame={currentGame}
      selectedRevisionLabel={currentGame?.currentRevision}
      onGameChange={(nextGameId) => {
        setGameId(nextGameId);
        try {
          localStorage.setItem("gip_active_game", nextGameId);
        } catch {
          // ignore
        }
      }}
    />
  );
}
