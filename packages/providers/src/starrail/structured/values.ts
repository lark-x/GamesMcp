import { normalizeStarRailText } from "../corpus/normalizer.js";

/** Config numbers are commonly wrapped in { Value }; missing is not zero. */
export function configNumber(value: unknown): number | null {
  const raw = value && typeof value === "object" ? (value as { Value?: unknown }).Value : value;
  if (typeof raw !== "number" && typeof raw !== "string") return null;
  if (raw === "") return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

export function formatConfigText(text: string, parameters: unknown): string {
  const values = Array.isArray(parameters) ? parameters : [];
  return normalizeStarRailText(
    text.replace(
      /#(\d+)\[(i|f\d*|p\d*)\](%)?/gu,
      (token, index: string, format: string, percent: string | undefined) => {
        const value = configNumber(values[Number(index) - 1]);
        if (value === null) return token;
        const isPercent = format.startsWith("p") || Boolean(percent);
        const digits = Number(format.slice(1) || 0);
        if (digits > 10) return token;
        return `${(value * (isPercent ? 100 : 1)).toFixed(digits)}${isPercent ? "%" : ""}`;
      },
    ),
  );
}
