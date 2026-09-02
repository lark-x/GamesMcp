# Achievement spot check (`ce5d2a3`)

## Source and method

Checked against AnimeGameData commit
`26df1dfbdf05a82bbb1d97506859f3e1c40718d8`, using:

- `ExcelBinOutput/AchievementGoalExcelConfigData.json` (73 goal rows)
- `ExcelBinOutput/AchievementExcelConfigData.json` (2,002 achievement rows)
- `TextMap/TextMap_MediumCHS.json`

Rows were sorted by numeric achievement id. The visible and hidden samples
are the first ten title-resolvable rows in each display class. The group
sample is the first row for each of ten distinct `goalId` values, including
the absent/default goal id. This gives 10 visible, 10 hidden, and 10 distinct
groups (30 checks total).

## Source-wide checks

- `isShow = "SHOWTYPE_HIDE"`: 1,099 rows; these are the hidden rows.
- `isShow` absent: 903 rows; these are displayable rows.
- `isDisuse = true`: 157 rows (105 hidden and 52 displayable); this confirms
  that `isDisuse` must not be used as the hidden predicate.
- Title resolution through the medium Chinese map: 1,845/2,002 rows. The
  remaining 157 rows are expected converter `name_missing` failures and are
  excluded from the title-based sample below.
- Among the 1,845 title-resolvable rows, canonical categories are: 985
  `wonders_of_the_world`, 57 `memories_of_the_heart`, 12
  `teyvat_fishing_guide`, 137 `challenger`, 28 `elemental_specialist`, and
  626 `other`.

## Visible sample (10)

| Achievement id | Title            | goalId | Goal name       | Canonical category | isShow | isDisuse |
| -------------: | ---------------- | -----: | --------------- | ------------------ | ------ | -------- |
|          80001 | 风与异乡人       |      1 | 尘世巡游·第一辑 | `other`            | absent | false    |
|          80002 | 千嶂万仞         |      1 | 尘世巡游·第一辑 | `other`            | absent | false    |
|          80003 | 流水叮咛         |      1 | 尘世巡游·第一辑 | `other`            | absent | false    |
|          80004 | 神戟狂言凌云霄   |      1 | 尘世巡游·第一辑 | `other`            | absent | false    |
|          80005 | 醉客与狼的相遇   |      1 | 尘世巡游·第一辑 | `other`            | absent | false    |
|          80006 | 清泉、白马与月光 |      1 | 尘世巡游·第一辑 | `other`            | absent | false    |
|          80007 | 人铸赋形         |      2 | 冒险手艺        | `other`            | absent | false    |
|          80008 | 生存专家         |      2 | 冒险手艺        | `other`            | absent | false    |
|          80009 | 生存专家         |      2 | 冒险手艺        | `other`            | absent | false    |
|          80010 | 生存专家         |      2 | 冒险手艺        | `other`            | absent | false    |

Expected normalized result for every row above: `hidden = false`,
`displayState = "displayed"`.

## Hidden sample (10)

| Achievement id | Title                   | goalId | Goal name | Canonical category     | isShow          | isDisuse |
| -------------: | ----------------------- | -----: | --------- | ---------------------- | --------------- | -------- |
|          80091 | 妖鬼狂言百物语          | absent | 天地万象  | `wonders_of_the_world` | `SHOWTYPE_HIDE` | false    |
|          80092 | 布武雷国                | absent | 天地万象  | `wonders_of_the_world` | `SHOWTYPE_HIDE` | false    |
|          81000 | 俯瞰风景                | absent | 天地万象  | `wonders_of_the_world` | `SHOWTYPE_HIDE` | false    |
|          81001 | 烈风的遗骨              | absent | 天地万象  | `wonders_of_the_world` | `SHOWTYPE_HIDE` | false    |
|          81002 | 「风带来了故事的种子…」 | absent | 天地万象  | `wonders_of_the_world` | `SHOWTYPE_HIDE` | false    |
|          81003 | 矢志不渝                | absent | 天地万象  | `wonders_of_the_world` | `SHOWTYPE_HIDE` | false    |
|          81004 | 启动跃迁引擎！          | absent | 天地万象  | `wonders_of_the_world` | `SHOWTYPE_HIDE` | false    |
|          81005 | 风神的宠儿              | absent | 天地万象  | `wonders_of_the_world` | `SHOWTYPE_HIDE` | false    |
|          81010 | 冢里最好的剑            | absent | 天地万象  | `wonders_of_the_world` | `SHOWTYPE_HIDE` | false    |
|          81014 | 华清归藏密宫            | absent | 天地万象  | `wonders_of_the_world` | `SHOWTYPE_HIDE` | false    |

Expected normalized result for every row above: `hidden = true`,
`displayState = "hidden"`.

## Distinct group sample (10)

| Achievement id | Title                      | goalId | Goal name                  | Canonical category     |
| -------------: | -------------------------- | -----: | -------------------------- | ---------------------- |
|          80001 | 风与异乡人                 |      1 | 尘世巡游·第一辑            | `other`                |
|          80007 | 人铸赋形                   |      2 | 冒险手艺                   | `other`                |
|          80014 | 如日方升的旅程             |      3 | 英雄之旅                   | `other`                |
|          80030 | 大地勘探·蒙德              |      4 | 蒙德·风与牧歌的城邦        | `other`                |
|          80043 | 大地勘探·璃月              |      5 | 璃月·岩与契约的海港        | `other`                |
|          80056 | 大地勘探·龙脊雪山          |     16 | 雪山上的来客               | `other`                |
|          80069 | 灿若惊雷                   |     22 | 尘世巡游·第二辑            | `other`                |
|          80074 | 大地勘探·雷光所照之土·其一 |     24 | 稻妻·雷与永恒的群岛·其之一 | `other`                |
|          80091 | 妖鬼狂言百物语             | absent | 天地万象                   | `wonders_of_the_world` |
|          80096 | 大地勘探·雷光所照之土·其二 |     26 | 稻妻·雷与永恒的群岛·其之二 | `other`                |

All ten group rows resolve to the expected goal name and the checked-in
goal-id mapping. The full fixture-driven converter tests additionally cover
`memories_of_the_heart`, `challenger`, `elemental_specialist`, and
`teyvat_fishing_guide`.
