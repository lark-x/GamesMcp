import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  computeDiff,
  LocalDirectoryAdapter,
  LocalJsonAdapter,
  normalizeRawRecord,
  normalizeSnapshot,
  validateImport,
} from "./index.js";

describe("ingestion", () => {
  it("normalizes a document and preserves source identity", () => {
    const record = normalizeRawRecord({
      sourceKey: "quests/intro",
      recordType: "document",
      payload: {
        title: "序章",
        body: "旅行者来到蒙德",
        parserVersion: "source-adapter-v2",
        entities: [
          { sourceKey: "traveler", name: "旅行者", entityType: "character", aliases: ["Traveler"] },
        ],
      },
      metadata: { file: "intro.json" },
    });
    expect(record.sourceKey).toBe("quests/intro");
    expect(record.entities?.[0]?.name).toBe("旅行者");
    expect(record.parserVersion).toBe("source-adapter-v2");
    expect(record.contentHash).toHaveLength(64);
  });

  it("computes additions, modifications and deletion candidates", () => {
    const one = normalizeRawRecord({
      sourceKey: "a",
      recordType: "document",
      payload: { title: "A", body: "one" },
      metadata: {},
    });
    const two = normalizeRawRecord({
      sourceKey: "b",
      recordType: "document",
      payload: { title: "B", body: "two" },
      metadata: {},
    });
    const diff = computeDiff(
      [one],
      new Map([
        ["a", "old"],
        ["b", two.contentHash],
      ]),
    );
    expect(diff.modified).toEqual(["a"]);
    expect(diff.unchanged).toEqual([]);
    expect(diff.deletionCandidates).toEqual(["b"]);
  });

  it("blocks confirmed claims without evidence", () => {
    const record = normalizeRawRecord({
      sourceKey: "a",
      recordType: "document",
      payload: { title: "A", body: "text", claims: [{ statement: "事实", status: "confirmed" }] },
      metadata: {},
    });
    expect(validateImport([record]).errors.map((issue) => issue.code)).toContain(
      "claim_evidence_required",
    );
  });

  it("reads JSON, Markdown and text files through the directory adapter", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gip-ingestion-"));
    try {
      await writeFile(join(directory, "a.md"), "# 设定\n旅行者来到提瓦特。", "utf8");
      await writeFile(join(directory, "b.txt"), "纯文本资料。", "utf8");
      await writeFile(
        join(directory, "c.json"),
        JSON.stringify({ title: "JSON", body: "内容" }),
        "utf8",
      );
      await writeFile(join(directory, "ignored.bin"), "binary", "utf8");
      const adapter = new LocalDirectoryAdapter();
      const inspection = await adapter.inspect({
        sourceId: "source",
        type: "local_directory",
        path: directory,
        storageDir: directory,
      });
      expect(inspection.fileCount).toBe(3);
      const snapshot = await adapter.snapshot({
        sourceId: "source",
        type: "local_directory",
        path: directory,
        storageDir: directory,
      });
      const normalized = await normalizeSnapshot(snapshot, adapter);
      expect(normalized.records).toHaveLength(3);
      expect(normalized.records.map((record) => record.sourceKey)).toEqual([
        "a.md",
        "b.txt",
        "c.json#1",
      ]);
      expect(await readFile(snapshot.storagePath, "utf8")).toContain(snapshot.contentHash);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps malformed JSON in the staged error path", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gip-ingestion-invalid-"));
    try {
      const path = join(directory, "invalid.json");
      await writeFile(path, "{not-json", "utf8");
      const adapter = new LocalJsonAdapter();
      const snapshot = await adapter.snapshot({
        sourceId: "source",
        type: "local_json",
        path,
        storageDir: directory,
      });
      const normalized = await normalizeSnapshot(snapshot, adapter);
      expect(normalized.records).toEqual([]);
      expect(normalized.parseIssues[0]?.code).toBe("source_parse_failed");
      expect(computeDiff([], new Map(), normalized.parseIssues).unparsed).toEqual(["<source>"]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("refuses to overwrite a tampered immutable snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gip-ingestion-immutable-"));
    try {
      const path = join(directory, "source.json");
      await writeFile(path, JSON.stringify({ title: "标题", body: "正文" }), "utf8");
      const adapter = new LocalJsonAdapter();
      const input = {
        sourceId: "source",
        type: "local_json" as const,
        path,
        storageDir: directory,
      };
      const snapshot = await adapter.snapshot(input);
      const tampered = JSON.parse(await readFile(snapshot.storagePath, "utf8")) as Record<
        string,
        unknown
      >;
      tampered.files = [{ relativePath: "source.json", content: "被篡改" }];
      await writeFile(snapshot.storagePath, JSON.stringify(tampered), "utf8");
      await expect(adapter.snapshot(input)).rejects.toThrow("Immutable snapshot content mismatch");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("reports empty sources and invalid encoding as blocking issues", () => {
    const record = normalizeRawRecord({
      sourceKey: "bad",
      recordType: "document",
      payload: { title: "坏资料", body: "\uFFFD" },
      metadata: {},
    });
    const validation = validateImport([record]);
    expect(validation.errors.map((issue) => issue.code)).toContain("invalid_encoding");
    expect(validateImport([]).errors.map((issue) => issue.code)).toContain("no_records");
  });
});
