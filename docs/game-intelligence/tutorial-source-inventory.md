# Tutorial / Mechanism source inventory

盘点基于 `data/upstream/AnimeGameData` 的 pinned commit
`26df1dfbdf05a82bbb1d97506859f3e1c40718d8`（game version
`CNRELWin7.0.0_R47482070_S47579390_D47579390`，主语言 `zh-CN`）。磁盘目录按
`ls data/upstream/AnimeGameData/ExcelBinOutput` 检查；上游候选表按
`git -C data/upstream/AnimeGameData ls-tree HEAD ExcelBinOutput/ --name-only` 检查。

## 结论

- sparse checkout 当前只物化了 20 个 `ExcelBinOutput` 文件，没有文件名包含
  `Tutorial`、`Guide`、`Help`、`Mechanic`、`Tips`、`Handbook` 或 `Training` 的表。
- 磁盘上唯一相邻的 Codex 文件是 `AvatarCodexExcelConfigData.json`、
  `BooksCodexExcelConfigData.json`、`MaterialCodexExcelConfigData.json` 和
  `QuestCodexExcelConfigData.json`；它们不是机制帮助正文源。
- 磁盘上的 `LocalizationExcelConfigData.json` 有 2,229 行，但只有两行的资源路径包含
  `StopMechanism`。这些字段是 `.mihoyobin` 资源定位，不是可由 `TextResolver` 解析的教程标题/正文，
  因而没有把它们伪造为机制记录。
- 上游 tree 有 86 个名称相关的 Excel 表，其中 82 个没有出现在 sparse checkout；另外四个相邻
  Codex 表已经物化，但不是机制帮助正文源。对
  `TutorialExcelConfigData.json`、`TutorialDetailExcelConfigData.json`、
  `TutorialCatalogExcelConfigData.json`、`GuideV2ExcelConfigData.json`、
  `PushTipsConfigData.json` 和 `GCGTutorialTextExcelConfigData.json` 做了
  `git show` 可读性探测；本地 promisor blob 不在对象库中，探测返回 `bad object`/promisor
  fetch failure，未读取到正文。
- 因此当前 pinned checkout 的机制提取结果必须是 `discovered=0`；
  `packages/ingestion/src/anime-game-data/mechanism/extractor.ts` 会在磁盘源缺失时以
  `child_process` 执行受 `GIT_NO_LAZY_FETCH=1` 保护的 `git -C <upstream> show` 回退，只有
  blob 实际可读才会转换，不会隐式联网或猜测正文。

## 磁盘上可用的 Excel 源

下面是本次 `ls` 得到的完整物化文件名。没有一个是 canonical Tutorial/Guide/Help 文本表；
`LocalizationExcelConfigData.json` 仅作为资源路径索引保留在盘点中。

```text
AvatarCodexExcelConfigData.json
AvatarExcelConfigData.json
BookSuitExcelConfigData.json
BooksCodexExcelConfigData.json
ChapterExcelConfigData.json
DialogExcelConfigData.json
DocumentExcelConfigData.json
DocumentLocalizationFormatExcelConfigData.json
FetterInfoExcelConfigData.json
FetterStoryExcelConfigData.json
FettersExcelConfigData.json
LocalizationExcelConfigData.json
MainQuestExcelConfigData.json
MaterialCodexExcelConfigData.json
MaterialExcelConfigData.json
NpcExcelConfigData.json
QuestCodexExcelConfigData.json
QuestExcelConfigData.json
TalkExcelConfigData_0.json
TalkExcelConfigData_1.json
```

可用的 `TextMap/TextMapCHS.json` 与 `TextMap/TextMap_MediumCHS.json` 只能解析已经存在的
文本 hash；它们不能补足缺失的 Tutorial/Guide/Help 行。

## 上游 tree 中的相关表

下面 86 个名称来自 pinned `HEAD` 的 `ExcelBinOutput/` 目录。除上面列出的四个相邻 Codex 表外，
其余 82 项是 sparse checkout 缺失项；如果要生成完整 tutorial/mechanism 数据，必须先取得对应
缺失 blob，或逐个通过
`git -C data/upstream/AnimeGameData show HEAD:<path>` 读取。列表包含文本候选、索引/触发器以及
活动配置，后续实现必须继续按字段确认哪些行确实是官方帮助正文。

