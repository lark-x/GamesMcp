# Story / Text / Mechanism coverage inventory

本盘点覆盖 `quest`、`dialogue`、`book`、`character_story`、`voice`、`item`、
`tutorial_mechanism` 和 `achievement` 八个域。输入快照固定为
`data/upstream/AnimeGameData` commit
`26df1dfbdf05a82bbb1d97506859f3e1c40718d8`，game version
`CNRELWin7.0.0_R47482070_S47579390_D47579390`，基线语言为 `zh-CN`。
机器可读版本见 [`story-coverage.json`](../../data/evaluation/genshin/story-coverage.json)。

## Status definitions

| Status             | Meaning                                                                                      |
| ------------------ | -------------------------------------------------------------------------------------------- |
| **Integrated**     | 当前 extractor/converter 已在 pinned source unit 上运行，所有 discovered rows 都有输出记录。 |
| **Partial**        | 已有真实输出，但只覆盖公开/可验证子集、存在已解释排除，或仍走 legacy converter。             |
| **Not Integrated** | 域在 scope 内，但本次没有可用 extractor output；未知数字不填假值，并标 `needs_run=true`。    |
| **Unsupported**    | extractor 可以诚实报告状态，但 pinned snapshot 没有可读的该域源文件。                        |
| **Not Relevant**   | 不属于本次 Story/Text/Mechanism 八域；八个列出的域没有使用此状态。                           |

## Domain coverage

`coverage` 统一表示 `converted / discovered`；空源按照 extractor 契约记为 `1`，但必须结合
`status`、`evidence` 和 `needs_run` 阅读。`failed` 只计转换失败，不把有明确原因的排除重复计为
failure。

| Domain             | Status         | Source unit / extractor                                            | Discovered | Converted | Failed |           Coverage | needs_run |
| ------------------ | -------------- | ------------------------------------------------------------------ | ---------: | --------: | -----: | -----------------: | --------- |
| quest              | Partial        | 4,372 MainQuest rows；quest converter 的 public `zh-CN` 主任务文档 |      4,372 |     1,140 |      0 | 0.2607502287282708 | false     |
| dialogue           | Integrated     | `DialogExcelConfigData` rows；`dialogue/extractor.ts`              |    203,908 |   203,908 |      0 |                  1 | false     |
| book               | Partial        | `BooksCodexExcelConfigData` rows；legacy book converter            |        293 |       288 |      0 | 0.9829351535836177 | false     |
| character_story    | Integrated     | `FetterStoryExcelConfigData` rows；`character-story/extractor.ts`  |        958 |       958 |      0 |                  1 | false     |
| voice              | Unsupported    | `AvatarVoiceExcelConfigData`；`voice/extractor.ts`                 |          0 |         0 |      0 |                  1 | false     |
| item               | Partial        | `MaterialExcelConfigData` rows；`item-text/extractor.ts`           |     10,404 |    10,404 |      0 |                  1 | false     |
| tutorial_mechanism | Unsupported    | canonical tutorial/guide/help rows；`mechanism/extractor.ts`       |          0 |         0 |      0 |                  1 | false     |
| achievement        | Not Integrated | pinned source files absent；本次无 achievement extractor output    |          0 |      null |   null |               null | true      |

### Quest and dialogue

- `convertQuestSnapshot` 实际发现 4,372 个 MainQuest rows；双语言构建结果为 2,280 条 public
  documents（`zh-CN` 1,140、`en` 1,140），0 failed，排除的 6,464 个 locale documents 都有
  明确 incomplete/visibility 原因，accounted coverage 为 1。这里的 `converted` 按唯一
  `zh-CN` 主任务计，所以机器文件同时保留 `outputRecords=2280`。
- `dialogueExtractor` 实际转换 203,908 个 Dialog rows，0 failed。文本 hash 未解析的节点仍
  保留为结构记录；这些是 field warnings，不被静默当作转换失败。
- 基线原始计数分别为 `quests=4,372`、`subquests=17,814`、`dialogueNodes=203,908`、
  `dialogueEdges=180,916`，详见 [`story-baseline.json`](../../data/evaluation/genshin/story-baseline.json)。

### Book, character story, voice, and item

- [`book-source-inventory.md`](book-source-inventory.md) 记录 293 条 BooksCodex 行、288 个唯一
  volume 映射和 1,910 个 CHS readable 文件；legacy converter 转换 288 行，5 行是已有明确
  排除原因的书目记录，因此状态为 Partial。
- `CharacterStoryExtractor` 实际转换 958/958 条 FetterStory rows；对应基线
  `characterStories=958`。
- `VoiceExtractor` 在 pinned checkout 中实际发现 `AvatarVoiceExcelConfigData.json` 缺失，
  返回 0/0/0 并发出 `voice_source_missing`；这是源不可用，不是把语音域伪造成空成功。
- [`item-text-source-inventory.md`](item-text-source-inventory.md) 记录 Material 目录 10,404
  行（`ITEM_MATERIAL` 10,279、`ITEM_VIRTUAL` 125）和 Codex 关系。当前 item-text extractor
  实际转换 10,404/10,404 行；名称/描述字段仍按 TextResolver 结果保留 null，item 的 Partial
  是因为本批次只覆盖 Material 源类，其他 item family 尚未从专用表接入。

### Tutorial / mechanism and achievement

- [`tutorial-source-inventory.md`](tutorial-source-inventory.md) 记录磁盘 sparse checkout 没有
  canonical Tutorial/Guide/Help 表；pinned tree 虽列出相关表，但相应 promisor blobs 在本地
  不可读。`MechanismExtractor` 实际运行结果为 0/0/0，并保留
  `mechanism_source_missing`，所以没有虚构标题、正文或分类。
- [`story-baseline.json`](../../data/evaluation/genshin/story-baseline.json) 的
  `tutorials=0`、`mechanisms=0`、`achievements=0` 是 pinned 可见源计数，不是“社区指南”或
  其他外部数据的替代。achievement 的本次输出字段保持 null 并标 `needs_run=true`，待取得
  `AchievementExcelConfigData.json` 与 `AchievementGoalExcelConfigData.json` 后重新运行。

## Evidence references

- Scope and domain boundary: [`story-scope.md`](story-scope.md)
- Pinned checkout and locale: [`current-upstream.md`](current-upstream.md)
- Raw baseline counts: [`story-baseline.json`](../../data/evaluation/genshin/story-baseline.json)
- Book/readable inventory: [`book-source-inventory.md`](book-source-inventory.md)
- Item/material inventory: [`item-text-source-inventory.md`](item-text-source-inventory.md)
- Tutorial/Guide/Help inventory: [`tutorial-source-inventory.md`](tutorial-source-inventory.md)
- Extractor contracts and tests: `packages/ingestion/src/anime-game-data/` 下各域对应
  `extractor.ts` 与 `extractor.test.ts`
