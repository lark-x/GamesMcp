import { test, expect, type Page } from "@playwright/test";

const gameId = "00000000-0000-0000-0000-000000000001";
const travelerId = "00000000-0000-0000-0000-000000000002";
const paimonId = "00000000-0000-0000-0000-000000000003";
const documentId = "00000000-0000-0000-0000-000000000004";
const segmentId = "00000000-0000-0000-0000-000000000005";
const batchId = "00000000-0000-0000-0000-000000000006";
const revisionOne = "00000000-0000-0000-0000-000000000007";
const revisionTwo = "00000000-0000-0000-0000-000000000008";
const sourceId = "00000000-0000-0000-0000-000000000009";

const game = {
  id: gameId,
  slug: "genshin-impact",
  name: "原神",
  status: "active",
  currentRevision: "r1",
};
const documentSummary = {
  id: documentId,
  sourceKey: "lore/first-steps",
  title: "踏入提瓦特",
  type: "lore",
  gameVersion: "fixture",
  revision: "r1",
};
const detailDocument = {
  ...documentSummary,
  body: "旅行者在提瓦特寻找失散的血亲，并与派蒙一起踏上旅程。",
  sourceName: "Fixture",
  sourceId,
  provenance: {
    datasetRevision: "r1",
    sourceSnapshotId: "00000000-0000-0000-0000-000000000013",
    upstreamSource: "Fixture/Source",
    upstreamCommit: "fixture-commit",
    upstreamVersionLabel: "fixture-7.0.0",
    locale: "zh-CN",
    canonicalKey: "book/fixture",
    sourceFiles: ["ExcelBinOutput/Fixture.json"],
    upstreamIds: { documentId: 1001 },
    textMapHashes: { title: 1001, body: [1002] },
    rawContentHash: "raw-hash",
    normalizedContentHash: "normalized-hash",
    transforms: ["fixture transform"],
  },
  segments: [
    {
      id: segmentId,
      ordinal: 0,
      headingPath: [],
      body: "旅行者在提瓦特寻找失散的血亲，并与派蒙一起踏上旅程。",
      startOffset: 0,
      endOffset: 31,
      mentions: [
        { entityId: travelerId, name: "旅行者", startOffset: 0, endOffset: 3 },
        { entityId: paimonId, name: "派蒙", startOffset: 18, endOffset: 20 },
      ],
    },
  ],
};
const detailEntity = {
  id: travelerId,
  sourceKey: "entities/traveler",
  gameId,
  name: "旅行者",
  type: "character",
  summary: "从世界之外来到提瓦特的旅行者。",
  aliases: ["Traveler"],
  properties: { element: "variable" },
  deleted: false,
  revision: "r1",
  relationships: [
    {
      id: "00000000-0000-0000-0000-000000000010",
      subjectId: travelerId,
      subjectName: "旅行者",
      predicate: "related_to",
      objectId: paimonId,
      objectName: "派蒙",
      revision: "r1",
    },
  ],
  documents: [documentSummary],
  claims: [
    {
      id: "00000000-0000-0000-0000-000000000011",
      statement: "旅行者在提瓦特寻找失散的血亲。",
      status: "confirmed",
      confidence: 0.95,
      evidence: [
        {
          id: "00000000-0000-0000-0000-000000000012",
          documentId,
          documentTitle: "踏入提瓦特",
          segmentId,
          quote: "旅行者在提瓦特寻找失散的血亲",
        },
      ],
    },
  ],
};

