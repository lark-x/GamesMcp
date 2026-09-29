import { describe, expect, it } from "vitest";
import type { StoryCatalog as ApiStoryCatalog } from "../../api.js";
import { buildStoryTree, compareChapterOrder, parseStoryOrder } from "./StoryCatalog.js";
import { formatStoryString } from "./story-format.js";
import type { ProtagonistPreferences } from "./story.types.js";
import type { StoryEntry } from "./story.types.js";

const catalogEntry = (questKey: string, title: string) => ({
  questKey,
  title,
  order: 1,
  completeness: "complete" as const,
  bodyAvailability: "dialogue" as const,
});

const storyCatalogFixture: ApiStoryCatalog = {
  gameId: "game",
  revisionId: "revision",
  regions: [
    {
      id: "region",
      name: "测试地区",
      order: 1,
      families: [
        {
          id: "family",
          name: "测试系列",
          order: 1,
          provenance: "derived",
          chapters: [
            {
              id: "chapter",
              name: "测试章节",
              order: 1,
              quests: [catalogEntry("mission/1", "甲任务"), catalogEntry("mission/2", "乙任务")],
            },
          ],
        },
      ],
      chapters: [],
    },
  ],
};

const storyEntry = (questKey: string, title: string): StoryEntry => ({
  questKey,
  title,
  type: "trailblaze_mission",
  completeness: "complete",
  locale: "zh-CN",
});

