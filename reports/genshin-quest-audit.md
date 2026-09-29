# 原神任务解析审计

- 上游：`F:\Project\GamesMcp\data\upstream\AnimeGameData-current`
- Commit：`9587d1afbd9ab0419cdd00dc05ecd114b9e3fe99`
- 主任务：4417
- 可发布双语记录：5070
- 完整/部分/仅元数据（中文）：3322/338/332
- 解析失败：0
- Story Family：115；区域级其他独立任务：0；独立任务条目：0
- Talk 已解析任务：3322；存在 Talk 问题的任务：171

## BEFORE / AFTER / DELTA

```json
{
  "before": null,
  "after": {
    "resolvedQuestCount": 3322,
    "dialogueNodeCount": 330477,
    "fallbackFamilyCount": 0,
    "standaloneQuestCount": 0,
    "aggregateCount": 3,
    "controlCount": 398,
    "talkUnresolvedCount": 346,
    "danglingEdgeCount": 867,
    "publicNarrativeQuestCount": 2392,
    "publicNarrativeResolvedCount": 2138,
    "publicNarrativeDialogueNodes": 290635,
    "allNarrativeQuestCount": 3681,
    "allNarrativeResolvedCount": 3322,
    "allNarrativeDialogueNodes": 330477
  },
  "delta": {
    "resolvedQuestCount": null,
    "dialogueNodeCount": null,
    "fallbackFamilyCount": null,
    "standaloneQuestCount": null,
    "aggregateCount": null,
    "controlCount": null,
    "talkUnresolvedCount": null,
    "danglingEdgeCount": null,
    "publicNarrativeQuestCount": null,
    "publicNarrativeResolvedCount": null,
    "publicNarrativeDialogueNodes": null,
    "allNarrativeQuestCount": null,
    "allNarrativeResolvedCount": null,
    "allNarrativeDialogueNodes": null
  }
}
```

## 重点核对

