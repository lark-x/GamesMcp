# 原神任务解析审计

- 上游：`F:\Project\GamesMcp\data\upstream\AnimeGameData-current`
- Commit：`26df1dfbdf05a82bbb1d97506859f3e1c40718d8`
- 主任务：4372
- 可发布双语记录：4972
- 完整/部分/仅元数据（中文）：2595/1032/153
- 解析失败：0
- Story Family：421；区域级其他独立任务：9；独立任务条目：2954
- Talk 已解析任务：2551；存在 Talk 问题的任务：964

## BEFORE / AFTER / DELTA

```json
{
  "before": {
    "resolvedQuestCount": 2551,
    "dialogueNodeCount": 487836,
    "fallbackFamilyCount": 9,
    "standaloneQuestCount": 2954,
    "aggregateCount": 451,
    "controlCount": 96,
    "talkUnresolvedCount": 461,
    "danglingEdgeCount": 2125
  },
  "after": {
    "resolvedQuestCount": 2551,
    "dialogueNodeCount": 491252,
    "fallbackFamilyCount": 9,
    "standaloneQuestCount": 2954,
    "aggregateCount": 451,
    "controlCount": 96,
    "talkUnresolvedCount": 461,
    "danglingEdgeCount": 2125
  },
  "delta": {
    "resolvedQuestCount": 0,
    "dialogueNodeCount": 3416,
    "fallbackFamilyCount": 0,
    "standaloneQuestCount": 0,
    "aggregateCount": 0,
    "controlCount": 0,
    "talkUnresolvedCount": 0,
    "danglingEdgeCount": 0
  }
}
```

## 重点核对

