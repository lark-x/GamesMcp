const COLOR_TAG = /<\/?color(?:=[^>]*)?>/giu;
const RUBY_TAG = /<\/?ruby(?:=[^>]*)?>/giu;
const HTML_LIKE_TAG = /<\/?(?:size|b|i|u|align|sprite|icon|unbreak)(?:=[^>]*)?>/giu;

// 上游模板占位符：{NICKNAME} 指代开拓者，其余（{TEXTNUM}、{M#..} 等）为运行时
// 才能填充的数值/布局槽位，静态文本中直接移除。
const NICKNAME_PLACEHOLDER = /\{NICKNAME\}/giu;
const TEMPLATE_PLACEHOLDER = /\{[A-Z][A-Z0-9_#,.]*\}/gu;

export function normalizeStarRailText(input: string): string {
  return input
    .replace(NICKNAME_PLACEHOLDER, "开拓者")
    .replace(COLOR_TAG, "")
    .replace(/<color=[^>]*$/giu, "")
    .replace(RUBY_TAG, "")
    .replace(HTML_LIKE_TAG, "")
    .replace(/\\n/gu, "\n")
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
    .replace(TEMPLATE_PLACEHOLDER, "")
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
