import { test, expect } from "@playwright/test";

const candidate = {
  id: "c1",
  gameId: "g1",
  name: "Amber",
  status: "ready",
  currentBuildId: "b1",
  importBatchIds: ["import-1"],
  builds: [
    {
      id: "b1",
      buildNumber: 1,
      status: "ready",
      recordCount: 51,
      contentChecksum: "a".repeat(64),
      manifestId: "m1",
      indexStatus: "ready",
    },
  ],
};
async function mockApi(page: import("@playwright/test").Page) {
  await page.route("**/api/**", async (route) => {
    const u = new URL(route.request().url());
    if (u.pathname === "/api/games")
      return route.fulfill({ json: { games: [{ id: "g1", name: "Game" }] } });
    if (u.pathname === "/api/games/g1/quests")
      return route.fulfill({
        json: {
          quests: [
            {
              questKey: "quest/1000",
              mainQuestId: "1000",
              title: "浮世浮生千岩间",
              type: "archon_quest",
              chapter: "第一章",
              series: "1001",
              completeness: "complete",
              locale: u.searchParams.get("locale") ?? "zh-CN",
              documentId: "d-quest-1000",
              revision: "r1",
              match: "text",
            },
          ],
        },
      });
    if (u.pathname === "/api/games/g1/quests/quest%2F1000")
      return route.fulfill({
        json: {
          quest: {
            questKey: "quest/1000",
            mainQuestId: "1000",
            title: "浮世浮生千岩间",
            type: "archon_quest",
            chapter: "第一章",
            series: "1001",
            completeness: "complete",
            locale: u.searchParams.get("locale") ?? "zh-CN",
            documentId: "d-quest-1000",
            revision: "r1",
            gameVersion: "7.0.0",
            subquests: [
              {
                subquestKey: "quest/1000/subquest/100000",
                subquestId: "100000",
                title: "前往璃月港",
                objective: "前往璃月港",
                order: 1,
                completeness: "complete",
              },
            ],
            dialogueNodes:
              u.searchParams.get("cursor") === "next"
                ? [
                    {
                      nodeKey: "quest/1000/dialog/100002",
                      nodeId: "100002",
                      type: "dialogue",
                      speakerName: "派蒙",
                      body: "下一页台词",
                      order: 2,
                    },
                  ]
                : [
                    {
                      nodeKey: "quest/1000/dialog/100001",
                      nodeId: "100001",
                      type: "dialogue",
                      speakerName: "派蒙",
                      body: "要寻找岩神的话，一年里只有这一次机会。",
                      order: 1,
                    },
                  ],
            dialogueEdges: [],
            participants: [{ id: "e1", sourceKey: "npc/1005", name: "派蒙", type: "npc" }],
            prerequisites: [],
            citations: [],
            warnings: [],
            nextCursor: u.searchParams.get("cursor") === "next" ? null : "next",
          },
        },
      });
    if (u.pathname === "/api/admin/sources")
      return route.fulfill({
        json: { sources: [{ id: "s1", name: "Fixture source", type: "local_json" }] },
      });
    if (u.pathname === "/api/admin/previews/b1/quests")
      return route.fulfill({
        json: {
          preview: true,
          buildId: "b1",
          candidateId: "c1",
          quests: [
            {
              questKey: "quest/1000",
              mainQuestId: "1000",
              title: "浮世浮生千岩间",
              type: "archon_quest",
              chapter: "第一章",
              series: "1001",
              completeness: "complete",
              locale: u.searchParams.get("locale") ?? "zh-CN",
              documentId: "quest/1000/locale/zh-CN",
              revision: "preview:1",
              match: "preview_build",
            },
          ],
        },
      });
    if (u.pathname === "/api/admin/previews/b1/quests/quest%2F1000")
      return route.fulfill({
        json: {
          preview: true,
          buildId: "b1",
          candidateId: "c1",
          quest: {
            questKey: "quest/1000",
            mainQuestId: "1000",
            title: "浮世浮生千岩间",
            type: "archon_quest",
            chapter: "第一章",
            series: "1001",
            completeness: "complete",
            locale: u.searchParams.get("locale") ?? "zh-CN",
            documentId: "quest/1000/locale/zh-CN",
            revision: "preview:1",
            gameVersion: "7.0.0",
            subquests: [
              {
                subquestKey: "quest/1000/subquest/100000",
                subquestId: "100000",
                title: "前往璃月港",
                objective: "前往璃月港",
                order: 1,
                completeness: "complete",
              },
            ],
            dialogueNodes: [
              {
                nodeKey: "quest/1000/dialog/100001",
                nodeId: "100001",
                type: "dialogue",
                speakerName: "派蒙",
                body: "预发布任务台词",
                order: 1,
              },
            ],
            dialogueEdges: [],
            participants: [{ id: "e1", sourceKey: "npc/1005", name: "派蒙", type: "npc" }],
            prerequisites: [],
            citations: [
              {
                documentId: "quest/1000/locale/zh-CN",
                locale: "zh-CN",
                questKey: "quest/1000",
                dialogueNodeKey: "quest/1000/dialog/100001",
                revision: "preview:1",
              },
            ],
            warnings: [],
            nextCursor: null,
          },
        },
      });
    if (
      u.pathname.includes("/previews/b1/") &&
      (u.pathname.endsWith("/records") ||
        u.pathname.endsWith("/entities") ||
        u.pathname.endsWith("/documents"))
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
        json: u.pathname.endsWith("/records")
          ? {
              records: payload.map((record) => ({ ...record, displayKind: "entity" })),
              total: 51,
            }
          : u.pathname.endsWith("/entities")
            ? { entities: payload, total: 51 }
            : { documents: payload, total: 51 },
      });
    }
    if (u.pathname === "/api/admin/release-candidates")
      return route.fulfill({ json: { candidates: [candidate] } });
    if (u.pathname === "/api/admin/release-candidates/c1")
      return route.fulfill({ json: { candidate } });
    if (u.pathname === "/api/admin/release-candidates/c1/readiness")
      return route.fulfill({
        json: {
          candidateId: "c1",
          buildId: "b1",
          contentChecksum: "a".repeat(64),
          ready: false,
          blockingReasons: [{ code: "review_issue_open", message: "Needs review" }],
        },
      });
    if (u.pathname === "/api/admin/release-candidates/c1/checks")
      return route.fulfill({ json: { checks: [] } });
    if (u.pathname === "/api/admin/revisions")
      return route.fulfill({
        json: {
          revisions: [
            {
              id: "r1",
              revisionNumber: 1,
              lifecycleStatus: "published",
              indexStatus: "ready",
              isCurrent: false,
              manifestId: "m1",
            },
          ],
        },
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
    if (u.pathname === "/api/admin/review-issues/i1/evidence")
      return route.fulfill({ json: { evidence: [] } });
    if (u.pathname === "/api/admin/imports")
      return route.fulfill({
        json: route.request().method() === "POST" ? { id: "import-1" } : { imports: [] },
      });
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
    await route.fallback();
  });
  await page.goto("/#preview/c1");
  await page.getByLabel("搜索预发布资料").fill("amber");
  await expect.poll(() => requested).toContain("q=amber");
});

