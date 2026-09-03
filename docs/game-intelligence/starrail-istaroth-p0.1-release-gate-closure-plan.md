# GamesMcp StarRail / Istaroth P0.1 收尾执行计划

> 适用仓库：`https://github.com/lark-x/GamesMcp`  
> 当前审查基线：`38f3603c4b7626c5c139f36d493dd731441db27c`  
> 本轮性质：**Release Evidence Closure**  
> 目标：把“本地已经验证”升级为“GitHub clean runner 可重复验证”，然后正式关闭 StarRail / Istaroth P0。

---

# 1. 本轮唯一目标

本轮不再扩展 StarRail Corpus、Provider 或检索功能，只完成下面闭环：

```text
Pinned TurnBasedGameData
        ↓
Full StarRail Corpus
        ↓
Corpus Validation
        ↓
Istaroth Checkpoint
        ↓
GitHub Artifact
        ↓
Ephemeral Istaroth MCP
        ↓
GamesMcp Provider
        ↓
Real MCP E2E
        ↓
Golden + Latency + Recovery
        ↓
P0_FIX_COMPLETE = true
```

当前已经证明“本地可以跑通”，本轮必须证明：

> 在一台干净 GitHub-hosted Ubuntu Runner 上，从固定源码 SHA 开始，也能重新生成真实 checkpoint，并由该 checkpoint 完成 GamesMcp → Istaroth 的真实 E2E。

---

# 2. 本轮禁止事项

Agent 本轮禁止：

- 增加新的 StarRail Corpus 类别
- 接入 EN / JP / KR TextMap
- 更换 embedding 模型
- 引入 Redis / OpenSearch / Qdrant / Milvus
- 重写 Istaroth
- 无必要修改 Provider Contract
- 做前端、Game Archive、Media Asset Resolver
- 修改 Golden 阈值来让测试通过
- 将失败的真实测试改成 skip / warning
- 用 Fixture 代替 Full Corpus
- 用本地预生成 checkpoint 冒充 CI checkpoint
- 用外部人工常驻 Istaroth 服务作为唯一 Release Gate
- 报告里写 PASS，但没有 Action Run / JSON Artifact / Metadata 证据

---

# 3. 已完成基线

以下能力视为已经完成，本轮只做回归保护：

```text
[完成] Windows canonical path
[完成] pinned TurnBasedGameData full corpus
[完成] 8 类 StarRail source mapping
[完成] uint64 TextMap Hash 无损处理
[完成] 15,907 real documents
[完成] unresolved title = 0
[完成] duplicate = 0
[完成] index fallback = 0
[完成] Stable ID
[完成] Schema Drift regression
[完成] Istaroth Adapter
[完成] Local Checkpoint build
[完成] Local 50-case Istaroth E2E
[完成] Main CI green
```

---

# 4. 最终 Release Gate

只有以下条件全部满足，才能声明：

```text
P0_FIX_COMPLETE = true
```

检查项：

```text
[ ] build-starrail-checkpoint 在 GitHub-hosted Ubuntu runner 成功
[ ] TurnBasedGameData 使用明确 SHA
[ ] Istaroth 使用明确 SHA
[ ] Full Corpus 在 CI 中重新生成
[ ] Corpus validation PASS
[ ] Checkpoint 从零生成
[ ] Checkpoint metadata 记录完整 provenance
[ ] Checkpoint Artifact 上传成功
[ ] 后续 E2E 使用 CI 生成的 checkpoint
[ ] Istaroth MCP 在 CI 中临时启动
[ ] MCP initialize PASS
[ ] tools/list PASS
[ ] GamesMcp provider health PASS
[ ] hybrid PASS
[ ] keyword PASS
[ ] document read PASS
[ ] hierarchy PASS
[ ] down isolation PASS
[ ] reconnect PASS
[ ] 50-case E2E 全部 PASS
[ ] Retrieval metrics 写入 JSON
[ ] Latency P50/P95/P99 写入 JSON
[ ] 最终报告记录正确 GamesMcp tested SHA
[ ] 最终报告记录正确 Istaroth SHA
[ ] 最终报告记录正确 TurnBasedGameData SHA
[ ] Main CI Linux / Windows / macOS 全绿
```

