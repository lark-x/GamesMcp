# Achievement data mapping

## Upstream source

The mapping is pinned to `DimbreathBot/AnimeGameData` commit
`26df1dfbdf05a82bbb1d97506859f3e1c40718d8`:

- `ExcelBinOutput/AchievementGoalExcelConfigData.json`
- `ExcelBinOutput/AchievementExcelConfigData.json`
- `TextMap/TextMap_MediumCHS.json`

The complete 73-row goal mapping is checked in at
`scripts/mappings/achievement-goals.ts`. The mapping stores the source goal
id, resolved Chinese goal name, and the platform's canonical category. The
first upstream goal row has no `id`; it is keyed as the default goal for
achievement rows whose `goalId` is absent.

## Goal to canonical category rules

Categories are assigned from the goal mapping, never from an achievement
title or a free-form name fallback:

| Upstream goal name family                                          | Canonical category      |
| ------------------------------------------------------------------ | ----------------------- |
| `天地万象`                                                         | `wonders_of_the_world`  |
| `心跳的记忆`                                                       | `memories_of_the_heart` |
| `提瓦特钓鱼指南·第一辑`                                            | `teyvat_fishing_guide`  |
| `元素专家·第一辑` and `元素专家·第二辑`                            | `elemental_specialist`  |
| `挑战者·第一辑` through `挑战者·第十辑`                            | `challenger`            |
| `对决者·第一辑` through `对决者·第三辑`                            | `challenger`            |
| Every other goal row in the pinned source, explicitly listed by id | `other`                 |

`other` is therefore an explicit category for the current source rows, not a
replacement for a missing goal lookup. If a future source row cannot be
matched to the checked-in id/name mapping, the converter emits an
`achievements/goal_mapping_missing` failure and preserves `other` only as a
safe contract value until the mapping is updated.

## Achievement fields

| Upstream field     | Meaning in the source                                                                                           | Normalized behavior                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `goalId`           | Achievement group reference. The absent value refers to the first, unnamed-id goal row (`天地万象`).            | Resolved through the goal map; stored as `provenance.goalId` and `provenance.goalName`.                                   |
| `isShow`           | Display enum. In this snapshot, the only present value is `SHOWTYPE_HIDE`; absent means the row is displayable. | `SHOWTYPE_HIDE` → `hidden: true`, `displayState: "hidden"`; missing → `hidden: false`, `displayState: "displayed"`.       |
| `isDisuse`         | Source lifecycle/deprecation marker, independent of display visibility.                                         | Retained as `provenance.isDisuse`; it does not change `hidden` or `displayState`.                                         |
| `titleTextMapHash` | Achievement title text reference.                                                                               | Resolved through `TextMap_MediumCHS.json`; missing text causes `name_missing` and the row is not emitted.                 |
| `descTextMapHash`  | Requirement/description text reference.                                                                         | Resolved to `requirement`; unresolved text remains nullable.                                                              |
| `finishRewardId`   | Reward configuration id, not a primogem amount.                                                                 | Retained as `provenance.finishRewardId`; `rewardPrimogems` remains nullable because reward resolution is not implemented. |

The source has no `groupId` field in this snapshot. `goalId` is the grouping
key and is retained in provenance for downstream grouping/filtering.
