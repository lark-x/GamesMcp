import { test, expect } from "@playwright/test";

const gameId = "00000000-0000-0000-0000-000000000001";

function baseGames() {
  return { games: [{ id: gameId, name: "崩坏：星穹铁道", status: "active" }] };
}

test("剧情档案目录、正文与 deep link", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/api/games") return route.fulfill({ json: baseGames() });
    if (u.pathname === `/api/games/${gameId}/quests`)
      return route.fulfill({
        json: {
          quests: [
            {
              questKey: "quest/1000",
              mainQuestId: "1000",
              title: "于枯索的冬夜里",
              type: "archon_quest",
              chapter: "第一章",
              series: "开拓任务",
              completeness: "complete",
              locale: "zh-CN",
              documentId: "d-quest-1000",
              revision: "r1",
            },
          ],
        },
      });
    if (u.pathname === `/api/games/${gameId}/quests/quest%2F1000`)
      return route.fulfill({
        json: {
          quest: {
            questKey: "quest/1000",
            mainQuestId: "1000",
            title: "于枯索的冬夜里",
            type: "archon_quest",
            completeness: "complete",
            locale: "zh-CN",
            documentId: "d-quest-1000",
            revision: "r1",
            gameVersion: "3.2.0",
            subquests: [],
            dialogueNodes: [
              {
                nodeKey: "q1000-n1",
                nodeId: 1,
                type: "narration",
                body: "风雪没有停止。",
                order: 1,
              },
              {
                nodeKey: "q1000-n2",
                nodeId: 2,
                type: "dialogue",
                speakerName: "三月七",
                body: "这里的风雪比我们想象的还要糟糕……",
                order: 2,
              },
              {
                nodeKey: "q1000-n3",
                nodeId: 3,
                type: "player_choice",
                body: "我觉得事情没这么简单。",
                order: 3,
              },
            ],
            dialogueEdges: [],
            participants: [{ id: "e1", sourceKey: null, name: "三月七", type: "character" }],
            prerequisites: [],
            citations: [],
            warnings: [],
            nextCursor: null,
          },
        },
      });
    if (u.pathname === `/api/games/${gameId}/sources`)
      return route.fulfill({ json: { sources: [] } });
    return route.fulfill({ json: {} });
  });

  await page.goto(`/#story/${encodeURIComponent("quest/1000")}`);
  await expect(page.getByRole("heading", { name: "于枯索的冬夜里" })).toBeVisible();
  await expect(page.getByText("风雪没有停止。")).toBeVisible();
  await expect(page.locator(".story-speaker", { hasText: "三月七" })).toBeVisible();
  await expect(page.getByText("我觉得事情没这么简单。")).toBeVisible();
  // deep link hash is preserved for reload.
  await expect(page).toHaveURL(/#story%2Fquest%2F1000|#story\/quest%2F1000/);
});

test("材料浏览器分类、列表与详情", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/api/games") return route.fulfill({ json: baseGames() });
    if (u.pathname === `/api/games/${gameId}/codex/materials`)
      return route.fulfill({
        json: {
          gameId,
          revisionId: null,
          materials: [
            {
              stableId: "material/1",
              name: "梦之珠泪",
              category: "character_ascension",
              rarity: 5,
              description: "传说中凝结晶泪的珠子。",
              sources: ["模拟宇宙"],
              usedBy: ["三月七"],
            },
            {
              stableId: "material/2",
              name: "信用点",
              category: "currency",
              rarity: 3,
              description: "通用货币。",
              sources: [],
              usedBy: [],
            },
          ],
        },
      });
    if (u.pathname === `/api/games/${gameId}/codex/materials/material%2F1`)
      return route.fulfill({
        json: {
          material: {
            stableId: "material/1",
            name: "梦之珠泪",
            category: "character_ascension",
            rarity: 5,
            description: "传说中凝结晶泪的珠子。",
            sources: ["模拟宇宙"],
            usedBy: ["三月七"],
          },
        },
      });
    if (u.pathname === `/api/games/${gameId}/sources`)
      return route.fulfill({ json: { sources: [] } });
    return route.fulfill({ json: {} });
  });

  await page.goto("/#archive/materials");
  await expect(page.getByText("梦之珠泪")).toBeVisible();
  await page.getByRole("listitem").filter({ hasText: "梦之珠泪" }).click();
  await expect(page.getByText("传说中凝结晶泪的珠子。")).toBeVisible();
  await expect(page.locator(".material-source-list").getByText("模拟宇宙")).toBeVisible();
});

test("文本浏览器目录、正文与章节导航", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/api/games") return route.fulfill({ json: baseGames() });
    if (u.pathname === `/api/games/${gameId}/text/books`)
      return route.fulfill({
        json: {
          gameId,
          revisionId: null,
          locale: "zh-CN",
          totalVolumes: 2,
          books: [
            {
              stableId: "book/heta",
              bookStableId: "book/heta",
              title: "黑塔研究图鉴",
              volumes: [
                {
                  stableId: "volume/1",
                  bookStableId: "book/heta",
                  documentId: "doc-1",
                  title: "第一卷",
                  volume: 1,
                  order: 1,
                  segmentCount: 1,
                },
                {
                  stableId: "volume/2",
                  bookStableId: "book/heta",
                  documentId: "doc-2",
                  title: "第二卷",
                  volume: 2,
                  order: 2,
                  segmentCount: 1,
                },
              ],
            },
          ],
        },
      });
    if (u.pathname === `/api/games/${gameId}/documents/doc-1`)
      return route.fulfill({
        json: {
          document: {
            id: "doc-1",
            title: "黑塔研究图鉴 · 第一卷",
            type: "book",
            locale: "zh-CN",
            gameVersion: "3.2.0",
            revision: "r1",
            sourceName: "TurnBasedGameData",
            sourceKey: "book/heta/1",
            segments: [
              {
                id: "seg-1",
                ordinal: 0,
                headingPath: ["第一章"],
                body: "黑塔空间站由天才俱乐部成员黑塔主持建立。",
                startOffset: 0,
                endOffset: 20,
                mentions: [],
              },
            ],
          },
        },
      });
    if (u.pathname === `/api/games/${gameId}/sources`)
      return route.fulfill({ json: { sources: [] } });
    return route.fulfill({ json: {} });
  });

  await page.goto("/#text/books");
  await expect(page.locator(".text-reader-header h2")).toContainText("黑塔研究图鉴");
  await expect(page.getByText("黑塔空间站由天才俱乐部成员黑塔主持建立。")).toBeVisible();
  await expect(page.getByText("1 / 2")).toBeVisible();
  await expect(page.getByRole("button", { name: "← 上一章" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "下一章 →" })).toBeEnabled();
  await page.getByRole("button", { name: "下一章 →" }).click();
  await expect(page.getByText("2 / 2")).toBeVisible();
  await expect(page.getByRole("button", { name: "下一章 →" })).toBeDisabled();
});
