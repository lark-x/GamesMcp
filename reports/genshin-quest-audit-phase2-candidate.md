# 原神任务解析审计

- 上游：`F:\Project\GamesMcp\data\upstream\AnimeGameData-current`
- Commit：`26df1dfbdf05a82bbb1d97506859f3e1c40718d8`
- 主任务：4372
- 可发布双语记录：4972
- 完整/部分/仅元数据（中文）：2271/1324/246
- 解析失败：0
- Story Family：350；区域级其他独立任务：9；独立任务条目：3211
- Talk 已解析任务：2281；存在 Talk 问题的任务：1295

## BEFORE / AFTER / DELTA

```json
{
  "before": {
    "resolvedQuestCount": 3634,
    "dialogueNodeCount": 879978,
    "fallbackFamilyCount": null,
    "standaloneQuestCount": null,
    "aggregateCount": 270,
    "controlCount": 168,
    "talkUnresolvedCount": 255,
    "danglingEdgeCount": null,
    "publicNarrativeQuestCount": 2351,
    "publicNarrativeResolvedCount": 2350,
    "publicNarrativeDialogueNodes": 439989,
    "allNarrativeQuestCount": 3676,
    "allNarrativeResolvedCount": 3634,
    "allNarrativeDialogueNodes": 498880
  },
  "after": {
    "resolvedQuestCount": 2281,
    "dialogueNodeCount": 471044,
    "fallbackFamilyCount": 9,
    "standaloneQuestCount": 3211,
    "aggregateCount": 296,
    "controlCount": 177,
    "talkUnresolvedCount": 3200,
    "danglingEdgeCount": 2403,
    "publicNarrativeQuestCount": 2345,
    "publicNarrativeResolvedCount": 1580,
    "publicNarrativeDialogueNodes": 418252,
    "allNarrativeQuestCount": 3637,
    "allNarrativeResolvedCount": 2281,
    "allNarrativeDialogueNodes": 471044
  },
  "delta": {
    "resolvedQuestCount": -1353,
    "dialogueNodeCount": -408934,
    "fallbackFamilyCount": null,
    "standaloneQuestCount": null,
    "aggregateCount": 26,
    "controlCount": 9,
    "talkUnresolvedCount": 2945,
    "danglingEdgeCount": null,
    "publicNarrativeQuestCount": -6,
    "publicNarrativeResolvedCount": -770,
    "publicNarrativeDialogueNodes": -21737,
    "allNarrativeQuestCount": -39,
    "allNarrativeResolvedCount": -1353,
    "allNarrativeDialogueNodes": -27836
  }
}
```

## 重点核对