---

# 5. Sprint P0.1-1：冻结所有外部版本

## 目标

消除：

```text
main
latest
默认分支
```

导致的不可复现问题。

## 固定基线

当前已知：

```text
TurnBasedGameData:
8cdb905dc2f8e6fffa9be4eb07af3e34435d6091

Istaroth:
f22ea938704f414cfa6bfe03bc65b71142c781b7
```

GamesMcp 必须使用：

```text
真正执行最终 Release Gate 的 commit SHA
```

不能继续把旧的 `ca58b...` 写成 tested revision。

## 重点文件

```text
.github/workflows/build-starrail-checkpoint.yml
.github/workflows/provider-integration.yml
artifacts/P0-REPAIR-REPORT.md
```

## 要求

`workflow_dispatch` 继续接受：

```yaml
turn_based_game_data_ref:
istaroth_ref:
```

但 Release Gate 执行时必须传入完整 SHA。

Scheduled workflow 如果没有 input，只能读取：

```text
TURN_BASED_GAME_DATA_REF
ISTAROTH_REF
```

缺失则 fail fast。

禁止 fallback：

```text
|| 'main'
```

## DoD

```text
[ ] workflow 不隐式依赖 main
[ ] 三个 SHA 写入 logs
[ ] 三个 SHA 写入 artifact metadata
```

---

# 6. Sprint P0.1-2：完善 Checkpoint Metadata

输出必须存在：

```text
starrail-checkpoint/checkpoint-metadata.json
```

建议结构：

```json
{
  "schemaVersion": 1,
  "game": "starrail",
  "language": "CHS",
  "gamesMcp": {
    "repository": "lark-x/GamesMcp",
    "commit": "<sha>"
  },
  "istaroth": {
    "repository": "lark-x/istaroth",
    "commit": "<sha>"
  },
  "source": {
    "repository": "DimbreathBot/TurnBasedGameData",
    "commit": "<sha>"
  },
  "corpus": {
    "documentCount": 15907,
    "corpusHash": "<sha256>",
    "validationOk": true
  },
  "embedding": {
    "backend": "sentence-transformers",
    "model": "BAAI/bge-small-zh-v1.5",
    "device": "cpu"
  },
  "build": {
    "runner": "github-actions",
    "platform": "linux",
    "createdAt": "<ISO8601>"
  }
}
```

CI 不允许只执行：

```bash
test -f checkpoint-metadata.json
```

还必须解析并断言：

```text
documentCount > 0
source.commit == expected
istaroth.commit == expected
gamesMcp.commit == github.sha
corpusHash 非空
validationOk == true
embedding model == expected
```

---

# 7. Sprint P0.1-3：真实运行 build-starrail-checkpoint

## 执行

手动触发：

```text
build-starrail-checkpoint
```

Input：

```text
turn_based_game_data_ref =
8cdb905dc2f8e6fffa9be4eb07af3e34435d6091

istaroth_ref =
f22ea938704f414cfa6bfe03bc65b71142c781b7
```

## 必须是

```yaml
runs-on: ubuntu-latest
```

GitHub-hosted runner。

不能把 self-hosted / 本地机器作为唯一验收。

## 实际步骤必须完整执行

```text
Checkout GamesMcp
↓
Checkout pinned TurnBasedGameData
↓
Checkout pinned Istaroth
↓
Python 3.12
↓
uv sync
↓
Node 22
↓
pnpm install --frozen-lockfile
↓
pnpm data:starrail:corpus
↓
pnpm data:starrail:validate
↓
pnpm checkpoint:starrail:build
↓
metadata verification
↓
artifact upload
```

## 失败规则

以下任一情况必须 exit != 0：