async function mockApi(page: Page) {
  let currentBatch = {
    id: batchId,
    gameId,
    sourceId,
    sourceSnapshotId: "00000000-0000-0000-0000-000000000013",
    status: "review_required",
    parserVersion: "1.0.0",
    successCount: 3,
    failureCount: 0,
    errors: [],
    warnings: [],
    diff: {
      added: ["lore/new"],
      modified: ["lore/first-steps"],
      deletionCandidates: ["lore/legacy"],
      unchanged: ["entities/traveler"],
      conflicts: [],
      unparsed: [],
    },
  };
  let revisions = [
    {
      id: revisionOne,
      gameId,
      revisionNumber: 1,
      releaseNote: "Fixture 发布",
      isCurrent: true,
      indexStatus: "ready",
    },
  ];
  let sources: Array<typeof source> = [];
  const source = {
    id: sourceId,
    gameId,
    name: "Fixture 来源",
    type: "local_json",
    pathLabel: "fixture.json",
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const pathname = new URL(request.url()).pathname;
    const json = (value: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (method === "GET" && pathname === "/api/games") return json({ games: [game] });
    if (method === "GET" && pathname === "/api/ready")
      return json({ status: "ready", currentRevision: "r1", searchIndex: "ready" });
    if (method === "GET" && pathname.endsWith("/sources")) return json({ sources: [source] });
    if (method === "GET" && pathname.endsWith("/documents"))
      return json({ documents: [documentSummary] });
    if (method === "GET" && pathname.endsWith("/entities"))
      return json({ entities: [detailEntity] });
    if (method === "GET" && pathname.includes(`/documents/${documentId}`))
      return json({ document: detailDocument });
    if (method === "GET" && pathname.includes(`/entities/${travelerId}`))
      return json({ entity: detailEntity });
    if (method === "POST" && pathname.endsWith("/search")) {
      return json({
        entities: [detailEntity],
        documents: [documentSummary],
        segments: [
          {
            ...documentSummary,
            segmentId,
            snippet: detailDocument.segments[0].body,
            match: "segment_contains",
          },
        ],
        revision: "r1",
        revisionId: revisionOne,
        indexStatus: "ready",
      });
    }
    if (method === "POST" && pathname.endsWith("/qa")) {
      return json({
        answer: "旅行者在提瓦特寻找失散的血亲。[S1]",
        confidence: "high",
        citations: [
          {
            documentId,
            sourceKey: "lore/first-steps",
            documentTitle: "踏入提瓦特",
            segmentId,
            quote: "旅行者在提瓦特寻找失散的血亲",
            sourceName: "Fixture",
            gameVersion: "fixture",
            datasetRevision: "r1",
          },
        ],
        relatedEntities: [{ id: travelerId, name: "旅行者", type: "character" }],
        datasetRevision: "r1",
        warnings: [],
      });
    }
    if (method === "GET" && pathname === "/api/admin/sources") return json({ sources });
    if (method === "GET" && pathname === "/api/admin/imports") return json({ imports: [] });
    if (method === "GET" && pathname === "/api/admin/conflicts") return json({ conflicts: [] });
    if (method === "POST" && pathname === "/api/admin/sources") {
      sources = [source];
      return json(source);
    }
    if (method === "POST" && pathname === "/api/admin/imports") return json(currentBatch);
    if (method === "GET" && pathname === `/api/admin/imports/${batchId}`) return json(currentBatch);
    if (method === "GET" && pathname === `/api/admin/imports/${batchId}/diff`)
      return json({
        batchId,
        status: currentBatch.status,
        diff: currentBatch.diff,
        errors: [],
        warnings: [],
      });
    if (method === "GET" && pathname === `/api/admin/imports/${batchId}/verification`)
      return json(
        {
          error: { code: "verification_run_not_found", message: "Verification run was not found" },
        },
        404,
      );
    if (method === "POST" && pathname === `/api/admin/imports/${batchId}/review`) {
      currentBatch = { ...currentBatch, status: "review_required" };
      return json(currentBatch);
    }
    if (method === "POST" && pathname === `/api/admin/imports/${batchId}/publish`) {
      currentBatch = { ...currentBatch, status: "published" };
      revisions = [
        {
          id: revisionTwo,
          gameId,
          revisionNumber: 2,
          releaseNote: "Web 管理界面发布",
          isCurrent: true,
          indexStatus: "pending",
        },
        { ...revisions[0], isCurrent: false },
      ];
      return json(revisions[0]);
    }
    if (method === "GET" && pathname === "/api/admin/revisions") return json({ revisions });
    if (method === "POST" && pathname.includes("/rollback")) {
      revisions = revisions.map((revision) => ({
        ...revision,
        isCurrent: revision.id === revisionOne,
      }));
      return json(revisions[1]);
    }
    if (method === "GET" && pathname === "/api/admin/jobs")
      return json({
        jobs: [{ id: "job-1", type: "rebuild_search", status: "completed", attempts: 1 }],
      });
    return json({});
  });
}