```text
ActivitySnowRaceHideTutorialExcelConfigData.json
ActivityTradeShowTdHandbookExcelConfigData.json
AlchemySimPotionTutorialExcelConfigData.json
AnimalCodexExcelConfigData.json
AutoChessTipsExcelConfigData.json
AvatarCodexExcelConfigData.json
BeastsBattleTipsExcelConfigData.json
BeyondHandbookExcelConfigData.json
BeyondHandbookOverallExcelConfigData.json
BeyondHandbookWatcherExcelConfigData.json
BomberV3TipsExcelConfigData.json
BooksCodexExcelConfigData.json
DeshretPushTipsCatalogDataData.json
DieTypeTipsExcelConfigData.json
DungeonMultiPlayerFixDataConfigData.json
EntityMultiPlayerExcelConfigData.json
FireworksPushtipsExcelConfigData.json
FleurFairTipsExcelConfigData.json
FungusTrainingDungeonEnemyAffixExcelConfigData.json
FungusTrainingDungeonExcelConfigData.json
GCGTutorialTextExcelConfigData.json
GuideRatingExcelConfigData.json
GuideTriggerExcelConfigData.json
GuideV2ClientTriggerExcelConfigData.json
GuideV2ExcelConfigData.json
HandbookMainQuestGuideExcelConfigData.json
HandbookQuestGuideExcelConfigData.json
HandbookQuestGuideHintPicExcelConfigData.json
HolidayResortGraffitiPhaseExcelConfigData.json
IceCreatureCodexExcelConfigData.json
LoadingTipsExcelConfigData.json
MaterialCodexExcelConfigData.json
MaterialReminderTipsExcelConfigData.json
MechanicBuildingExcelConfigData.json
MechanicusCardCurseExcelConfigData.json
MechanicusCardEffectExcelConfigData.json
MechanicusCardExcelConfigData.json
MechanicusDifficultyExcelConfigData.json
MechanicusExcelConfigData.json
MechanicusGearLevelUpExcelConfigData.json
MechanicusMapExcelConfigData.json
MechanicusMapPointExcelConfigData.json
MechanicusSequenceExcelConfigData.json
MechanicusWatcherExcelConfigData.json
MonsterChessPushTipsExcelConfigData.json
MonsterChessV2PushTipsExcelConfigData.json
MonsterMultiPlayerExcelConfigData.json
MusicGameBookGuideExcelConfigData.json
NaturalistHandBookExcelConfigData.json
NewActivityPushTipsConfigData.json
PersonalLineGuideExcelConfigData.json
PushTipsCodexExcelConfigData.json
PushTipsConfigData.json
QuestCatalogGuideExcelConfigData.json
QuestCodexExcelConfigData.json
RechargeDiskTrainingExcelConfigData.json
ReliquaryCodexExcelConfigData.json
ResortGuideMapDataExcelConfigData.json
ResortGuideMapTextExcelConfigData.json
ReunionGuideExcelConfigData.json
SlimeCannonPushtipsExcelConfigData.json
StepsTrainingEntryExcelConfigData.json
StepsTrainingExcelConfigData.json
TpsGlassesPushTipsExcelConfigData.json
TrainingGuideAdviserLevelConfigData.json
TrainingGuideAdviserRelicConfigData.json
TrainingGuideAdviserSkillConfigData.json
TrainingGuideAdviserWeaponConfigData.json
TrainingGuideCheckStandardExcelConfigData.json
TrainingGuideCitySmithExcelConfigData.json
TrainingGuideDungeonCheckConfigData.json
TrainingGuideExpCostConfigData.json
TrainingGuideGlobalExcelConfigData.json
TrainingGuideItemSourceConfigData.json
TrainingGuideUnlockExcelConfigData.json
TrainingGuideUsualRelicConfigData.json
TreasureGainTipsExcelConfigData.json
TutorialCatalogExcelConfigData.json
TutorialDetailExcelConfigData.json
TutorialExcelConfigData.json
UgcTutorialExcelConfigData.json
ViewCodexExcelConfigData.json
VintageMarketHelpSkillExcelConfigData.json
WeaponCodexExcelConfigData.json
WidgetGotSpecialTipsExcelConfigData.json
WinterCampRaceItemTipsExcelConfigData.json
```

> 注：tree 清单中的 `TrainingGuideExpCostConfigData.json` 是原始文件名；它不带
> `ExcelConfigData`，但属于同一组 TrainingGuide 邻接表。

## 当前提取器输入边界

`mechanism/extractor.ts` 当前尝试读取下列可验证的文本候选表；每个输入都是可选的，缺失时
不会把 tree 名称计为 discovered 行：

| Input                                              | 角色                       | pinned checkout 状态         |
| -------------------------------------------------- | -------------------------- | ---------------------------- |
| `TutorialExcelConfigData.json`                     | Tutorial 主行              | sparse 缺失，git blob 不可读 |
| `TutorialDetailExcelConfigData.json`               | Tutorial 正文/详情候选     | sparse 缺失，git blob 不可读 |
| `TutorialCatalogExcelConfigData.json`              | Tutorial 目录候选          | sparse 缺失，git blob 不可读 |
| `GuideV2ExcelConfigData.json`                      | Guide 正文候选             | sparse 缺失，git blob 不可读 |
| `PushTipsConfigData.json`                          | 系统/提示正文候选          | sparse 缺失，git blob 不可读 |
| `PushTipsCodexExcelConfigData.json`                | 提示 Codex 正文候选        | sparse 缺失，git blob 不可读 |
| `LoadingTipsExcelConfigData.json`                  | Loading/help 文本候选      | sparse 缺失，git blob 不可读 |
| `GCGTutorialTextExcelConfigData.json`              | 七圣召唤 Tutorial 文本候选 | sparse 缺失，git blob 不可读 |
| `ActivitySnowRaceHideTutorialExcelConfigData.json` | 活动 Tutorial 候选         | sparse 缺失，git blob 不可读 |
| `AlchemySimPotionTutorialExcelConfigData.json`     | 炼金活动 Tutorial 候选     | sparse 缺失，git blob 不可读 |
| `UgcTutorialExcelConfigData.json`                  | UGC Tutorial 候选          | sparse 缺失，git blob 不可读 |
| `HandbookQuestGuideExcelConfigData.json`           | Handbook Guide 正文候选    | sparse 缺失，git blob 不可读 |

其他 74 个 tree 表中，4 个相邻 Codex 表已经物化但不属于机制正文，剩余 70 个仍需在取得完整
blob 后逐表做字段级审计，不能仅凭文件名把配置/触发器当成官方机制正文。
