import { createHash } from "node:crypto";

/**
 * TextResolver resolves TextMap hashes into cleaned display strings with
 * deterministic lineage. It centralizes the missing-hash / empty / escaped-
 * newline / rich-text-tag handling that used to live inline in converters.
 */

export type ResolvedText = {
  /** Numeric upstream hash as string. */
  hash: string;
  /** Raw upstream string before cleaning. */
  raw: string;
  /** Cleaned display value; empty string when unresolved. */
  value: string;
  resolved: boolean;
  /** SHA-256 of the raw value for lineage. */
  rawSha: string;
};

export type FallbackLocaleText = {
  value: string | null;
  locale: string | null;
  resolved: boolean;
};

export type TextResolverOptions = {
  /** Ordered maps; the first map that contains the hash wins. */
  maps: Array<{ locale: string; values: Record<string, unknown> }>;
};

const ESCAPES: Array<[RegExp, string]> = [
  [/\\n/g, "\n"],
  [/\\r/g, ""],
  [/\\t/g, "\t"],
  [/\\\\/g, "\\"],
  [/\\"/g, '"'],
];

/** Strip rich-text / color / image / size tags while keeping inner text. */
export function cleanUpstreamText(raw: string): string {
  let value = raw;
  for (const [pattern, replacement] of ESCAPES) value = value.replace(pattern, replacement);
  value = value
    .replace(/<color=#([0-9a-fA-F]{6,8})>/g, "")
    .replace(/<\/color>/g, "")
    .replace(/<image[^>]*\/>/g, "")
    .replace(/<sprite[^>]*\/>/g, "")
    .replace(/<size=[^>]*>/g, "")
    .replace(/<\/size>/g, "")
    .replace(/<i>/g, "")
    .replace(/<\/i>/g, "")
    .replace(/<b>/g, "")
    .replace(/<\/b>/g, "")
    .replace(/\{[^#{]*#([^}]*)\}/g, "$1")
    .replace(/\{NICKNAME\}/g, "旅行者")
    .replace(/\{MATE\}/g, "派蒙");
  return value.trim();
}

function sha(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export class TextResolver {
  private readonly maps: Array<{ locale: string; values: Record<string, unknown> }>;

  constructor(options: TextResolverOptions) {
    this.maps = options.maps;
  }

  /** Resolve a hash; throws when the hash is missing in every map. */
  resolve(hash: string | number): ResolvedText {
    const result = this.tryResolve(hash);
    if (!result.resolved) {
      throw new Error(`text_hash_missing:${result.hash}`);
    }
    return result;
  }

  /** Resolve a hash without throwing; resolved=false when missing. */
  tryResolve(hash: string | number): ResolvedText {
    const key = String(hash);
    for (const map of this.maps) {
      const raw = map.values[key];
      if (typeof raw !== "string") continue;
      const value = cleanUpstreamText(raw);
      return {
        hash: key,
        raw,
        value,
        resolved: value.length > 0,
        rawSha: sha(raw),
      };
    }
    return { hash: key, raw: "", value: "", resolved: false, rawSha: sha("") };
  }

  /** Resolve against the primary locale, then fall back through extra maps. */
  resolveWithFallback(hash: string | number): FallbackLocaleText {
    for (const map of this.maps) {
      const raw = map.values[String(hash)];
      if (typeof raw !== "string") continue;
      const value = cleanUpstreamText(raw);
      if (!value) continue;
      return { value, locale: map.locale, resolved: true };
    }
    return { value: null, locale: null, resolved: false };
  }
}