```text
Corpus build fail
Validation fail
Embedding fail
Chroma missing
BM25 missing
Metadata missing
SHA mismatch
Dependency install fail
```

## Artifact 建议

```text
starrail-istaroth-checkpoint-<short-sha>
```

内容：

```text
checkpoint/
manifest/
metadata/
validation.json
source-inventory.json
checkpoint-metadata.json
build-summary.json
```

## 阶段验收证据

Agent 必须记录：

```text
Workflow:
Run ID:
Run URL:
Conclusion:
GamesMcp SHA:
TurnBasedGameData SHA:
Istaroth SHA:
Artifact name:
Artifact size:
```

---

# 8. Sprint P0.1-4：新增最终 Release Gate Workflow

推荐新增：

```text
.github/workflows/starrail-istaroth-release-gate.yml
```

结构：

```text
Job 1: build-checkpoint
        ↓ artifact

Job 2: e2e
        ↓

Job 3: final-gate
```

## Job 1

生成真实 full corpus + checkpoint 并上传 artifact。

## Job 2

必须：

```yaml
needs: build-checkpoint
```

并：

```text
download checkpoint artifact
↓
启动临时 Istaroth
↓
等待 MCP Ready
↓
运行 GamesMcp real E2E
↓
生成 metrics artifacts
```

关键原则：

> E2E 必须消费本次 Job 1 生成的 checkpoint。

不能使用：

```text
开发机 checkpoint
外部共享 checkpoint
之前某个 workflow 的未固定 artifact
```

---

# 9. Sprint P0.1-5：CI 内启动临时 Istaroth

Release workflow 不应依赖一个外部长期运行的：

```text
STARRAIL_ISTAROTH_INTEGRATION_URL
```

## 启动流程

```text
download checkpoint
↓
配置 ISTAROTH_DOCUMENT_STORE_SET
↓
启动 Istaroth MCP
↓
绑定 localhost
↓
等待 MCP ready
↓
运行测试
↓
finally cleanup
```

## 启动命令

Agent 必须先读取当前 Istaroth fork：

```text
README
pyproject.toml
scripts/
mcp_server.py
Dockerfile
```

确认真实启动方式。

禁止猜命令。

## Ready 判定

不能只检查：

```text
port open
```

必须至少：

```text
MCP initialize PASS
tools/list PASS
```

建议最大等待：

```text
120 秒
```

超时则 workflow fail。

---

# 10. Sprint P0.1-6：GamesMcp → Istaroth 真实 E2E

调用链必须是：

```text
Test Runner
↓
GamesMcp Provider
↓
Istaroth MCP Client
↓
Istaroth MCP
↓
CI-generated Checkpoint
```

禁止直接绕过 GamesMcp 调用 Istaroth 作为 Release Gate。

---

# 11. E2E 必测项目

## Provider Health

验证：

```text
game = starrail
provider = istaroth
status = available
```

## Hybrid Search

至少覆盖：

```text
卡芙卡
黄泉
砂金
匹诺康尼
星核猎手
开拓者
三月七
仙舟罗浮
```

## Keyword Search

至少：

```text
规则就是用来打破的
人有五名 代价有三个
模拟宇宙
无名客
```

## Semantic

至少：

```text
砂金在匹诺康尼经历了什么
黄泉和虚无是什么关系
仙舟联盟为什么追猎丰饶
贝洛伯格上下层区的冲突
```

## Cross-document

至少：

```text
星核猎手 卡芙卡 银狼 刃
星穹列车 姬子 瓦尔特 三月七 丹恒
仙舟 罗浮 景元 符玄 彦卿
```

最终 Golden 仍使用现有 50 case。

---

# 12. Document Read Gate

必须：

```text
search
↓
获取真实 documentId
↓
get_game_document
```

验证：

```text
正文非空
documentId 一致
cursor 有效
第二页不是第一页重复内容
结束 cursor 正确
```

禁止硬编码本地已有 Document ID 作为唯一测试方式。

