import { Suspense, lazy, useEffect, useState } from "react";
import type { GameSummary } from "@gip/contracts";
import { parseArchiveRoute } from "./archive.routes.js";
import type { ArchiveRoute, DataKind } from "./archive.types.js";
import { ArchiveHeader } from "./ArchiveHeader.js";
import { ArchiveHome } from "./ArchiveHome.js";
import { ArchiveLoading } from "./ArchiveStates.js";

const StoryBrowser = lazy(() =>
  import("./story/StoryBrowser.js").then((m) => ({ default: m.StoryBrowser })),
);
const MaterialBrowser = lazy(() =>
  import("./materials/MaterialBrowser.js").then((m) => ({ default: m.MaterialBrowser })),
);
const DataBrowser = lazy(() =>
  import("./data/DataBrowser.js").then((m) => ({ default: m.DataBrowser })),
);
const TextBrowser = lazy(() =>
  import("./text/TextBrowser.js").then((m) => ({ default: m.TextBrowser })),
);
const SearchPage = lazy(() =>
  import("./search/SearchPage.js").then((m) => ({ default: m.SearchPage })),
);
const AskPage = lazy(() => import("./ask/AskPage.js").then((m) => ({ default: m.AskPage })));

export function ArchiveApp({
  gameId,
  games,
  currentGame,
  selectedRevision,
  selectedRevisionLabel,
  onGameChange,
}: {
  gameId: string;
  games: GameSummary[];
  currentGame?: GameSummary;
  selectedRevision?: string;
  selectedRevisionLabel?: string;
  onGameChange: (value: string) => void;
}) {
  const [route, setRoute] = useState<ArchiveRoute>(() => parseArchiveRoute());

  useEffect(() => {
    function handleHashChange() {
      setRoute(parseArchiveRoute());
    }
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const gameName = currentGame?.name ?? "原神";
  const revisionLabel = selectedRevisionLabel ?? "正式发布";

  function renderContent() {
    switch (route.kind) {
      case "home":
        return (
          <ArchiveHome
            currentGame={currentGame}
            gameName={gameName}
            selectedRevisionLabel={revisionLabel}
          />
        );

      case "story":
      case "quests":
      case "story-catalog":
        return (
          <Suspense fallback={<ArchiveLoading label="加载剧情档案中..." />}>
            <StoryBrowser
              gameId={gameId}
              gameName={gameName}
              revisionLabel={revisionLabel}
              selectedRevision={selectedRevision}
              initialQuestKey={route.kind === "story" ? route.questKey : undefined}
              onHome={() => (window.location.hash = "")}
              onOpenMaterials={() => (window.location.hash = "archive/materials")}
              onOpenText={() => (window.location.hash = "text/books")}
              onQuestKeyChange={(key) => {
                window.location.hash = key ? `story/${encodeURIComponent(key)}` : "story";
              }}
            />
          </Suspense>
        );

      case "materials":
        return (
          <Suspense fallback={<ArchiveLoading label="加载材料百科中..." />}>
            <MaterialBrowser
              gameId={gameId}
              gameName={gameName}
              revisionLabel={revisionLabel}
              selectedRevision={selectedRevision}
              initialMaterialId={route.materialId}
              onHome={() => (window.location.hash = "")}
              onOpenStory={() => (window.location.hash = "story")}
              onOpenText={() => (window.location.hash = "text/books")}
              onMaterialIdChange={(id) => {
                window.location.hash = id
                  ? `archive/materials/${encodeURIComponent(id)}`
                  : "archive/materials";
              }}
            />
          </Suspense>
        );

      case "data":
        return (
          <Suspense fallback={<ArchiveLoading label="加载游戏资料中..." />}>
            <DataBrowser
              gameId={gameId}
              dataKind={route.dataKind}
              selectedRevision={selectedRevision}
              initialItemId={route.itemId}
              onSelectKind={(kind: DataKind) => {
                window.location.hash = `archive/${kind}`;
              }}
              onSelectItem={(id) => {
                window.location.hash = id
                  ? `archive/${route.dataKind}/${encodeURIComponent(id)}`
                  : `archive/${route.dataKind}`;
              }}
            />
          </Suspense>
        );

      case "text":
        return (
          <Suspense fallback={<ArchiveLoading label="加载文献文本中..." />}>
            <TextBrowser
              gameId={gameId}
              gameName={gameName}
              revisionLabel={revisionLabel}
              selectedRevision={selectedRevision}
              initialBookId={route.bookId}
              initialChapterId={route.chapterId}
              onHome={() => (window.location.hash = "")}
              onOpenStory={() => (window.location.hash = "story")}
              onOpenMaterials={() => (window.location.hash = "archive/materials")}
              onRouteChange={(bookId, chapterId) => {
                const parts = ["text", route.textKind];
                if (bookId) parts.push(encodeURIComponent(bookId));
                if (bookId && chapterId) parts.push(encodeURIComponent(chapterId));
                window.location.hash = parts.join("/");
              }}
            />
          </Suspense>
        );

      case "search":
        return (
          <Suspense fallback={<ArchiveLoading label="加载检索模块中..." />}>
            <SearchPage
              gameId={gameId}
              selectedRevision={selectedRevision}
              initialQuery={route.query}
            />
          </Suspense>
        );

      case "ask":
        return (
          <Suspense fallback={<ArchiveLoading label="加载智能问答中..." />}>
            <AskPage
              gameId={gameId}
              selectedRevision={selectedRevision}
              initialQuestion={route.question}
            />
          </Suspense>
        );

      default:
        return (
          <ArchiveHome
            currentGame={currentGame}
            gameName={gameName}
            selectedRevisionLabel={revisionLabel}
          />
        );
    }
  }

  return (
    <div className="archive-app-root">
      <ArchiveHeader
        gameName={gameName}
        games={games}
        gameId={gameId}
        selectedRevisionLabel={revisionLabel}
        onGameChange={onGameChange}
      />
      <main className="archive-app-main">{renderContent()}</main>
    </div>
  );
}
