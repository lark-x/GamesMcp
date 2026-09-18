import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import xxhash from "xxhash-wasm";
import type { StarRailSourceInventory } from "./inventory.js";

export interface GameLocalizationResolver {
  resolve(hash: string | number): string | null;
}

export class StarRailTextMapResolver implements GameLocalizationResolver {
  private values: Map<string, string> | null = null;
  private hash64: ((input: string) => bigint) | null = null;

  constructor(
    private readonly input: {
      dataDir: string;
      inventory: StarRailSourceInventory;
      locale?: string;
    },
  ) {}

  async load(): Promise<{ totalKeys: number; resolvedSample: number; rssBytes: number }> {
    await this.ensureLoaded();
    const values = [...(this.values?.keys() ?? [])].slice(0, 100);
    return {
      totalKeys: this.values?.size ?? 0,
      resolvedSample: values.filter((key) => this.resolve(key)).length,
      rssBytes: process.memoryUsage().rss,
    };
  }

  resolve(hash: string | number): string | null {
    const key = String(hash);
    const direct = this.values?.get(key);
    if (direct !== undefined) return direct;
    // Named keys such as RelicDesc_1012 use unsigned xxHash64 (seed 0),
    // as documented by TurnBasedGameData's README.
    if (typeof hash === "string" && !/^-?\d+$/u.test(hash) && this.hash64) {
      return this.values?.get(this.hash64(hash).toString()) ?? null;
    }
    return null;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.values) return;
    const locale = (this.input.locale ?? "CHS").toUpperCase();
    const candidates = this.input.inventory.items
      .filter(
        (item) =>
          item.family === "TextMap" &&
          item.path.endsWith(".json") &&
          textMapLocale(item.path) === locale,
      )
      .sort((a, b) => a.path.localeCompare(b.path));
    if (!candidates.length) {
      throw new Error(`Missing TextMap for requested locale ${locale}`);
    }
    const values = new Map<string, string>();
    for (const candidate of candidates) {
      const raw = await readFile(resolve(this.input.dataDir, candidate.path), "utf8");
      const entries = new Map<string, string>();
      collectTextMapEntries(JSON.parse(raw), entries);
      for (const [key, value] of entries) {
        if (values.has(key) && values.get(key) !== value)
          throw new Error(`Conflicting ${locale} TextMap hash ${key}: ${candidate.path}`);
        values.set(key, value);
      }
    }
    if (!values.size) throw new Error(`Empty TextMap for requested locale ${locale}`);
    this.hash64 = (await xxhash()).h64;
    this.values = values;
  }
}

function textMapLocale(path: string): string | undefined {
  return /(?:^|\/)TextMap(?:Main)?([A-Za-z]+)(?:[._/]|$)/u.exec(path)?.[1]?.toUpperCase();
}

function collectTextMapEntries(value: unknown, output: Map<string, string>, prefix = ""): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectTextMapEntries(item, output, `${prefix}/${index}`));
    return;
  }
  for (const [key, candidate] of Object.entries(value)) {
    if (typeof candidate === "string" && candidate.trim()) output.set(key, candidate.trim());
    else if (candidate && typeof candidate === "object") {
      const nested = candidate as Record<string, unknown>;
      const nestedText = nested.Value ?? nested.value ?? nested.Text ?? nested.text;
      if (typeof nestedText === "string" && nestedText.trim()) output.set(key, nestedText.trim());
      else collectTextMapEntries(candidate, output, prefix ? `${prefix}/${key}` : key);
    }
  }
}
