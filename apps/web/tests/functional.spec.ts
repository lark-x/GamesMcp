import { test, expect } from "@playwright/test";

const candidate = {
  id: "c1",
  name: "Amber",
  status: "ready",
  currentBuildId: "b1",
  builds: [{ id: "b1", buildNumber: 1, status: "ready", recordCount: 51 }],
};
async function mockApi(page: import("@playwright/test").Page) {
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/api/games")
      return route.fulfill({ json: { games: [{ id: "g1", name: "Game" }] } });
    if (
      u.pathname.includes("/previews/b1/") &&
      (u.pathname.endsWith("/entities") || u.pathname.endsWith("/documents"))
    ) {
      const offset = Number(u.searchParams.get("offset") ?? 0);
      const records = Array.from({ length: Math.min(50, 51 - offset) }, (_, i) => ({
        sourceKey: `k${offset + i}`,
        displayKind: "document",
        title: `Record ${offset + i}`,
        body: "body",
        metadata: {},
        contentHash: "h",
        parserVersion: "p",
      }));
      const payload = records.map((r) => ({
        sourceKey: r.sourceKey,
        title: r.title,
        name: r.title,
        body: r.body,
        metadata: {},
        contentHash: "h",
        parserVersion: "p",
      }));
      return route.fulfill({
        json: u.pathname.endsWith("/entities")
          ? { entities: payload, total: 51 }
          : { documents: payload, total: 51 },
      });
    }
    if (u.pathname === "/api/admin/release-candidates")
      return route.fulfill({ json: { candidates: [candidate] } });
    if (u.pathname === "/api/admin/release-candidates/c1")
      return route.fulfill({ json: { candidate } });
    if (u.pathname === "/api/admin/revisions")
      return route.fulfill({
        json: { revisions: [{ id: "r1", version: "1.0", status: "published", manifestId: "m1" }] },
      });
    if (u.pathname === "/api/admin/review-issues")
      return route.fulfill({
        json: {
          issues: [
            {
              id: "i1",
              candidateId: "c1",
              canonicalKey: "k1",
              kind: "conflict",
              status: "open",
              summary: "Needs review",
            },
          ],
        },
      });
    if (u.pathname === "/api/admin/imports") return route.fulfill({ json: { imports: [] } });
    return route.fulfill({ json: {} });
  });
}

test("主页可切换预发布并浏览 51 条记录分页", async ({ page }) => {
  await mockApi(page);
  await page.goto("/#preview/c1");
  await expect(page.getByRole("heading", { name: "Record 0", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "下一页" }).click();
  await expect(page.getByRole("heading", { name: "Record 50", exact: true })).toBeVisible();
});

test("预览搜索过滤会发送 q 参数", async ({ page }) => {
  await mockApi(page);
  let requested = "";
  await page.route("**/api/admin/previews/**", async (route) => {
    requested = route.request().url();
    await route.continue();
  });
  await page.goto("/#preview/c1");
  await page.getByLabel("搜索预发布资料").fill("amber");
  await expect.poll(() => requested).toContain("q=amber");
});

test("导入提交显示自动 Candidate 说明", async ({ page }) => {
  await mockApi(page);
  await page.goto("/#admin/intake");
  await page.getByPlaceholder("游戏 UUID").fill("g1");
  await page.getByPlaceholder("来源 UUID").fill("s1");
  await page.getByPlaceholder("本地路径或 URL").fill("/tmp/data");
  await page.getByRole("button", { name: "创建导入任务" }).click();
  await expect(page.getByText(/导入任务已创建|Worker 会自动聚合 Candidate/)).toBeVisible();
});

test("问题页上传证据并创建 Patch", async ({ page }) => {
  await mockApi(page);
  let patchBody = "";
  let evidenceBody = "";
  await page.route("**/review-issues/i1/evidence", async (route) => {
    evidenceBody = route.request().postData() ?? "";
    await route.fulfill({ json: {} });
  });
  await page.route("**/patches", async (route) => {
    patchBody = route.request().postData() ?? "";
    await route.fulfill({ json: {} });
  });
  await page.goto("/#admin/issues");
  await page.getByLabel("说明 k1").fill("verified");
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "evidence.png", mimeType: "image/png", buffer: Buffer.from("png") });
  await page.getByRole("button", { name: "上传证据" }).click();
  await expect.poll(() => evidenceBody).toContain("dataBase64");
  await page.getByRole("button", { name: "创建 Patch 并生成 Build N+1" }).click();
  await expect.poll(() => patchBody).toContain("issueId");
  await expect(page.getByText(/已创建 Patch/)).toBeVisible();
});

test("历史页回滚提交原因", async ({ page }) => {
  await mockApi(page);
  let body = "";
  await page.route("**/revisions/r1/rollback", async (route) => {
    body = route.request().postData() ?? "";
    await route.fulfill({ json: {} });
  });
  await page.goto("/#admin/history");
  await page.getByLabel("回滚原因 r1").fill("安全回退");
  await page.getByRole("button", { name: "带原因回滚" }).click();
  await expect.poll(() => body).toContain("安全回退");
});
