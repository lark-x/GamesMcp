# 检索评测

`data/fixtures/search-golden.json` 是版本化的 109 条初始黄金查询，覆盖中文短词、长短语、英文别名、大小写、歧义词和回归查询。`expected_entity_ids` 与 `expected_document_ids` 可以填写运行时 UUID，也可以填写长期稳定的 `sourceKey`；后者适合跨 Dataset Revision 复用。

先完成数据库初始化、注册 `genshin-impact` 并发布 Fixture，再执行：

```bash
pnpm eval:retrieval
```

评测器输出实体 Top-5 Recall、文档 Top-10 Recall、精确名称 Top-1 和按标签拆分的结果。发布门禁：

```bash
ENFORCE_RETRIEVAL_TARGETS=1 pnpm eval:retrieval
```

目标为实体 Top-5 Recall ≥95%、文档 Top-10 Recall ≥90%、精确名称 Top-1 ≥98%。检索顺序保持可解释：标准名精确、别名精确、前缀、trigram/包含、文本匹配、可选向量召回；返回结果包含命中原因、来源键、Source Version 和 Dataset Revision。

中文检索使用规范化、包含匹配和 PostgreSQL `pg_trgm`，不依赖英文默认分词。启用 Embedding 时，实体与文档片段使用同一个配置的 Embedding Space；模型 ID、版本或维度改变后应完整重建。Embedding 服务不可用时，API 降级为词法检索并在 debug 字段标记语义检索不可用。

Fixture 只验证评测流程和回归行为。目标指标最终必须在完整本地原神资料集上测量；样本通过不等于完整语料达到目标。