| 主任务 | 标题                       | 系列           | 章节                                  | 对白 | 内容角色          | Talk 状态            | 质量             |
| ------ | -------------------------- | -------------- | ------------------------------------- | ---: | ----------------- | -------------------- | ---------------- |
| 21009  | 旧味难寻                   | 其他独立任务   |                                       |   10 | story             | resolved             | complete         |
| 72236  | 三色档案                   | 其他独立任务   |                                       |   48 | story_and_control | resolved             | complete         |
| 73013  | 为那菈献上珍馐             | 愿为一炊之梦   | 愿为一炊之梦                          |  140 | story_and_control | resolved             | complete         |
| 73019  | 料理是快乐的回忆           | 愿为一炊之梦   | 愿为一炊之梦                          |  155 | story             | resolved             | complete         |
| 73020  | 料理是自然的风味           | 愿为一炊之梦   | 愿为一炊之梦                          |  107 | story_and_control | resolved             | complete         |
| 73021  | 料理是思归的香气           | 愿为一炊之梦   | 愿为一炊之梦                          |  141 | story             | resolved             | complete         |
| 73022  | 料理是分享的美好           | 愿为一炊之梦   | 愿为一炊之梦                          |  187 | story             | resolved             | complete         |
| 73189  | 无形壁障                   | 其他独立任务   | 旧语新知                              |   14 | story_and_control | resolved             | complete         |
| 74001  | 「水仙十字大冒险」         | 水仙十字系列   | 水仙的安·第一幕 「水仙十字大冒险」    |  669 | story_and_control | talk_asset_ambiguous | partial_dialogue |
| 74002  | 「公主」与「冒险团」的故事 | 水仙的安       | 水仙的安·第一幕 「水仙十字大冒险」    |  182 | story_and_control | talk_asset_ambiguous | partial_dialogue |
| 74003  | 安的故事                   | 水仙的安       | 水仙的安·第二幕 「镜中的王国」        |  319 | story_and_control | resolved             | complete         |
| 74004  | 玛丽安的故事               | 水仙的安       | 水仙的安·第三幕 「假如她不再梦到你…」 |  266 | story_and_control | talk_asset_ambiguous | partial_dialogue |
| 74072  | 藻海的寻踪                 | 水仙的追迹     | 水仙的追迹·第一幕 藻海的寻踪          | 1010 | story_and_control | talk_asset_ambiguous | partial_dialogue |
| 74073  | 缪斯的母亲                 | 水仙十字系列   | 水仙的追迹·第一幕 藻海的寻踪          |   87 | story_and_control | talk_asset_ambiguous | partial_dialogue |
| 74074  | 流星的投矛                 | 水仙十字系列   | 水仙的追迹·第一幕 藻海的寻踪          |   86 | story_and_control | talk_asset_ambiguous | partial_dialogue |
| 74075  | 丘比特的爱人               | 水仙十字系列   | 水仙的追迹·第一幕 藻海的寻踪          |   89 | story_and_control | talk_asset_ambiguous | partial_dialogue |
| 74076  | 悲喜的面具                 | 水仙十字系列   | 水仙的追迹·第一幕 藻海的寻踪          |  102 | story_and_control | talk_asset_ambiguous | partial_dialogue |
| 74077  | 救世者的守灵               | 水仙的追迹     | 水仙的追迹·第二幕 救世者的守灵        |  119 | story_and_control | resolved             | complete         |
| 74078  | 溪舟的尾波                 | 水仙的追迹     | 水仙的追迹·第四幕 溪舟的尾波          |  353 | story_and_control | talk_asset_ambiguous | partial_dialogue |
| 74165  | 大梦的醒转                 | 水仙的追迹     | 水仙的追迹·第三幕 大梦的醒转          |  104 | story_and_control | talk_asset_ambiguous | partial_dialogue |
| 74183  | 雷穆利亚的最后一日         | 谐律上的咏叙诗 | 谐律上的咏叙诗·第二章 被缚的囚徒      |  109 | story_and_control | resolved             | complete         |
| 74184  | 佩特莉可的阴霾             | 谐律上的咏叙诗 | 谐律上的咏叙诗·序曲 诡镇之梦          |  242 | story_and_control | resolved             | complete         |
| 74194  | 通往卡皮托林的阶梯         | 谐律上的咏叙诗 | 谐律上的咏叙诗·第三章 法沙利亚狂想曲  |  250 | story_and_control | resolved             | complete         |
| 74195  | 水下夜想曲                 | 谐律上的咏叙诗 | 谐律上的咏叙诗·第一章 海魔王的宫殿    |  209 | story_and_control | partial              | partial_dialogue |
| 74196  | 哀悼命运之疮               | 谐律上的咏叙诗 | 谐律上的咏叙诗·终章 安魂曲            |  203 | story_and_control | graph_incomplete     | partial_dialogue |
| 76148  | 狮子奋迅                   | 山中好长日     | 山中好长日·第二章 地狱                |   29 | story_and_control | talk_asset_ambiguous | partial_dialogue |
| 76152  | 狮子奋迅                   | 山中好长日     | 山中好长日·第二章 地狱                |    0 | aggregate         | not_applicable       | aggregate        |

## 非完整任务

