import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { StarRailSourceInventory } from "./inventory.js";

export interface GameLocalizationResolver {
  resolve(hash: string | number): string | null;
}

export class StarRailTextMapResolver implements GameLocalizationResolver {
  private values: Map<string, string> | null = null;

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
    return this.values?.get(String(hash)) ?? null;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.values) return;
    const locale = this.input.locale ?? "CHS";
    const candidates = this.input.inventory.items
      .filter((item) => item.family === "TextMap" && item.path.endsWith(".json"))
      .sort(
        (left, right) => scoreTextMapPath(right.path, locale) - scoreTextMapPath(left.path, locale),
      );
    const chosen = candidates[0];
    if (!chosen) {
      this.values = new Map();
      return;
    }
    const raw = await readFile(resolve(this.input.dataDir, chosen.path), "utf8");
    const json = JSON.parse(raw) as unknown;
    this.values = new Map();
    collectTextMapEntries(json, this.values);
  }
}

function scoreTextMapPath(path: string, locale: string): number {
  let score = 0;
  if (/TextMap/iu.test(path)) score += 10;
  if (path.toUpperCase().includes(locale.toUpperCase())) score += 100;
  if (/CHS/iu.test(path)) score += 5;
  return score;
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