---

# 13. Hierarchy Gate

使用真实搜索结果：

```text
search
↓
documentId
↓
get_game_document_hierarchy
```

验证：

```text
返回非空
document identity 正确
hierarchy/path 合法
```

不得 fabricated hierarchy。

---

# 14. Failure Isolation Gate

执行：

```text
Istaroth running
↓
search PASS

kill Istaroth
↓
search 返回 provider_unavailable

GamesMcp
↓
仍然存活
```

禁止：

```text
uncaught exception
GamesMcp process crash
infinite retry
异常长时间阻塞
```

---

# 15. Reconnect Gate

执行：

```text
start Istaroth
↓
search PASS

stop Istaroth
↓
search provider_unavailable

restart Istaroth
↓
再次 search PASS
```

这是对之前 stale client retry Bug 的最终回归验证。

---

# 16. Sprint P0.1-7：把所有关键结果写入 JSON Artifact

新增或升级：

```text
artifacts/evaluation/starrail-istaroth-release-gate.json
```

建议：

```json
{
  "schemaVersion": 1,
  "testedRevision": {
    "gamesMcp": "<sha>",
    "istaroth": "<sha>",
    "turnBasedGameData": "<sha>"
  },
  "checkpoint": {
    "corpusHash": "<hash>",
    "documentCount": 15907,
    "embeddingModel": "BAAI/bge-small-zh-v1.5"
  },
  "e2e": {
    "total": 50,
    "passed": 50,
    "failed": 0,
    "hybridPassed": true,
    "keywordPassed": true,
    "documentReadPassed": true,
    "hierarchyPassed": true,
    "downIsolationPassed": true,
    "reconnectPassed": true
  },
  "retrieval": {
    "recallAt5": 0,
    "recallAt10": 0,
    "mrr": 0,
    "emptyResultRate": 0
  },
  "latencyMs": {
    "p50": 0,
    "p95": 0,
    "p99": 0,
    "sampleCount": 50
  }
}
```

注意：

```text
0 只是 schema 示例
```

运行时必须写真实值。

不得复制旧 Markdown 中的 44 / 68 / 73ms。

---

# 17. Latency 采集

至少采集每次真实请求耗时：

```ts
const startedAt = performance.now();
...
const elapsedMs = performance.now() - startedAt;
```

建议分别统计：

```text
hybrid
keyword
document
hierarchy
overall
```

输出：

```json
{
  "latencyMs": {
    "hybrid": {
      "p50": 0,
      "p95": 0,
      "p99": 0
    },
    "keyword": {},
    "document": {},
    "hierarchy": {},
    "overall": {}
  }
}
```

本轮不需要为了性能数字修改检索算法。

本轮只要求：

```text
真实
机器可读
可复现
无 timeout
```

---

# 18. Golden 评价规则

保留现有 50-case Golden，用于 P0 Release regression。

但 Agent 必须明确：

```text
Recall@5 / Recall@10 / MRR
```

当前主要是 regression/smoke 指标，不代表已经形成完整人工标注 IR benchmark。

本轮禁止为了达到 100% 修改 case 或放宽 mustContainAny。

如实际结果低于当前 baseline：

```text
必须分析原因
不得直接改阈值
```

---

# 19. Sprint P0.1-8：修复最终 P0 报告

文件：

```text
artifacts/P0-REPAIR-REPORT.md
```

当前最大问题：

```text
GamesMcp Revision 仍写旧 SHA
```

新报告必须区分：

```text
GamesMcp Tested Revision:
<真正执行 release gate 的代码 SHA>

Istaroth Revision:
<实际 SHA>

TurnBasedGameData Revision:
<实际 SHA>
```

不要让：

```text
Report Commit
```

和：

```text
Tested Commit
```

混为一谈。

---

# 20. 最终报告必须包含 GitHub Action 证据

```text
Main CI
- Run ID
- URL
- conclusion

Checkpoint Workflow
- Run ID
- URL
- conclusion

StarRail Istaroth Release Gate
- Run ID
- URL
- conclusion
```

