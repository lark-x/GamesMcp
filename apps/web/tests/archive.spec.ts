import { test, expect } from "@playwright/test";

const gameId = "00000000-0000-0000-0000-000000000001";

function baseGames() {
  return { games: [{ id: gameId, name: "崩坏：星穹铁道", status: "active" }] };
}

test.describe("Story Browser (S01 - S07)", () => {
  test("S01: 剧情档案分层目录、正文、Deep Link 与 Inspector 引用跳转", async ({ page }) => {
    await page.route("**/api/**", async (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === "/api/games") return route.fulfill({ json: baseGames() });
      if (u.pathname === `/api/games/${gameId}/quests`) {
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
      }
      if (u.pathname === `/api/games/${gameId}/quests/quest%2F1000`) {
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
              ],
              dialogueEdges: [],
              participants: [{ id: "e1", sourceKey: null, name: "三月七", type: "character" }],
              prerequisites: ["序章·第三幕"],
              citations: [
                {
                  documentId: "d-quest-1000",
                  locale: "zh-CN",
                  questKey: "quest/1000",
                  dialogueNodeKey: "q1000-n2",
                  sourceName: "TurnBasedGameData",
                  revision: "r1",
                },
              ],
              warnings: [],
              nextCursor: null,
            },
          },
        });
      }
      if (u.pathname === `/api/games/${gameId}/sources`) {
        return route.fulfill({ json: { sources: [] } });
      }
      return route.fulfill({ json: {} });
    });

    await page.goto(`/#story/${encodeURIComponent("quest/1000")}`);
    await expect(page.getByRole("heading", { name: "于枯索的冬夜里" })).toBeVisible();
    await expect(page.getByText("风雪没有停止。")).toBeVisible();
    await expect(page.locator(".story-speaker", { hasText: "三月七" })).toBeVisible();

    // Inspector checks: participants, prerequisites, successors, citations
    await expect(page.getByText("序章·第三幕")).toBeVisible();
    await expect(page.getByText("暂无后续任务数据")).toBeVisible();
    await expect(page.getByText("暂无地点数据")).toBeVisible();

    // Expand citations and click to jump
    const citationHeader = page.getByText(/引用依据 \d+ 条/);
    await citationHeader.scrollIntoViewIfNeeded();
    await expect(citationHeader).toBeVisible();
    await page.getByRole("button", { name: "展开引用" }).click();
    await expect(page.getByText("定位正文台词").first()).toBeVisible();
    await page.getByText("定位正文台词").first().click();
    await expect(page.locator(".story-node.is-highlight")).toBeVisible();

    // Deep link url preserved
    await expect(page).toHaveURL(/#story%2Fquest%2F1000|#story\/quest%2F1000/);
  });

  test("S02: Story 目录分层折叠与搜索过滤", async ({ page }) => {
    await page.route("**/api/**", async (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === "/api/games") return route.fulfill({ json: baseGames() });
      if (u.pathname === `/api/games/${gameId}/quests`) {
        const q = u.searchParams.get("q") ?? "";
        const all = [
          {
            questKey: "quest/1000",
            mainQuestId: "1000",
            title: "于枯索的冬夜里",
            type: "archon_quest",
            chapter: "第一章",
            series: "开拓任务",
            completeness: "complete",
            locale: "zh-CN",
            documentId: "d-1000",
            revision: "r1",
          },
          {
            questKey: "quest/2000",
            mainQuestId: "2000",
            title: "只是个孩子",
            type: "story_quest",
            chapter: "",
            series: "同行任务",
            completeness: "complete",
            locale: "zh-CN",
            documentId: "d-2000",
            revision: "r1",
          },
        ];
        const filtered = q ? all.filter((item) => item.title.includes(q)) : all;
        return route.fulfill({ json: { quests: filtered } });
      }
      return route.fulfill({ json: {} });
    });

    await page.goto("/#story");
    // Verify tree series headers
    await expect(page.getByRole("button", { name: /开拓任务/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /同行任务/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "于枯索的冬夜里" })).toBeVisible();
    await expect(page.getByRole("button", { name: "只是个孩子" })).toBeVisible();

    // Toggle collapse
    await page.getByRole("button", { name: /开拓任务/ }).click();
    await expect(page.getByRole("button", { name: "于枯索的冬夜里" })).not.toBeVisible();
    await page.getByRole("button", { name: /开拓任务/ }).click();
    await expect(page.getByRole("button", { name: "于枯索的冬夜里" })).toBeVisible();

    // Search query
    await page.getByPlaceholder("任务名、章节、台词…").fill("孩子");
    await page.getByPlaceholder("任务名、章节、台词…").press("Enter");
    await expect(page.getByRole("button", { name: "只是个孩子" })).toBeVisible();
    await expect(page.getByRole("button", { name: "于枯索的冬夜里" })).not.toBeVisible();
  });

  test("S03: Story 语言切换与同步", async ({ page }) => {
    let requestedLocale = "";
    await page.route("**/api/**", async (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === "/api/games") return route.fulfill({ json: baseGames() });
      if (u.pathname === `/api/games/${gameId}/quests`) {
        requestedLocale = u.searchParams.get("locale") ?? "";
        return route.fulfill({
          json: {
            quests: [
              {
                questKey: "quest/1000",
                mainQuestId: "1000",
                title:
                  requestedLocale === "en" ? "In the Withering Winter Night" : "于枯索的冬夜里",
                type: "archon_quest",
                chapter: "第一章",
                series: "开拓任务",
                completeness: "complete",
                locale: requestedLocale,
                documentId: "d-1000",
                revision: "r1",
              },
            ],
          },
        });
      }
      if (u.pathname === `/api/games/${gameId}/quests/quest%2F1000`) {
        return route.fulfill({
          json: {
            quest: {
              questKey: "quest/1000",
              mainQuestId: "1000",
              title: requestedLocale === "en" ? "In the Withering Winter Night" : "于枯索的冬夜里",
              type: "archon_quest",
              completeness: "complete",
              locale: requestedLocale,
              documentId: "d-1000",
              revision: "r1",
              dialogueNodes: [
                {
                  nodeKey: "n1",
                  nodeId: 1,
                  type: "dialogue",
                  body: requestedLocale === "en" ? "The snow never stopped." : "风雪没有停止。",
                },
              ],
              dialogueEdges: [],
              participants: [],
              prerequisites: [],
              citations: [],
              warnings: [],
              nextCursor: null,
            },
          },
        });
      }
      return route.fulfill({ json: {} });
    });

    await page.goto(`/#story/${encodeURIComponent("quest/1000")}`);
    await expect(page.getByText("风雪没有停止。")).toBeVisible();

    // Switch language to English
    await page.getByLabel("任务语言").selectOption("en");
    await expect(page.getByText("The snow never stopped.")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "In the Withering Winter Night" }),
    ).toBeVisible();
  });

  test("S05: Story 正文 Cursor 加载更多", async ({ page }) => {
    await page.route("**/api/**", async (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === "/api/games") return route.fulfill({ json: baseGames() });
      if (u.pathname === `/api/games/${gameId}/quests`) {
        return route.fulfill({
          json: {
            quests: [
              {
                questKey: "quest/1000",
                mainQuestId: "1000",
                title: "长线任务",
                type: "archon_quest",
                completeness: "complete",
                locale: "zh-CN",
                documentId: "d-1",
                revision: "r1",
              },
            ],
          },
        });
      }
      if (u.pathname === `/api/games/${gameId}/quests/quest%2F1000`) {
        const cursor = u.searchParams.get("cursor");
        if (!cursor) {
          return route.fulfill({
            json: {
              quest: {
                questKey: "quest/1000",
                mainQuestId: "1000",
                title: "长线任务",
                type: "archon_quest",
                completeness: "complete",
                locale: "zh-CN",
                documentId: "d-1",
                revision: "r1",
                totalDialogueNodes: 2,
                loadedDialogueNodes: 1,
                dialogueNodes: [
                  { nodeKey: "n1", nodeId: 1, type: "narration", body: "第一段台词" },
                ],
                dialogueEdges: [],
                participants: [],
                prerequisites: [],
                citations: [],
                warnings: [],
                nextCursor: "cursor_p2",
              },
            },
          });
        } else {
          return route.fulfill({
            json: {
              quest: {
                questKey: "quest/1000",
                mainQuestId: "1000",
                title: "长线任务",
                type: "archon_quest",
                completeness: "complete",
                locale: "zh-CN",
                documentId: "d-1",
                revision: "r1",
                totalDialogueNodes: 2,
                loadedDialogueNodes: 2,
                dialogueNodes: [
                  { nodeKey: "n2", nodeId: 2, type: "narration", body: "第二段续接台词" },
                ],
                dialogueEdges: [],
                participants: [],
                prerequisites: [],
                citations: [],
                warnings: [],
                nextCursor: null,
              },
            },
          });
        }
      }
      return route.fulfill({ json: {} });
    });

    await page.goto(`/#story/${encodeURIComponent("quest/1000")}`);
    await expect(page.getByText("第一段台词")).toBeVisible();
    await expect(page.getByRole("button", { name: "加载更多正文" })).toBeEnabled();

    await page.getByRole("button", { name: "加载更多正文" }).click();
    await expect(page.getByText("第二段续接台词")).toBeVisible();
    await expect(page.getByText("第一段台词")).toBeVisible();
    await expect(page.getByRole("button", { name: "已到正文末尾" })).toBeDisabled();
  });

  test("S06 & S07: Story 上一任务 / 下一任务 与 浏览器后退同步", async ({ page }) => {
    await page.route("**/api/**", async (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === "/api/games") return route.fulfill({ json: baseGames() });
      if (u.pathname === `/api/games/${gameId}/quests`) {
        return route.fulfill({
          json: {
            quests: [
              {
                questKey: "quest/1",
                mainQuestId: "1",
                title: "寒潮的另一面",
                type: "archon_quest",
                series: "开拓任务",
                completeness: "complete",
                locale: "zh-CN",
                documentId: "d-1",
                revision: "r1",
              },
              {
                questKey: "quest/2",
                mainQuestId: "2",
                title: "长夜终尽",
                type: "archon_quest",
                series: "开拓任务",
                completeness: "complete",
                locale: "zh-CN",
                documentId: "d-2",
                revision: "r1",
              },
            ],
          },
        });
      }
      if (u.pathname.includes("/quests/quest%2F1")) {
        return route.fulfill({
          json: {
            quest: {
              questKey: "quest/1",
              title: "寒潮的另一面",
              type: "archon_quest",
              completeness: "complete",
              locale: "zh-CN",
              documentId: "d-1",
              revision: "r1",
              dialogueNodes: [
                { nodeKey: "n1", nodeId: 1, type: "narration", body: "雪原深处的声音" },
              ],
              dialogueEdges: [],
              participants: [],
              prerequisites: [],
              citations: [],
              warnings: [],
            },
          },
        });
      }
      if (u.pathname.includes("/quests/quest%2F2")) {
        return route.fulfill({
          json: {
            quest: {
              questKey: "quest/2",
              title: "长夜终尽",
              type: "archon_quest",
              completeness: "complete",
              locale: "zh-CN",
              documentId: "d-2",
              revision: "r1",
              dialogueNodes: [
                { nodeKey: "n2", nodeId: 2, type: "narration", body: "黎明终将到来" },
              ],
              dialogueEdges: [],
              participants: [],
              prerequisites: [],
              citations: [],
              warnings: [],
            },
          },
        });
      }
      return route.fulfill({ json: {} });
    });

    await page.goto(`/#story/${encodeURIComponent("quest/1")}`);
    await expect(page.getByRole("heading", { name: "寒潮的另一面" })).toBeVisible();
    await expect(page.getByText("雪原深处的声音")).toBeVisible();
    await expect(page.getByRole("button", { name: "← 上一任务" })).toBeDisabled();

    // Click Next quest
    await page.getByRole("button", { name: "下一任务 →" }).click();
    await expect(page.getByRole("heading", { name: "长夜终尽" })).toBeVisible();
    await expect(page.getByText("黎明终将到来")).toBeVisible();

    // Browser back
    await page.goBack();
    await expect(page.getByRole("heading", { name: "寒潮的另一面" })).toBeVisible();
    await expect(page.getByText("雪原深处的声音")).toBeVisible();
  });
});

