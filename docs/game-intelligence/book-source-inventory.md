# Book / Document source inventory

盘点基于 `data/upstream/AnimeGameData` 的 `26df1dfbdf05a82bbb1d97506859f3e1c40718d8`（2026-09-01 本地 checkout），语言为 CHS。`BooksCodexExcelConfigData` 的 `materialId` 连接 `DocumentExcelConfigData.id`；文档的 `questIDList` 再连接 `LocalizationExcelConfigData`，由此解析 `Readable/CHS/*.txt`。书目归属通过对应 `MaterialExcelConfigData.setID` 连接 `BookSuitExcelConfigData.id`。

## Counts

| Source / relation                           | Count | Meaning                                     |
| ------------------------------------------- | ----: | ------------------------------------------- |
| `BookSuitExcelConfigData.json` rows         |    77 | 配置中的书目/套系                           |
| `BooksCodexExcelConfigData.json` rows       |   293 | 书卷图鉴行（含 18 行 `isDisuse=true`）      |
| unique `BooksCodex.materialId`              |   288 | 唯一卷文档/原文关联                         |
| unique `Material.setID` in all codex rows   |    76 | 有卷记录的书目                              |
| unique `Material.setID` in non-disused rows |    74 | 有当前有效卷记录的书目                      |
| `Readable/CHS/*.txt`                        | 1,910 | CHS 可读文本文件总数                        |
| `Readable/CHS/Book*.txt`                    | 1,257 | 书籍命名空间文件；其余 653 个是其他可读文本 |
| unique mapped CHS book paths                |   288 | 与 unique `materialId` 一一对应             |

## Coverage and gaps

所有 293 条 BooksCodex 行都能解析到一个 `Readable/CHS/Book*.txt`，且本次盘点中对应文件均存在、非空；按 unique volume 计，原文覆盖为 **288/288**。因此没有“已有卷但缺原文”的卷。

配置层唯一缺少卷和原文的书目是：

| BookSuit id | 书目     | 状态                                                           |
| ----------: | -------- | -------------------------------------------------------------- |
|        1075 | 渊兽之心 | BookSuit 有配置，但没有 BooksCodex 行，也没有可映射的 CHS 原文 |

另有两个 BookSuit（1013「旅行者的笔记」、1020「岩神传说」）只剩 `isDisuse=true` 的 4 卷记录；它们仍有原文文件，但不计入当前有效卷覆盖。转换器保留这些源行的既有 accounting 行为，并通过稳定卷 ID 避免重复 canonical key 造成多份文档。

## Identity and segmentation contract

- `bookStableId = book/{BookSuit.id}`：同一书目跨版本稳定。
- `volumeStableId = {bookStableId}/volume/{BooksCodex.id}`：同书不同卷不同；使用 codex 行 ID，不使用可能重复的 `materialId`。
- `documentStableId = document/{volumeStableId}`：一个卷对应一个可读取 document 的稳定来源身份；实际数据库 `documentId` 仍由发布 revision 生成，不能与该稳定来源身份混用。
- `segmentKey = segmentStableId(documentStableId, ordinal)`，即 `{documentStableId}/segment/{ordinal+1}`：不包含内容 hash 或 revision，重复转换可复现。
- 普通卷输出一个 segment，`headingPath=[书目名, 卷名]`。超过 2,000 字的卷按空行分隔的段落组切分，追加 `段落组 N` 到 heading path。若来源正文显式包含至少两个卷标题，也会先按卷切分，再对长卷按段落组切分。

每个 segment 同时携带 `documentStableId`、`segmentStableId`、`headingPath`、`revision`/`locale` 所需的来源元数据；发布层继续生成 revision-scoped `documentId` 和 `segmentId`，`readSection` 消费的 citation 字段契约保持不变。
