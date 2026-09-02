import { describe, expect, it } from "vitest";
import {
  mapArchiveHomeResponse,
  mapBookListResponse,
  mapCharacterStoryListResponse,
  mapMechanicsResponse,
  mapQuestDetail,
  mapSectionReadResponse,
  mapTextItemDetailResponse,
  mapTextItemListResponse,
  mapVoiceListResponse,
  mergeQuestPages,
} from "./mappers.js";

describe("Game Codex response mappers", () => {
  it("normalizes archive domains, counts, entries, and revision metadata", () => {
    const home = mapArchiveHomeResponse({
      gameId: "game-1",
      revision: "r7",
      latestRevision: "r8",
      latestRevisionId: "revision-8",
      categories: [
        {
          id: "dialogue",
          label: "对话节点",
          description: "任务节点",
          count: 4.8,
          entries: [
            {
              id: "node-1",
              name: "序章 · 派蒙",
              kind: "document",
              type: "dialogue",
              documentId: "document-1",
              anchorId: "node-1",
            },
          ],
        },
      ],
    });

    expect(home).toMatchObject({
      gameId: "game-1",
      revision: "r7",
      latestRevision: "r8",
      latestRevisionId: "revision-8",
    });
    expect(home.categories[0]).toMatchObject({ id: "dialogue", count: 4 });
    expect(home.categories[0]?.entries[0]).toMatchObject({
      id: "node-1",
      kind: "document",
      documentId: "document-1",
      anchorId: "node-1",
    });
  });

  it("derives a revision-scoped citation when a page omits citation rows", () => {
    const quest = mapQuestDetail({
      questKey: "quest/1001",
      mainQuestId: "1001",
      title: "捕风的异乡人",
      type: "archon_quest",
      completeness: "complete",
      locale: "zh-CN",
      documentId: "document-1",
      revision: "r8",
      dialogueNodes: [
        {
          nodeKey: "quest/1001/dialog/1",
          nodeId: 1,
          type: "dialogue",
          body: "旅行者，我们出发吧。",
          segmentId: "segment-1",
        },
      ],
      citations: [],
    });

    expect(quest.citations).toEqual([
      expect.objectContaining({
        documentId: "document-1",
        dialogueNodeKey: "quest/1001/dialog/1",
        segmentId: "segment-1",
        revision: "r8",
      }),
    ]);
    expect(quest.loadedDialogueNodes).toBe(1);
    expect(quest.totalDialogueNodes).toBe(1);
  });

  it("merges cursor pages without duplicating nodes, edges, participants, or citations", () => {
    const first = mapQuestDetail({
      questKey: "quest/1001",
      mainQuestId: "1001",
      title: "捕风的异乡人",
      type: "archon_quest",
      completeness: "complete",
      locale: "zh-CN",
      documentId: "document-1",
      revision: "r8",
      totalDialogueNodes: 3,
      dialogueNodes: [{ nodeKey: "node-1", nodeId: 1, type: "dialogue", body: "一" }],
      dialogueEdges: [{ fromNodeKey: "node-1", toNodeKey: "node-2", type: "next" }],
      participants: [{ id: "npc-1", name: "派蒙", type: "npc" }],
      citations: [],
      nextCursor: "cursor-2",
    });
    const second = mapQuestDetail({
      questKey: "quest/1001",
      mainQuestId: "1001",
      title: "捕风的异乡人",
      type: "archon_quest",
      completeness: "complete",
      locale: "zh-CN",
      documentId: "document-1",
      revision: "r8",
      totalDialogueNodes: 3,
      dialogueNodes: [
        { nodeKey: "node-1", nodeId: 1, type: "dialogue", body: "一" },
        { nodeKey: "node-2", nodeId: 2, type: "player_choice", body: "二" },
      ],
      dialogueEdges: [
        { fromNodeKey: "node-1", toNodeKey: "node-2", type: "next" },
        { fromNodeKey: "node-2", toNodeKey: "node-3", type: "choice", optionText: "继续" },
      ],
      participants: [
        { id: "npc-1", name: "派蒙", type: "npc" },
        { id: "npc-2", name: "旅行者", type: "character" },
      ],
      citations: [],
      nextCursor: null,
    });

    const merged = mergeQuestPages(first, second);
    expect(merged.dialogueNodes.map((node) => node.nodeKey)).toEqual(["node-1", "node-2"]);
    expect(merged.dialogueEdges).toHaveLength(2);
    expect(merged.participants.map((participant) => participant.id)).toEqual(["npc-1", "npc-2"]);
    expect(merged.citations.map((citation) => citation.dialogueNodeKey)).toEqual([
      "node-1",
      "node-2",
    ]);
    expect(merged.loadedDialogueNodes).toBe(2);
    expect(merged.totalDialogueNodes).toBe(3);
    expect(merged.nextCursor).toBeNull();
    expect(merged.hasMore).toBe(false);
  });

  it("maps grouped books and orders volumes by their reader order", () => {
    const catalog = mapBookListResponse({
      gameId: "game-1",
      revisionId: "revision-1",
      locale: "zh-CN",
      totalVolumes: 2,
      books: [
        {
          stableId: "book/1",
          bookStableId: "book/1",
          title: "书目一",
          volumes: [
            { stableId: "volume-2", documentId: "doc-2", title: "第二卷", order: 2 },
            { stableId: "volume-1", documentId: "doc-1", title: "第一卷", order: 1 },
          ],
        },
      ],
    });
    expect(catalog.books[0]?.volumes.map((volume) => volume.stableId)).toEqual([
      "volume-1",
      "volume-2",
    ]);
    expect(catalog.books[0]?.volumes[0]).toMatchObject({
      bookStableId: "book/1",
      segmentCount: 0,
      volume: null,
    });
  });

  it("maps FetterStory groups without losing character or story identities", () => {
    const catalog = mapCharacterStoryListResponse({
      gameId: "game-1",
      sourceDomain: "FetterStory",
      corpusStatus: "available",
      totalStories: 1,
      characters: [
        {
          characterStableId: "character/10001",
          characterName: "胡桃",
          stories: [
            {
              stableId: "character/10001/story/101",
              storyStableId: "character/10001/story/101",
              storyKey: "101",
              documentId: "doc-1",
              title: "故事一",
              displayTitle: "胡桃 · 故事一",
            },
          ],
        },
      ],
    });
    expect(catalog).toMatchObject({
      sourceDomain: "FetterStory",
      characters: [
        {
          characterStableId: "character/10001",
          stories: [{ storyStableId: "character/10001/story/101", documentId: "doc-1" }],
        },
      ],
    });
  });

  it("maps item list and detail payloads into stable text records", () => {
    const list = mapTextItemListResponse({
      gameId: "game-1",
      revisionId: "revision-1",
      query: null,
      items: [
        {
          id: "item-1",
          stableId: "material/nichang",
          name: "霓裳花",
          category: "local_specialty",
          excerpt: "璃月的鲜花。",
          sources: ["璃月"],
          usedBy: ["胡桃"],
        },
      ],
    });
    expect(list.items[0]).toMatchObject({
      stableId: "material/nichang",
      description: "璃月的鲜花。",
      sources: ["璃月"],
    });
    expect(mapTextItemDetailResponse({ item: list.items[0] })).toMatchObject({
      stableId: "material/nichang",
      usedBy: ["胡桃"],
    });
  });

  it("preserves explicit empty-corpus statuses for voices and maps mechanics hits", () => {
    expect(
      mapVoiceListResponse({ corpusStatus: "voice_source_missing", count: 0, voices: [] }),
    ).toMatchObject({ corpusStatus: "voice_source_missing", count: 0, voices: [] });
    expect(
      mapMechanicsResponse({
        query: "超载",
        corpusStatus: "available",
        hits: [{ sourceKey: "mechanism/Tutorial/1001", title: "超载" }],
      }),
    ).toMatchObject({
      corpusStatus: "available",
      hits: [{ sourceKey: "mechanism/Tutorial/1001", title: "超载" }],
    });
  });

  it("maps section citations for document and segment location", () => {
    const section = mapSectionReadResponse({
      documentId: "doc-1",
      title: "卷一",
      locale: "zh-CN",
      revision: "r4",
      headingPath: ["书目一", "卷一"],
      body: "正文",
      truncated: false,
      citations: [{ documentId: "doc-1", segmentId: "segment-1" }],
    });
    expect(section).toMatchObject({
      headingPath: ["书目一", "卷一"],
      citations: [{ documentId: "doc-1", segmentId: "segment-1", revision: "r4" }],
    });
  });
});