describe("story catalog filtering", () => {
  it("renders independent quests directly under their region without a synthetic family", () => {
    const catalog: ApiStoryCatalog = {
      gameId: "game",
      revisionId: "revision",
      regions: [
        {
          id: "fontaine",
          name: "枫丹",
          order: 5,
          families: [],
          quests: [catalogEntry("quest/76148", "狮子奋迅")],
          chapters: [],
        },
      ],
    };

    const tree = buildStoryTree([], catalog);
    expect(tree[0]?.children).toEqual([
      expect.objectContaining({ type: "quest", questKey: "quest/76148" }),
    ]);
  });

  it("renders collections as expandable non-clickable nodes", () => {
    const catalog: ApiStoryCatalog = {
      gameId: "game",
      revisionId: "revision",
      regions: [
        {
          id: "region",
          name: "测试地区",
          order: 1,
          families: [
            {
              id: "family",
              name: "其他独立任务",
              order: 1,
              provenance: "derived",
              chapters: [],
              quests: [{ ...catalogEntry("quest/child", "子任务"), parentQuestId: "76152" }],
              collections: [
                {
                  ...catalogEntry("quest/76152", "狮子奋迅"),
                  entryType: "collection",
                  aggregateChildQuestIds: ["child"],
                },
              ],
            },
          ],
          chapters: [],
        },
      ],
    };
    const tree = buildStoryTree([], catalog, "", false);
    expect(tree[0]?.children?.[0]?.children?.[0]).toMatchObject({
      type: "collection",
      title: "狮子奋迅",
    });
    expect(tree[0]?.children?.[0]?.children?.[0]?.children?.[0]).toMatchObject({
      type: "quest",
      questKey: "quest/child",
    });
  });

  it("keeps a quest whose dialogue body matched the search endpoint", () => {
    const tree = buildStoryTree(
      [storyEntry("mission/2", "乙任务")],
      storyCatalogFixture,
      "对白中的稀有词",
      true,
    );

    expect(tree).toHaveLength(1);
    expect(tree[0]?.children?.[0]?.children?.[0]?.children).toEqual([
      expect.objectContaining({ questKey: "mission/2", title: "乙任务" }),
    ]);
  });

  it("resolves collection children that are stored under a chapter", () => {
    const catalog: ApiStoryCatalog = {
      gameId: "game",
      revisionId: "revision",
      regions: [
        {
          id: "region",
          name: "测试地区",
          order: 1,
          families: [
            {
              id: "family",
              name: "测试系列",
              order: 1,
              provenance: "derived",
              quests: [],
              collections: [
                {
                  ...catalogEntry("mission/collection", "合集任务"),
                  entryType: "collection",
                  aggregateChildQuestIds: ["child"],
                },
              ],
              chapters: [
                {
                  id: "chapter",
                  name: "测试章节",
                  order: 1,
                  quests: [catalogEntry("mission/child", "子任务")],
                },
              ],
            },
          ],
          chapters: [],
        },
      ],
    };
    const tree = buildStoryTree([], catalog, "", true);
    expect(tree[0]?.children?.[0]?.children?.[0]?.children).toEqual([
      expect.objectContaining({ questKey: "mission/child", title: "子任务" }),
    ]);
  });

  it("returns no catalog nodes when a query has no title or body matches", () => {
    expect(buildStoryTree([], storyCatalogFixture, "不存在的任务", true)).toEqual([]);
  });

  it("groups region children under type nodes when questType is present", () => {
    const catalog: ApiStoryCatalog = {
      gameId: "game",
      revisionId: "revision",
      regions: [
        {
          id: "fontaine",
          name: "枫丹",
          order: 1,
          families: [
            {
              id: "genshin:aq:chapter-4",
              name: "魔神任务 · 第四章「罪人舞步旋」",
              order: 1,
              provenance: "derived",
              chapters: [
                {
                  id: "1401",
                  name: "第四章 第一幕 白露与黑潮的序诗",
                  order: 100,
                  quests: [
                    {
                      questKey: "quest/400403",
                      title: "白露与黑潮的序诗",
                      order: 1,
                      questType: "archon_quest",
                      completeness: "complete",
                      bodyAvailability: "dialogue",
                    },
                  ],
                },
              ],
            },
            {
              id: "genshin:personal-line:emilie",
              name: "艾梅莉埃 · 香氛瓶之章",
              order: 2,
              provenance: "derived",
              chapters: [
                {
                  id: "2051",
                  name: "香氛瓶之章 第一幕 花债血偿",
                  order: 100,
                  quests: [
                    {
                      questKey: "quest/14037",
                      title: "前调·花债",
                      order: 1,
                      questType: "story_quest",
                      completeness: "complete",
                      bodyAvailability: "dialogue",
                    },
                  ],
                },
              ],
            },
          ],
          chapters: [],
        },
      ],
    };

    const tree = buildStoryTree([], catalog);
    expect(tree[0]?.type).toBe("region");
    expect(tree[0]?.children?.map((c) => ({ type: c.type, title: c.title }))).toEqual([
      { type: "type", title: "魔神任务" },
      { type: "type", title: "传说任务" },
    ]);
    const archonTypeNode = tree[0]?.children?.[0];
    expect(archonTypeNode?.children?.[0]?.title).toBe("魔神任务 · 第四章「罪人舞步旋」");
  });

  it("filters by typeFilter matching left-sidebar selection", () => {
    const catalog: ApiStoryCatalog = {
      gameId: "game",
      revisionId: "revision",
      regions: [
        {
          id: "fontaine",
          name: "枫丹",
          order: 1,
          families: [
            {
              id: "genshin:aq:chapter-4",
              name: "魔神任务 · 第四章「罪人舞步旋」",
              order: 1,
              provenance: "derived",
              chapters: [],
              quests: [
                {
                  questKey: "quest/400403",
                  title: "白露与黑潮的序诗",
                  order: 1,
                  questType: "archon_quest",
                  completeness: "complete",
                  bodyAvailability: "dialogue",
                },
              ],
            },
            {
              id: "genshin:personal-line:emilie",
              name: "艾梅莉埃 · 香氛瓶之章",
              order: 2,
              provenance: "derived",
              chapters: [],
              quests: [
                {
                  questKey: "quest/14037",
                  title: "花债血偿",
                  order: 1,
                  questType: "story_quest",
                  completeness: "complete",
                  bodyAvailability: "dialogue",
                },
              ],
            },
          ],
          chapters: [],
        },
      ],
    };

    const archonTree = buildStoryTree([], catalog, "", false, "archon_quest");
    expect(archonTree[0]?.children?.map((c) => c.title)).toEqual([
      "魔神任务 · 第四章「罪人舞步旋」",
    ]);

    const storyTree = buildStoryTree([], catalog, "", false, "story_quest");
    expect(storyTree[0]?.children?.map((c) => c.title)).toEqual(["艾梅莉埃 · 香氛瓶之章"]);
  });

  it("strictly orders acts in chronological narrative sequence: prologue, act 1..10", () => {
    const catalog: ApiStoryCatalog = {
      gameId: "genshin",
      revisionId: "r1",
      regions: [
        {
          id: "nod_krai",
          name: "诺德卡莱",
          order: 7,
          chapters: [],
          families: [
            {
              id: "genshin:aq:nod-krai",
              name: "魔神任务 · 空月之歌",
              order: 100,
              provenance: "derived",
              chapters: [
                {
                  id: "1609",
                  name: "空月之歌 第九幕 身土坏空，五蕴识转",
                  order: 900,
                  quests: [{ questKey: "quest/409", title: "第九幕任务", order: 1, questType: "archon_quest" }],
                },
                {
                  id: "1601",
                  name: "空月之歌 第一幕 雪浪与苍林之舞",
                  order: 100,
                  quests: [{ questKey: "quest/401", title: "第一幕任务", order: 1, questType: "archon_quest" }],
                },
                {
                  id: "1600",
                  name: "空月之歌 序奏 归途",
                  order: 50,
                  quests: [{ questKey: "quest/400", title: "序奏任务", order: 1, questType: "archon_quest" }],
                },
                {
                  id: "1602",
                  name: "空月之歌 第二幕 尘与灯的挽歌",
                  order: 200,
                  quests: [{ questKey: "quest/402", title: "第二幕任务", order: 1, questType: "archon_quest" }],
                },
                {
                  id: "1610",
                  name: "空月之歌 第十幕 道成千壑，因果异灭",
                  order: 1000,
                  quests: [{ questKey: "quest/410", title: "第十幕任务", order: 1, questType: "archon_quest" }],
                },
              ],
            },
          ],
        },
      ],
    };

    const tree = buildStoryTree([], catalog, "", false, "archon_quest");
    const familyNode = tree[0]?.children?.[0];
    const chapterTitles = familyNode?.children?.map((c) => c.title);
    expect(chapterTitles).toEqual([
      "空月之歌 序奏 归途",
      "空月之歌 第一幕 雪浪与苍林之舞",
      "空月之歌 第二幕 尘与灯的挽歌",
      "空月之歌 第九幕 身土坏空，五蕴识转",
      "空月之歌 第十幕 道成千壑，因果异灭",
    ]);
  });

  it("strictly filters development test data and hidden tasks from the tree", () => {
    const catalog: ApiStoryCatalog = {
      gameId: "game",
      revisionId: "revision",
      regions: [
        {
          id: "fontaine",
          name: "枫丹",
          order: 1,
          families: [
            {
              id: "f1",
              name: "正常系列",
              order: 1,
              provenance: "derived",
              chapters: [],
              quests: [
                {
                  questKey: "quest/100",
                  title: "正常任务",
                  order: 1,
                  completeness: "complete",
                  bodyAvailability: "dialogue",
                },
                {
                  questKey: "quest/5003",
                  title: "测试任务5003",
                  order: 2,
                  completeness: "complete",
                  bodyAvailability: "dialogue",
                },
                {
                  questKey: "quest/101",
                  title: "内部调试(test)",
                  order: 3,
                  completeness: "complete",
                  bodyAvailability: "dialogue",
                },
                {
                  questKey: "quest/102",
                  title: "未发布任务$UNRELEASED$",
                  order: 4,
                  completeness: "complete",
                  bodyAvailability: "dialogue",
                },
              ],
            },
            {
              id: "f2",
              name: "开发测试(test)",
              order: 2,
              provenance: "derived",
              chapters: [],
              quests: [
                {
                  questKey: "quest/103",
                  title: "子项",
                  order: 1,
                  completeness: "complete",
                  bodyAvailability: "dialogue",
                },
              ],
            },
          ],
          chapters: [],
        },
      ],
    };

    const tree = buildStoryTree([], catalog);
    const quests = tree[0]?.children?.[0]?.children ?? [];
    expect(quests.map((q) => q.title)).toEqual(["正常任务"]);
    expect(tree[0]?.children?.find((f) => f.title.includes("开发测试"))).toBeUndefined();
  });

  it("deduplicates and merges same-title families under the same region", () => {
    const catalog: ApiStoryCatalog = {
      gameId: "game",
      revisionId: "revision",
      regions: [
        {
          id: "fontaine",
          name: "枫丹",
          order: 1,
          families: [
            {
              id: "f1",
              name: "山中好长日",
              order: 1,
              provenance: "curated",
              chapters: [
                {
                  id: "c1",
                  name: "第一章",
                  order: 1,
                  quests: [catalogEntry("quest/1", "任务一")],
                },
              ],
            },
            {
              id: "f2",
              name: "山中好长日",
              order: 2,
              provenance: "derived",
              chapters: [
                {
                  id: "c2",
                  name: "第二章",
                  order: 2,
                  quests: [catalogEntry("quest/2", "任务二")],
                },
              ],
            },
          ],
          chapters: [],
        },
      ],
    };

    const tree = buildStoryTree([], catalog);
    const families = tree[0]?.children ?? [];
    expect(families).toHaveLength(1);
    expect(families[0]?.title).toBe("山中好长日");
    expect(families[0]?.children?.map((c) => c.title)).toEqual(["第一章", "第二章"]);
  });

  it("retains legitimate quests with words like hidden, test, or tutorial in title", () => {
    const catalog: ApiStoryCatalog = {
      gameId: "game",
      revisionId: "revision",
      regions: [
        {
          id: "mondstadt",
          name: "蒙德",
          order: 1,
          families: [
            {
              id: "prologue",
              name: "魔神任务 · 序章",
              order: 1,
              provenance: "derived",
              chapters: [],
              quests: [
                { ...catalogEntry("quest/381", "Hidden Tears"), order: 1 },
                { ...catalogEntry("quest/425", "Gliding Test Quest"), order: 2 },
                { ...catalogEntry("quest/20039", "Timaeus' Alchemy Tutorial"), order: 3 },
              ],
            },
          ],
          chapters: [],
        },
      ],
    };

    const tree = buildStoryTree([], catalog);
    const quests = tree[0]?.children?.[0]?.children ?? [];
    expect(quests.map((q) => q.title)).toEqual([
      "Hidden Tears",
      "Gliding Test Quest",
      "Timaeus' Alchemy Tutorial",
    ]);
  });

  it("filters out chapters with test markers even if child quests have normal titles", () => {
    const catalog: ApiStoryCatalog = {
      gameId: "game",
      revisionId: "revision",
      regions: [
        {
          id: "fontaine",
          name: "枫丹",
          order: 1,
          families: [
            {
              id: "fam",
              name: "正常系列",
              order: 1,
              provenance: "derived",
              chapters: [
                {
                  id: "chap-normal",
                  name: "正常章节",
                  order: 1,
                  quests: [catalogEntry("quest/10", "任务A")],
                },
                {
                  id: "chap-test",
                  name: "测试章节(test)",
                  order: 2,
                  quests: [catalogEntry("quest/11", "任务B")],
                },
              ],
            },
          ],
          chapters: [],
        },
      ],
    };

    const tree = buildStoryTree([], catalog);
    const chapters = tree[0]?.children?.[0]?.children ?? [];
    expect(chapters.map((c) => c.title)).toEqual(["正常章节"]);
  });
});

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
      expect(formatStoryString("#{NICKNAME}，我们出发吧！", malePrefs)).toBe(
        "空之轨迹，我们出发吧！",
      );
      expect(formatStoryString("#{NICKNAME}，我们出发吧！", femalePrefs)).toBe(
        "荧光夜曲，我们出发吧！",
      );
    });

    it("falls back to 旅行者 if nickname is empty", () => {
      expect(formatStoryString("#{NICKNAME}！", { gender: "male", nickname: "   " })).toBe(
        "旅行者！",
      );
    });

    it("resolves REALNAME macro to canonical name", () => {
      expect(
        formatStoryString("请呼唤我的名字，{REALNAME[ID(1)|HOSTONLY(true)]}。", malePrefs),
      ).toBe("请呼唤我的名字，空。");
      expect(
        formatStoryString("请呼唤我的名字，{REALNAME[ID(1)|HOSTONLY(true)]}。", femalePrefs),
      ).toBe("请呼唤我的名字，荧。");
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
      const text =
        "哈哈，你很懂嘛，{PLAYERAVATAR#SEXPRO[INFO_MALE_PRONOUN_BOYA|INFO_FEMALE_PRONOUN_GIRLB]}！";
      expect(formatStoryString(text, malePrefs)).toBe("哈哈，你很懂嘛，少年！");
      expect(formatStoryString(text, femalePrefs)).toBe("哈哈，你很懂嘛，少女！");
    });

    it("resolves MATEAVATAR macros to the opposite twin", () => {
      const text =
        "深渊教团的殿下…正是{MATEAVATAR#SEXPRO[INFO_MALE_PRONOUN_BROTHER|INFO_FEMALE_PRONOUN_SISTER]}。";
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
        "逐影猎人曾经拯救了<ruby>城市<rt>枫丹</rt></ruby>的英雄。",
      );
      expect(formatStoryString("它叫做「虚{RUBY#[D]阿卡西}空终端」", malePrefs)).toBe(
        "它叫做「<ruby>虚空终端<rt>阿卡西</rt></ruby>」",
      );
      expect(formatStoryString("古名「马{RUBY#[D]回火}力卜」", malePrefs)).toBe(
        "古名「<ruby>马力卜<rt>回火</rt></ruby>」",
      );
    });

    it("parses English split words into <ruby>", () => {
      expect(formatStoryString("Mak{RUBY#[S]the previous Shogun}oto.", malePrefs)).toBe(
        "<ruby>Makoto<rt>the previous Shogun</rt></ruby>.",
      );
      expect(formatStoryString("Drago{RUBY#[S]Nibelung}n", malePrefs)).toBe(
        "<ruby>Dragon<rt>Nibelung</rt></ruby>",
      );
      expect(formatStoryString("sw{RUBY#[S]claws of steel}ord", malePrefs)).toBe(
        "<ruby>sword<rt>claws of steel</rt></ruby>",
      );
    });

    it("parses terms with particle boundaries", () => {
      expect(formatStoryString("这是真{RUBY#[D]前代雷神}的佩刀。", malePrefs)).toBe(
        "这是<ruby>真<rt>前代雷神</rt></ruby>的佩刀。",
      );
      expect(formatStoryString("转移到我的剑{RUBY#[S]钢铁的爪牙}里就行。", malePrefs)).toBe(
        "转移到我的<ruby>剑<rt>钢铁的爪牙</rt></ruby>里就行。",
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
        "列车即将跃迁，请各位乘客坐好。",
      );
    });

    it("renders paired Star Rail ruby as <ruby>base<rt>annotation</rt></ruby>", () => {
      // Upstream writes the annotated word BETWEEN the markers, unlike the
      // Genshin {RUBY#annotation#base} form.
      expect(formatStoryString("{RUBY_B#「毁灭」的令使}绝灭大君{RUBY_E#}不在附近。", srMale)).toBe(
        "<ruby>绝灭大君<rt>「毁灭」的令使</rt></ruby>不在附近。",
      );
      expect(formatStoryString("拥有星神{RUBY_B#「毁灭」}纳努克{RUBY_E#}的赐福。", srMale)).toBe(
        "拥有星神<ruby>纳努克<rt>「毁灭」</rt></ruby>的赐福。",
      );
    });

    it("never leaks an unpaired ruby marker to the reader", () => {
      expect(formatStoryString("残留{RUBY_B#注}标记{RUBY_E#}结束", srMale)).toBe(
        "残留<ruby>标记<rt>注</rt></ruby>结束",
      );
      expect(formatStoryString("未闭合{RUBY_B#注释}的文本", srMale)).toBe("未闭合的文本");
      expect(formatStoryString("孤立{RUBY_E#}标记", srMale)).toBe("孤立标记");
    });
  });

  describe("chapter and story ordering", () => {
    it("orders Star Rail chapters by act and section correctly (第一节 before 第二节)", () => {
      const sec1 = parseStoryOrder("第一幕•第一节");
      const sec2 = parseStoryOrder("第一幕•第二节");
      expect(sec1).toBeLessThan(sec2);

      const sorted = [
        { name: "第一幕•第二节" },
        { name: "第一幕•第一节" },
        { name: "第一幕•第三节" },
      ].sort(compareChapterOrder);

      expect(sorted.map((s) => s.name)).toEqual([
        "第一幕•第一节",
        "第一幕•第二节",
        "第一幕•第三节",
      ]);
    });

    it("orders sub-parts like 上/中/下 and 其一/其二 correctly", () => {
      const sorted = [
        { name: "间章·下" },
        { name: "间章·上" },
        { name: "间章·中" },
      ].sort(compareChapterOrder);

      expect(sorted.map((s) => s.name)).toEqual([
        "间章·上",
        "间章·中",
        "间章·下",
      ]);
    });
  });
});