test("completes search, entity, document, QA and admin release flow", async ({ page }) => {
  await mockApi(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "原神叙事知识库" })).toBeVisible();
  await page.getByLabel("搜索知识库").fill("旅行者");
  await page.getByRole("button", { name: "检索" }).click();
  await expect(page.getByRole("button", { name: /旅行者/ }).first()).toBeVisible();
  await page
    .getByRole("button", { name: /旅行者/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "旅行者" })).toBeVisible();
  await page
    .getByRole("button", { name: /踏入提瓦特/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "踏入提瓦特" })).toBeVisible();
  await page.getByText("查看完整出处").click();
  await expect(page.getByText("book/fixture")).toBeVisible();
  await expect(page.getByText("fixture-commit")).toBeVisible();
  await page.getByLabel("问答问题").fill("旅行者");
  await page.getByRole("button", { name: "基于证据回答" }).click();
  await expect(page.getByText("旅行者在提瓦特寻找失散的血亲。[S1]")).toBeVisible();
  await page.getByRole("button", { name: /\[S1\] 踏入提瓦特/ }).click();
  await expect(page.locator(`[id="${segmentId}"]`)).toHaveClass(/is-active/);

  await page.getByRole("button", { name: "打开数据管理" }).click();
  await page.getByPlaceholder("本地文件或目录路径").fill("/private/fixture.json");
  await page.getByRole("button", { name: "导入并生成 Diff" }).click();
  await expect(page.getByText("lore/legacy")).toBeVisible();
  await page.locator(".deletion-row input").check();
  await page.getByRole("button", { name: "审核当前 Diff" }).click();
  await expect(page.getByRole("status")).toHaveText("审核完成：review_required");
  await page.getByRole("button", { name: "发布版本" }).click();
  await expect(page.getByText(/发布成功：r2/)).toBeVisible();
  await expect(page.getByText("回滚到此版本")).toBeVisible();
});

