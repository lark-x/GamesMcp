# 原神任务解析审计

- 上游：`F:\Project\GamesMcp\data\upstream\AnimeGameData-current`
- Commit：`26df1dfbdf05a82bbb1d97506859f3e1c40718d8`
- 主任务：4372
- 可发布双语记录：4972
- 完整/部分/仅元数据（中文）：3173/425/330
- 解析失败：0
- Story Family：382；区域级其他独立任务：9；独立任务条目：3214
- Talk 已解析任务：3184；存在 Talk 问题的任务：232

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
    "resolvedQuestCount": 3184,
    "dialogueNodeCount": 475952,
    "fallbackFamilyCount": 9,
    "standaloneQuestCount": 3214,
    "aggregateCount": 3,
    "controlCount": 397,
    "talkUnresolvedCount": 424,
    "danglingEdgeCount": 2072,
    "publicNarrativeQuestCount": 2345,
    "publicNarrativeResolvedCount": 2001,
    "publicNarrativeDialogueNodes": 422437,
    "allNarrativeQuestCount": 3639,
    "allNarrativeResolvedCount": 3184,
    "allNarrativeDialogueNodes": 475952
  },
  "delta": {
    "resolvedQuestCount": -450,
    "dialogueNodeCount": -404026,
    "fallbackFamilyCount": null,
    "standaloneQuestCount": null,
    "aggregateCount": -267,
    "controlCount": 229,
    "talkUnresolvedCount": 169,
    "danglingEdgeCount": null,
    "publicNarrativeQuestCount": -6,
    "publicNarrativeResolvedCount": -349,
    "publicNarrativeDialogueNodes": -17552,
    "allNarrativeQuestCount": -37,
    "allNarrativeResolvedCount": -450,
    "allNarrativeDialogueNodes": -22928
  }
}
```

## 重点核对

| 主任务 | 标题 | 系列 | 章节 | 对白 | 内容角色 | Talk 状态 | 质量 |
| --- | --- | --- | --- | ---: | --- | --- | --- |
| 21009 | 旧味难寻 | 其他独立任务 |  | 5 | story | resolved | complete |
| 72236 | 三色档案 | 其他独立任务 |  | 47 | story_and_control | resolved | complete |
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
| 74184 | 佩特莉可的阴霾 | 谐律上的咏叙诗 | 谐律上的咏叙诗·序曲 诡镇之梦 | 239 | story_and_control | resolved | complete |
| 74194 | 通往卡皮托林的阶梯 | 谐律上的咏叙诗 | 谐律上的咏叙诗·第三章 法沙利亚狂想曲 | 250 | story_and_control | resolved | complete |
| 74195 | 水下夜想曲 | 谐律上的咏叙诗 | 谐律上的咏叙诗·第一章 海魔王的宫殿 | 209 | story_and_control | partial | partial_dialogue |
| 74196 | 哀悼命运之疮 | 谐律上的咏叙诗 | 谐律上的咏叙诗·终章 安魂曲 | 203 | story_and_control | graph_incomplete | partial_dialogue |
| 76148 | 狮子奋迅 | 山中好长日 | 山中好长日·第二章 地狱 | 28 | story_and_control | resolved | complete |
| 76152 | 狮子奋迅 | 山中好长日 | 山中好长日·第二章 地狱 | 0 | trigger | not_applicable | control |

## 非完整任务

- 347 阅读占坑$HIDDEN：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_unknown, visibility_hidden, excluded:hidden_show_type
- 361 风魔龙飞过$HIDDEN：source_missing；missing_dialogue_nodes, dialogue_talk_reference_missing, content_role_metadata, visibility_hidden, excluded:hidden_show_type:missingDialogue
- 310 招募新伙伴：source_missing；missing_dialogue_nodes, dialogue_talk_asset_missing
- 311 (test)一阶段结束$HIDDEN：partial_dialogue；dialogue_dialogue_text_missing, visibility_hidden, excluded:hidden_show_type
- 370 阴影下的蒙德：partial_dialogue；dialogue_partial
- 373 听凭风引：partial_dialogue；dialogue_graph_incomplete
- 376 逃亡：partial_dialogue；dialogue_dialogue_text_missing
- 20101 追逐暗影：partial_dialogue；dialogue_dialogue_text_missing
- 385 (test)一起去冒险吧$UNRELEASED$HIDDEN：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_unknown, visibility_hidden, excluded:hidden_show_type
- 398 尾声，风停之后：partial_dialogue；dialogue_partial
- 303 女神像解锁$HIDDEN：partial_dialogue；dialogue_talk_asset_ambiguous, visibility_hidden, excluded:hidden_show_type
- 416 跑道牙子$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 419 解除黑日族封印：control；content_role_trigger
- 420 解除好睡族封印：control；content_role_trigger
- 422 解除好肉族封印：control；content_role_trigger
- 424 高级潜入测试$UNRELEASED：source_missing；missing_dialogue_nodes, dialogue_talk_asset_missing, visibility_unreleased, excluded:unreleased_marker:missingDialogue
- 425 飞行测试任务$UNRELEASED：source_missing；missing_dialogue_nodes, dialogue_talk_asset_missing, visibility_unreleased, excluded:unreleased_marker:missingDialogue
- 428 安柏深渊$UNRELEASED：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_unreleased, excluded:unreleased_marker
- 429 史莱姆守卫战$UNRELEASED：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_unknown, visibility_unreleased, excluded:unreleased_marker
- 465 暗夜英雄的危机：partial_dialogue；dialogue_partial
- 469 七神的赐福：partial_dialogue；dialogue_dialogue_text_missing
- 471 风神瞳说明$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 482 风起地飞行特训$UNRELEASED：partial_dialogue；dialogue_partial, visibility_unreleased, excluded:unreleased_marker
- 484 那家伙叫「怪鸟」：partial_dialogue；dialogue_partial
- 488 委托人查尔斯的烦恼：partial_dialogue；dialogue_graph_incomplete
- 489 委托人莎拉的忧愁：partial_dialogue；dialogue_dialogue_text_missing
- 490 骑士团长的一日假期：partial_dialogue；dialogue_graph_incomplete
- 990 (test)对话编辑器测试任务$UNRELEASED：partial_dialogue；dialogue_dialogue_text_missing, visibility_unreleased, excluded:unreleased_marker
- 991 (test)冲突NPC测试1$UNRELEASED：source_missing；missing_dialogue_nodes, missing_subquests, dialogue_talk_asset_missing, content_role_unknown, visibility_unreleased, excluded:unreleased_marker:missingDialogue,missingSubquests
- 992 (test)冲突NPC测试2$UNRELEASED：source_missing；missing_dialogue_nodes, missing_subquests, dialogue_talk_asset_missing, content_role_unknown, visibility_unreleased, excluded:unreleased_marker:missingDialogue,missingSubquests
- 993 (test)玉京台潜入测试$UNRELEASED：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_unreleased, excluded:unreleased_marker
- 994 (test)主角Freestyle动作测试$UNRELEASED：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_unreleased, excluded:unreleased_marker
- 995 (test)单元测试任务$UNRELEASED：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_unreleased, excluded:unreleased_marker
- 997 (test)测试对话编辑器$UNRELEASED：partial_dialogue；dialogue_partial, visibility_unreleased, excluded:unreleased_marker
- 998 (test)任务测试任务$UNRELEASED：partial_dialogue；dialogue_partial, visibility_unreleased, excluded:unreleased_marker
- 999 (test)对话测试任务$UNRELEASED：partial_dialogue；dialogue_partial, visibility_unreleased, excluded:unreleased_marker
- 1005 (test)海灯节活动完成记录$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 1006 (test)海灯节遇到魈的标记$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 1008 叠山：partial_dialogue；dialogue_dialogue_text_missing
- 1010 往生：partial_dialogue；dialogue_partial
- 1011 指月：partial_dialogue；dialogue_graph_incomplete
- 1012 传香：partial_dialogue；dialogue_partial
- 1013 市井：partial_dialogue；dialogue_partial
- 1026 (test)寻人启事刷新$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 1022 孤芳：partial_dialogue；dialogue_graph_incomplete
- 10111 南风与冒险：partial_dialogue；dialogue_dialogue_text_missing
- 10114 (test)控制温迪的空闲对话$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
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
- 20032 开启事件系统$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 20500 (test)武器强化$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 20501 秘境中的古树：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_unknown
- 20502 忘却之峡：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_unknown
- 20507 (test)蒙德传送点教学$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 20508 (test)第一次通关地城指引（隐藏）$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 20509 (test)PC呼出鼠标教学$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 20510 (test)发放树脂用（隐藏）$HIDDEN：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_unknown, visibility_hidden, excluded:hidden_show_type
- 21013 丘占木巢$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_unknown, visibility_hidden, excluded:hidden_show_type
- 21014 (test)璃月入口镜头$UNRELEASED$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 25000 解禁1-隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 25001 冒险等阶突破·一：metadata_only；missing_dialogue_nodes, content_role_metadata
- 25002 解禁2-隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 25003 冒险等阶突破·二：metadata_only；missing_dialogue_nodes, content_role_metadata
- 25004 解禁3-隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 25005 冒险等阶突破·二：metadata_only；missing_dialogue_nodes, content_role_metadata
- 25006 解禁4-隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 25007 冒险等阶突破·二：metadata_only；missing_dialogue_nodes, content_role_metadata
- 25008 解禁5-隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 25009 冒险等阶突破·三：metadata_only；missing_dialogue_nodes, content_role_metadata
- 25010 解禁6-隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 25011 冒险等阶突破·四：metadata_only；missing_dialogue_nodes, content_role_metadata
- 25012 解禁7-隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 25013 冒险等阶突破·七：metadata_only；missing_dialogue_nodes, content_role_metadata
- 25014 解禁8-隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 25015 世界等级突破：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_metadata
- 71002 忽得一信向天飞$HIDDEN：control；content_role_trigger, visibility_hidden, excluded:hidden_show_type
- 71004 test考古迷踪$UNRELEASED$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 71009 (test)神秘的声音$UNRELEASED：source_missing；missing_dialogue_nodes, dialogue_talk_asset_missing, visibility_unreleased, excluded:unreleased_marker:missingDialogue
- 40001 灯自何处来$UNRELEASED：partial_dialogue；dialogue_dialogue_text_missing, visibility_unreleased, excluded:unreleased_marker
- 40004 托风问故人$UNRELEASED：partial_dialogue；dialogue_dialogue_text_missing, visibility_unreleased, excluded:unreleased_marker
- 40006 (test)海灯节氛围npc控制$UNRELEASED$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 600 第一及第二罪行：partial_dialogue；dialogue_graph_incomplete
- 601 众生的渴求：partial_dialogue；dialogue_graph_incomplete
- 603 (test)???$UNRELEASED：source_missing；missing_dialogue_nodes, missing_subquests, dialogue_talk_asset_missing, visibility_unreleased, excluded:unreleased_marker:missingDialogue,missingSubquests
- 1027 层岩间章Part2.5$HIDDEN：partial_dialogue；dialogue_dialogue_text_missing, visibility_hidden, excluded:hidden_show_type
- 1030 穷途末路：partial_dialogue；dialogue_dialogue_text_missing
- 1032 层岩间章Part3.5$HIDDEN：partial_dialogue；dialogue_dialogue_text_missing, visibility_hidden, excluded:hidden_show_type
- 2001 南十字武斗会：partial_dialogue；dialogue_talk_asset_ambiguous
- 2003 三个心愿：partial_dialogue；dialogue_partial
- 2007 于狱中绽放之花：partial_dialogue；dialogue_dialogue_text_missing
- 2008 在审判的雷鸣声中：partial_dialogue；dialogue_dialogue_text_missing
- 2009 以反抗之人的名义：partial_dialogue；dialogue_partial
- 2015 邪眼：partial_dialogue；dialogue_dialogue_text_missing
- 2016 眷属的践行：partial_dialogue；dialogue_partial
- 2021 愿望：partial_dialogue；dialogue_partial
- 3009 流转存续的花神诞祭：partial_dialogue；dialogue_partial
- 3018 剑拔弩张四人众：partial_dialogue；dialogue_dialogue_text_missing
- 3019 失踪的守村人：partial_dialogue；dialogue_dialogue_text_missing
- 3022 识藏日：partial_dialogue；dialogue_dialogue_text_missing
- 3026 请饮下祝胜之酒：partial_dialogue；dialogue_dialogue_text_missing
- 3027 (test)隐藏npc控制任务$HIDDEN：partial_dialogue；dialogue_dialogue_text_missing, visibility_hidden, excluded:hidden_show_type
- 3033 （test）修改3.3间章完成后任务$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 3035 通向自我的歧途：partial_dialogue；dialogue_talk_asset_ambiguous
- 3036 旧影重现：partial_dialogue；dialogue_talk_asset_ambiguous
- 4006 聚光灯下谎言成影：speaker_unresolved；dialogue_partial, speaker_name_unresolved
- 4007 探入水底迷雾：partial_dialogue；dialogue_graph_incomplete
- 4010 灾厄的脚步：partial_dialogue；dialogue_dialogue_text_missing
- 4014 （test）主线任务预留02$UNRELEASED：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_metadata, visibility_unreleased, excluded:unreleased_marker
- 4020 相见亦是离别：partial_dialogue；dialogue_dialogue_text_missing
- 4021 狩猎者，预见者：partial_dialogue；dialogue_graph_incomplete
- 4022 审判日：partial_dialogue；dialogue_talk_asset_ambiguous
- 4024 黑潮与白露的歌剧：partial_dialogue；dialogue_graph_incomplete
- 4029 Quest 4029：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_metadata, title_unresolved, visibility_hidden, excluded:hidden_show_type
- 5000 纳塔！新的旅程：partial_dialogue；dialogue_graph_incomplete
- 5002 温泉之乡：partial_dialogue；dialogue_graph_incomplete
- 5006 坠入永夜：partial_dialogue；dialogue_graph_incomplete
- 5012 绝望高悬天之上：partial_dialogue；dialogue_graph_incomplete
- 5024 星与火的征途：partial_dialogue；dialogue_graph_incomplete
- 5028 众望所归：partial_dialogue；dialogue_dialogue_text_missing
- 5029 当一切镌刻成碑：partial_dialogue；dialogue_dialogue_text_missing
- 5030 (test)(hide)二阶段闲置管理$HIDDEN：partial_dialogue；dialogue_graph_incomplete, visibility_hidden, excluded:hidden_show_type:missingSubquests
- 5031 Quest 5031：partial_dialogue；missing_dialogue_nodes, missing_subquests, dialogue_talk_asset_ambiguous, title_unresolved, visibility_hidden, excluded:hidden_show_type:missingDialogue,missingSubquests
- 5033 全新的巡礼：partial_dialogue；dialogue_graph_incomplete
- 6003 无月之夜：partial_dialogue；dialogue_graph_incomplete
- 6013 特别行动：partial_dialogue；dialogue_graph_incomplete
- 6017 空月归乡：partial_dialogue；dialogue_graph_incomplete
- 6018 皆为预言：partial_dialogue；dialogue_graph_incomplete
- 6020 命运的回声：partial_dialogue；dialogue_dialogue_text_missing
- 6022 你我交错的时空：partial_dialogue；dialogue_dialogue_text_missing
- 6023 循着过往的足迹：partial_dialogue；dialogue_dialogue_text_missing
- 6024 名于何处？：partial_dialogue；dialogue_dialogue_text_missing
- 6026 无法传达的涟漪：partial_dialogue；dialogue_dialogue_text_missing
- 6027 月亮回家的夜晚：partial_dialogue；dialogue_dialogue_text_missing
- 6028 回到月亮上去：partial_dialogue；dialogue_graph_incomplete
- 6034 幽暗时分：partial_dialogue；dialogue_graph_incomplete
- 7000 (test)隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 7001 (test)隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 7002 (test)隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 7003 (test)废弃$UNRELEASED：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_metadata, visibility_unreleased, excluded:unreleased_marker
- 7005 白幕降下：partial_dialogue；dialogue_partial
- 7006 莱莱可的自白：partial_dialogue；dialogue_dialogue_text_missing
- 7007 冬日静默如谜：partial_dialogue；dialogue_graph_incomplete
- 7009 槲寄生：partial_dialogue；dialogue_graph_incomplete
- 7011 逆风向苦寒之北：partial_dialogue；dialogue_dialogue_text_missing
- 7012 沉寂之地的枪声：partial_dialogue；dialogue_dialogue_text_missing
- 7013 冰原上的伟业：partial_dialogue；dialogue_dialogue_text_missing
- 7014 唯沉默不受眷顾：partial_dialogue；dialogue_dialogue_text_missing
- 8007 黑蛇骑士的荣光：partial_dialogue；dialogue_partial
- 8013 卡利贝尔：control；content_role_trigger, visibility_hidden, excluded:hidden_show_type
- 8017 「救世主」：partial_dialogue；dialogue_graph_incomplete
- 8021 以世界之格的诉说：partial_dialogue；dialogue_graph_incomplete
- 10500 占星术与五十年之约：partial_dialogue；dialogue_dialogue_text_missing
- 10501 向蒙德进发：partial_dialogue；dialogue_dialogue_text_missing
- 10801 (test)隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 11012 童话里的守梦人：partial_dialogue；dialogue_graph_incomplete
- 11013 鸣海栖霞：partial_dialogue；dialogue_dialogue_text_missing
- 11014 往事如尘：partial_dialogue；dialogue_partial
- 11016 (test)间章隐藏任务刷群玉阁$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 11020 旧日之影：partial_dialogue；dialogue_talk_asset_ambiguous
- 11123 变乱似流，磐石不转：partial_dialogue；dialogue_dialogue_text_missing
- 11200 Quest 11200：partial_dialogue；missing_dialogue_nodes, dialogue_dialogue_text_missing, title_unresolved, visibility_unresolved, excluded:unresolved_title:missingDialogue
- 11201 Quest 11201：partial_dialogue；missing_dialogue_nodes, dialogue_dialogue_text_missing, title_unresolved, visibility_unresolved, excluded:unresolved_title:missingDialogue
- 11202 Quest 11202：partial_dialogue；missing_dialogue_nodes, dialogue_dialogue_text_missing, title_unresolved, visibility_unresolved, excluded:unresolved_title:missingDialogue
- 12005 丝织之愿：partial_dialogue；dialogue_partial
- 12008 愿与君同：partial_dialogue；dialogue_dialogue_text_missing
- 12017 质料恒常无易：partial_dialogue；dialogue_partial
- 12038 乱象识真面：partial_dialogue；dialogue_dialogue_text_missing
- 12800 Quest 12800：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_metadata, title_unresolved, visibility_hidden, excluded:hidden_show_type
- 13002 机械之心：partial_dialogue；dialogue_dialogue_text_missing
- 13009 走私疑案：partial_dialogue；dialogue_dialogue_text_missing
- 13011 终归沉寂：partial_dialogue；dialogue_partial
- 13017 Quest 13017：metadata_only；missing_dialogue_nodes, content_role_metadata, title_unresolved, visibility_hidden, excluded:hidden_show_type
- 13018 Quest 13018：metadata_only；missing_dialogue_nodes, content_role_metadata, title_unresolved, visibility_hidden, excluded:hidden_show_type
- 13019 若忘记家在何处：partial_dialogue；dialogue_partial
- 13032 横贯天际之花：partial_dialogue；dialogue_dialogue_text_missing
- 13033 Quest 13033：metadata_only；missing_dialogue_nodes, content_role_metadata, title_unresolved, visibility_hidden, excluded:hidden_show_type
- 13034 （test）补充爱尔海森个人线全局变量$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_unknown, visibility_hidden, excluded:hidden_show_type
- 14005 以「檐帽会」为傲：partial_dialogue；dialogue_dialogue_text_missing
- 14006 罪有应得：partial_dialogue；dialogue_dialogue_text_missing
- 14007 似曾相识的威胁：partial_dialogue；dialogue_graph_incomplete
- 14016 遗落与传承：partial_dialogue；dialogue_partial
- 14017 昔日之泪，明日之灯：partial_dialogue；dialogue_dialogue_text_missing
- 14019 被遗忘的怪盗：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 14022 所织与所斩：partial_dialogue；dialogue_partial
- 14026 步入阳光之下：partial_dialogue；dialogue_dialogue_text_missing
- 14036 (test)克洛琳德线镜像大世界入口控制$HIDDEN：partial_dialogue；dialogue_talk_asset_ambiguous, visibility_hidden, excluded:hidden_show_type:missingSubquests
- 14040 (test)希格雯个人线隐藏父任务控制group卸载$HIDDEN：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 14045 以炽焰炙烤：partial_dialogue；dialogue_talk_asset_ambiguous
- 15001 英雄的仪式：partial_dialogue；dialogue_graph_incomplete
- 15008 鳍游龙的聚会：partial_dialogue；dialogue_talk_asset_ambiguous
- 15009 天空与海的谜题：partial_dialogue；dialogue_graph_incomplete
- 15012 嵴锋的异响：partial_dialogue；dialogue_graph_incomplete
- 其余 824 条见 JSON。

## Story Structure Audit

- 系列：382；单任务系列：100；仅 aggregate 系列：0
- 重复系列标题：41；重复章节标题：212
- 孤立 aggregate：0；跨地区系列：0

## Topology / Talk / Dialogue Audit

- Raw edges：66659；Derived edges：1318；requires：1196；aggregate：122
- 拓扑 cycle：26；拓扑 dangling：94
- Talk expected/resolved/unresolved/ambiguous：25044/24620/424/43
- Dialogue nodes/edges/dangling：475952/328481/2072
- rootless/cyclic graph：19/86；重复正文额外节点：196435
- Talk 全目录 metadata scan：55925；孤立对白资产：24325；metadata scan 失败：0

本报告只读取上游文件并在内存中运行转换，不写入数据库；应在所有规则完成后再执行一次候选导入。
