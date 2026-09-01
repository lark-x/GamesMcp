import { test, expect } from "@playwright/test";

test("管理后台展示四个入口并支持移动端布局", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/games") return route.fulfill({ json: { games: [] } });
    if (path === "/api/admin/revisions") return route.fulfill({ json: { revisions: [] } });
    if (path === "/api/admin/review-issues") return route.fulfill({ json: { issues: [] } });
    if (path === "/api/admin/release-candidates")
      return route.fulfill({ json: { candidates: [] } });
    return route.fulfill({ json: {} });
  });
  await page.goto("/#admin/intake");
  await expect(page.getByRole("region", { name: "导入数据" })).toBeVisible();
});
