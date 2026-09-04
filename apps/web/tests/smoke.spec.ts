import { test, expect } from "@playwright/test";

test("纯净知识档案库页面正常加载且不包含旧版后台入口", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/games") {
      return route.fulfill({
        json: {
          games: [
            { id: "genshin", name: "原神", status: "active", currentRevision: "v5.4" },
            { id: "starrail", name: "崩坏：星穹铁道", status: "active", currentRevision: "v3.1" },
          ],
        },
      });
    }
    return route.fulfill({ json: {} });
  });

  await page.goto("/");
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("banner").getByText("GamesMcp", { exact: true })).toBeVisible();
  await expect(page.getByLabel("选择游戏")).toBeVisible();

  // Ensure no legacy admin or version switcher buttons exist
  await expect(page.getByRole("button", { name: "管理后台" })).not.toBeVisible();
  await expect(page.getByRole("button", { name: /切换版本/ })).not.toBeVisible();
});
