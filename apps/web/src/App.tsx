import { useEffect, useMemo, useState } from "react";
import type { GameSummary } from "@gip/contracts";
import { AdminRoutes } from "./admin/AdminRoutes.js";
import { apiFetch, type Revision } from "./api.js";
import { ArchiveApp } from "./archive/ArchiveApp.js";
import { PreviewBrowser } from "./preview/PreviewBrowser.js";
import { parsePreviewRoute, type PreviewRoute } from "./shared.js";

type GameResponse = { games: GameSummary[] };

export function App() {
  const [isAdminRoute, setIsAdminRoute] = useState(() =>
    window.location.hash.startsWith("#admin/"),
  );
  const [previewRoute, setPreviewRoute] = useState<PreviewRoute | null>(() => parsePreviewRoute());
  const [games, setGames] = useState<GameSummary[]>([]);
  const [gameId, setGameId] = useState("");
  const [selectedRevision, setSelectedRevision] = useState<string | undefined>();
  const [selectedRevisionLabel, setSelectedRevisionLabel] = useState<string | undefined>();

  useEffect(() => {
    function handleHash() {
      setIsAdminRoute(window.location.hash.startsWith("#admin/"));
      setPreviewRoute(parsePreviewRoute());
    }
    window.addEventListener("hashchange", handleHash);
    return () => window.removeEventListener("hashchange", handleHash);
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadGames() {
      try {
        const response = await apiFetch<GameResponse>("/api/games");
        if (cancelled) return;
        setGames(response.games);
        if (response.games.length > 0 && !gameId) {
          setGameId(response.games[0].id);
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

  const visibleRevisionLabel = useMemo(() => {
    if (selectedRevisionLabel) return selectedRevisionLabel;
    if (currentGame?.currentRevision) return currentGame.currentRevision;
    return "正式发布";
  }, [selectedRevisionLabel, currentGame]);

  // Admin routing
  if (isAdminRoute) {
    return <AdminRoutes initialRoute={window.location.hash.slice(1)} />;
  }

  // Preview routing
  if (previewRoute && gameId) {
    return (
      <PreviewBrowser
        gameId={gameId}
        candidateId={previewRoute.candidateId}
        initialBuildId={previewRoute.buildId}
      />
    );
  }

  // GamesMcp Archive (The Single Public UI)
  return (
    <ArchiveApp
      gameId={gameId}
      games={games}
      currentGame={currentGame}
      selectedRevision={selectedRevision}
      selectedRevisionLabel={visibleRevisionLabel}
      onGameChange={(nextGameId) => {
        setGameId(nextGameId);
        setSelectedRevision(undefined);
        setSelectedRevisionLabel(undefined);
      }}
      onPreview={(candidateId, buildId) => {
        window.location.hash = `preview/${candidateId}${buildId ? `/${buildId}` : ""}`;
      }}
      onRevision={(revisionId: string, revision?: Revision) => {
        setSelectedRevision(revisionId);
        setSelectedRevisionLabel(
          revision?.revisionNumber
            ? `r${revision.revisionNumber}`
            : (revision?.version ?? revisionId),
        );
      }}
      onCurrent={() => {
        setSelectedRevision(undefined);
        setSelectedRevisionLabel(undefined);
      }}
    />
  );
}