没有 Run ID / URL，不允许写：

```text
PASS
```

---

# 21. Corpus Evidence

最终报告：

```text
Documents
Categories
Chars
Unresolved Titles
Duplicate Count
Stable ID fallback count
Validation warnings
Corpus hash
```

所有数据必须来自对应 JSON artifact。

---

# 22. Checkpoint Evidence

必须记录：

```text
Artifact name
Artifact size
Document count
Chunk count
Corpus hash
Embedding backend
Embedding model
Build duration
```

---

# 23. MCP E2E Evidence

最终必须明确：

```text
health: PASS / FAIL
hybrid: PASS / FAIL
keyword: PASS / FAIL
document: PASS / FAIL
hierarchy: PASS / FAIL
down isolation: PASS / FAIL
reconnect: PASS / FAIL
```

每个结论必须由 release-gate JSON 支撑。

---

# 24. UTF-8 Warning 收尾

当前已有：

```text
possible utf8 replacement char:
sr_book/190699.txt
```

本轮必须查清：

## 情况 A：上游原始数据就包含 U+FFFD

则：

```text
记录 source path
保留 warning
不篡改 upstream content
```

## 情况 B：GamesMcp decode bug

则：

```text
修复 reader
增加 regression test
重新生成 full corpus
重新执行 checkpoint
```

该 warning 本身不阻塞 P0，除非确认属于 GamesMcp 解码错误。

---

# 25. 普通 CI 最终回归

最终提交后重新跑：

```text
.github/workflows/ci.yml
```

必须：

```text
Linux PASS
Windows PASS
macOS PASS
```

继续保证：

```text
pnpm build
pnpm typecheck
pnpm test
pnpm lint
pnpm format:check
```

全部成功。

---

# 26. 推荐最终 Workflow 架构

```text
ci.yml
├── Linux
├── Windows
└── macOS

build-starrail-checkpoint.yml
└── reproducible checkpoint build

provider-integration.yml
├── provider-contract
├── real-genshin-istaroth
├── real-starrail-local
└── optional external provider integration

starrail-istaroth-release-gate.yml
├── full corpus
├── checkpoint
├── ephemeral Istaroth
├── GamesMcp real E2E
├── Golden
├── latency
├── failure isolation
├── reconnect
└── final artifact
```

其中：

```text
starrail-istaroth-release-gate.yml
```

应成为 StarRail/Istaroth P0 的权威 Release Gate。

---

# 27. 脚本职责建议

避免把所有逻辑写在 GitHub YAML。

建议：

```text
scripts/
├── build-starrail-checkpoint.*
├── verify-starrail-checkpoint.ts
├── start-starrail-istaroth.*
├── test-starrail-istaroth.ts
├── evaluate-starrail-retrieval.ts
└── write-starrail-release-report.ts
```

规则：

```text
Workflow = orchestration
Scripts  = reusable logic
```

---

# 28. Agent 严格执行顺序

```text
P0.1-1 Pin revisions
↓
P0.1-2 Checkpoint metadata
↓
P0.1-3 GitHub clean checkpoint build
↓
修复直到 workflow green
↓
P0.1-4 Release Gate workflow
↓
P0.1-5 Ephemeral Istaroth
↓
P0.1-6 Real GamesMcp E2E
↓
P0.1-7 JSON metrics + latency
↓
P0.1-8 Final report
↓
Main CI regression
↓
P0 final decision
```

禁止跳过 clean checkpoint build 直接宣布完成。

---

# 29. 每个阶段 Agent 必须提交的执行报告

固定格式：

```markdown
## Changed

- 修改文件
- 修改原因

## Tests

- 执行命令
- PASS / FAIL

## Real Data

- TurnBasedGameData SHA
- 是否 Full Corpus
- 是否真实 Checkpoint
- 是否真实 Istaroth

## GitHub Actions

- Workflow
- Run ID
- Run URL
- Conclusion

## Artifacts

- Artifact 名称
- 大小
- Hash
- 内容

## Remaining

- 尚未关闭的问题
```

