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
      added: ["lore/new", ...Array.from({ length: 12 }, (_, index) => `lore/new-${index + 1}`)],
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
  const previewCandidateId = "00000000-0000-0000-0000-000000000040";
  const previewBuildId = "00000000-0000-0000-0000-000000000041";
  const previewCandidates = [
    {
      id: previewCandidateId,
      gameId,
      name: "RC 7.0 候选",
      baseRevisionId: revisionOne,
      importBatchIds: [batchId],
      status: "preview_ready",
      currentBuildId: previewBuildId,
      promotedRevisionId: null,
      builds: [
        {
          id: previewBuildId,
          candidateId: previewCandidateId,
          buildNumber: 1,
          status: "ready",
          contentChecksum: "a".repeat(64),
          recordCount: 2,
          createdAt: new Date().toISOString(),
        },
      ],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

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
    if (method === "GET" && pathname.startsWith("/api/games/") && pathname.endsWith("/documents"))
      return json({ documents: [documentSummary] });
    if (method === "GET" && pathname.startsWith("/api/games/") && pathname.endsWith("/entities"))
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
    if (method === "GET" && pathname === "/api/admin/release-candidates")
      return json({ candidates: previewCandidates });
    if (method === "GET" && pathname === `/api/admin/release-candidates/${previewCandidateId}`)
      return json({ candidate: previewCandidates[0] });
    if (
      method === "GET" &&
      pathname.includes("/api/admin/previews/") &&
      pathname.endsWith("/entities")
    ) {
      return json({
        entities: [
          {
            sourceKey: "entities/traveler",
            type: "character",
            name: "旅行者",
            summary: "从世界之外来到提瓦特的旅行者。",
            metadata: {},
            contentHash: "hash-1",
          },
        ],
      });
    }
    if (
      method === "GET" &&
      pathname.includes("/api/admin/previews/") &&
      pathname.endsWith("/documents")
    ) {
      return json({
        documents: [
          {
            sourceKey: "lore/first-steps",
            type: "lore",
            title: "踏入提瓦特",
            body: "旅行者在提瓦特寻找失散的血亲。",
            metadata: {},
            contentHash: "hash-2",
          },
        ],
      });
    }
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
    if (method === "GET" && pathname === `/api/admin/imports/${batchId}/publish-readiness`)
      return json({ batchId, ready: true, blockingReasons: [] });
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
  await expect(page.getByRole("heading", { name: "旅行者", exact: true })).toBeVisible();
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

  await page.getByRole("button", { name: "打开审核工作台" }).click();
  await page.getByPlaceholder("本地文件或目录路径").fill("/private/fixture.json");
  await page.getByRole("button", { name: "导入并进入预发布" }).click();
  await page.getByRole("button", { name: "预发布分支" }).click();
  await expect(page.getByText("lore/legacy")).toBeVisible();
  const diffAdded = page
    .locator(".diff-grid > div")
    .filter({ has: page.getByRole("heading", { name: "新增" }) });
  await expect(diffAdded.getByText("1 / 2")).toBeVisible();
  await diffAdded.getByRole("button", { name: "下一页" }).click();
  await expect(diffAdded.getByText("2 / 2")).toBeVisible();
  await expect(diffAdded.getByText("lore/new-12")).toBeVisible();
  await page.locator(".deletion-row input").check();
  await page.getByRole("button", { name: "查看问题队列" }).click();
  await expect(page.getByRole("heading", { name: "问题队列" })).toBeVisible();
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
    if (method === "GET" && pathname === "/api/admin/release-candidates")
      return json({ candidates: [] });
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

test("supports issue-driven review and conflict detail", async ({ page }) => {
  await mockAcquisitionApi(page);
  await page.goto("/");
  await page.getByRole("button", { name: "打开审核工作台" }).click();
  await page.getByRole("button", { name: "待处理问题" }).click();
  await expect(page.getByRole("heading", { name: "问题队列" })).toBeVisible();
  await expect(page.getByText(/无需逐条核验|无待处理问题|问题/).first()).toBeVisible();
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

test("supports browsing preview candidate data in isolated preview browser", async ({ page }) => {
  await mockApi(page);
  await page.goto(
    "/#preview/00000000-0000-0000-0000-000000000040/00000000-0000-0000-0000-000000000041",
  );
  await expect(page.getByText(/这是预发布数据，当前正式 MCP 不会读取此 Build/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "旅行者" })).toBeVisible();
  await page.getByRole("button", { name: /踏入提瓦特/ }).click();
  await expect(page.getByText("旅行者在提瓦特寻找失散的血亲。")).toBeVisible();
  await expect(page.getByRole("button", { name: "报告问题" })).toBeVisible();
});
