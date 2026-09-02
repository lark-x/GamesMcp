import { describe, expect, it } from "vitest";
import { loadConfig } from "@gip/config";
import type { KnowledgeRepository } from "@gip/domain";
import { EvidenceQaService } from "./index.js";

const document = {
  id: "00000000-0000-0000-0000-000000000010",
  sourceKey: "lore/evidence",
  sourceVersion: "snapshot-hash",
  title: "证据文档",
  type: "lore",
  gameVersion: "fixture",
  revision: "r1",
  body: "旅行者来到提瓦特。",
  sourceName: "Fixture",
  sourceId: "00000000-0000-0000-0000-000000000011",
  segments: [
    {
      id: "00000000-0000-0000-0000-000000000012",
      ordinal: 0,
      headingPath: [],
      body: "旅行者来到提瓦特。",
      startOffset: 0,
      endOffset: 10,
      mentions: [],
    },
  ],
};

function repository(searchResult: {
  segments: Array<{
    id: string;
    title: string;
    segmentId: string;
    type: "lore";
    gameVersion: string;
    revision: string;
  }>;
  revision: string;
}): KnowledgeRepository {
  return {
    search: async () => ({ entities: [], documents: [], indexStatus: "ready", ...searchResult }),
    getDocument: async () => document,
  } as unknown as KnowledgeRepository;
}

describe("evidence QA", () => {
  it("returns insufficient when retrieval has no citation", async () => {
    const service = new EvidenceQaService(
      repository({ segments: [], revision: "r1" }),
      loadConfig({}),
    );
    const answer = await service.answer("00000000-0000-0000-0000-000000000001", "未知问题");
    expect(answer.confidence).toBe("insufficient");
    expect(answer.citations).toHaveLength(0);
  });

  it("prefers Search Core lore hits over legacy read-model segments (FIX-023)", async () => {
    const base = repository({ segments: [], revision: "r1" });
    const coreRepository = {
      ...base,
      search: async () => ({
        entities: [],
        documents: [],
        segments: [],
        revision: "r1",
        revisionId: "00000000-0000-0000-0000-000000000020",
        indexStatus: "ready",
        coreHits: {
          lore: [
            {
              document: { id: document.id },
              body: "旅行者来到提瓦特。",
              score: 3.2,
              matchedBy: "fts",
            },
          ],
        },
      }),
    } as unknown as KnowledgeRepository;
    const service = new EvidenceQaService(coreRepository, loadConfig({}));
    const answer = await service.answer(
      "00000000-0000-0000-0000-000000000001",
      "旅行者去了哪里",
      8,
      "00000000-0000-0000-0000-000000000020",
    );
    expect(answer.citations).toHaveLength(1);
    expect(answer.citations[0]?.documentId).toBe(document.id);
    expect(answer.citations[0]?.segmentId).toBe("00000000-0000-0000-0000-000000000012");
    expect(answer.warnings).not.toContain("没有找到可引用的已发布证据。");
  });

  it("returns structured citations without an LLM", async () => {
    const service = new EvidenceQaService(
      repository({
        segments: [
          {
            id: document.id,
            title: document.title,
            segmentId: document.segments[0]!.id,
            type: "lore",
            gameVersion: "fixture",
            revision: "r1",
          },
        ],
        revision: "r1",
      }),
      loadConfig({}),
    );
    const answer = await service.answer("00000000-0000-0000-0000-000000000001", "旅行者");
    expect(answer.citations[0]?.segmentId).toBe(document.segments[0]!.id);
    expect(answer.citations[0]?.sourceVersion).toBe("snapshot-hash");
    expect(answer.answer).toContain("[S1]");
  });

  it("rejects citation markers that do not exist", () => {
    const service = new EvidenceQaService(
      repository({ segments: [], revision: "r1" }),
      loadConfig({}),
    );
    expect(
      service.validateCitations("答案 [S2]", [
        {
          documentId: document.id,
          documentTitle: document.title,
          segmentId: document.segments[0]!.id,
          quote: "证据",
          sourceName: "Fixture",
          gameVersion: "fixture",
          datasetRevision: "r1",
        },
      ]).valid,
    ).toBe(false);
    expect(
      service.validateCitations("答案 [C1]", [
        {
          documentId: document.id,
          documentTitle: document.title,
          segmentId: document.segments[0]!.id,
          quote: "证据",
          sourceName: "Fixture",
          gameVersion: "fixture",
          datasetRevision: "r1",
        },
      ]).valid,
    ).toBe(false);
  });

  it("surfaces claim-status conflicts alongside claim evidence", async () => {
    const conflictRepository = {
      search: async () => ({
        entities: [
          {
            id: "00000000-0000-0000-0000-000000000013",
            name: "旅行者",
            type: "character" as const,
            aliases: [],
          },
        ],
        documents: [],
        segments: [],
        revision: "r1",
        revisionId: "00000000-0000-0000-0000-000000000014",
        indexStatus: "ready",
      }),
      getEntity: async () =>
        ({
          id: "00000000-0000-0000-0000-000000000013",
          gameId: "00000000-0000-0000-0000-000000000001",
          name: "旅行者",
          type: "character",
          aliases: [],
          summary: null,
          sourceKey: "entities/traveler",
          properties: {},
          deleted: false,
          relationships: [],
          documents: [],
          claims: [
            {
              id: "00000000-0000-0000-0000-000000000015",
              statement: "旅行者来到提瓦特。",
              status: "confirmed",
              evidence: [
                {
                  id: "00000000-0000-0000-0000-000000000016",
                  documentId: document.id,
                  documentTitle: document.title,
                  segmentId: document.segments[0]!.id,
                  quote: "旅行者来到提瓦特。",
                },
              ],
            },
            {
              id: "00000000-0000-0000-0000-000000000017",
              statement: "旅行者来到提瓦特。",
              status: "rejected",
              evidence: [
                {
                  id: "00000000-0000-0000-0000-000000000018",
                  documentId: document.id,
                  documentTitle: document.title,
                  segmentId: document.segments[0]!.id,
                  quote: "旅行者来到提瓦特。",
                },
              ],
            },
          ],
        }) as never,
      getDocument: async () => document,
    } as unknown as KnowledgeRepository;
    const service = new EvidenceQaService(conflictRepository, loadConfig({}));
    const answer = await service.answer("00000000-0000-0000-0000-000000000001", "旅行者");
    expect(answer.citations).toHaveLength(1);
    expect(answer.warnings.some((warning) => warning.includes("状态冲突"))).toBe(true);
  });
});