test.describe("Material Browser (M01 - M07)", () => {
  test("M01 - M05: 材料分类、列表、搜索、详情与 Deep Link", async ({ page }) => {
    await page.route("**/api/**", async (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === "/api/games") return route.fulfill({ json: baseGames() });
      if (u.pathname === `/api/games/${gameId}/codex/materials`) {
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
                description: "宇宙通用货币。",
                sources: ["任务奖励"],
                usedBy: ["全角色"],
              },
            ],
          },
        });
      }
      if (u.pathname === `/api/games/${gameId}/codex/materials/material%2F1`) {
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
      }
      return route.fulfill({ json: {} });
    });

    await page.goto("/#archive/materials");
    await expect(page.getByText("梦之珠泪")).toBeVisible();
    await expect(page.getByText("信用点")).toBeVisible();

    // Search by source "模拟宇宙"
    await page.getByPlaceholder("搜索材料名称、用途、来源…").fill("模拟宇宙");
    await expect(page.getByText("梦之珠泪")).toBeVisible();
    await expect(page.getByText("信用点")).not.toBeVisible();

    // Clear search
    await page.getByPlaceholder("搜索材料名称、用途、来源…").fill("");

    // Click item for detail
    await page.getByRole("listitem").filter({ hasText: "梦之珠泪" }).click();
    await expect(page.getByText("传说中凝结晶泪的珠子。")).toBeVisible();
    await expect(page.locator(".material-source-list").getByText("模拟宇宙")).toBeVisible();

    // Deep link directly
    await page.goto("/#archive/materials/material%2F1");
    await expect(page.getByText("传说中凝结晶泪的珠子。")).toBeVisible();
  });

  test("M06: 材料跨 100 条分页导航", async ({ page }) => {
    await page.route("**/api/**", async (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === "/api/games") return route.fulfill({ json: baseGames() });
      if (u.pathname === `/api/games/${gameId}/codex/materials`) {
        const offset = Number(u.searchParams.get("offset") ?? "0");
        if (offset === 0) {
          // 100 items on page 1
          const items = Array.from({ length: 100 }, (_, i) => ({
            stableId: `mat/${i + 1}`,
            name: `材料_${i + 1}`,
            category: "consumable",
            rarity: 3,
            description: `材料描述 ${i + 1}`,
            sources: [],
            usedBy: [],
          }));
          return route.fulfill({ json: { gameId, materials: items } });
        } else {
          // Page 2: item 101 to 105
          const items = Array.from({ length: 5 }, (_, i) => ({
            stableId: `mat/${offset + i + 1}`,
            name: `第101条之后材料_${offset + i + 1}`,
            category: "consumable",
            rarity: 4,
            description: "远超100条的材料",
            sources: [],
            usedBy: [],
          }));
          return route.fulfill({ json: { gameId, materials: items } });
        }
      }
      return route.fulfill({ json: {} });
    });

    await page.goto("/#archive/materials");
    await expect(page.getByText("材料_1", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /上一页/ })).toBeDisabled();
    await expect(page.getByRole("button", { name: /下一页/ })).toBeEnabled();

    // Navigate to page 2
    await page.getByRole("button", { name: /下一页/ }).click();
    await expect(page.getByText("第101条之后材料_101")).toBeVisible();
    await expect(page.getByText("材料_1", { exact: true })).not.toBeVisible();
    await expect(page.getByRole("button", { name: /上一页/ })).toBeEnabled();
  });

  test("M07: 材料请求失败真正重试", async ({ page }) => {
    let attempts = 0;
    await page.route("**/api/**", async (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === "/api/games") return route.fulfill({ json: baseGames() });
      if (u.pathname === `/api/games/${gameId}/codex/materials`) {
        attempts++;
        if (attempts === 1) {
          return route.fulfill({ status: 500, json: { error: "Network error" } });
        }
        return route.fulfill({
          json: {
            gameId,
            materials: [
              {
                stableId: "mat/recovered",
                name: "重试成功恢复的材料",
                category: "consumable",
                rarity: 3,
                description: "说明重试发起了真实网络请求",
                sources: [],
                usedBy: [],
              },
            ],
          },
        });
      }
      return route.fulfill({ json: {} });
    });

    await page.goto("/#archive/materials");
    await expect(page.getByText("资料加载失败")).toBeVisible();

    // Click retry
    await page.getByRole("button", { name: "重试" }).click();
    await expect(page.getByText("重试成功恢复的材料")).toBeVisible();
    expect(attempts).toBeGreaterThanOrEqual(2);
  });
});

