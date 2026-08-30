import { test, expect } from "@playwright/test";

test("管理后台展示四个入口并支持移动端布局", async ({ page }) => {
  await page.goto("/#admin/intake");
  await expect(page.getByRole("button", { name: "导入", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "预发布分支", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "待处理问题", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "正式版本历史", exact: true })).toBeVisible();
});