async function mockAcquisitionApi(page: Page) {
  const acquisitionBatchId = "00000000-0000-0000-0000-000000000006";
  const verificationRunId = "00000000-0000-0000-0000-000000000014";
  const verificationItemId = "00000000-0000-0000-0000-000000000015";
  const conflictId = "00000000-0000-0000-0000-000000000016";
  const sourceSnapshotId = "00000000-0000-0000-0000-000000000013";
  let conflictOpen = true;
  const source = {
    id: sourceId,
    gameId,
    name: "AnimeGameData",
    type: "local_json",
    pathLabel: "books.json",
  };
  const batch = {
    id: acquisitionBatchId,
    gameId,
    sourceId,
    sourceSnapshotId,
    status: "review_required",
    parserVersion: "anime-game-data-import-1.0.0",
    successCount: 288,
    failureCount: 0,
    createdAt: "2026-08-30T00:00:01.000Z",
    errors: [],
    warnings: [],
    diff: {
      added: [],
      modified: [],
      deletionCandidates: [],
      unchanged: [],
      conflicts: [],
      unparsed: [],
    },
  };
  const verification = {
    id: verificationRunId,
    batchId: acquisitionBatchId,
    upstreamCommit: "26df1dfbdf05a82bbb1d97506859f3e1c40718d8",
    expectedGameVersion: "7.0.0",
    expectedLocale: "zh-CN",
    seed: "26df1dfbdf05a82bbb1d97506859f3e1c40718d8",
    status: "pending",
    items: [
      {
        id: verificationItemId,
        runId: verificationRunId,
        category: "book",
        canonicalKey: "book/verification",
        title: "测试卷册",
        body: "测试正文",
        sourceId,
        sourceSnapshotId,
        gameVersion: "7.0.0",
        locale: "zh-CN",
        provenance: {
          canonicalKey: "book/verification",
          upstreamCommit: "fixture-commit",
          upstreamVersionLabel: "fixture-7.0.0",
          sourceFiles: ["ExcelBinOutput/Verification.json"],
          upstreamIds: { documentId: 2001 },
          textMapHashes: { title: 2001, body: [2002] },
          rawContentHash: "raw-verification",
          normalizedContentHash: "normalized-verification",
          transforms: ["fixture transform"],
        },
        status: "not_checked",
        channel: null,
        checkedGameVersion: null,
        checkedLocale: null,
        note: null,
        required: true,
        screenshotCount: 0,
      },
      {
        id: "00000000-0000-0000-0000-000000000017",
        runId: verificationRunId,
        category: "book",
        canonicalKey: "book/second",
        title: "第二卷",
        body: "第二卷正文",
        sourceId,
        sourceSnapshotId,
        gameVersion: "7.0.0",
        locale: "zh-CN",
        provenance: {
          canonicalKey: "book/second",
          upstreamCommit: "fixture-commit",
          sourceFiles: ["ExcelBinOutput/Second.json"],
        },
        status: "not_checked",
        channel: null,
        checkedGameVersion: null,
        checkedLocale: null,
        note: null,
        required: true,
        screenshotCount: 0,
      },
    ],
  };
  const conflict = {
    id: conflictId,
    gameId,
    canonicalKey: "book/conflict",
    gameVersion: "7.0.0",
    locale: "zh-CN",
    kind: "content_conflict",
    status: "open",
    observationIds: ["00000000-0000-0000-0000-000000000018"],
    selectedObservationId: null,
    createdAt: new Date().toISOString(),
  };
  const conflictDetail = {
    ...conflict,
    observations: [
      {
        id: "00000000-0000-0000-0000-000000000018",
        sourceId,
        sourceSnapshotId,
        canonicalKey: conflict.canonicalKey,
        category: "book",
        gameVersion: "7.0.0",
        locale: "zh-CN",
        title: "冲突卷册",
        body: "冲突来源正文",
        rawContentHash: "raw-conflict",
        normalizedContentHash: "normalized-conflict",
        provenance: {
          upstreamCommit: "fixture-commit",
          sourceFiles: ["ExcelBinOutput/Conflict.json"],
        },
      },
    ],
  };

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const pathname = new URL(request.url()).pathname;
    const json = (value: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(value) });
    if (method === "GET" && pathname === "/api/games") return json({ games: [game] });
    if (method === "GET" && pathname === "/api/ready") return json({ status: "ready" });
    if (method === "GET" && pathname.endsWith("/documents")) return json({ documents: [] });
    if (method === "GET" && pathname.endsWith("/entities")) return json({ entities: [] });
    if (method === "GET" && pathname.endsWith("/sources")) return json({ sources: [source] });
    if (method === "GET" && pathname === "/api/admin/sources") return json({ sources: [source] });
    if (method === "GET" && pathname === "/api/admin/revisions") return json({ revisions: [] });
    if (method === "GET" && pathname === "/api/admin/jobs") return json({ jobs: [] });
    if (method === "GET" && pathname === "/api/admin/acquisition/status")
      return json({
        status: {
          generatedAt: "2026-08-30T00:00:00.000Z",
          conversion: {
            gameVersion: "7.0.0",
            locale: "zh-CN",
            accounting: {
              book: { discovered: 293, converted: 288, excluded: 5 },
            },
          },
          observations: {
            total: 4824,
            snapshots: 6,
            sourceCoverage: [
              {
                name: "AnimeGameData",
                category: "book",
                complete: true,
                latest: {
                  observedCount: 293,
                  expectedCount: 293,
                  coverage: 1,
                  missingCount: 0,
                  unexpectedCount: 0,
                },
              },
            ],
            integrity: { ok: true },
          },
          conflicts: { total: 2412, open: 0, resolved: 2412 },
          releaseGate: {
            ready: false,
            manifestComplete: true,
            sourceCoverageComplete: true,
            observationIntegrity: true,
            allSamplesProcessed: false,
            exactMatchPerCategory: { book: 0 },
            openConflicts: 0,
            conflictSelectionComplete: true,
            backupAvailable: true,
            backupAfterCurrentBatches: true,
            manualVerificationReady: false,
            blockingReasons: ["book:pending_30"],
          },
          latestBackup: { integrityValid: true, afterCurrentBatches: true },
        },
      });
    if (method === "GET" && pathname === "/api/admin/imports") return json({ imports: [batch] });
    if (method === "GET" && pathname === `/api/admin/imports/${acquisitionBatchId}`)
      return json(batch);
    if (method === "GET" && pathname === `/api/admin/imports/${acquisitionBatchId}/diff`)
      return json({
        batchId: acquisitionBatchId,
        status: batch.status,
        diff: batch.diff,
        errors: [],
        warnings: [],
      });
    if (method === "GET" && pathname === `/api/admin/imports/${acquisitionBatchId}/verification`)
      return json(verification);
    if (method === "GET" && pathname === "/api/admin/conflicts")
      return json({ conflicts: conflictOpen ? [conflict] : [] });
    if (method === "GET" && pathname === `/api/admin/conflicts/${conflictId}`)
      return json({ conflict: conflictDetail });
    if (method === "PATCH" && pathname.startsWith("/api/admin/verification/items/")) {
      const item = verification.items.find((candidate) => pathname.endsWith(candidate.id));
      if (item) Object.assign(item, JSON.parse(request.postData() ?? "{}"));
      return json(item ?? {});
    }
    if (
      method === "POST" &&
      pathname.startsWith("/api/admin/verification/items/") &&
      pathname.endsWith("/screenshots")
    ) {
      const item = verification.items.find((candidate) => pathname.includes(candidate.id));
      if (item) item.screenshotCount += 1;
      return json({
        relativePath: "verification/test.png",
        sha256: "fixture",
        bytes: 68,
        mimeType: "image/png",
      });
    }
    if (method === "POST" && pathname === `/api/admin/conflicts/${conflictId}/resolve`) {
      conflictOpen = false;
      return json({ ...conflict, status: "resolved", resolution: "正式来源优先" });
    }
    return json({});
  });
}

