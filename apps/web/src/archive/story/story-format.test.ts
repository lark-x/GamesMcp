import { describe, expect, it } from "vitest";
import { formatStoryString } from "./story-format.js";
import type { ProtagonistPreferences } from "./story.types.js";

describe("formatStoryString", () => {
  const malePrefs: ProtagonistPreferences = {
    game: "genshin",
    gender: "male",
    nickname: "空之轨迹",
  };

  const femalePrefs: ProtagonistPreferences = {
    game: "genshin",
    gender: "female",
    nickname: "荧光夜曲",
  };

  describe("NICKNAME and REALNAME replacement", () => {
    it("replaces {NICKNAME} with customized nickname", () => {
      expect(formatStoryString("#{NICKNAME}，我们出发吧！", malePrefs)).toBe("空之轨迹，我们出发吧！");
      expect(formatStoryString("#{NICKNAME}，我们出发吧！", femalePrefs)).toBe("荧光夜曲，我们出发吧！");
    });

    it("falls back to 旅行者 if nickname is empty", () => {
      expect(formatStoryString("#{NICKNAME}！", { gender: "male", nickname: "   " })).toBe("旅行者！");
    });

    it("resolves REALNAME macro to canonical name", () => {
      expect(formatStoryString("请呼唤我的名字，{REALNAME[ID(1)|HOSTONLY(true)]}。", malePrefs)).toBe("请呼唤我的名字，空。");
      expect(formatStoryString("请呼唤我的名字，{REALNAME[ID(1)|HOSTONLY(true)]}。", femalePrefs)).toBe("请呼唤我的名字，荧。");
    });
  });

  describe("Gender branch tags: {M#...}{F#...}", () => {
    it("selects correct branch for male traveler", () => {
      const text = "#{M#他}{F#她}就是拯救了蒙德的荣誉骑士。";
      expect(formatStoryString(text, malePrefs)).toBe("他就是拯救了蒙德的荣誉骑士。");
    });

    it("selects correct branch for female traveler", () => {
      const text = "#{M#他}{F#她}就是拯救了蒙德的荣誉骑士。";
      expect(formatStoryString(text, femalePrefs)).toBe("她就是拯救了蒙德的荣誉骑士。");
    });

    it("handles reverse branch order {F#...}{M#...}", () => {
      const text = "寻找{F#哥哥}{M#妹妹}的旅途";
      expect(formatStoryString(text, malePrefs)).toBe("寻找妹妹的旅途");
      expect(formatStoryString(text, femalePrefs)).toBe("寻找哥哥的旅途");
    });

    it("handles English gender branches", () => {
      const text = "I wish I could find my {M#sister}{F#brother} soon...";
      expect(formatStoryString(text, malePrefs)).toBe("I wish I could find my sister soon...");
      expect(formatStoryString(text, femalePrefs)).toBe("I wish I could find my brother soon...");
    });
  });

  describe("SEXPRO macros", () => {
    it("resolves PLAYERAVATAR macros for male and female", () => {
      const text = "哈哈，你很懂嘛，{PLAYERAVATAR#SEXPRO[INFO_MALE_PRONOUN_BOYA|INFO_FEMALE_PRONOUN_GIRLB]}！";
      expect(formatStoryString(text, malePrefs)).toBe("哈哈，你很懂嘛，少年！");
      expect(formatStoryString(text, femalePrefs)).toBe("哈哈，你很懂嘛，少女！");
    });

    it("resolves MATEAVATAR macros to the opposite twin", () => {
      const text = "深渊教团的殿下…正是{MATEAVATAR#SEXPRO[INFO_MALE_PRONOUN_BROTHER|INFO_FEMALE_PRONOUN_SISTER]}。";
      // When player is male (空), mate is female (荧/妹妹)
      expect(formatStoryString(text, malePrefs)).toBe("深渊教团的殿下…正是妹妹。");
      // When player is female (荧), mate is male (空/哥哥)
      expect(formatStoryString(text, femalePrefs)).toBe("深渊教团的殿下…正是哥哥。");
    });
  });

  describe("System & Story specific tokens", () => {
    it("resolves ABYSSWAR counter", () => {
      const text = "纪念在守护纳塔的战争中阵亡的{ABYSSWAR#1003}名勇士。";
      expect(formatStoryString(text, malePrefs)).toBe("纪念在守护纳塔的战争中阵亡的1003名勇士。");
    });

    it("resolves LAYOUT prompts to PC action", () => {
      const text = "#{LAYOUT_MOBILE#点按}{LAYOUT_PC#按下E}{LAYOUT_PS#按下}释放元素战技。";
      expect(formatStoryString(text, malePrefs)).toBe("按下E释放元素战技。");
    });
  });

  describe("Ruby furigana tag parsing", () => {
    it("parses Chinese split words into <ruby>", () => {
      expect(formatStoryString("逐影猎人曾经拯救了城{RUBY#[D]枫丹}市的英雄。", malePrefs)).toBe(
        "逐影猎人曾经拯救了<ruby>城市<rt>枫丹</rt></ruby>的英雄。"
      );
      expect(formatStoryString("它叫做「虚{RUBY#[D]阿卡西}空终端」", malePrefs)).toBe(
        "它叫做「<ruby>虚空终端<rt>阿卡西</rt></ruby>」"
      );
      expect(formatStoryString("古名「马{RUBY#[D]回火}力卜」", malePrefs)).toBe(
        "古名「<ruby>马力卜<rt>回火</rt></ruby>」"
      );
    });

    it("parses English split words into <ruby>", () => {
      expect(formatStoryString("Mak{RUBY#[S]the previous Shogun}oto.", malePrefs)).toBe(
        "<ruby>Makoto<rt>the previous Shogun</rt></ruby>."
      );
      expect(formatStoryString("Drago{RUBY#[S]Nibelung}n", malePrefs)).toBe(
        "<ruby>Dragon<rt>Nibelung</rt></ruby>"
      );
      expect(formatStoryString("sw{RUBY#[S]claws of steel}ord", malePrefs)).toBe(
        "<ruby>sword<rt>claws of steel</rt></ruby>"
      );
    });

    it("parses terms with particle boundaries", () => {
      expect(formatStoryString("这是真{RUBY#[D]前代雷神}的佩刀。", malePrefs)).toBe(
        "这是<ruby>真<rt>前代雷神</rt></ruby>的佩刀。"
      );
      expect(formatStoryString("转移到我的剑{RUBY#[S]钢铁的爪牙}里就行。", malePrefs)).toBe(
        "转移到我的<ruby>剑<rt>钢铁的爪牙</rt></ruby>里就行。"
      );
    });
  });

  describe("Star Rail Trailblazer (穹 / 星) and macro resolution", () => {
    const srMale: ProtagonistPreferences = {
      game: "starrail",
      gender: "male",
      nickname: "开拓者",
    };

    const srFemale: ProtagonistPreferences = {
      game: "starrail",
      gender: "female",
      nickname: "开拓者",
    };

    const srCustom: ProtagonistPreferences = {
      game: "starrail",
      gender: "female",
      nickname: "星际列车长",
    };

    it("resolves default nickname to 开拓者 and custom nickname", () => {
      expect(formatStoryString("你好，{NICKNAME}！", srMale)).toBe("你好，开拓者！");
      expect(formatStoryString("你好，{NICKNAME}！", srFemale)).toBe("你好，开拓者！");
      expect(formatStoryString("你好，{NICKNAME}！", srCustom)).toBe("你好，星际列车长！");
    });

    it("resolves REALNAME macro to 穹 / 星 in Star Rail", () => {
      expect(formatStoryString("呼唤你的名字，{REALNAME}。", srMale)).toBe("呼唤你的名字，穹。");
      expect(formatStoryString("呼唤你的名字，{REALNAME}。", srFemale)).toBe("呼唤你的名字，星。");
    });

    it("resolves gender branch for Star Rail Trailblazer", () => {
      const branchText = "那是{M#穹}{F#星}的选择，{M#他}{F#她}拯救了雅利洛-VI。";
      expect(formatStoryString(branchText, srMale)).toBe("那是穹的选择，他拯救了雅利洛-VI。");
      expect(formatStoryString(branchText, srFemale)).toBe("那是星的选择，她拯救了雅利洛-VI。");
    });

    it("removes {TEXTJOIN} macros cleanly", () => {
      expect(formatStoryString("列车即将跃迁{TEXTJOIN#55}，请各位乘客坐好。", srMale)).toBe(
        "列车即将跃迁，请各位乘客坐好。"
      );
    });
  });
});

