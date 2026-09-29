# 原神公开世界任务对白差异审计（r14）

固定源快照：AnimeGameData 7.0.0，commit 26df1dfbdf05a82bbb1d97506859f3e1c40718d8。只记录审计结果；不从 Wiki 补写正文。

公开世界叙事任务 1,334 条：complete 1,167；非 complete 167（partial dialogue 158、speaker unresolved 8、source missing 1）。原因码按任务累计且可重叠。

| MainQuest ID | 标题 | 质量 | 原因码 | 未解析 Talk ID |
|---:|---|---|---|---|
| 310 | 招募新伙伴 | source_missing | missing_dialogue_nodes, dialogue_talk_asset_missing | 31013, 31014, 31015, 31016, 31017, 31018, 31019, 41401 |
| 469 | 七神的赐福 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 18000 | 拾枝者·戴因斯雷布 | partial_dialogue | dialogue_partial | 1800017 |
| 20601 | 天赐良机？ | partial_dialogue | dialogue_graph_incomplete | — |
| 40142 | 人来人往 | partial_dialogue | dialogue_graph_incomplete | — |
| 40143 | 有朋自远方来·其一 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 40202 | 隐行谛勘，秽金之罪 | partial_dialogue | dialogue_graph_incomplete | — |
| 41122 | 各有职责 | partial_dialogue | dialogue_graph_incomplete | — |
| 41331 | 轻策庄的霄灯 | partial_dialogue | dialogue_partial | 4133101, 4133108, 4133109, 4133124 |
| 41333 | 铁块紫微一相逢… | partial_dialogue | dialogue_partial | 4133310 |
| 70027 | 自律机关能源研究·绪论 | partial_dialogue | dialogue_partial | 7002703 |
| 70050 | 故事繁多的翘英庄 | partial_dialogue | dialogue_partial | 7005096 |
| 70067 | 「沙上楼阁」稗记 | partial_dialogue | dialogue_partial | 7006723 |
| 70099 | 风停了 | partial_dialogue | dialogue_graph_incomplete | — |
| 70102 | 腐殖之牙 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 70513 | 恰如其分的收场 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 70559 | 收工时的「战地」大餐 | partial_dialogue | dialogue_graph_incomplete | — |
| 70681 | 神秘武学的召唤 | partial_dialogue | dialogue_partial | 7068106 |
| 70810 | 等量交换 | partial_dialogue | dialogue_graph_incomplete | — |
| 70814 | 冒险家…该干嘛？ | partial_dialogue | dialogue_graph_incomplete | — |
| 71022 | 恨繁囿兮作土 | speaker_unresolved | dialogue_dialogue_text_missing, speaker_name_unresolved | — |
| 71037 | 方入巨渊初探勘 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 71099 | 台上台下 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 71100 | 祀珑在昔，灵锦歆诚 | partial_dialogue | dialogue_partial | 7110082 |
| 71103 | 采撷掇拾，沉玉浮琼 | partial_dialogue | dialogue_talk_asset_ambiguous | 7110325, 7110343 |
| 71114 | 水土暂服 | partial_dialogue | dialogue_talk_asset_ambiguous | 7111401 |
| 71501 | 深泥奇谭 | partial_dialogue | dialogue_partial | 7150104 |
| 71528 | 暂无止境的斗虫之路！ | partial_dialogue | dialogue_partial | 7166662 |
| 71656 | 飘浮之灵，调查启动 | partial_dialogue | dialogue_graph_incomplete | — |
| 71659 | 丹剂与魔药 | speaker_unresolved | dialogue_partial, speaker_name_unresolved | 7165905 |
| 71666 | 荒泷甲光烈烈斗虫大修行！ | partial_dialogue | dialogue_partial | 7166606 |
| 71831 | 身后事·归于山中 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 72106 | 绀田事话 | partial_dialogue | dialogue_graph_incomplete | — |
| 72124 | 刀剑成梦 | partial_dialogue | dialogue_talk_asset_ambiguous | 7212401 |
| 72144 | 广海的守望 | partial_dialogue | dialogue_graph_incomplete | — |
| 72153 | 在他乡 | partial_dialogue | dialogue_graph_incomplete | — |
| 72161 | 武者的宿命 | partial_dialogue | dialogue_partial | 7216112 |
| 72173 | 日轮与菅名山 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 72197 | 执望三千里 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 72239 | 食莲者 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 72261 | 山海八所巡礼·琥珀仙岳绮语 | partial_dialogue | dialogue_partial | 7226105 |
| 72262 | 山海八所巡礼·荻原川狩百景 | partial_dialogue | dialogue_partial | 7226207 |
| 72263 | 终末番的任务 | partial_dialogue | dialogue_partial | 7226322, 7226323, 7226324 |
| 72264 | 山海八所巡礼·大雪隐御伽话 | partial_dialogue | dialogue_partial | 7226410 |
| 72279 | 关于拯救狸猫合影板这件事 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 72675 | 山海八所巡礼·远岛孤山独语 | partial_dialogue | dialogue_partial | 7267505 |
| 72676 | 山海八所巡礼·双城风土名迹 | partial_dialogue | dialogue_partial | 7267614, 7267615 |
| 72677 | 山海八所巡礼·炎炎连歌百韵 | partial_dialogue | dialogue_partial | 7267709 |
| 72678 | 山海八所巡礼·风来坊内鉴录 | partial_dialogue | dialogue_partial | 7267808 |
| 72687 | 花影瑶庭·其一 | partial_dialogue | dialogue_partial | 7268703 |
| 72688 | 花影瑶庭·其二 | partial_dialogue | dialogue_partial | 7268802 |
| 72689 | 花影瑶庭·其三 | partial_dialogue | dialogue_partial | 7268902 |
| 72690 | 花影瑶庭·其四 | partial_dialogue | dialogue_partial | 7269002 |
| 72801 | 诸国游记 | partial_dialogue | dialogue_talk_asset_ambiguous | 7280101 |
| 72804 | 洗刷耻辱的一战 | partial_dialogue | dialogue_talk_asset_ambiguous | 7280401 |
| 73000 | 吉祥具书·初篇 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 73016 | 忿怒的铁块 | partial_dialogue | dialogue_partial | 7301602 |
| 73017 | 沉睡的根系 | partial_dialogue | dialogue_partial | 7301711 |
| 73018 | 膏腴土地下的唤雨之曲 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 73025 | 「兰那罗的世界」 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 73035 | 为了「果实」、「种子」，还有「树」 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 73036 | 为了过去的孩子们 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 73037 | 为了一切向往生命的孩子们 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 73049 | 愚人者人愚之 | partial_dialogue | dialogue_partial | 7304907 |
| 73057 | 兰纳真的老友 | partial_dialogue | dialogue_graph_incomplete | — |
| 73058 | 兰迦鲁的涂鸦 | partial_dialogue | dialogue_partial | 7305805 |
| 73061 | 星夜之章 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 73066 | 终章 | partial_dialogue | dialogue_partial | 99902 |
| 73069 | 通往黯道的曲调 | partial_dialogue | dialogue_partial | 7306921 |
| 73070 | 新芽迸发的曲调 | partial_dialogue | dialogue_partial | 7307022 |
| 73074 | 揭示兽径的曲调 | partial_dialogue | dialogue_partial | 7307420 |
| 73083 | 二重证据 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 73110 | 索赫尔的心愿 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 73185 | 兽有失蹄 | partial_dialogue | dialogue_talk_asset_ambiguous | 7318504 |
| 73187 | 埋葬丰饶的沙丘·中 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 73207 | 献给某人的蔷薇·来自往日的歌谣 | speaker_unresolved | speaker_name_unresolved | — |
| 73219 | 流沙如泪的神殿 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 73231 | 锋刃林游增记 | partial_dialogue | dialogue_talk_asset_ambiguous | 7323103 |
| 73232 | 蒂尔·亚什特的赞歌 | partial_dialogue | dialogue_partial | 7323201 |
| 73251 | 如是灵光悉示现 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 73256 | 如是灵光悉示现·灭 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 73257 | 蒂尔·亚什特的赞歌 | partial_dialogue | dialogue_partial | 7325709 |
| 73281 | 「鹰猎」 | partial_dialogue | dialogue_talk_asset_ambiguous | 7328107 |
| 73285 | 碑铭的研究 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 73287 | 智慧筑屋，凿成七柱 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 73319 | 浮光鸣召 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 73330 | 调查索希标记的愚人众营地 | partial_dialogue | dialogue_partial | 7333009, 7333010 |
| 73532 | 奇书疑云 | partial_dialogue | dialogue_graph_incomplete | — |
| 73688 | 演武传心 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 73693 | 药剂应对法 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 74001 | 「水仙十字大冒险」 | partial_dialogue | dialogue_graph_incomplete | — |
| 74008 | 水色潮痕 | partial_dialogue | dialogue_graph_incomplete | — |
| 74012 | 往事追迹·西 | partial_dialogue | dialogue_partial | 7401203, 7401204 |
| 74018 | 坏蛋们 | partial_dialogue | dialogue_graph_incomplete | — |
| 74034 | 一份通知 | partial_dialogue | dialogue_talk_asset_ambiguous | 7403401 |
| 74040 | 孤帆幽影 | partial_dialogue | dialogue_partial | 7404013 |
| 74043 | 依旧让人垂涎欲滴！ | partial_dialogue | dialogue_partial | 7404305, 7404306, 7404309 |
| 74051 | 三人行…先寻明师·之一 | partial_dialogue | dialogue_talk_asset_ambiguous | 7405101, 7405102, 7405104, 7405105, 7405106, 7405107 |
| 74053 | 枫丹科学院，停滞于一片废墟上 | partial_dialogue | dialogue_partial | 7405397 |
| 74078 | 溪舟的尾波 | partial_dialogue | dialogue_graph_incomplete | — |
| 74081 | 海渊封缠的乖离光 | partial_dialogue | dialogue_partial | 7405722, 7405723 |
| 74082 | 幽林雾道 | partial_dialogue | dialogue_graph_incomplete | — |
| 74083 | 枯萎垂柳 | partial_dialogue | dialogue_talk_asset_ambiguous | 7408301 |
| 74084 | 愤怒泉眼 | partial_dialogue | dialogue_graph_incomplete | — |
| 74091 | 我们的目标在另一条管道 | partial_dialogue | dialogue_graph_incomplete | — |
| 74115 | 红与黑 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 74140 | 穿过谜镜 | speaker_unresolved | speaker_name_unresolved | — |
| 74141 | 追寻 | speaker_unresolved | speaker_name_unresolved | — |
| 74142 | 追寻 | speaker_unresolved | speaker_name_unresolved | — |
| 74156 | 勒鲁瓦·夜后咏叹调 | partial_dialogue | dialogue_graph_incomplete | — |
| 74185 | 为了旧日与明天 | partial_dialogue | dialogue_partial | 7418502 |
| 74195 | 水下夜想曲 | partial_dialogue | dialogue_partial | 7419520 |
| 74196 | 哀悼命运之疮 | partial_dialogue | dialogue_graph_incomplete | — |
| 74228 | 海精灵们的礼物 | partial_dialogue | dialogue_talk_asset_ambiguous | 7422803 |
| 74692 | 魔女的谕示·特调之谕 | partial_dialogue | dialogue_partial | 7469202 |
| 74693 | 魔女的谕示·履职之谕 | partial_dialogue | dialogue_partial | 7469302 |
| 74694 | 魔女的谕示·舶来之谕 | partial_dialogue | dialogue_partial | 7469402 |
| 74695 | 魔女的谕示·监守之谕 | partial_dialogue | dialogue_partial | 7469502 |
| 74696 | 魔女的谕示·奇躯之谕 | partial_dialogue | dialogue_partial | 7469602 |
| 74697 | 魔女的谕示·梦外之谕 | partial_dialogue | dialogue_partial | 7469702 |
| 74698 | 魔女的谕示·大妖怪之谕 | partial_dialogue | dialogue_partial | 7469802 |
| 74800 | 危机四伏的枫丹廷 | partial_dialogue | dialogue_talk_asset_ambiguous | 7480001 |
| 75000 | 迷林之子 | partial_dialogue | dialogue_talk_asset_ambiguous | 7500008 |
| 75001 | 在晶岩下 | partial_dialogue | dialogue_partial | 7500102, 7500114 |
| 75004 | 令眠者得安宁 | partial_dialogue | dialogue_partial | 7504501, 7504502 |
| 75011 | 溯寻者不可得 | partial_dialogue | dialogue_partial | 7501104, 7501106 |
| 75032 | 龙的归巢 | partial_dialogue | dialogue_partial | 7503207 |
| 75108 | 火与水的好友 | partial_dialogue | dialogue_graph_incomplete | — |
| 75146 | 碎岩及其往事 | partial_dialogue | dialogue_graph_incomplete | — |
| 75151 | 毁灭预兆与最后的通牒 | partial_dialogue | dialogue_graph_incomplete | — |
| 75209 | 「沫彩花海」 | partial_dialogue | dialogue_partial | 7520907 |
| 75230 | 最后的特诺奇兹托克人 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 75233 | 闪耀！皮皮潘偶像大赛！ | partial_dialogue | dialogue_graph_incomplete | — |
| 76003 | 鞋匠的孩子总是光脚 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 76007 | 转行总是令人焦虑 | partial_dialogue | dialogue_graph_incomplete | — |
| 76018 | 飞向天空的约定 | partial_dialogue | dialogue_graph_incomplete | — |
| 76029 | 月光奏鸣曲 | partial_dialogue | dialogue_partial | 7602907 |
| 76031 | 月光联系你我 | partial_dialogue | dialogue_partial | 7603105 |
| 76039 | 援助小队的诉说 | partial_dialogue | dialogue_graph_incomplete | — |
| 76074 | 放逐者的荒歌 | partial_dialogue | dialogue_graph_incomplete | — |
| 76084 | 月光奏鸣曲·遐音 | partial_dialogue | dialogue_graph_incomplete | — |
| 76119 | 月亮藏在哪 | partial_dialogue | dialogue_graph_incomplete | — |
| 76121 | 夜空中的月亮·三月 | partial_dialogue | dialogue_graph_incomplete | — |
| 76133 | 星空访客 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 76142 | 英灵的残响 | partial_dialogue | dialogue_partial | 7614205, 7614206 |
| 76159 | 魔女的课业·导引之职…？ | partial_dialogue | dialogue_graph_incomplete | — |
| 76162 | 古老的阵眼·其三 | partial_dialogue | dialogue_graph_incomplete | — |
| 76651 | 到灯塔去 | partial_dialogue | dialogue_graph_incomplete | — |
| 76656 | 新的想法 | partial_dialogue | dialogue_partial | 7665623, 7665625 |
| 76673 | 魔女的小屋 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 76678 | 如月之恒 | partial_dialogue | dialogue_graph_incomplete | — |
| 77005 | 白与黑的变奏舞·日程 | speaker_unresolved | speaker_name_unresolved | — |
| 77006 | 白与黑的变奏舞·日程 | speaker_unresolved | speaker_name_unresolved | — |
| 77100 | 望向入梦的白冕 | partial_dialogue | dialogue_partial | 7710005 |
| 77112 | 安慰者的合唱 | partial_dialogue | dialogue_graph_incomplete | — |
| 77128 | 普洛克路斯忒斯的寝床 | partial_dialogue | dialogue_talk_asset_ambiguous | 7712807 |
| 77131 | 无魂者之屋 | partial_dialogue | dialogue_partial | 7713103 |
| 77137 | 如汐歌幽诉之地 | partial_dialogue | dialogue_graph_incomplete | — |
| 77143 | 无仁义的争执 | partial_dialogue | dialogue_partial | 7714303, 7714312 |
| 77204 | 浮雪之上 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 77235 | 白与黑的变奏舞·日程 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 77236 | 白与黑的变奏舞·日程 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 77237 | 白与黑的变奏舞·日程 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 79008 | 夏日赠礼 | partial_dialogue | dialogue_graph_incomplete | — |
| 79021 | 寻物航行 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 79024 | 被错置的海螺 | partial_dialogue | dialogue_dialogue_text_missing | — |
| 79065 | 荷叶与冠军 | partial_dialogue | dialogue_graph_incomplete | — |

## 唯一空正文的公开叙事任务

310「招募新伙伴」有 8 个 Talk 引用（31013–31019、41401），当前快照中都没有可精确归属的对白资源。TalkExcel 行指向 NPC Group／初始化 Dialog；这些配置只有触发和可用性信息，不含对白正文。分类为 source_missing，不是 complete。不得用 Wiki 文本补齐；只在固定源快照中找到精确资源桥接时才重新分类。

其余 partial_dialogue 原因包括：Talk 资产缺失或多任务歧义、Talk 中缺少对白文本、对白关系图不完整。speaker_unresolved 保留对白正文，只表示角色名称未解析。完整 Talk ID、已解析／未解析集合、资源路径和来源字段保存在机器审计结果中。
