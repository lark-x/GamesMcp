const COLOR_TAG = /<\/?color(?:=[^>]*)?>/giu;
const RUBY_TAG = /<\/?ruby(?:=[^>]*)?>/giu;
const HTML_LIKE_TAG = /<\/?(?:size|b|i|u|align|sprite|icon|unbreak)(?:=[^>]*)?>/giu;

// Body variables are source data; only display labels use a generic nickname.
const NICKNAME_PLACEHOLDER = /\{NICKNAME\}/giu;

export function normalizeStarRailText(input: string): string {
  return input
    .replace(COLOR_TAG, "")
    .replace(/<color=[^>]*$/giu, "")
    .replace(RUBY_TAG, "")
    .replace(HTML_LIKE_TAG, "")
    .replace(/\\r\\n|\\n|\\r/gu, "\n")
    .split("")
    .filter((char) => !isDiscardedControlCharacter(char))
    .join("")
    .replace(/\r\n?/gu, "\n")
    .replace(/[ \t]+\n/gu, "\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

/** 标题/条目名单行文本清洗：占位符替换 + 富文本标签剥离 + 空白压缩。 */
export function normalizeStarRailLabel(input: string): string {
  return normalizeStarRailText(input)
    .replace(NICKNAME_PLACEHOLDER, "开拓者")
    .replace(/\s+/gu, " ")
    .replace(/^[\s·:：,，、-]+|[\s·:：,，、-]+$/gu, "")
    .trim();
}

function isDiscardedControlCharacter(value: string): boolean {
  const code = value.charCodeAt(0);
  return code === 0x7f || (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d);
}

export function hasLikelyNarrativeText(input: string): boolean {
  const normalized = normalizeStarRailText(input);
  if (normalized.length < 2) return false;
  if (/^(?:N\/A|null|undefined|none|0)$/iu.test(normalized)) return false;
  if (
    /^(?:[A-Za-z0-9_./\\-]+\.(?:png|jpg|jpeg|webp|prefab|asset|wav|ogg|mp3|json))$/iu.test(
      normalized,
    )
  )
    return false;
  return /[一-龥ぁ-んァ-ヶ가-힣A-Za-z]/u.test(normalized);
}
