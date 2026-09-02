# Item / Material text source inventory

盘点基于 `data/upstream/AnimeGameData` 的
`26df1dfbdf05a82bbb1d97506859f3e1c40718d8`（2026-09-01 本地 sparse checkout），主语言为
CHS。这里的“有文本”按 Excel 行中的 TextMap hash 字段非空统计，不等同于当前执行上下文中
TextResolver 已成功解析出的语言文本数量。

## Counts

| Source                              |   Rows | Source `itemType` distribution                                    |                     `description` source present |                                       `storyText` source present |
| ----------------------------------- | -----: | ----------------------------------------------------------------- | -----------------------------------------------: | ---------------------------------------------------------------: |
| `MaterialExcelConfigData.json`      | 10,404 | `ITEM_MATERIAL`: 10,279；`ITEM_VIRTUAL`: 125                      |                        `descTextMapHash`: 10,404 |                                    literal `storyText*` field: 0 |
| `MaterialCodexExcelConfigData.json` |  1,166 | no `itemType` field；通过 `materialId` 关联后均为 `ITEM_MATERIAL` | `descTextMapHash`: 1,166（作为图鉴故事文本来源） | literal `storyText*` field: 0；canonical `storyText`: 1,166 rows |

Material rows also expose `specialDescTextMapHash` on 10,404/10,404 rows and
`effectDescTextMapHash` on 10,404/10,404 rows. The extractor maps
`Material.descTextMapHash` to `description`, `Material.specialDescTextMapHash` to
`specialDescription`, and the exact `MaterialCodex.materialId -> Material.id` relation's
`MaterialCodex.descTextMapHash` to `storyText`.

## Relation coverage

| Relation / property               |        Count | Meaning                                            |
| --------------------------------- | -----------: | -------------------------------------------------- |
| unique Material IDs               |       10,404 | Material catalog IDs are unique in this snapshot   |
| unique MaterialCodex IDs          |        1,166 | Codex row IDs are unique                           |
| unique `MaterialCodex.materialId` |        1,159 | Seven material IDs have two Codex rows             |
| Codex rows linked to Material     |  1,166/1,166 | Every Codex row has an exact Material row          |
| Material rows with a Codex row    | 1,159/10,404 | Coverage of canonical `storyText` by distinct item |
| dangling Codex material IDs       |            0 | No unmatched `materialId` in this snapshot         |

The current item-text extractor emits one record per Material row (`item/<Material.id>`).
When more than one Codex row points at an item, it deterministically selects the non-disused
row with the lowest `sortOrder`, then the lowest Codex ID; duplicate relations remain visible in
manifest statistics. Missing TextMap values stay `null`.

## First-batch item type mapping

The pinned `MaterialExcelConfigData` contains only the following upstream values. The mapping is
based on the source `itemType` field itself; `materialType` is not used to reclassify an
`ITEM_MATERIAL` row.

| Upstream `itemType`    | Canonical `ItemTextRecord.itemType` |                     Rows |
| ---------------------- | ----------------------------------- | -----------------------: |
| `ITEM_MATERIAL`        | `material`                          |                   10,279 |
| `ITEM_VIRTUAL`         | `currency`                          |                      125 |
| any unrecognized value | `other` + warning                   | 0 in the pinned snapshot |

The extractor initializes zero counters for all canonical classes in `manifest.stats` using the
keys `itemType.material`, `itemType.quest_item`, `itemType.weapon`, `itemType.artifact`,
`itemType.food`, `itemType.gadget`, `itemType.furnishing`, `itemType.currency`,
`itemType.special_item`, `itemType.book_item`, and `itemType.other`. The remaining classes are
reserved for their dedicated upstream tables in later batches; deriving them from
`materialType` here would change the meaning of the upstream `itemType` field.

## Sparse checkout limitation

The checkout is pinned to the commit above with sparse checkout enabled. Its selected paths include
the two Material tables, `TextMap/TextMapCHS.json`, `TextMap/TextMap_MediumCHS.json`, and the
`Readable/CHS/` tree, but not the complete upstream repository or every locale/Excel table.
Therefore:

- this inventory describes only the visible files in the checkout; an absent path is not evidence
  that the full upstream repository has no such source;
- the extractor may consume only files that physically exist, and records missing optional fields
  as `null` rather than inventing data from another table;
- TextMap hash presence above is source coverage, while resolved text coverage depends on the
  maps supplied to `AnimeContext.textResolver` and on the selected locale;
- weapon, artifact, and other item families that live in separate upstream tables are not silently
  projected into this first Material batch.
