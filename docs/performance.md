# 性能基准

使用已发布的本地数据集和运行中的 API 执行：

```bash
GAME_ID=<game-uuid> pnpm benchmark:search
```

脚本按三种请求分别输出 P50、P95 和最大耗时：

| profile    | 请求类型               | 目标 P95 |
| ---------- | ---------------------- | -------: |
| `entity`   | `entity`               |  ≤ 200ms |
| `fulltext` | `document` + `segment` |  ≤ 500ms |
| `mixed`    | 默认实体、文档、片段   |     ≤ 1s |

每个 profile 默认执行 5 个中文查询、5 次迭代；可用 `BENCHMARK_QUERIES`、`BENCHMARK_ITERATIONS`、`API_BASE_URL` 覆盖。发布前启用门禁：

```bash
GAME_ID=<game-uuid> ENFORCE_PERFORMANCE_TARGETS=1 pnpm benchmark:search
```

该基准不包含模型生成时间。导入解析、全文索引任务和 Embedding 由 Worker 执行，不阻塞 API；Embedding/LLM 不可用时仍保留词法检索。API 按请求查询数据库，不把完整数据集常驻内存；实际目标应在目标机器和完整资料集上重新测量。
