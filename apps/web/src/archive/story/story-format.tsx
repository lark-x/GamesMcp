import React from "react";
import type { ProtagonistPreferences } from "./story.types.js";

const SEXPRO_MAP: Record<string, string> = {
  INFO_MALE_PRONOUN_HE: "他",
  INFO_FEMALE_PRONOUN_SHE: "她",
  INFO_MALE_PRONOUN_BIGBROTHER: "哥哥",
  INFO_FEMALE_PRONOUN_BIGSISTER: "姐姐",
  INFO_MALE_PRONOUN_BROTHER: "哥哥",
  INFO_FEMALE_PRONOUN_SISTERA: "妹妹",
  INFO_FEMALE_PRONOUN_SISTER: "妹妹",
  INFO_MALE_PRONOUN_SISTER: "妹妹",
  INFO_MALE_PRONOUN_BOY: "少年",
  INFO_FEMALE_PRONOUN_GIRL: "少女",
  INFO_MALE_PRONOUN_BOYA: "少年",
  INFO_FEMALE_PRONOUN_GIRLB: "少女",
  INFO_MALE_PRONOUN_BOYC: "少年",
  INFO_FEMALE_PRONOUN_GIRLC: "少女",
  INFO_MALE_PRONOUN_BOYD: "少年",
  INFO_FEMALE_PRONOUN_GIRLD: "少女",
  INFO_MALE_PRONOUN_BOYE: "少年",
  INFO_FEMALE_PRONOUN_GIRLE: "少女",
  INFO_MALE_PRONOUN_GIRLF: "少女",
  INFO_MALE_PRONOUN_XIABOY: "少侠",
  INFO_FEMALE_PRONOUN_XIAGIRL: "女侠",
  INFO_MALE_PRONOUN_CUTEBIGBROTHER: "哥哥",
  INFO_FEMALE_PRONOUN_CUTEBIGSISTER: "姐姐",
  INFO_MALE_PRONOUN_YING: "荧",
  INFO_FEMALE_PRONOUN_BROTHER: "哥哥",
  INFO_FEMALE_PRONOUN_KONG: "空",
  INFO_MALE_PRONOUN_Twins2Male: "哥哥",
  INFO_FEMALE_PRONOUN_Twins2Female: "妹妹",
};

const PARTICLES_AFTER = "的了里在是吗吧呢啊，。！？：；…）】」”' ";
const PARTICLES_BEFORE = "这那在是，。！？：；…（【「“' ";

const DEFAULT_PREFS: ProtagonistPreferences = {
  game: "genshin",
  gender: "female",
  nickname: "旅行者",
};

/**
 * Parses raw text into intermediate string with <ruby> markup
 * and resolves all Traveler/Trailblazer gender/nickname/system variables.
 */