- 347 阅读占坑$HIDDEN：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_unknown, visibility_hidden, excluded:hidden_show_type
- 310 招募新伙伴：partial_dialogue；missing_dialogue_nodes, dialogue_partial
- 311 (test)一阶段结束$HIDDEN：partial_dialogue；dialogue_dialogue_text_missing, visibility_hidden, excluded:hidden_show_type
- 370 阴影下的蒙德：partial_dialogue；dialogue_partial
- 372 那个绿色的家伙：partial_dialogue；dialogue_partial
- 373 听凭风引：partial_dialogue；dialogue_graph_incomplete
- 376 逃亡：partial_dialogue；dialogue_dialogue_text_missing
- 20101 追逐暗影：partial_dialogue；dialogue_partial
- 385 (test)一起去冒险吧$UNRELEASED$HIDDEN：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_unknown, visibility_hidden, excluded:hidden_show_type
- 398 尾声，风停之后：partial_dialogue；dialogue_partial
- 303 女神像解锁$HIDDEN：partial_dialogue；dialogue_talk_asset_ambiguous, visibility_hidden, excluded:hidden_show_type
- 419 解除黑日族封印：control；content_role_trigger
- 420 解除好睡族封印：control；content_role_trigger
- 422 解除好肉族封印：control；content_role_trigger
- 424 高级潜入测试$UNRELEASED：source_missing；missing_dialogue_nodes, dialogue_talk_asset_missing, visibility_unreleased, excluded:unreleased_marker:missingDialogue
- 425 飞行测试任务$UNRELEASED：source_missing；missing_dialogue_nodes, dialogue_talk_asset_missing, visibility_unreleased, excluded:unreleased_marker:missingDialogue
- 428 安柏深渊$UNRELEASED：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_unreleased, excluded:unreleased_marker
- 429 史莱姆守卫战$UNRELEASED：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_unknown, visibility_unreleased, excluded:unreleased_marker
- 465 暗夜英雄的危机：partial_dialogue；dialogue_partial
- 469 七神的赐福：partial_dialogue；dialogue_partial
- 482 风起地飞行特训$UNRELEASED：source_missing；missing_dialogue_nodes, dialogue_talk_asset_missing, visibility_unreleased, excluded:unreleased_marker:missingDialogue
- 481 风之翼随风而起：partial_dialogue；dialogue_partial
- 484 那家伙叫「怪鸟」：partial_dialogue；dialogue_partial
- 488 委托人查尔斯的烦恼：partial_dialogue；dialogue_graph_incomplete
- 489 委托人莎拉的忧愁：partial_dialogue；dialogue_dialogue_text_missing
- 490 骑士团长的一日假期：partial_dialogue；dialogue_graph_incomplete
- 990 (test)对话编辑器测试任务$UNRELEASED：partial_dialogue；dialogue_dialogue_text_missing, visibility_unreleased, excluded:unreleased_marker
- 991 (test)冲突NPC测试1$UNRELEASED：source_missing；missing_dialogue_nodes, missing_subquests, dialogue_talk_asset_missing, content_role_unknown, visibility_unreleased, excluded:unreleased_marker:missingDialogue,missingSubquests
- 992 (test)冲突NPC测试2$UNRELEASED：source_missing；missing_dialogue_nodes, missing_subquests, dialogue_talk_asset_missing, content_role_unknown, visibility_unreleased, excluded:unreleased_marker:missingDialogue,missingSubquests
- 993 (test)玉京台潜入测试$UNRELEASED：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_unreleased, excluded:unreleased_marker
- 994 (test)主角Freestyle动作测试$UNRELEASED：source_missing；missing_dialogue_nodes, dialogue_talk_asset_missing, content_role_metadata, visibility_unreleased, excluded:unreleased_marker:missingDialogue
- 995 (test)单元测试任务$UNRELEASED：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_unreleased, excluded:unreleased_marker
- 996 (test)测试跨场景创建NPC$UNRELEASED：partial_dialogue；dialogue_partial, visibility_unreleased, excluded:unreleased_marker
- 997 (test)测试对话编辑器$UNRELEASED：partial_dialogue；dialogue_partial, visibility_unreleased, excluded:unreleased_marker
- 998 (test)任务测试任务$UNRELEASED：partial_dialogue；dialogue_partial, visibility_unreleased, excluded:unreleased_marker
- 999 (test)对话测试任务$UNRELEASED：partial_dialogue；dialogue_talk_asset_ambiguous, visibility_unreleased, excluded:unreleased_marker
- 1008 叠山：partial_dialogue；dialogue_talk_asset_ambiguous
- 1010 往生：partial_dialogue；dialogue_partial
- 1011 指月：partial_dialogue；dialogue_graph_incomplete
- 1012 传香：partial_dialogue；dialogue_partial
- 1013 市井：partial_dialogue；dialogue_partial
- 1022 孤芳：partial_dialogue；dialogue_graph_incomplete
- 10111 南风与冒险：partial_dialogue；dialogue_dialogue_text_missing
- 10300 (test)芭芭拉线玩法白盒$UNRELEASED：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_unreleased, excluded:unreleased_marker
- 11006 (test)（弃用）$UNRELEASED：control；content_role_trigger, visibility_unreleased, excluded:unreleased_marker
- 20037 触不可及的恋人：partial_dialogue；dialogue_graph_incomplete
- 20043 永不停歇的风与米歇尔小姐：partial_dialogue；dialogue_graph_incomplete
- 20051 蒙德城的酒：partial_dialogue；dialogue_partial
- 20058 诺拉快跑！：partial_dialogue；dialogue_graph_incomplete
- 22003 勿言勿笑：partial_dialogue；dialogue_graph_incomplete
- 22116 这本小说会很厉害！：speaker_unresolved；dialogue_dialogue_text_missing, speaker_name_unresolved
- 22301 且听下回分解：partial_dialogue；dialogue_partial
- 22305 点石成…什么：partial_dialogue；dialogue_graph_incomplete
- 20501 秘境中的古树：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_unknown
- 20502 忘却之峡：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_unknown
- 20507 (test)蒙德传送点教学$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 20508 (test)第一次通关地城指引（隐藏）$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 20509 (test)PC呼出鼠标教学$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 20510 (test)发放树脂用（隐藏）$HIDDEN：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_unknown, visibility_hidden, excluded:hidden_show_type
- 21012 扫梯而下$UNRELEASED：partial_dialogue；dialogue_graph_incomplete, visibility_unreleased, excluded:unreleased_marker
- 21013 丘占木巢$HIDDEN：partial_dialogue；dialogue_partial, visibility_hidden, excluded:hidden_show_type
- 21014 (test)璃月入口镜头$UNRELEASED$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 25002 解禁2-隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 25006 解禁4-隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 25012 解禁7-隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 71004 test考古迷踪$UNRELEASED$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 71009 (test)神秘的声音$UNRELEASED：source_missing；missing_dialogue_nodes, dialogue_talk_asset_missing, visibility_unreleased, excluded:unreleased_marker:missingDialogue
- 40001 灯自何处来$UNRELEASED：partial_dialogue；dialogue_partial, visibility_unreleased, excluded:unreleased_marker
- 40002 灯下暗流深$UNRELEASED：partial_dialogue；dialogue_partial, visibility_unreleased, excluded:unreleased_marker
- 40004 托风问故人$UNRELEASED：partial_dialogue；dialogue_partial, visibility_unreleased, excluded:unreleased_marker
- 40006 (test)海灯节氛围npc控制$UNRELEASED$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 600 第一及第二罪行：partial_dialogue；dialogue_talk_asset_ambiguous
- 601 众生的渴求：partial_dialogue；dialogue_talk_asset_ambiguous
- 602 园丁：partial_dialogue；dialogue_talk_asset_ambiguous
- 603 (test)???$UNRELEASED：source_missing；missing_dialogue_nodes, missing_subquests, dialogue_talk_asset_missing, visibility_unreleased, excluded:unreleased_marker:missingDialogue,missingSubquests
- 807 (test)测试用任务$UNRELEASED：partial_dialogue；dialogue_talk_asset_ambiguous, visibility_unreleased, excluded:unreleased_marker:missingSubquests
- 1019 意外之客：partial_dialogue；dialogue_talk_asset_ambiguous
- 1027 层岩间章Part2.5$HIDDEN：partial_dialogue；dialogue_dialogue_text_missing, visibility_hidden, excluded:hidden_show_type
- 1029 危机四伏：partial_dialogue；dialogue_talk_asset_ambiguous
- 1030 穷途末路：partial_dialogue；dialogue_talk_asset_ambiguous
- 1032 层岩间章Part3.5$HIDDEN：partial_dialogue；dialogue_dialogue_text_missing, visibility_hidden, excluded:hidden_show_type
- 2000 冲破雷暴之法：partial_dialogue；dialogue_talk_asset_ambiguous
- 2001 南十字武斗会：partial_dialogue；dialogue_talk_asset_ambiguous
- 2002 一路随风：partial_dialogue；dialogue_talk_asset_ambiguous
- 2003 三个心愿：partial_dialogue；dialogue_partial
- 2004 无意义的等待的意义：partial_dialogue；dialogue_talk_asset_ambiguous
- 2007 于狱中绽放之花：partial_dialogue；dialogue_talk_asset_ambiguous
- 2008 在审判的雷鸣声中：partial_dialogue；dialogue_talk_asset_ambiguous
- 2009 以反抗之人的名义：partial_dialogue；dialogue_talk_asset_ambiguous
- 2012 异乡人的忏悔录：partial_dialogue；dialogue_talk_asset_ambiguous
- 2013 离岛逃离计划：partial_dialogue；dialogue_talk_asset_ambiguous
- 2014 渴求神明注视之人：partial_dialogue；dialogue_talk_asset_ambiguous
- 2015 邪眼：partial_dialogue；dialogue_dialogue_text_missing
- 2016 眷属的践行：partial_dialogue；dialogue_partial
- 2021 愿望：partial_dialogue；dialogue_partial
- 3000 林中遇变：partial_dialogue；dialogue_talk_asset_ambiguous
- 3001 疗养观察：partial_dialogue；dialogue_talk_asset_ambiguous
- 3002 痼疾：partial_dialogue；dialogue_talk_asset_ambiguous
- 3003 缄默的求知者：partial_dialogue；dialogue_talk_asset_ambiguous
- 3004 智慧之神的踪影：partial_dialogue；dialogue_talk_asset_ambiguous
- 3005 失物匿于繁华：partial_dialogue；dialogue_talk_asset_ambiguous
- 3006 近在咫尺的目标：partial_dialogue；dialogue_talk_asset_ambiguous
- 3007 终将到来的花神诞祭：partial_dialogue；dialogue_talk_asset_ambiguous
- 3008 已然来临的花神诞祭：partial_dialogue；dialogue_talk_asset_ambiguous
- 3009 流转存续的花神诞祭：partial_dialogue；dialogue_talk_asset_ambiguous
- 3011 因果命运的花神诞祭：partial_dialogue；dialogue_talk_asset_ambiguous
- 3014 空幻回响的花神诞祭：partial_dialogue；dialogue_talk_asset_ambiguous
- 3016 如凯旋的英雄一般：partial_dialogue；dialogue_talk_asset_ambiguous
- 3018 剑拔弩张四人众：partial_dialogue；dialogue_talk_asset_ambiguous
- 3019 失踪的守村人：partial_dialogue；dialogue_dialogue_text_missing
- 3020 魔鳞病医院的哭声：partial_dialogue；dialogue_talk_asset_ambiguous
- 3021 热沙中的秘密：partial_dialogue；dialogue_talk_asset_ambiguous
- 3022 识藏日：partial_dialogue；dialogue_talk_asset_ambiguous
- 3024 行于黎明前夜幕里：partial_dialogue；dialogue_talk_asset_ambiguous
- 3025 如临神之畔：partial_dialogue；dialogue_talk_asset_ambiguous
- 3026 请饮下祝胜之酒：partial_dialogue；dialogue_dialogue_text_missing
- 3027 (test)隐藏npc控制任务$HIDDEN：partial_dialogue；dialogue_dialogue_text_missing, visibility_hidden, excluded:hidden_show_type
- 3028 意识之舟所至之处：partial_dialogue；dialogue_talk_asset_ambiguous
- 3029 夜中飞鸟坠于三段：partial_dialogue；dialogue_talk_asset_ambiguous
- 3031 幕切——倾奇之末：partial_dialogue；dialogue_talk_asset_ambiguous
- 3034 花于何处醒来：partial_dialogue；dialogue_talk_asset_ambiguous
- 3035 通向自我的歧途：partial_dialogue；dialogue_talk_asset_ambiguous
- 3036 旧影重现：partial_dialogue；dialogue_talk_asset_ambiguous
- 4001 真相流逝于雨后：partial_dialogue；dialogue_talk_asset_ambiguous
- 4002 当一切回归于水：partial_dialogue；dialogue_talk_asset_ambiguous
- 4004 独舞者的序幕：partial_dialogue；dialogue_talk_asset_ambiguous
- 4005 细雨眷恋之城：partial_dialogue；dialogue_talk_asset_ambiguous
- 4006 聚光灯下谎言成影：speaker_unresolved；dialogue_talk_asset_ambiguous, speaker_name_unresolved
- 4007 探入水底迷雾：partial_dialogue；dialogue_talk_asset_ambiguous
- 4008 真相隐于影中：partial_dialogue；dialogue_talk_asset_ambiguous
- 4010 灾厄的脚步：partial_dialogue；dialogue_talk_asset_ambiguous
- 4011 锋芒难掩的茶会：partial_dialogue；dialogue_talk_asset_ambiguous
- 4012 梅洛彼得堡：partial_dialogue；dialogue_talk_asset_ambiguous
- 4014 （test）主线任务预留02$UNRELEASED：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_metadata, visibility_unreleased, excluded:unreleased_marker
- 4015 匿于日常之禁忌：partial_dialogue；dialogue_talk_asset_ambiguous, excluded:bilingual_pair_incomplete
- 4018 深海的迷路者：partial_dialogue；dialogue_talk_asset_ambiguous
- 4020 相见亦是离别：partial_dialogue；dialogue_dialogue_text_missing
- 4021 狩猎者，预见者：partial_dialogue；dialogue_talk_asset_ambiguous
- 4022 审判日：partial_dialogue；dialogue_talk_asset_ambiguous
- 4024 黑潮与白露的歌剧：partial_dialogue；dialogue_graph_incomplete
- 4025 终幕礼：partial_dialogue；dialogue_talk_asset_ambiguous
- 5000 纳塔！新的旅程：partial_dialogue；dialogue_talk_asset_ambiguous
- 5001 归火圣夜巡礼：partial_dialogue；dialogue_talk_asset_ambiguous
- 5002 温泉之乡：partial_dialogue；dialogue_talk_asset_ambiguous
- 5004 古名寻回之旅：partial_dialogue；dialogue_talk_asset_ambiguous
- 5006 坠入永夜：partial_dialogue；dialogue_talk_asset_ambiguous
- 5010 共睹那日之将落：partial_dialogue；dialogue_talk_asset_ambiguous
- 5011 席卷而来的暗潮：partial_dialogue；dialogue_talk_asset_ambiguous
- 5012 绝望高悬天之上：partial_dialogue；dialogue_talk_asset_ambiguous
- 5014 名为「命运」的燃料：partial_dialogue；dialogue_talk_asset_ambiguous
- 5016 向着迷烟飘往之处：partial_dialogue；dialogue_talk_asset_ambiguous
- 5017 摇曳灯火一分为二：partial_dialogue；dialogue_talk_asset_ambiguous
- 5024 星与火的征途：partial_dialogue；dialogue_graph_incomplete
- 5026 为同一片土地：partial_dialogue；dialogue_talk_asset_ambiguous
- 5028 众望所归：partial_dialogue；dialogue_talk_asset_ambiguous
- 5029 当一切镌刻成碑：partial_dialogue；dialogue_talk_asset_ambiguous
- 5030 (test)(hide)二阶段闲置管理$HIDDEN：partial_dialogue；dialogue_graph_incomplete, visibility_hidden, excluded:hidden_show_type:missingSubquests
- 5031 Quest 5031：partial_dialogue；dialogue_talk_asset_ambiguous, title_unresolved, visibility_hidden, excluded:hidden_show_type:missingSubquests
- 5033 全新的巡礼：partial_dialogue；dialogue_talk_asset_ambiguous
- 5034 聆听，归来者：partial_dialogue；dialogue_talk_asset_ambiguous
- 5035 (test)茜特菈莉常驻$HIDDEN：partial_dialogue；dialogue_talk_asset_ambiguous, visibility_hidden, excluded:hidden_show_type:missingSubquests
- 6000 月亮升起的地方：partial_dialogue；dialogue_talk_asset_ambiguous
- 6001 于月光下重逢：partial_dialogue；dialogue_talk_asset_ambiguous
- 6002 在夜的阴影中：partial_dialogue；dialogue_talk_asset_ambiguous
- 6003 无月之夜：partial_dialogue；dialogue_talk_asset_ambiguous
- 6005 阴燃：partial_dialogue；dialogue_talk_asset_ambiguous
- 6006 逆焰：partial_dialogue；dialogue_talk_asset_ambiguous
- 6007 轰鸣与暗涌：partial_dialogue；dialogue_talk_asset_ambiguous
- 6010 灰白的秩序熊熊燃烧：partial_dialogue；dialogue_talk_asset_ambiguous
- 6011 遥不可及的安息：partial_dialogue；dialogue_talk_asset_ambiguous
- 6013 特别行动：partial_dialogue；dialogue_graph_incomplete
- 6014 如月长存：partial_dialogue；dialogue_talk_asset_ambiguous
- 6015 最初的那抹月光：partial_dialogue；dialogue_talk_asset_ambiguous
- 6016 月之将坠：partial_dialogue；dialogue_talk_asset_ambiguous
- 6017 空月归乡：partial_dialogue；dialogue_talk_asset_ambiguous
- 6018 皆为预言：partial_dialogue；dialogue_talk_asset_ambiguous
- 6019 蛇与蝎的亡命舞：partial_dialogue；dialogue_talk_asset_ambiguous
- 6020 命运的回声：partial_dialogue；dialogue_talk_asset_ambiguous
- 6022 你我交错的时空：partial_dialogue；dialogue_talk_asset_ambiguous
- 6023 循着过往的足迹：partial_dialogue；dialogue_talk_asset_ambiguous
- 6024 名于何处？：partial_dialogue；dialogue_talk_asset_ambiguous
- 6025 月影轮番登台：partial_dialogue；dialogue_talk_asset_ambiguous
- 6026 无法传达的涟漪：partial_dialogue；dialogue_talk_asset_ambiguous
- 6027 月亮回家的夜晚：partial_dialogue；dialogue_talk_asset_ambiguous
- 6028 回到月亮上去：partial_dialogue；dialogue_talk_asset_ambiguous
- 6034 幽暗时分：partial_dialogue；dialogue_talk_asset_ambiguous
- 6035 妄念与真知的通天塔：partial_dialogue；dialogue_talk_asset_ambiguous
- 6036 虚空劫灰往世书：partial_dialogue；dialogue_talk_asset_ambiguous
- 7003 (test)废弃$UNRELEASED：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_metadata, visibility_unreleased, excluded:unreleased_marker
- 7005 白幕降下：partial_dialogue；dialogue_partial
- 7006 莱莱可的自白：partial_dialogue；dialogue_talk_asset_ambiguous
- 7007 冬日静默如谜：partial_dialogue；dialogue_talk_asset_ambiguous
- 7008 死魂灵的夜曲：partial_dialogue；dialogue_talk_asset_ambiguous
- 7009 槲寄生：partial_dialogue；dialogue_talk_asset_ambiguous
- 7011 逆风向苦寒之北：partial_dialogue；dialogue_talk_asset_ambiguous
- 7012 沉寂之地的枪声：partial_dialogue；dialogue_talk_asset_ambiguous
- 7013 冰原上的伟业：partial_dialogue；dialogue_talk_asset_ambiguous
- 7014 唯沉默不受眷顾：partial_dialogue；dialogue_talk_asset_ambiguous
- 8000 非自愿的祭献：partial_dialogue；dialogue_talk_asset_ambiguous
- 8002 不荣誉的试炼：partial_dialogue；dialogue_talk_asset_ambiguous
- 其余 1122 条见 JSON。

## Story Structure Audit

- 系列：421；单任务系列：72；仅 aggregate 系列：6
- 重复系列标题：65；重复章节标题：212
- 孤立 aggregate：74；跨地区系列：4

## Topology / Talk / Dialogue Audit

- Raw edges：65306；Derived edges：6164；requires：1196；aggregate：122
- 拓扑 cycle：682；拓扑 dangling：94
- Talk expected/resolved/unresolved/ambiguous：27419/26958/461/2289
- Dialogue nodes/edges/dangling：491252/339264/2125
- rootless/cyclic graph：20/88；重复正文额外节点：201816
- Talk 全目录 metadata scan：55925；孤立对白资产：3927；metadata scan 失败：0

本报告只读取上游文件并在内存中运行转换，不写入数据库；应在所有规则完成后再执行一次候选导入。