test("预发布查看页可切换到剧情任务并读取 Build 内对话", async ({ page }) => {
  await mockApi(page);
  await page.goto("/#preview/c1");
  await page.getByRole("button", { name: "剧情任务" }).click();
  await expect(page.getByText("当前 Build 任务")).toBeVisible();
  await page.getByRole("button", { name: /浮世浮生千岩间/ }).click();
  await expect(page.getByText("预发布任务台词")).toBeVisible();
  await expect(page.getByText(/quest\/1000 · zh-CN · preview:1/)).toBeVisible();
});

test("从预发布详情报告问题并进入问题工作台", async ({ page }) => {
  await mockApi(page);
  let issueBody = "";
  await page.route("**/api/admin/release-candidates/c1/issues", async (route) => {
    issueBody = route.request().postData() ?? "";
    await route.fulfill({ json: { issue: { id: "i1" } } });
  });
  await page.goto("/#preview/c1");
  await page.getByRole("button", { name: "报告问题" }).click();
  await expect.poll(() => issueBody).toContain("canonicalKey");
  await expect(page).toHaveURL(/#admin\/issues\?/);
});

test("导入提交显示自动 Candidate 说明", async ({ page }) => {
  await mockApi(page);
  await page.goto("/#admin/intake");
  await page.getByLabel("选择游戏").selectOption("g1");
  await page.getByLabel("选择数据来源").selectOption("s1");
  await page.getByPlaceholder(/例如 F:/).fill("/tmp/data");
  await page.getByRole("button", { name: "创建导入任务" }).click();
  await expect(page.getByRole("status")).toContainText("导入任务已创建：import-1");
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
    await route.fulfill({
      json: {
        patch: { id: "p1" },
        build: { id: "b2", buildNumber: 2, status: "ready", recordCount: 51 },
      },
    });
  });
  await page.goto("/#admin/issues");
  await page.getByLabel("说明 k1").fill("verified");
  await page.getByLabel("核对版本 k1").fill("7.0");
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name: "evidence.png", mimeType: "image/png", buffer: Buffer.from("png") });
  await page.getByRole("button", { name: "上传截图证据" }).click();
  await expect.poll(() => evidenceBody).toContain("dataBase64");
  await page.getByRole("button", { name: "生成 Patch 与 Build N+1" }).click();
  await expect.poll(() => patchBody).toContain("issueId");
  await expect(page).toHaveURL(/#preview\/c1\/b2/);
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
  await page.getByRole("button", { name: "切换到此 Revision" }).click();
  await expect.poll(() => body).toContain("安全回退");
});

test("剧情阅读器可搜索任务并分页读取对话", async ({ page }) => {
  await mockApi(page);
  await page.goto("/#quests");
  await expect(page.getByRole("heading", { name: "剧情任务阅读器" })).toBeVisible();
  await page.getByLabel("搜索任务").fill("岩神");
  await page.getByRole("button", { name: "搜索任务" }).click();
  await page.getByRole("button", { name: /浮世浮生千岩间/ }).click();
  await expect(page.getByText("要寻找岩神的话，一年里只有这一次机会。")).toBeVisible();
  await page.getByRole("button", { name: "读取下一页对话" }).click();
  await expect(page.getByText("下一页台词")).toBeVisible();
});