export function formatStoryString(rawText: string, prefs?: ProtagonistPreferences): string {
  if (!rawText) return "";
  let text = rawText.replace(/^#\s*/, "");

  const activePrefs = prefs ?? DEFAULT_PREFS;
  const isStarRail = activePrefs.game === "starrail";
  const defaultNick = isStarRail ? "开拓者" : "旅行者";

  // 1. NICKNAME
  const activeNickname = activePrefs.nickname?.trim() || defaultNick;
  text = text.replace(/\{NICKNAME\}/gi, activeNickname);

  // 2. REALNAME (空/荧 for Genshin, 穹/星 for Star Rail)
  const maleReal = isStarRail ? "穹" : "空";
  const femaleReal = isStarRail ? "星" : "荧";
  text = text.replace(/\{REALNAME[^}]*\}/gi, activePrefs.gender === "male" ? maleReal : femaleReal);

  // 3. Gender pair branches: {M#...}{F#...} and {F#...}{M#...}
  text = text.replace(/\{M#([^}]*)\}\{F#([^}]*)\}/gi, (_m, mVal, fVal) =>
    activePrefs.gender === "male" ? mVal : fVal
  );
  text = text.replace(/\{F#([^}]*)\}\{M#([^}]*)\}/gi, (_m, fVal, mVal) =>
    prefs.gender === "female" ? fVal : mVal
  );

  // 4. Isolated {M#...} and {F#...}
  text = text.replace(/\{M#([^}]*)\}/gi, (_m, mVal) =>
    prefs.gender === "male" ? mVal : ""
  );
  text = text.replace(/\{F#([^}]*)\}/gi, (_m, fVal) =>
    prefs.gender === "female" ? fVal : ""
  );

  // 5. Star Rail TEXTJOIN macros: {TEXTJOIN#123}
  text = text.replace(/\{TEXTJOIN#[^}]*\}/gi, "");


  // 5. PLAYERAVATAR SEXPRO (Protagonist pronoun macro)
  text = text.replace(/\{PLAYERAVATAR#SEXPRO\[([^|\]]+)\|([^|\]]+)\]\}/gi, (_m, mTok, fTok) => {
    const tok = prefs.gender === "male" ? mTok : fTok;
    return SEXPRO_MAP[tok] || (prefs.gender === "male" ? "他" : "她");
  });

  // 6. MATEAVATAR SEXPRO (Abyss twin pronoun macro - opposite gender of player)
  text = text.replace(/\{MATEAVATAR#SEXPRO\[([^|\]]+)\|([^|\]]+)\]\}/gi, (_m, mTok, fTok) => {
    const tok = prefs.gender === "male" ? fTok : mTok;
    return SEXPRO_MAP[tok] || (prefs.gender === "male" ? "妹妹" : "哥哥");
  });

  // 7. LAYOUT prompts (Default to PC or clean action prompt)
  text = text.replace(/\{LAYOUT_MOBILE#([^}]*)\}\{LAYOUT_PC#([^}]*)\}\{LAYOUT_PS#([^}]*)\}/gi, "$2");
  text = text.replace(/\{LAYOUT_[A-Z]+#([^}]*)\}/gi, "$1");

  // 8. Specific story counters & challenge values
  text = text.replace(/\{ABYSSWAR#(\d+)\}/gi, "$1");
  text = text.replace(/\{ChallengeCurrValue\d+\}/gi, "");

  // 9. Ruby Markup processing
  // 9a. Star Rail explicit ruby: {ruby#annotation#base} -> <ruby>base<rt>annotation</rt></ruby>
  text = text.replace(
    /\{RUBY#([^#]+)#([^}]+)\}/gi,
    (_m, rt, base) => `<ruby>${base}<rt>${rt}</rt></ruby>`
  );

  // 9b. Quoted terms with ruby inside: 「杜麦{RUBY#[S]希望}尼」 or "Tum{RUBY#[S]Hope}aini!"
  text = text.replace(
    /([「“"'])([^」”"'{]+)\{RUBY#\[([SD])\]([^}]+)\}([^」”"'}]+)([」”"'])/g,
    (_m, q1, b1, _mode, rt, b2, q2) => `${q1}<ruby>${b1}${b2}<rt>${rt}</rt></ruby>${q2}`
  );

  // 9b. Quoted terms with ruby at the end: 「狼{RUBY#[S]我}」
  text = text.replace(
    /([「“"'])([^」”"'{]+)\{RUBY#\[([SD])\]([^}]+)\}([」”"'])/g,
    (_m, q1, b, _mode, rt, q2) => `${q1}<ruby>${b}<rt>${rt}</rt></ruby>${q2}`
  );

  // 9c. English word split: Mak{RUBY...}oto or co{RUBY...}re or sw{RUBY...}ord
  text = text.replace(
    /([a-zA-Z]+)\{RUBY#\[([SD])\]([^}]+)\}([a-zA-Z]+)/g,
    (_m, b1, _mode, rt, b2) => `<ruby>${b1}${b2}<rt>${rt}</rt></ruby>`
  );
  text = text.replace(
    /([a-zA-Z]+)\{RUBY#\[([SD])\]([^}]+)\}/g,
    (_m, b, _mode, rt) => `<ruby>${b}<rt>${rt}</rt></ruby>`
  );
  text = text.replace(
    /\{RUBY#\[([SD])\]([^}]+)\}([a-zA-Z]+)/g,
    (_m, _mode, rt, b) => `<ruby>${b}<rt>${rt}</rt></ruby>`
  );

  // 9d. Chinese: Explicit known phrases or compound patterns
  text = text.replace(/(愣头)\{RUBY#\[([SD])\]([^}]+)\}(青)/g, (_m, b1, _mode, rt, b2) => `<ruby>${b1}${b2}<rt>${rt}</rt></ruby>`);
  text = text.replace(/(马)\{RUBY#\[([SD])\]([^}]+)\}(力卜)/g, (_m, b1, _mode, rt, b2) => `<ruby>${b1}${b2}<rt>${rt}</rt></ruby>`);
  text = text.replace(/(杜)\{RUBY#\[([SD])\]([^}]+)\}(麦尼)/g, (_m, b1, _mode, rt, b2) => `<ruby>${b1}${b2}<rt>${rt}</rt></ruby>`);

  // 9e. Chinese: Ruby before trailing particles: 这是真{RUBY#[D]前代雷神}的佩刀 -> 真<rt>前代雷神</rt>的佩刀
  text = text.replace(
    new RegExp(`([\\u4e00-\\u9fa5])\\{RUBY#\\[([SD])\\]([^}]+)\\}(?=[${PARTICLES_AFTER}])`, "g"),
    (_m, b, _mode, rt) => `<ruby>${b}<rt>${rt}</rt></ruby>`
  );

  // 9f. Chinese: Ruby after leading particles: 这个{RUBY#[D]我家地下室}国家 -> 这个<ruby>国家<rt>我家地下室</rt></ruby>
  text = text.replace(
    new RegExp(`(?<=[${PARTICLES_BEFORE}])\\{RUBY#\\[([SD])\\]([^}]+)\\}([\\u4e00-\\u9fa5]{1,2})`, "g"),
    (_m, _mode, rt, b) => `<ruby>${b}<rt>${rt}</rt></ruby>`
  );

  // 9g. Chinese: Single char split: 城市, 虚空, 影子, 弟子, 王城, 教堂, 谐香, 未来, 拟真, 核心, 灵魂, 神格
  text = text.replace(
    /([\u4e00-\u9fa5])\{RUBY#\[([SD])\]([^}]+)\}([\u4e00-\u9fa5])/g,
    (_m, b1, _mode, rt, b2) => `<ruby>${b1}${b2}<rt>${rt}</rt></ruby>`
  );

  // 9h. Fallback for any remaining ruby
  text = text.replace(
    /([\u4e00-\u9fa5]{1,4})\{RUBY#\[([SD])\]([^}]+)\}/g,
    (_m, b, _mode, rt) => `<ruby>${b}<rt>${rt}</rt></ruby>`
  );
  text = text.replace(
    /\{RUBY#\[([SD])\]([^}]+)\}([\u4e00-\u9fa5]{1,4})/g,
    (_m, _mode, rt, b) => `<ruby>${b}<rt>${rt}</rt></ruby>`
  );

  return text;
}

/**
 * Transforms raw dialogue / story text into rich ReactNode
 * with native <ruby><rt> annotations and traveler preferences applied.
 */
export function formatStoryText(
  rawText: string,
  prefs?: ProtagonistPreferences
): React.ReactNode {
  const formatted = formatStoryString(rawText, prefs);
  if (!formatted.includes("<ruby>")) {
    return formatted;
  }

  const nodes: React.ReactNode[] = [];
  const regex = /<ruby>(.*?)<rt>(.*?)<\/rt><\/ruby>/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(formatted)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(formatted.slice(lastIndex, match.index));
    }
    const baseWord = match[1];
    const rubyText = match[2];
    nodes.push(
      <ruby key={`${match.index}-${baseWord}`} className="story-ruby">
        {baseWord}
        <rt className="story-rt">{rubyText}</rt>
      </ruby>
    );
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < formatted.length) {
    nodes.push(formatted.slice(lastIndex));
  }

  return <>{nodes}</>;
}