test.describe("Text Browser (T01 - T06)", () => {
  test("T01 - T05: 书籍目录、正文、真实下一章文本、第二卷 Deep Link 与搜索", async ({ page }) => {
    await page.route("**/api/**", async (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === "/api/games") return route.fulfill({ json: baseGames() });
      if (u.pathname === `/api/games/${gameId}/text/books`) {
        return route.fulfill({
          json: {
            gameId,
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
                    segmentCount: 1,
                  },
                  {
                    stableId: "volume/2",
                    bookStableId: "book/heta",
                    documentId: "doc-2",
                    title: "第二卷",
                    volume: 2,
                    segmentCount: 1,
                  },
                ],
              },
              {
                stableId: "book/belobog",
                bookStableId: "book/belobog",
                title: "贝洛伯格编年史",
                volumes: [
                  {
                    stableId: "vol/b1",
                    bookStableId: "book/belobog",
                    documentId: "doc-b1",
                    title: "筑城纪元",
                    volume: 1,
                    segmentCount: 1,
                  },
                ],
              },
            ],
          },
        });
      }
      if (u.pathname === `/api/games/${gameId}/documents/doc-1`) {
        return route.fulfill({
          json: {
            document: {
              id: "doc-1",
              title: "黑塔研究图鉴 · 第一卷",
              type: "book",
              sourceName: "TurnBasedGameData",
              segments: [
                {
                  id: "seg-1",
                  body: "黑塔空间站由天才俱乐部成员黑塔主持建立。",
                },
              ],
            },
          },
        });
      }
      if (u.pathname === `/api/games/${gameId}/documents/doc-2`) {
        return route.fulfill({
          json: {
            document: {
              id: "doc-2",
              title: "黑塔研究图鉴 · 第二卷",
              type: "book",
              sourceName: "TurnBasedGameData",
              segments: [
                {
                  id: "seg-2",
                  body: "奇物是具有特殊效应的未知遗物，需存入封闭收容仓。",
                },
              ],
            },
          },
        });
      }
      return route.fulfill({ json: {} });
    });

    // T01: First chapter
    await page.goto("/#text/books");
    await expect(page.locator(".text-reader-header h2")).toContainText("黑塔研究图鉴 · 第一卷");
    await expect(page.getByText("黑塔空间站由天才俱乐部成员黑塔主持建立。")).toBeVisible();
    await expect(page.getByText("1 / 3")).toBeVisible();

    // T02: Next chapter - real body assertion for doc-2
    await page.getByRole("button", { name: /下一章/ }).click();
    await expect(page.getByText("奇物是具有特殊效应的未知遗物，需存入封闭收容仓。")).toBeVisible();

    // T05: Browser back
    await page.goBack();
    await expect(page.getByText("黑塔空间站由天才俱乐部成员黑塔主持建立。")).toBeVisible();

    // T04: Search books
    await page.getByPlaceholder("搜索书名、卷名…").fill("贝洛伯格");
    await expect(page.locator(".text-catalog").getByText("贝洛伯格编年史")).toBeVisible();
    await expect(page.locator(".text-catalog").getByText("黑塔研究图鉴")).not.toBeVisible();

    // T03: Deep Link Volume 2 directly
    await page.goto(`/#text/books/book%2Fheta/volume%2F2`);
    await expect(page.getByText("奇物是具有特殊效应的未知遗物，需存入封闭收容仓。")).toBeVisible();
  });

  test("T06: 文本正文失败真正重试", async ({ page }) => {
    let docAttempts = 0;
    await page.route("**/api/**", async (route) => {
      const u = new URL(route.request().url());
      if (u.pathname === "/api/games") return route.fulfill({ json: baseGames() });
      if (u.pathname === `/api/games/${gameId}/text/books`) {
        return route.fulfill({
          json: {
            gameId,
            books: [
              {
                stableId: "book/1",
                bookStableId: "book/1",
                title: "星穹铁道速成指南",
                volumes: [
                  {
                    stableId: "vol/1",
                    bookStableId: "book/1",
                    documentId: "doc-err",
                    title: "第一章",
                    volume: 1,
                  },
                ],
              },
            ],
          },
        });
      }
      if (u.pathname === `/api/games/${gameId}/documents/doc-err`) {
        docAttempts++;
        if (docAttempts === 1) {
          return route.fulfill({ status: 500, json: { error: "Failed to fetch document" } });
        }
        return route.fulfill({
          json: {
            document: {
              id: "doc-err",
              title: "星穹铁道速成指南",
              sourceName: "TurnBasedGameData",
              segments: [{ id: "s1", body: "列车正穿梭在银河之间。" }],
            },
          },
        });
      }
      return route.fulfill({ json: {} });
    });

    await page.goto("/#text/books");
    await expect(page.getByText("资料加载失败")).toBeVisible();

    // Click retry
    await page.getByRole("button", { name: "重试" }).click();
    await expect(page.getByText("列车正穿梭在银河之间。")).toBeVisible();
    expect(docAttempts).toBeGreaterThanOrEqual(2);
  });
});