禁止只输出：

```text
完成
测试通过
```

---

# 30. Commit 建议

```text
ci(starrail): pin checkpoint build revisions
```

```text
feat(starrail): add checkpoint provenance verification
```

```text
ci(starrail): add reproducible istaroth release gate
```

```text
test(starrail): persist e2e latency and recovery evidence
```

```text
docs(starrail): finalize p0 verification report
```

尽量保持小提交。

---

# 31. Agent 最终必须回答的 30 个问题

```text
1. GamesMcp tested SHA?
2. TurnBasedGameData SHA?
3. Istaroth SHA?
4. Main CI Run ID?
5. Main CI green?
6. Checkpoint workflow Run ID?
7. Clean runner checkpoint build green?
8. Checkpoint artifact name?
9. Checkpoint artifact size?
10. Corpus document count?
11. Corpus hash?
12. Checkpoint document count?
13. Checkpoint chunk count?
14. Embedding model?
15. Release Gate Run ID?
16. MCP initialize PASS?
17. tools/list PASS?
18. Provider health PASS?
19. Hybrid PASS?
20. Keyword PASS?
21. Document PASS?
22. Hierarchy PASS?
23. Down isolation PASS?
24. Reconnect PASS?
25. Golden total / passed?
26. Recall@5?
27. Recall@10?
28. MRR / empty result rate?
29. P50 / P95 / P99?
30. UTF-8 warning root cause?
```

其中任意关键项无法回答：

```text
不得声明 P0 complete
```

---

# 32. 最终状态枚举

## 完全关闭

```text
P0_FIX_COMPLETE = true
P0_RELEASE_VERIFIED = true
```

前提：

```text
所有 Release Gate PASS
```

## 代码完成但 Release Evidence 不完整

```text
P0_CODE_COMPLETE = true
P0_RELEASE_VERIFIED = false
```

典型情况：

```text
GitHub clean runner checkpoint fail
Release Gate 未跑
Artifact provenance 不完整
```

## 仍有 P0 Bug

```text
P0_FIX_COMPLETE = false
```

必须明确：

```text
Blocking issue
Root cause
Next action
```

---

# 33. P0.1 完成后的下一阶段

只有：

```text
P0_FIX_COMPLETE = true
P0_RELEASE_VERIFIED = true
```

以后，才进入：

```text
Game Archive / Data Browser
Media Asset Resolver
Character / Item Image Mapping
Dialogue Browser
Story Browser
Source / Provenance UI
```

本轮不要提前实现。

---

# 34. 给 Agent 的最终指令

> 本轮不是继续扩展 GamesMcp 功能，而是把已经在本地跑通的 StarRail + Istaroth 链路变成由 GitHub clean runner 独立、可重复构建和验证的正式 Release Gate。
>
> 不允许使用 Fixture、本地预生成 Checkpoint、人工常驻服务或 Markdown 声明替代真实 GitHub Actions 证据。
>
> 首先确保 `build-starrail-checkpoint` 可以在 GitHub-hosted Ubuntu runner 上，从 pinned TurnBasedGameData SHA 和 pinned Istaroth SHA 开始生成真实 checkpoint。随后，最终 Release Gate 必须消费这次 CI 生成的 checkpoint，启动临时 Istaroth MCP，再通过 GamesMcp 完成真实 health、hybrid、keyword、document、hierarchy、failure isolation、reconnect、Golden 和 latency 验证。
>
> 所有关键结果必须写入机器可读 JSON Artifact。最终报告中的每一个 PASS，都必须能追溯到 GitHub Action Run、JSON Artifact 或 checkpoint metadata。
>
> 所有 Release Gate 通过后，才允许声明：
>
> ```text
> P0_FIX_COMPLETE = true
> P0_RELEASE_VERIFIED = true
> ```