test("supports acquisition verification, screenshot evidence and conflict detail", async ({
  page,
}) => {
  await mockAcquisitionApi(page);
  let lastVerificationUpdate: Record<string, unknown> | undefined;
  page.on("request", (request) => {
    if (request.method() === "PATCH" && request.url().includes("/api/admin/verification/items/")) {
      lastVerificationUpdate = JSON.parse(request.postData() ?? "{}") as Record<string, unknown>;
    }
  });
  await page.goto("/");
  await page.getByRole("button", { name: "打开数据管理" }).click();
  await expect(page.getByRole("heading", { name: "采集完整性审计" })).toBeVisible();
  await expect(page.getByText(/报告可能早于最新批次/)).toBeVisible();
  await expect(page.getByText("书籍：发现 293 · 成功 288 · 排除 5")).toBeVisible();
  await expect(page.getByText("book:pending_30")).toBeVisible();
  await page.getByLabel("选择已有导入批次").selectOption(batchId);
  await expect(page.getByRole("heading", { name: "游戏内核验台" })).toBeVisible();
  await expect(page.getByText("游戏内逐字一致 0/10 · 当前样本 2")).toBeVisible();
  const checklistDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出核验清单" }).click();
  expect((await checklistDownload).suggestedFilename()).toBe(`verification-${batchId}.json`);
  await page.getByText("查看正文与完整出处").first().click();
  await expect(page.getByText("测试正文")).toBeVisible();
  await expect(
    page.locator(".verification-provenance[open]").getByText("fixture-commit"),
  ).toBeVisible();
  const checkedVersion = page.getByLabel("book/verification核验版本");
  const checkedLocale = page.getByLabel("book/verification核验语言");
  await expect(checkedVersion).toHaveValue("7.0.0");
  await expect(checkedLocale).toHaveValue("zh-CN");
  await checkedVersion.fill("6.9.0");
  await checkedVersion.blur();
  await expect.poll(() => lastVerificationUpdate?.checkedGameVersion).toBe("6.9.0");
  await expect.poll(() => lastVerificationUpdate?.checkedLocale).toBe("zh-CN");
  await page.getByLabel("book/verification核验状态").selectOption("mismatch");
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "verification.png",
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgo=", "base64"),
    });
  await expect(page.getByText("book/verification · 截图 1")).toBeVisible();
  await page.getByRole("button", { name: "查看原文" }).click();
  await expect(page.getByText("冲突来源正文")).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept("正式来源优先"));
  await page.getByRole("button", { name: "记录人工裁决" }).click();
  await expect(page.getByText("没有未解决冲突")).toBeVisible();
});

test("supports mobile search and document reading layout", async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "原神叙事知识库" })).toBeVisible();
  await page.getByLabel("搜索知识库").fill("提瓦特");
  await page.getByRole("button", { name: "检索" }).click();
  await page
    .getByRole("button", { name: /踏入提瓦特/ })
    .first()
    .click();
  await expect(page.getByRole("heading", { name: "踏入提瓦特" })).toBeVisible();
  await expect(page.locator(".document-body")).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("min-width", "320px");
});
