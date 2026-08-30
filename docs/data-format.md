# 本地导入格式

首版只接受本地 JSON、Markdown、纯文本或目录，不自动联网抓取，也不依赖第三方 MCP 格式。完整原始资料放在 `data/imports/` 或私有目录，不提交 Git。

## JSON

JSON 可以是单个对象或对象数组。推荐结构如下：

```json
{
  "sourceKey": "lore/example",
  "recordType": "document",
  "title": "文档标题",
  "documentType": "lore",
  "gameVersion": "5.x",
  "body": "原文内容",
  "entities": [
    {
      "sourceKey": "entities/example",
      "name": "实体",
      "entityType": "concept",
      "summary": "实体摘要",
      "aliases": [{ "value": "旧称", "language": "zh", "primary": false }],
      "properties": {}
    }
  ],
  "relationships": [
    {
      "subjectSourceKey": "entities/a",
      "predicate": "related_to",
      "objectSourceKey": "entities/b",
      "confidence": 0.9
    }
  ],
  "claims": [
    {
      "sourceKey": "claims/example",
      "statement": "主张",
      "status": "confirmed",
      "entitySourceKeys": ["entities/example"],
      "evidence": [{ "documentSourceKey": "lore/example", "quote": "原文证据" }]
    }
  ],
  "metadata": {}
}
```

`sourceKey` 是记录的稳定来源键，也是实体稳定身份和重复导入 Diff 的基础。改名只修改 `name`，不要修改实体的 `sourceKey`。JSON 数组中没有 `sourceKey` 的记录会使用文件名加序号作为键；为避免后续重排造成变化，正式资料应显式填写。

## Markdown、文本和目录

- Markdown：首个一级标题作为标题，全文作为正文，默认 `documentType=lore`。
- 纯文本：文件名作为标题，全文作为正文，默认 `documentType=lore`。
- 目录：递归读取 `.json`、`.md`、`.markdown`、`.txt`、`.text`，忽略隐藏文件和其他扩展名；相对路径作为默认 `sourceKey`。

解析后统一为 `NormalizedRecord`，包含 `sourceKey`、`recordType`、可选标题/正文、实体/关系/主张、`metadata`、内容哈希和 `parserVersion`。

## 四类版本

返回值中的版本含义不同：

| 字段                           | 含义                                                     |
| ------------------------------ | -------------------------------------------------------- |
| `gameVersion`                  | 游戏本身的内容版本，例如 `5.x`                           |
| `sourceVersion`                | 本次原始来源快照的内容哈希，表示来源版本                 |
| `revision` / `datasetRevision` | 平台审核发布的 Dataset Revision，例如 `r3`               |
| Migration                      | 数据库结构迁移，位于 `packages/database/src/migrations/` |

## 校验与发布

导入会先创建不可变 Source Snapshot，再解析、标准化和生成 Diff。校验包括必填字段、实体/文档/关系枚举、重复来源键、失效引用、确认/暗示主张的 Evidence、空正文、异常删除比例、超大文档和非法编码。错误阻止发布，Warning 进入人工审核。

删除默认为 `deletionCandidates`；只有在审核中明确勾选并发布，才会在正式版本产生实体 Tombstone。导入失败或发布事务失败都不会修改当前发布版本。

`confirmed` 和 `implied` 主张必须至少提供一条可定位到文档片段的 Evidence；AI 问答不会自动写回 Claim 或 Relationship。
