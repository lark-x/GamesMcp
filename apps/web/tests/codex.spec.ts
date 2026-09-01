import { test, expect } from "@playwright/test";

const gameId = "00000000-0000-0000-0000-000000000001";

test("Game Codex 数据页展示角色列表并支持分类切换", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/games")
      return route.fulfill({
        json: { games: [{ id: gameId, name: "原神", status: "active" }] },
      });
    if (path === `/api/games/${gameId}/genshin/characters`)
      return route.fulfill({
        json: {
          gameId,
          revisionId: null,
          characters: [
            {
              stableId: "char/hutao",
              name: "胡桃",
              title: "往生堂堂主",
              rarity: 5,
              element: "pyro",
              weaponType: "polearm",
              description: "往生堂七十七代堂主。",
            },
          ],
        },
      });
    if (path === `/api/games/${gameId}/genshin/materials`)
      return route.fulfill({
        json: {
          gameId,
          revisionId: null,
          materials: [
            {
              stableId: "material/nichang",
              name: "霓裳花",
              category: "local_specialty",
              description: "璃月特产。",
            },
          ],
        },
      });
    if (path === `/api/games/${gameId}/home`) return route.fulfill({ json: {} });
    if (path === `/api/games/${gameId}/sources`) return route.fulfill({ json: { sources: [] } });
    return route.fulfill({ json: {} });
  });

  await page.goto("/#codex/characters");
  await expect(page.getByRole("heading", { name: "角色" })).toBeVisible();
  await expect(page.getByText("胡桃")).toBeVisible();
  await expect(page.getByText("往生堂七十七代堂主。")).toBeVisible();

  await page.getByRole("button", { name: "材料" }).click();
  await expect(page.getByRole("heading", { name: "材料" })).toBeVisible();
  await expect(page.getByText("霓裳花")).toBeVisible();
});