| 主任务 | 标题 | 系列 | 章节 | 对白 | 内容角色 | Talk 状态 | 质量 |
| --- | --- | --- | --- | ---: | --- | --- | --- |
| 21009 | 旧味难寻 | 其他独立任务 |  | 5 | story | partial | partial_dialogue |
| 72236 | 三色档案 | 其他独立任务 |  | 47 | story_and_control | partial | partial_dialogue |
| 73013 | 为那菈献上珍馐 | 愿为一炊之梦 | 愿为一炊之梦 | 140 | story_and_control | resolved | complete |
| 73019 | 料理是快乐的回忆 | 愿为一炊之梦 | 愿为一炊之梦 | 155 | story | resolved | complete |
| 73020 | 料理是自然的风味 | 愿为一炊之梦 | 愿为一炊之梦 | 107 | story_and_control | resolved | complete |
| 73021 | 料理是思归的香气 | 愿为一炊之梦 | 愿为一炊之梦 | 141 | story | resolved | complete |
| 73022 | 料理是分享的美好 | 愿为一炊之梦 | 愿为一炊之梦 | 187 | story | resolved | complete |
| 73189 | 无形壁障 | 其他独立任务 | 旧语新知 | 14 | story_and_control | resolved | complete |
| 74001 | 「水仙十字大冒险」 | 水仙十字系列 | 水仙的安·第一幕 「水仙十字大冒险」 | 653 | story_and_control | graph_incomplete | partial_dialogue |
| 74002 | 「公主」与「冒险团」的故事 | 水仙十字系列 | 水仙的安·第一幕 「水仙十字大冒险」 | 181 | story_and_control | resolved | complete |
| 74003 | 安的故事 | 水仙十字系列 | 水仙的安·第二幕 「镜中的王国」 | 319 | story_and_control | resolved | complete |
| 74004 | 玛丽安的故事 | 水仙十字系列 | 水仙的安·第三幕 「假如她不再梦到你…」 | 262 | story_and_control | resolved | complete |
| 74072 | 藻海的寻踪 | 水仙十字系列 | 水仙的追迹·第一幕 藻海的寻踪 | 943 | story_and_control | resolved | complete |
| 74073 | 缪斯的母亲 | 水仙十字系列 | 水仙的追迹·第一幕 藻海的寻踪 | 83 | story_and_control | resolved | complete |
| 74074 | 流星的投矛 | 水仙十字系列 | 水仙的追迹·第一幕 藻海的寻踪 | 81 | story_and_control | resolved | complete |
| 74075 | 丘比特的爱人 | 水仙十字系列 | 水仙的追迹·第一幕 藻海的寻踪 | 86 | story_and_control | resolved | complete |
| 74076 | 悲喜的面具 | 水仙十字系列 | 水仙的追迹·第一幕 藻海的寻踪 | 98 | story_and_control | resolved | complete |
| 74077 | 救世者的守灵 | 水仙十字系列 | 水仙的追迹·第二幕 救世者的守灵 | 119 | story_and_control | resolved | complete |
| 74078 | 溪舟的尾波 | 水仙十字系列 | 水仙的追迹·第四幕 溪舟的尾波 | 348 | story_and_control | graph_incomplete | partial_dialogue |
| 74165 | 大梦的醒转 | 水仙十字系列 | 水仙的追迹·第三幕 大梦的醒转 | 101 | story_and_control | resolved | complete |
| 74183 | 雷穆利亚的最后一日 | 谐律上的咏叙诗 | 谐律上的咏叙诗·第二章 被缚的囚徒 | 109 | story_and_control | resolved | complete |
| 74184 | 佩特莉可的阴霾 | 谐律上的咏叙诗 | 谐律上的咏叙诗·序曲 诡镇之梦 | 239 | story_and_control | partial | partial_dialogue |
| 74194 | 通往卡皮托林的阶梯 | 谐律上的咏叙诗 | 谐律上的咏叙诗·第三章 法沙利亚狂想曲 | 250 | story_and_control | resolved | complete |
| 74195 | 水下夜想曲 | 谐律上的咏叙诗 | 谐律上的咏叙诗·第一章 海魔王的宫殿 | 209 | story_and_control | partial | partial_dialogue |
| 74196 | 哀悼命运之疮 | 谐律上的咏叙诗 | 谐律上的咏叙诗·终章 安魂曲 | 203 | story_and_control | graph_incomplete | partial_dialogue |
| 76148 | 狮子奋迅 | 山中好长日 | 山中好长日·第二章 地狱 | 0 | story_and_control | talk_asset_ambiguous | partial_dialogue |
| 76152 | 狮子奋迅 | 山中好长日 | 山中好长日·第二章 地狱 | 0 | trigger | not_applicable | control |

## 非完整任务

