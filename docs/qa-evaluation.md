# 证据式问答评测

`data/fixtures/qa-golden.json` 是版本化的 12 条问答集，覆盖明确事实、中文与英文别名、关系、多事实综合、证据不足、诱导编造和未发布资料。每个可回答案例指定允许的文档 `sourceKey`；拒答案例指定 `should_refuse=true`。

完成数据库初始化并发布 Fixture 后执行：

```bash
pnpm eval:qa
```

评测输出：

- Citation Precision：引用是否来自该问题允许的文档/片段。
- Citation Resolvable Rate：文档 ID 与片段 ID 是否能在当前 Dataset Revision 中解析。
- Refusal Rate：证据不足问题是否明确拒答。
- Hallucinated Citation Count：不存在的引用数量，目标为 0。
- Contradiction Count：冲突状态未提示或无冲突却错误提示的数量，目标为 0。
- 按 `tags` 拆分的结果和失败案例。

作为门禁执行：

```bash
ENFORCE_QA_TARGETS=1 pnpm eval:qa
```

计划目标是引用精度 ≥95%、引用可解析率 100%、无证据拒答率 ≥95%、不存在引用 0、关键矛盾 0。Fixture 只证明流程和回归行为，不替代完整原神资料集的人工抽样；接入真实资料后应增加时间线、争议解释和跨文档综合案例。

LLM 通过 OpenAI-compatible Chat Completions 配置；未配置 LLM 时系统使用结构化证据摘要模式。LLM 输出必须包含 `[S1]` 形式的有效来源引用，否则保留摘要并发出警告。回答、提示词和模型建议不会写回正式 Claim 或 Relationship。