| 主任务 | 标题 | 系列 | 章节 | 对白 | 内容角色 | Talk 状态 | 质量 |
| --- | --- | --- | --- | ---: | --- | --- | --- |
| 21009 | 旧味难寻 |  |  | 5 | story | resolved | complete |
| 72236 | 三色档案 |  |  | 47 | story_and_control | resolved | complete |
| 73013 | 为那菈献上珍馐 |  | 愿为一炊之梦 | 140 | story_and_control | resolved | complete |
| 73019 | 料理是快乐的回忆 |  | 愿为一炊之梦 | 155 | story | resolved | complete |
| 73020 | 料理是自然的风味 |  | 愿为一炊之梦 | 107 | story_and_control | resolved | complete |
| 73021 | 料理是思归的香气 |  | 愿为一炊之梦 | 141 | story | resolved | complete |
| 73022 | 料理是分享的美好 |  | 愿为一炊之梦 | 187 | story | resolved | complete |
| 73189 | 无形壁障 |  | 旧语新知 | 14 | story_and_control | resolved | complete |
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
- 310 招募新伙伴：control；content_role_trigger
- 311 (test)一阶段结束$HIDDEN：partial_dialogue；dialogue_dialogue_text_missing, visibility_hidden, excluded:hidden_show_type
- 370 阴影下的蒙德：partial_dialogue；dialogue_partial
- 385 (test)一起去冒险吧$UNRELEASED$HIDDEN：metadata_only；missing_dialogue_nodes, missing_subquests, content_role_unknown, visibility_hidden, excluded:hidden_show_type
- 398 尾声，风停之后：partial_dialogue；dialogue_partial
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
- 1012 传香：partial_dialogue；dialogue_partial
- 1013 市井：partial_dialogue；dialogue_partial
- 1026 (test)寻人启事刷新$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 10114 (test)控制温迪的空闲对话$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 10300 (test)芭芭拉线玩法白盒$UNRELEASED：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_unreleased, excluded:unreleased_marker
- 11006 (test)（弃用）$UNRELEASED：control；content_role_trigger, visibility_unreleased, excluded:unreleased_marker
- 20037 触不可及的恋人：partial_dialogue；dialogue_graph_incomplete
- 20043 永不停歇的风与米歇尔小姐：partial_dialogue；dialogue_graph_incomplete
- 20051 蒙德城的酒：partial_dialogue；dialogue_partial
- 20058 诺拉快跑！：partial_dialogue；dialogue_graph_incomplete
- 22003 勿言勿笑：partial_dialogue；dialogue_graph_incomplete
- 22116 这本小说会很厉害！：partial_dialogue；dialogue_graph_incomplete
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
- 25014 解禁8-隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 25015 世界等级突破：metadata_only；missing_dialogue_nodes, content_role_metadata
- 71002 忽得一信向天飞$HIDDEN：control；content_role_trigger, visibility_hidden, excluded:hidden_show_type
- 71004 test考古迷踪$UNRELEASED$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 71009 (test)神秘的声音$UNRELEASED：source_missing；missing_dialogue_nodes, dialogue_talk_asset_missing, visibility_unreleased, excluded:unreleased_marker:missingDialogue
- 40001 灯自何处来$UNRELEASED：partial_dialogue；dialogue_dialogue_text_missing, visibility_unreleased, excluded:unreleased_marker
- 40004 托风问故人$UNRELEASED：partial_dialogue；dialogue_dialogue_text_missing, visibility_unreleased, excluded:unreleased_marker
- 40006 (test)海灯节氛围npc控制$UNRELEASED$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 603 (test)???$UNRELEASED：source_missing；missing_dialogue_nodes, dialogue_talk_asset_missing, visibility_unreleased, excluded:unreleased_marker:missingDialogue
- 1027 层岩间章Part2.5$HIDDEN：partial_dialogue；dialogue_dialogue_text_missing, visibility_hidden, excluded:hidden_show_type
- 1032 层岩间章Part3.5$HIDDEN：partial_dialogue；dialogue_dialogue_text_missing, visibility_hidden, excluded:hidden_show_type
- 2003 三个心愿：partial_dialogue；dialogue_partial
- 2009 以反抗之人的名义：partial_dialogue；dialogue_partial
- 2016 眷属的践行：partial_dialogue；dialogue_partial
- 2021 愿望：partial_dialogue；dialogue_partial
- 3009 流转存续的花神诞祭：partial_dialogue；dialogue_partial
- 3027 (test)隐藏npc控制任务$HIDDEN：partial_dialogue；dialogue_dialogue_text_missing, visibility_hidden, excluded:hidden_show_type
- 3033 （test）修改3.3间章完成后任务$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 3036 旧影重现：partial_dialogue；dialogue_partial
- 4006 聚光灯下谎言成影：partial_dialogue；dialogue_partial
- 4014 （test）主线任务预留02$UNRELEASED：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_unreleased, excluded:unreleased_marker
- 4022 审判日：partial_dialogue；dialogue_partial
- 4029 Quest 4029：metadata_only；missing_dialogue_nodes, content_role_metadata, title_unresolved, visibility_hidden, excluded:hidden_show_type
- 5030 (test)(hide)二阶段闲置管理$HIDDEN：partial_dialogue；dialogue_graph_incomplete, visibility_hidden, excluded:hidden_show_type
- 5031 Quest 5031：partial_dialogue；dialogue_graph_incomplete, title_unresolved, visibility_hidden, excluded:hidden_show_type
- 7000 (test)隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 7001 (test)隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 7002 (test)隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 7003 (test)废弃$UNRELEASED：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_unreleased, excluded:unreleased_marker
- 7005 白幕降下：partial_dialogue；dialogue_partial
- 7017 仅此一着：partial_dialogue；dialogue_partial
- 8007 黑蛇骑士的荣光：partial_dialogue；dialogue_partial
- 8013 卡利贝尔：control；content_role_trigger, visibility_hidden, excluded:hidden_show_type
- 10801 (test)隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 11014 往事如尘：partial_dialogue；dialogue_partial
- 11016 (test)间章隐藏任务刷群玉阁$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 11200 Quest 11200：partial_dialogue；missing_dialogue_nodes, dialogue_dialogue_text_missing, title_unresolved, visibility_unresolved, excluded:unresolved_title:missingDialogue
- 11201 Quest 11201：partial_dialogue；missing_dialogue_nodes, dialogue_dialogue_text_missing, title_unresolved, visibility_unresolved, excluded:unresolved_title:missingDialogue
- 11202 Quest 11202：partial_dialogue；missing_dialogue_nodes, dialogue_dialogue_text_missing, title_unresolved, visibility_unresolved, excluded:unresolved_title:missingDialogue
- 12005 丝织之愿：partial_dialogue；dialogue_partial
- 12017 质料恒常无易：partial_dialogue；dialogue_partial
- 12800 Quest 12800：metadata_only；missing_dialogue_nodes, content_role_metadata, title_unresolved, visibility_hidden, excluded:hidden_show_type
- 13011 终归沉寂：partial_dialogue；dialogue_partial
- 13017 Quest 13017：metadata_only；missing_dialogue_nodes, content_role_metadata, title_unresolved, visibility_hidden, excluded:hidden_show_type
- 13018 Quest 13018：metadata_only；missing_dialogue_nodes, content_role_metadata, title_unresolved, visibility_hidden, excluded:hidden_show_type
- 13019 若忘记家在何处：partial_dialogue；dialogue_partial
- 13033 Quest 13033：metadata_only；missing_dialogue_nodes, content_role_metadata, title_unresolved, visibility_hidden, excluded:hidden_show_type
- 13034 （test）补充爱尔海森个人线全局变量$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_unknown, visibility_hidden, excluded:hidden_show_type
- 14016 遗落与传承：partial_dialogue；dialogue_partial
- 14019 被遗忘的怪盗：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 14022 所织与所斩：partial_dialogue；dialogue_partial
- 14040 (test)希格雯个人线隐藏父任务控制group卸载$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 15046 (test)隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 15050 (test)隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 16007 幕间小憩：metadata_only；missing_dialogue_nodes, content_role_metadata
- 16016 Quest 16016：metadata_only；missing_dialogue_nodes, content_role_metadata, title_unresolved, visibility_hidden, excluded:hidden_show_type
- 16800 (test)隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 16801 (test)隐藏$HIDDEN：partial_dialogue；dialogue_graph_incomplete, visibility_hidden, excluded:hidden_show_type
- 16803 (test)废弃$UNRELEASED：metadata_only；missing_dialogue_nodes, content_role_unknown, visibility_unreleased, excluded:unreleased_marker
- 18000 拾枝者·戴因斯雷布：partial_dialogue；dialogue_partial
- 19001 维多利亚修女的担忧：partial_dialogue；dialogue_graph_incomplete
- 19002 突如其来的呼喊：partial_dialogue；dialogue_graph_incomplete
- 19003 教堂的诸多事宜：partial_dialogue；dialogue_graph_incomplete
- 19004 辣味饮料的原料之一：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19005 骑士与牧师，战斗表示！：control；content_role_trigger
- 19006 辣味饮料的原料之二：control；content_role_trigger
- 19007 心怀叵测之人…？：control；content_role_trigger
- 19008 治愈的本职：partial_dialogue；dialogue_graph_incomplete
- 19009 与众不同的饮品：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19010 束手就擒：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19014 唯有睡觉不可耽误：control；content_role_trigger
- 19018 意外相遇：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19020 特别训练：control；content_role_trigger
- 19021 行踪难觅：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19022 远处的视线：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19023 驱邪之行：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19024 冰棍的妙用：partial_dialogue；dialogue_dialogue_text_missing
- 19027 朋友之道：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19029 （test）处理桌椅隐藏$UNRELEASED：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_unreleased, excluded:unreleased_marker
- 19035 扫兴而归：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19038 幕后疑云深：partial_dialogue；dialogue_dialogue_text_missing
- 19041 属于冒险家的邂逅：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19043 是郊游…还是冒险？：control；content_role_trigger
- 19045 埃伊亚遗迹冒险：control；content_role_trigger
- 19046 (test)【隐藏】班尼特Coop天气恢复处理$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 19049 Quest 19049：metadata_only；missing_dialogue_nodes, content_role_metadata, title_unresolved, visibility_hidden, excluded:hidden_show_type
- 19050 特别来客：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19051 海上生活：partial_dialogue；dialogue_partial
- 19053 归离原寻宝纪事：control；content_role_trigger
- 19059 黄沙中的避风港：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19062 待客之道：control；content_role_trigger
- 19063 (test)待客之道：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_test, excluded:test_or_placeholder
- 19067 片刻闲暇：control；content_role_trigger
- 19071 全新风格：control；content_role_trigger
- 19072 富商：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19074 愿望的代价：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19075 旧物：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19081 女仆与复习：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19082 璃月之行：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19083 千岩牢固：control；content_role_trigger
- 19085 冒险家的入门考试：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19088 废弃$UNRELEASED：metadata_only；missing_dialogue_nodes, content_role_unknown, visibility_unreleased, excluded:unreleased_marker
- 19089 废弃$UNRELEASED：metadata_only；missing_dialogue_nodes, content_role_unknown, visibility_unreleased, excluded:unreleased_marker
- 19090 诺艾尔的侦察行动：control；content_role_trigger
- 19099 (test)凯亚Coop发家具隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 19100 (test)凯亚Coop发纪念道具隐藏$HIDDEN：metadata_only；missing_dialogue_nodes, content_role_metadata, visibility_hidden, excluded:hidden_show_type
- 19101 「猫尾酒馆」的调酒师：partial_dialogue；dialogue_graph_incomplete
- 19102 寻猫要诀：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19103 特殊的基底饮品：partial_dialogue；dialogue_graph_incomplete
- 19104 达达乌帕谷之影：partial_dialogue；dialogue_graph_incomplete
- 19105 丘丘人萨满的草药汤：partial_dialogue；dialogue_graph_incomplete
- 19106 特殊的调酒辅料：partial_dialogue；dialogue_graph_incomplete
- 19107 调酒师之间的切磋：partial_dialogue；dialogue_graph_incomplete
- 19111 背后的非议：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19112 东道主的邀请：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19113 多谢款待！：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19118 给猫猫狗狗的礼物：partial_dialogue；dialogue_partial
- 19119 离岛双人游：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19131 再访群玉阁：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19138 放假时间！：control；content_role_trigger
- 19142 神社之行：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19146 善后工作：control；content_role_trigger
- 19147 好好学习：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19150 昏昏沉沉的星星：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19154 寻迹向前：control；content_role_trigger
- 19155 最后一站：control；content_role_trigger
- 19156 令人无奈的恶作剧：control；content_role_trigger
- 19157 状态调整：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19158 帮手：metadata_only；missing_dialogue_nodes, content_role_metadata
- 19160 剩下的问题：partial_dialogue；dialogue_dialogue_text_missing
- 19162 饱餐之后：metadata_only；missing_dialogue_nodes, content_role_metadata
- 其余 720 条见 JSON。

## Story Structure Audit

- 系列：115；单任务系列：9；仅 aggregate 系列：0
- 重复系列标题：104；重复章节标题：216
- 孤立 aggregate：0；跨地区系列：6

## Topology / Talk / Dialogue Audit

- Raw edges：69342；Derived edges：1322；requires：1200；aggregate：122
- 拓扑 cycle：26；拓扑 dangling：94
- Talk expected/resolved/unresolved/ambiguous：25321/24975/346/0
- Dialogue nodes/edges/dangling：330477/386686/867
- rootless/cyclic graph：11/71；重复正文额外节点：53372
- Talk 全目录 metadata scan：59853；孤立对白资产：26416；metadata scan 失败：0

本报告只读取上游文件并在内存中运行转换，不写入数据库；应在所有规则完成后再执行一次候选导入。