- 347 阅读占坑$HIDDEN：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_unknown, visibility_hidden, excluded:hidden_show_type
- 348 猫尾酒馆留言板$HIDDEN：partial_dialogue；dialogue_partial, visibility_hidden, excluded:hidden_show_type
- 352 鸟瞰风物：partial_dialogue；dialogue_partial
- 361 风魔龙飞过$HIDDEN：source_missing；missing_dialogue_nodes, dialogue_talk_reference_missing, content_role_metadata, visibility_hidden, excluded:hidden_show_type:missingDialogue
- 306 昔日的风：partial_dialogue；dialogue_partial
- 307 骑士的现场教习：partial_dialogue；dialogue_partial
- 308 书页里的电火花：partial_dialogue；dialogue_partial
- 309 (test)蒙德之围$HIDDEN：partial_dialogue；dialogue_partial, visibility_hidden, excluded:hidden_show_type
- 310 招募新伙伴：partial_dialogue；missing_dialogue_nodes, dialogue_partial
- 311 (test)一阶段结束$HIDDEN：partial_dialogue；dialogue_dialogue_text_missing, visibility_hidden, excluded:hidden_show_type
- 370 阴影下的蒙德：partial_dialogue；dialogue_partial
- 371 不期而遇：partial_dialogue；dialogue_partial
- 372 那个绿色的家伙：partial_dialogue；dialogue_partial
- 373 听凭风引：partial_dialogue；dialogue_graph_incomplete
- 376 逃亡：partial_dialogue；dialogue_dialogue_text_missing
- 377 幕后谈话：partial_dialogue；dialogue_partial
- 20101 追逐暗影：partial_dialogue；dialogue_partial
- 385 (test)一起去冒险吧$UNRELEASED$HIDDEN：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_unknown, visibility_hidden, excluded:hidden_show_type
- 384 与巨龙重逢：partial_dialogue；dialogue_partial
- 394 为了青色的身影：partial_dialogue；dialogue_talk_asset_missing
- 398 尾声，风停之后：partial_dialogue；dialogue_partial
- 303 女神像解锁$HIDDEN：partial_dialogue；dialogue_talk_asset_ambiguous, visibility_hidden, excluded:hidden_show_type
- 407 璃月游戏$UNRELEASED：partial_dialogue；dialogue_partial, visibility_unreleased, excluded:unreleased_marker
- 408 浮桥跑酷$UNRELEASED：partial_dialogue；dialogue_partial, visibility_unreleased, excluded:unreleased_marker
- 409 史莱姆投篮$UNRELEASED：partial_dialogue；dialogue_partial, visibility_unreleased, excluded:unreleased_marker
- 416 跑道牙子$HIDDEN：source_missing；missing_dialogue_nodes, dialogue_talk_asset_missing, content_role_metadata, visibility_hidden, excluded:hidden_show_type:missingDialogue
- 418 探索剑冢封印：partial_dialogue；dialogue_partial
- 419 解除黑日族封印：control；content_role_trigger
- 420 解除好睡族封印：control；content_role_trigger
- 422 解除好肉族封印：control；content_role_trigger
- 424 高级潜入测试$UNRELEASED：source_missing；missing_dialogue_nodes, dialogue_talk_asset_missing, visibility_unreleased, excluded:unreleased_marker:missingDialogue
- 425 飞行测试任务$UNRELEASED：source_missing；missing_dialogue_nodes, dialogue_talk_asset_missing, visibility_unreleased, excluded:unreleased_marker:missingDialogue
- 428 安柏深渊$UNRELEASED：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_unreleased, excluded:unreleased_marker
- 429 史莱姆守卫战$UNRELEASED：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_unknown, visibility_unreleased, excluded:unreleased_marker
- 454 卢皮卡，即是命运的选择：partial_dialogue；dialogue_partial
- 461 凯亚的难题：partial_dialogue；dialogue_partial
- 464 暗夜英雄的传说：partial_dialogue；dialogue_partial
- 465 暗夜英雄的危机：partial_dialogue；dialogue_partial
- 466 暗夜英雄的不在场证明：partial_dialogue；dialogue_partial
- 469 七神的赐福：source_missing；missing_dialogue_nodes, dialogue_talk_asset_missing
- 471 风神瞳说明$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 482 风起地飞行特训$UNRELEASED：source_missing；missing_dialogue_nodes, dialogue_talk_asset_missing, visibility_unreleased, excluded:unreleased_marker:missingDialogue
- 481 风之翼随风而起：partial_dialogue；dialogue_partial
- 484 那家伙叫「怪鸟」：partial_dialogue；dialogue_partial
- 487 委托人玛格丽特的思念：partial_dialogue；dialogue_partial
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
- 999 (test)对话测试任务$UNRELEASED：partial_dialogue；dialogue_partial, visibility_unreleased, excluded:unreleased_marker
- 1000 请仙：partial_dialogue；dialogue_partial
- 1005 (test)海灯节活动完成记录$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 1006 (test)海灯节遇到魈的标记$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 1003 望舒：partial_dialogue；dialogue_partial
- 1008 叠山：partial_dialogue；dialogue_partial
- 1009 留云：partial_dialogue；dialogue_partial
- 1010 往生：partial_dialogue；dialogue_partial
- 1011 指月：partial_dialogue；dialogue_graph_incomplete
- 1012 传香：partial_dialogue；dialogue_partial
- 1014 壶天：partial_dialogue；dialogue_partial
- 1013 市井：partial_dialogue；dialogue_partial
- 1016 邀约：partial_dialogue；dialogue_partial
- 1026 (test)寻人启事刷新$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 1021 玑衡：partial_dialogue；dialogue_partial
- 1022 孤芳：partial_dialogue；dialogue_partial
- 1023 离心：partial_dialogue；dialogue_partial
- 1025 送仙：partial_dialogue；dialogue_partial
- 10100 麻烦的工作：partial_dialogue；dialogue_partial
- 10111 南风与冒险：partial_dialogue；dialogue_dialogue_text_missing
- 10114 (test)控制温迪的空闲对话$HIDDEN：source_missing；missing_dialogue_nodes, dialogue_talk_asset_missing, content_role_metadata, visibility_hidden, excluded:hidden_show_type:missingDialogue
- 10300 (test)芭芭拉线玩法白盒$UNRELEASED：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_unreleased, excluded:unreleased_marker
- 11005 料理对决：partial_dialogue；dialogue_partial
- 11006 (test)（弃用）$UNRELEASED：control；content_role_trigger, visibility_unreleased, excluded:unreleased_marker
- 12000 寻书巧遇江湖事：partial_dialogue；dialogue_partial
- 12002 山雨欲来风满楼：partial_dialogue；dialogue_partial
- 12003 淡泊名利侠客行：partial_dialogue；dialogue_partial
- 11103 诸境神游忽觉迷：partial_dialogue；dialogue_partial
- 20000 轻策庄限时抵达挑战$HIDDEN：partial_dialogue；dialogue_partial, visibility_hidden, excluded:hidden_show_type
- 20006 餐品订单：partial_dialogue；dialogue_partial
- 20016 餐品订单：partial_dialogue；dialogue_partial
- 20026 餐品订单：partial_dialogue；dialogue_partial
- 20037 触不可及的恋人：partial_dialogue；dialogue_graph_incomplete
- 20039 蒂玛乌斯的炼金指导：partial_dialogue；dialogue_partial, excluded:bilingual_pair_incomplete
- 20043 永不停歇的风与米歇尔小姐：partial_dialogue；dialogue_graph_incomplete
- 20051 蒙德城的酒：partial_dialogue；dialogue_partial
- 20058 诺拉快跑！：partial_dialogue；dialogue_graph_incomplete
- 20061 鸽子习惯一去不回：partial_dialogue；dialogue_partial
- 22003 勿言勿笑：partial_dialogue；dialogue_graph_incomplete
- 22111 冒险要朝着远方：partial_dialogue；dialogue_partial
- 22116 这本小说会很厉害！：speaker_unresolved；dialogue_dialogue_text_missing, speaker_name_unresolved
- 22301 且听下回分解：partial_dialogue；dialogue_partial
- 22305 点石成…什么：partial_dialogue；dialogue_graph_incomplete
- 20032 开启事件系统$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 20500 (test)武器强化$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 20501 秘境中的古树：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_unknown
- 20502 忘却之峡：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_unknown
- 20507 (test)蒙德传送点教学$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 20508 (test)第一次通关地城指引（隐藏）$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 20509 (test)PC呼出鼠标教学$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 20510 (test)发放树脂用（隐藏）$HIDDEN：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_unknown, visibility_hidden, excluded:hidden_show_type
- 21003 独木难支：partial_dialogue；dialogue_partial
- 21005 望舒客栈限时抵达挑战$HIDDEN：partial_dialogue；dialogue_partial, visibility_hidden, excluded:hidden_show_type
- 21009 旧味难寻：partial_dialogue；dialogue_partial
- 21011 (test)璃月漂流瓶收集任务$UNRELEASED$HIDDEN：partial_dialogue；dialogue_partial, visibility_hidden, excluded:hidden_show_type
- 21012 扫梯而下$UNRELEASED：partial_dialogue；dialogue_partial, visibility_unreleased, excluded:unreleased_marker
- 21013 丘占木巢$HIDDEN：source_missing；missing_dialogue_nodes, dialogue_talk_asset_missing, content_role_unknown, visibility_hidden, excluded:hidden_show_type:missingDialogue
- 21014 (test)璃月入口镜头$UNRELEASED$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 21016 瀑布群限时抵达挑战$HIDDEN：partial_dialogue；dialogue_partial, visibility_hidden, excluded:hidden_show_type
- 21017 瑶光滩限时抵达挑战$HIDDEN：partial_dialogue；dialogue_partial, visibility_hidden, excluded:hidden_show_type
- 21018 冒险从捉迷藏开始$UNRELEASED$HIDDEN：partial_dialogue；dialogue_partial, visibility_hidden, excluded:hidden_show_type
- 21021 古云有「螭」：partial_dialogue；dialogue_partial
- 21023 暂行之策：partial_dialogue；dialogue_partial
- 25000 解禁1-隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 25002 解禁2-隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 25004 解禁3-隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 25006 解禁4-隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 25008 解禁5-隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 25010 解禁6-隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 25012 解禁7-隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 25014 解禁8-隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 71004 test考古迷踪$UNRELEASED$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 71009 (test)神秘的声音$UNRELEASED：source_missing；missing_dialogue_nodes, dialogue_talk_asset_missing, visibility_unreleased, excluded:unreleased_marker:missingDialogue
- 40001 灯自何处来$UNRELEASED：partial_dialogue；dialogue_partial, visibility_unreleased, excluded:unreleased_marker
- 40002 灯下暗流深$UNRELEASED：partial_dialogue；dialogue_partial, visibility_unreleased, excluded:unreleased_marker
- 40004 托风问故人$UNRELEASED：partial_dialogue；dialogue_partial, visibility_unreleased, excluded:unreleased_marker
- 40006 (test)海灯节氛围npc控制$UNRELEASED$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 600 第一及第二罪行：partial_dialogue；dialogue_graph_incomplete
- 601 众生的渴求：partial_dialogue；dialogue_graph_incomplete
- 603 (test)???$UNRELEASED：source_missing；missing_dialogue_nodes, missing_subquests, dialogue_talk_asset_missing, visibility_unreleased, excluded:unreleased_marker:missingDialogue,missingSubquests
- 807 (test)测试用任务$UNRELEASED：partial_dialogue；missing_dialogue_nodes, missing_subquests, dialogue_talk_asset_ambiguous, content_role_metadata, visibility_unreleased, excluded:unreleased_marker:missingDialogue,missingSubquests
- 1027 层岩间章Part2.5$HIDDEN：partial_dialogue；dialogue_dialogue_text_missing, visibility_hidden, excluded:hidden_show_type
- 1030 穷途末路：partial_dialogue；dialogue_dialogue_text_missing
- 1031 绝处逢生：partial_dialogue；dialogue_partial
- 1032 层岩间章Part3.5$HIDDEN：partial_dialogue；dialogue_dialogue_text_missing, visibility_hidden, excluded:hidden_show_type
- 2000 冲破雷暴之法：partial_dialogue；dialogue_partial
- 2001 南十字武斗会：partial_dialogue；dialogue_talk_asset_ambiguous
- 2002 一路随风：partial_dialogue；dialogue_partial
- 2003 三个心愿：partial_dialogue；dialogue_partial
- 2004 无意义的等待的意义：partial_dialogue；dialogue_partial
- 2005 愿仁义之人被仁义以待：partial_dialogue；dialogue_partial
- 2006 剑道家的道路铺满剑道梦的碎片：partial_dialogue；dialogue_partial
- 2007 于狱中绽放之花：partial_dialogue；dialogue_dialogue_text_missing
- 2008 在审判的雷鸣声中：partial_dialogue；dialogue_dialogue_text_missing
- 2009 以反抗之人的名义：partial_dialogue；dialogue_partial
- 2011 起航之日：partial_dialogue；dialogue_partial
- 2013 离岛逃离计划：partial_dialogue；dialogue_partial
- 2015 邪眼：partial_dialogue；dialogue_dialogue_text_missing
- 2016 眷属的践行：partial_dialogue；dialogue_partial
- 2021 愿望：partial_dialogue；dialogue_partial
- 3003 缄默的求知者：partial_dialogue；dialogue_partial
- 3004 智慧之神的踪影：partial_dialogue；dialogue_partial
- 3005 失物匿于繁华：partial_dialogue；dialogue_partial
- 3009 流转存续的花神诞祭：partial_dialogue；dialogue_partial
- 3017 来自某位「神明」的凝视：partial_dialogue；dialogue_partial
- 3018 剑拔弩张四人众：partial_dialogue；dialogue_dialogue_text_missing
- 3019 失踪的守村人：partial_dialogue；dialogue_dialogue_text_missing
- 3020 魔鳞病医院的哭声：partial_dialogue；dialogue_partial
- 3022 识藏日：partial_dialogue；dialogue_dialogue_text_missing
- 3026 请饮下祝胜之酒：partial_dialogue；dialogue_dialogue_text_missing
- 3027 (test)隐藏npc控制任务$HIDDEN：partial_dialogue；dialogue_dialogue_text_missing, visibility_hidden, excluded:hidden_show_type
- 3033 （test）修改3.3间章完成后任务$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 3035 通向自我的歧途：partial_dialogue；dialogue_talk_asset_ambiguous
- 3036 旧影重现：partial_dialogue；dialogue_talk_asset_ambiguous
- 4001 真相流逝于雨后：partial_dialogue；dialogue_partial
- 4004 独舞者的序幕：partial_dialogue；dialogue_partial
- 4005 细雨眷恋之城：partial_dialogue；dialogue_partial
- 4006 聚光灯下谎言成影：speaker_unresolved；dialogue_partial, speaker_name_unresolved
- 4007 探入水底迷雾：partial_dialogue；dialogue_graph_incomplete
- 4010 灾厄的脚步：partial_dialogue；dialogue_dialogue_text_missing
- 4011 锋芒难掩的茶会：partial_dialogue；dialogue_partial
- 4014 （test）主线任务预留02$UNRELEASED：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_metadata, visibility_unreleased, excluded:unreleased_marker
- 4020 相见亦是离别：partial_dialogue；dialogue_dialogue_text_missing
- 4021 狩猎者，预见者：partial_dialogue；dialogue_graph_incomplete
- 4022 审判日：partial_dialogue；dialogue_talk_asset_ambiguous
- 4023 怒涛之灾：partial_dialogue；dialogue_partial
- 4024 黑潮与白露的歌剧：partial_dialogue；dialogue_graph_incomplete
- 4029 Quest 4029：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_metadata, title_unresolved, visibility_hidden, excluded:hidden_show_type
- 5000 纳塔！新的旅程：partial_dialogue；dialogue_partial
- 5001 归火圣夜巡礼：partial_dialogue；dialogue_partial
- 5002 温泉之乡：partial_dialogue；dialogue_partial
- 5006 坠入永夜：partial_dialogue；dialogue_graph_incomplete
- 5012 绝望高悬天之上：partial_dialogue；dialogue_graph_incomplete
- 5024 星与火的征途：partial_dialogue；dialogue_graph_incomplete
- 5028 众望所归：partial_dialogue；dialogue_dialogue_text_missing
- 5029 当一切镌刻成碑：partial_dialogue；dialogue_partial
- 5030 (test)(hide)二阶段闲置管理$HIDDEN：partial_dialogue；dialogue_graph_incomplete, visibility_hidden, excluded:hidden_show_type:missingSubquests
- 5031 Quest 5031：partial_dialogue；missing_dialogue_nodes, missing_subquests, dialogue_talk_asset_ambiguous, title_unresolved, visibility_hidden, excluded:hidden_show_type:missingDialogue,missingSubquests
- 5033 全新的巡礼：partial_dialogue；dialogue_graph_incomplete
- 6003 无月之夜：partial_dialogue；dialogue_graph_incomplete
- 6006 逆焰：partial_dialogue；dialogue_partial
- 6011 遥不可及的安息：partial_dialogue；dialogue_partial
- 6013 特别行动：partial_dialogue；dialogue_graph_incomplete
- 其余 1593 条见 JSON。

## Story Structure Audit

- 系列：350；单任务系列：69；仅 aggregate 系列：5
- 重复系列标题：42；重复章节标题：212
- 孤立 aggregate：293；跨地区系列：2

## Topology / Talk / Dialogue Audit

- Raw edges：66659；Derived edges：1318；requires：1196；aggregate：122
- 拓扑 cycle：26；拓扑 dangling：94
- Talk expected/resolved/unresolved/ambiguous：27420/24220/3200/406
- Dialogue nodes/edges/dangling：471044/323895/2403
- rootless/cyclic graph：19/85；重复正文额外节点：194810
- Talk 全目录 metadata scan：55925；孤立对白资产：3927；metadata scan 失败：0

本报告只读取上游文件并在内存中运行转换，不写入数据库；应在所有规则完成后再执行一次候选导入。
