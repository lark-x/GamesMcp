# GamesMcp StarRail / Istaroth P0 修复与真实闭环计划

> 适用仓库：`lark-x/GamesMcp`  
> 关联仓库：`lark-x/istaroth`、`DimbreathBot/TurnBasedGameData`  
> 基线参考：GamesMcp `ca58b146e330e98a40aac1d82bb3c40592ac6ebc`  
> 目标：只修复当前已确认的 P0，不扩展浏览页、图片资源、更多游戏或新的 RAG 架构。

---

## 0. 本轮唯一目标

把当前“架构已经存在，但真实全量闭环未验证”的状态推进到：

```text
Pinned TurnBasedGameData
        │
        ▼
Cross-platform Inventory
        │
        ▼
Dataset-aware Extractors
        │
        ▼
Validated Full StarRail Corpus
        │
        ▼
Reproducible Istaroth Checkpoint
        │
        ▼
Real StarRail Istaroth MCP
        │
        ▼
GamesMcp IstarothKnowledgeProvider
        │
        ▼
Real MCP E2E + Golden + CI Green
```

本轮完成后必须能够明确回答：

1. Windows / Linux / macOS 对同一份 StarRail 数据生成相同的 canonical source paths。
2. 8 个 P0 Corpus 类别在真实 `TurnBasedGameData` 上都有有效文档。
3. Corpus 不依赖数组 index 生成所谓 Stable ID。
4. Corpus Validator 能阻止关键类别缺失、严重未解析文本和明显数据漂移。
5. GitHub Actions 可以从零环境构建 StarRail Istaroth Checkpoint。
6. Checkpoint 可以启动真实 Istaroth MCP。
7. GamesMcp 可以通过 MCP 调用真实 StarRail Istaroth。
8. `retrieve`、`retrieve_bm25`、`get_file_content`、`get_document_hierarchy` 全部真实通过。
9. main CI 全绿。
10. StarRail Istaroth **仍不默认取代 LocalProvider**，除非本轮所有 Release Gate 全部通过且另外做切换决策。

---

# 1. 本轮范围

## 1.1 必须完成

### P0-1：跨平台路径规范化

解决 Windows 当前导致：

```text
sr_mission missing
sr_story missing
```

的问题。

### P0-2：真实 TurnBasedGameData 全量 Corpus 验证

不能继续只用 Fixture 证明 extractor 正确。

### P0-3：真实 Dataset Schema / Source Mapping 校正

重点确认：

```text
Mission
Story
Message
Train Visitor
Book
Character Story
Voice Line
Item Lore
```

对应真实上游文件和字段。

### P0-4：Stable ID 修复

禁止：

```text
${path}:${arrayIndex}
```

作为长期 Stable ID。

### P0-5：Corpus Validation / Drift Gate 加固

8 类 P0 数据必须成为真正 Release Gate。

### P0-6：Checkpoint Workflow 可复现化

GitHub clean runner 必须能：

```text
checkout
→ install Python/Istaroth deps
→ build corpus
→ validate
→ build checkpoint
→ upload artifact
```

### P0-7：真实 StarRail Istaroth MCP E2E

完整验证：

```text
GamesMcp
→ IstarothKnowledgeProvider
→ MCP Streamable HTTP
→ StarRail Istaroth
→ Real Checkpoint
```

### P0-8：CI 恢复全绿

至少：

```text
ubuntu
windows
```

当前 CI 全绿。

如果现有矩阵包含 macOS，也必须同时绿。

---

## 1.2 本轮明确不做

不要在本轮加入：

- Game Archive 浏览页面
- 剧情 Web Browser
- 角色故事 Web Browser
- 图片 Asset Resolver
- Sprite / Texture / Icon Pipeline
- StarRail 默认切换到 Istaroth
- 删除 `StarRailLocalProvider`
- 删除 PostgreSQL
- 重新设计 GamesMcp Provider Contract
- 重写 Istaroth BM25
- 重写向量检索
- 引入 Redis
- 引入 OpenSearch
- 引入 Qdrant / Milvus
- 引入新的向量数据库
- StarRail structured entity 全量建模
- ZZZ
- 更多游戏
- 多语言 Corpus
- 自动线上更新
- 前端功能
- Istaroth 大重构

原则：

> 本轮只做“修正确性、补真实数据证据、打通真实部署闭环”。

---

# 2. 当前已确认问题

## 2.1 P0：Windows Path Separator Bug

当前 Inventory 使用：

```ts
relative(root, file);
```

不同系统返回：

```text
Linux/macOS:
Story/Mission/...

Windows:
Story\\Mission\\...
```

而 extractor matcher 大量使用：

```ts
/(?:^|\/)Story\/Mission\//;
```

因此 Windows 下无法匹配。

当前已实际导致：

```text
sr_mission
sr_story
```

测试缺失。

### 根因

`inventory.path` 不是平台无关 canonical path。

---

## 2.2 P0：Fixture 与真实 Upstream Schema 尚未建立强绑定

现在有：

```text
data/fixtures/starrail
```

并能生成 8 类文档。

但 Fixture 只能验证：

```text
代码在我们构造的数据上能运行
```

不能证明：

```text
代码正确对应当前 TurnBasedGameData
```

必须用真实 pinned upstream 验证。

---

## 2.3 P0：Message Source Mapping 过宽

当前类似：

```ts
matchPath: (path) => /message|chat/iu.test(path);
```

风险：

```text
真实短信 dataset
```

和：

```text
Mission / Story 中的 PlayMessage / MessageSectionID 引用
```

可能混淆。

必须明确：

```text
canonical message source tables
```

然后以 source-aware extractor 为主。

---

## 2.4 P0：Stable ID 仍有 Index Fallback

当前逻辑存在：

```ts
identityFrom(record, naturalIdKeys) ?? `${item.path}:${index}`;
```

数组位置变化会导致同一语义对象 ID 改变。

这不能称为 Stable ID。

---

## 2.5 P0：Corpus Validator 没有覆盖完整 8 类 Release Gate

当前 required categories 只覆盖部分。

本轮要求 8 类全部成为正式验证项：

```text
sr_mission
sr_story
sr_message
sr_train_visitor
sr_book
sr_character_story
sr_voiceline
sr_item_lore
```

---

## 2.6 P0：Checkpoint GitHub Workflow 缺少完整 Python/Istaroth 环境安装

当前 workflow 大致：

```text
Node
pnpm
GamesMcp deps
Corpus
python scripts/rag_tools.py build
```

但 clean runner 不能假定已经存在：

```text
Istaroth Python dependencies
FastMCP
Chroma
embedding backend
sentence-transformers / torch / relevant ML deps
```

需要明确安装流程。

---

## 2.7 P0：真实 Checkpoint / MCP / Golden 无成功 Artifact

目前有：

```text
build script
test script
golden dataset
evaluation script
```

但缺：

```text
真实 successful checkpoint artifact
真实 StarRail Istaroth MCP E2E artifact
真实 retrieval quality report
```

所以不能宣布本轮完成。

---

# 3. 第一阶段：冻结 P0 修复基线

## 3.1 Agent 开始前必须记录

保存：

```text
GamesMcp HEAD
Istaroth HEAD
TurnBasedGameData target HEAD/ref
Node version
pnpm version
Python version
OS
```

建议生成：

```text
artifacts/p0-baseline.json
```

示例：

```json
{
  "gamesMcpCommit": "...",
  "istarothCommit": "...",
  "turnBasedGameDataCommit": "...",
  "node": "22.x",
  "pnpm": "11.1.2",
  "python": "3.x"
}
```

## 3.2 固定 TurnBasedGameData Revision

不要：

```text
永远直接使用 main
```

必须先选择本轮真实验证 SHA。

例如：

```text
TURN_BASED_GAME_DATA_REF=<full SHA>
```

后续：

```text
Corpus metadata
Checkpoint metadata
Golden report
CI artifact
```

必须全部写入同一个 SHA。

## 3.3 DoD

- [ ] 记录 3 个仓库 SHA
- [ ] 固定 TurnBasedGameData SHA
- [ ] 本轮不再用 floating main 作为 Release Gate
- [ ] baseline artifact 已生成

---

# 4. 第二阶段：跨平台 Canonical Source Path

这是第一项代码修复。

## 4.1 修改位置

重点：

```text
packages/providers/src/starrail/source/inventory.ts
```

当前：

```ts
const path = relative(root, file);
```

改为统一 POSIX path。

推荐：

```ts
function toCanonicalSourcePath(root: string, file: string): string {
  return relative(root, file).split(sep).join("/");
}
```

或者：

```ts
relative(root, file).replaceAll(sep, "/");
```

但优先显式函数。

## 4.2 Canonical Path Contract

项目内部所有：

```text
StarRailSourceInventoryItem.path
sourceFiles
metadata.sourcePath
manifest source path
extractor matcher
```

统一要求：

```text
/
```

禁止：

```text
\\
```

进入内部数据模型。

## 4.3 不要在每个 Extractor 兼容双分隔符

错误方案：

```ts
/Story[\\/]Mission/;
```

如果 8 个 extractor 各自这样处理，会永久留下平台差异。

正确方案：

```text
filesystem native path
↓
Inventory normalization boundary
↓
canonical POSIX source path
↓
all downstream logic
```

## 4.4 补测试

新增：

```text
packages/providers/src/starrail/source/inventory.test.ts
```

至少覆盖：

### Case 1

输入 native Windows style：

```text
Story\\Mission\\Main.json
```

规范化结果：

```text
Story/Mission/Main.json
```

### Case 2

Unix：

```text
Story/Mission/Main.json
```

保持不变。

### Case 3

所有输出：

```ts
expect(path).not.toContain("\\");
```

## 4.5 修复现有 Build Test

当前：

```text
packages/providers/src/starrail/corpus/build.test.ts
```

Windows 必须重新通过：

```text
sr_mission: 1
sr_story: 1
```

## 4.6 DoD

- [ ] Windows `build.test.ts` 通过
- [ ] Linux `build.test.ts` 通过
- [ ] canonical source path 全部使用 `/`
- [ ] extractor 不再自行兼容系统 separator
- [ ] Windows CI 不再因 Mission/Story 缺失失败

---

# 5. 第三阶段：真实 Source Inventory 与 Schema Audit

在改 extractor 前，不要猜。

先建立真实 source inventory。

## 5.1 对 pinned TurnBasedGameData 执行

```bash
pnpm data:starrail:inventory \
  --source /path/to/TurnBasedGameData \
  --output artifacts/starrail-source-inventory.json
```

如果 CLI 参数当前不同，按实际脚本调整。

## 5.2 必须生成 Source Audit Report

新增：

```text
artifacts/starrail-source-audit.json
```

至少包含：

```json
{
  "sourceCommit": "...",
  "families": {
    "Config": 0,
    "ExcelOutput": 0,
    "Story": 0,
    "TextMap": 0
  },
  "candidateDatasets": {
    "mission": [],
    "story": [],
    "message": [],
    "trainVisitor": [],
    "book": [],
    "characterStory": [],
    "voiceLine": [],
    "itemLore": []
  }
}
```

## 5.3 每个 P0 类别必须确认真实来源

Agent 不得只按文件名猜。

每一类形成 Mapping Table。

示例：

| Corpus         | Real Source Dataset          | Key                | Text fields | Join |
| -------------- | ---------------------------- | ------------------ | ----------- | ---- |
| Mission        | `...`                        | MissionID          | ...         | ...  |
| Story          | `...`                        | StoryID            | ...         | ...  |
| Message        | `...`                        | MessageSectionID   | ...         | ...  |
| TrainVisitor   | `TrainVisitorConfig.json` 等 | ...                | ...         | ...  |
| Book           | `...`                        | BookID             | ...         | ...  | ... |
| CharacterStory | `...`                        | AvatarID + section | ...         | ...  |
| VoiceLine      | `...`                        | AvatarID + voiceID | ...         | ...  |
| ItemLore       | `...`                        | ItemID             | ...         | ...  |

提交到：

```text
docs/starrail/source-mapping.md
```

## 5.4 Message 必须重点审查

必须区分：

```text
A. Message content tables
B. references to MessageSectionID
```

以下内容：

```text
Story/...
Config/Level/Mission/...
```

如果只是：

```text
PlayMessage
MessageSectionID
```

不能自动被当成正文文档。

建议设计：

```text
message content source
↓
MessageSectionID
↓
canonical message document
```

任务 / Story 中出现 MessageSectionID 时，只用于：

```text
relationship / reference
```

而不是重复生成 message document。

## 5.5 Corpus Source Matcher 禁止过宽 Regex

减少：

```ts
/message|chat/i;
```

这类全目录模糊扫描。

优先：

```ts
isKnownMessageDataset(path);
```

或者：

```ts
const MESSAGE_DATASETS = [...]
```

如果 upstream 文件集合会变化，可做：

```text
explicit known family
+
strict schema signature
```

不能靠 filename keyword 单独决定。

## 5.6 DoD

- [ ] pinned upstream inventory 已生成
- [ ] 8 类真实 source mapping 已形成
- [ ] Message source/ref 分离
- [ ] 不再依赖纯 filename 猜测正文数据
- [ ] docs/source-mapping.md 已提交

---

# 6. 第四阶段：逐类校正 Dataset-aware Extractor

本阶段不追求抽象漂亮，优先真实正确。

## 6.1 Mission

验证：

```text
真实 Mission dataset
真实剧情 conversation source
真实 MissionID
真实 title hash
真实 text hash
```

必须随机抽样至少：

```text
10 个 Mission
```

每个检查：

```text
ID
title
至少一段正文
speaker/text 是否合理
sourceFiles
sourceIds
```

## 6.2 Story

Story 不能简单等价于：

```text
所有 Story/ 下 JSON
```

必须识别：

```text
discussion
performance
dialogue
story section
```

哪些是真正应该进入 Corpus 的 narrative document。

防止：

```text
纯控制节点
资源配置
触发脚本
```

污染 Corpus。

## 6.3 Message

必须以真实消息正文表为主。

要求：

```text
一条 conversation = 一个稳定文档单位
```

保留：

```text
sender/contact
message order
branch/option
MessageSectionID
```

## 6.4 Train Visitor

当前上游已能看到类似：

```text
TrainVisitorConfig.json
```

但需验证：

```text
是否只是 trigger/config
还是包含可直接用于 Corpus 的 narrative text
```

如果正文分散于别表：

```text
TrainVisitor config
→ key
→ message/story table
```

需要真正 join。

## 6.5 Book

书籍推荐粒度：

```text
Book / Volume
```

优先一个“卷”一个文档。

避免：

```text
整套书合并成一个巨大 txt
```

导致 Istaroth chunking 过大。

## 6.6 Character Story

必须确认真正角色资料文本源。

不能只按：

```text
avatar.*story
character.*story
fetter
profile
```

模糊扫描。

建议输出：

```text
sr_character_story/<avatarId>/<sectionId>.txt
```

如果现有 Istaroth ID 约束只接受单文件数字名，则至少 metadata 中保留：

```text
avatarId
sectionId
sectionOrder
```

## 6.7 Voice Line

必须确认：

```text
voice line text
unlock/trigger title
avatar identity
```

不需要音频。

本轮只做文本 Corpus。

## 6.8 Item Lore

只收：

```text
有 narrative / lore value 的 item
```

不要把：

```text
价格
堆叠数量
资源路径
icon path
prefab
内部数值
```

作为主体文本。

## 6.9 P0 Corpus Content Quality Rules

一个文档至少满足：

```text
non-empty title
non-empty narrative content
valid source file
stable source identity
valid category
```

正文中不应大量出现：

```text
SpriteOutput/
Prefab/
Asset/
.png
.wav
.bundle
```

允许 metadata 有路径，正文尽量不要有。

## 6.10 DoD

8 类全部：

- [ ] 真实数据生成数量 > 0
- [ ] 每类随机抽样 >= 10 条，或该类总量不足则全量
- [ ] title 不是批量 unresolved
- [ ] narrative content 有意义
- [ ] source ID 可追溯
- [ ] source file 可追溯
- [ ] 无明显 asset/path 污染
- [ ] 不把 reference 当正文

---

# 7. 第五阶段：Stable ID 完整修复

这是 Corpus 长期可更新的基础。

## 7.1 删除 Index-based Identity

不得再把：

```ts
`${item.path}:${index}`;
```

当 fallback identity。

## 7.2 Stable Identity 优先级

统一策略：

```text
1. Native stable ID
2. Native composite ID
3. Semantic composite key
4. Stable content identity hash
5. Explicit unstable record — fail/warn
```

## 7.3 示例

### Mission

```text
MissionID
```

### Message

```text
MessageSectionID
```

如果一个 Section 内多个子节点：

```text
MessageSectionID + MessageID
```

### Character Story

可能：

```text
AvatarID + StorySectionID
```

### Voice

可能：

```text
AvatarID + VoiceID
```

### Book

```text
BookID + VolumeID
```

具体字段以真实 upstream 为准。

## 7.4 Content Identity Hash

如果某类确实没有 native ID：

```ts
sha256(game + category + canonicalSourcePath + semanticKeyFields + normalizedTitle);
```

不要直接：

```text
hash(full raw JSON)
```

否则 upstream 新增无关字段也会改变 ID。

## 7.5 ID Metadata

对 fallback hash 记录：

```json
{
  "idStrategy": "native|composite|semantic_hash",
  "identitySource": ["AvatarID", "StorySectionID"]
}
```

这可以放在 Corpus metadata，而不是正文。

## 7.6 Stability Test

新增测试：

```text
record order changed
→ same IDs
```

Case：

```text
[A, B, C]
```

变成：

```text
[X, A, B, C]
```

A/B/C 的 ID 必须保持不变。

## 7.7 DoD

- [ ] 无 `${path}:${index}` stable fallback
- [ ] reorder test 通过
- [ ] ID strategy 可追踪
- [ ] duplicate collision test 通过
- [ ] 两次相同 source 构建 manifest ID 完全一致

---

# 8. 第六阶段：Corpus Validator 升级为 Release Gate

## 8.1 Required Categories

默认：

```ts
const REQUIRED_CATEGORIES = [
  "sr_mission",
  "sr_story",
  "sr_message",
  "sr_train_visitor",
  "sr_book",
  "sr_character_story",
  "sr_voiceline",
  "sr_item_lore",
];
```

## 8.2 必须增加的检查

### A. 每类文档数

不能只检查：

```text
> 0
```

还要与：

```text
source-schema-golden
```

建立最低合理阈值。

避免 upstream 变化导致：

```text
Mission 5000 → 1
```

还通过。

### B. Unresolved Text

输出：

```text
unresolvedTitleCount
unresolvedTextCount
unresolvedTitleRate
unresolvedTextRate
```

建议第一轮：

```text
warning threshold
+
hard fail threshold
```

不要一开始把阈值设得过于严格。

示例：

```text
warning >= 5%
fail >= 20%
```

实际阈值应在第一次真实全量数据后根据基线确定。

### C. Duplicate

继续检查：

```text
category + id
relative path
```

还可以加入：

```text
source identity collision
```

### D. Oversized Document

保留。

但真实 corpus 跑完后，要查看：

```text
P95 / max document bytes
```

再决定默认阈值。

### E. Asset Path Pollution

现在只是 warning。

应新增统计：

```text
assetPathWarningCount
assetPathWarningRate
```

严重异常时 fail。

### F. Empty Narrative Ratio

每类统计：

```text
input candidate count
output document count
skipped non-narrative count
```

不能 silently drop 95% 数据而 Validator 仍然通过。

## 8.3 Schema Drift Gate 真正接线

当前已有：

```text
data/evaluation/starrail/source-schema-golden.json
```

必须增加：

```text
source-schema-golden.test.ts
```

或：

```text
validate-source-schema.ts
```

读取真实 inventory，并对：

```text
required file patterns
required key signatures
minimum row counts
```

进行比较。

## 8.4 Drift Gate 原则

不要把 upstream 所有文件名全部硬编码。

只保护 P0 Corpus 所依赖的：

```text
critical datasets
critical keys
critical joins
```

## 8.5 DoD

- [ ] 8 类 required categories
- [ ] unresolved rate
- [ ] empty/skipped rate
- [ ] duplicate rate
- [ ] asset pollution stats
- [ ] source schema golden 真正执行
- [ ] upstream source structure 明显断裂时 CI fail

---

# 9. 第七阶段：真实 Full Corpus Build

## 9.1 第一次 Release Candidate Build

使用 pinned SHA：

```bash
pnpm data:starrail:corpus \
  --source <TurnBasedGameData checkout> \
  --output data/generated/starrail/istaroth/full-chs
```

## 9.2 必须保存以下 Artifact

```text
artifacts/starrail-full-corpus/
├── source-audit.json
├── validation.json
├── category-stats.json
├── id-stability.json
├── unresolved-report.json
└── sample-review.json
```

Corpus 本身不要 commit 到 Git。

## 9.3 必须记录

```text
source commit
generator commit
document count
category counts
total characters
source file count
unresolved count/rate
duplicate rejected
skipped non-narrative
max document bytes
P50/P95 document bytes
```

## 9.4 人工抽样

每类：

```text
10 条
```

总计目标：

```text
80 条
```

重点检查：

```text
title
正文
说话人
选项
文本顺序
乱码
占位符
资源路径污染
ID
source provenance
```

## 9.5 DoD

- [ ] Full Corpus build 成功
- [ ] Validator PASS
- [ ] 8 类全部 > 0
- [ ] 80 条抽样完成
- [ ] 无严重 schema mapping 错误
- [ ] 生成完整 artifact

---

# 10. 第八阶段：Checkpoint Workflow 可复现化

## 10.1 不再假设 Runner 有 Python ML 环境

修改：

```text
.github/workflows/build-starrail-checkpoint.yml
```

## 10.2 推荐步骤

```text
Checkout GamesMcp
Checkout pinned TurnBasedGameData
Checkout pinned lark-x/istaroth
Setup Node 22
Setup pnpm
Setup Python
Setup uv
Install GamesMcp
Install Istaroth runtime + ML dependencies
Build Corpus
Validate Corpus
Build Checkpoint
Validate Checkpoint
Upload Artifact
```

## 10.3 Istaroth 安装方式

Agent 必须先读取当前：

```text
lark-x/istaroth/pyproject.toml
README
scripts/rag_tools.py
```

使用仓库真实推荐方式。

优先：

```bash
uv sync ...
```

不要手动维护一份容易漂移的：

```bash
pip install chromadb ...
```

除非 Istaroth 当前没有可用 dependency group。

## 10.4 固定 Python Version

不要使用 runner 随机默认版本。

例如：

```yaml
python-version: "3.12"
```

实际以 Istaroth 当前支持范围为准。

## 10.5 Embedding Backend 必须显式

Checkpoint metadata 不能长期出现：

```json
{
  "embeddingBackend": null,
  "embeddingModel": null
}
```

CI 要明确：

```text
embedding backend
embedding model
device
```

如果模型通过 HuggingFace：

```text
HF_HOME
```

也要固定缓存路径。

## 10.6 Checkpoint Reproducibility Metadata

必须保存：

```json
{
  "schemaVersion": 1,
  "game": "starrail",
  "gamesMcpCommit": "...",
  "istarothCommit": "...",
  "turnBasedGameDataCommit": "...",
  "corpusHash": "...",
  "embeddingBackend": "...",
  "embeddingModel": "...",
  "pythonVersion": "...",
  "builtAt": "..."
}
```

## 10.7 Corpus Hash 跨平台问题

当前 shell：

```text
find + sort -z + shasum
```

只用于 Linux workflow 可以接受。

但如果未来要跨平台复现，建议以后移到 Node/Python。

本轮不要求大改，只要 GitHub checkpoint workflow 的 Linux artifact 可复现即可。

## 10.8 Checkpoint Validation

Build 完不能只：

```text
exit 0
```

至少新增 smoke：

```text
checkpoint path exists
required metadata exists
Chroma/vector index exists
document count > 0
```

如果 Istaroth 有现有 inspect/check 命令，优先复用。

## 10.9 DoD

- [ ] clean GitHub runner 成功构建
- [ ] 不依赖预装 Istaroth deps
- [ ] embedding config 非空
- [ ] checkpoint metadata 完整
- [ ] checkpoint artifact 上传
- [ ] workflow 有一次明确 SUCCESS run

---

# 11. 第九阶段：真实 Istaroth StarRail MCP 启动

## 11.1 启动目标

```text
istaroth-starrail
```

环境：

```env
ISTAROTH_GAME_PROFILE=starrail
ISTAROTH_MCP_LANGUAGE=CHS
ISTAROTH_DOCUMENT_STORE_SET=CHS:/data/checkpoint/chs
```

具体 path 与 checkpoint artifact 保持一致。

## 11.2 MCP Health

必须实际验证：

```text
initialize
listTools
```

要求包含：

```text
retrieve
retrieve_bm25
get_file_content
get_document_hierarchy
```

## 11.3 不能仅依赖 Docker container healthy

Docker Healthcheck 只证明：

```text
MCP server process 可以初始化
```

不证明：

```text
StarRail checkpoint 真正加载
检索可用
```

因此增加：

```text
retrieval readiness smoke
```

例如：

```text
retrieve_bm25("卡芙卡")
```

至少有结果。

这个 smoke 可放专门测试，不需要塞进高频 healthcheck。

## 11.4 DoD

- [ ] StarRail Istaroth 启动
- [ ] listTools 正确
- [ ] checkpoint 加载成功
- [ ] keyword smoke 有结果
- [ ] hybrid smoke 有结果

---

# 12. 第十阶段：GamesMcp → StarRail Istaroth 真实 E2E

## 12.1 环境

```env
GAMESMCP_STARRAIL_ENABLED=true
GAMESMCP_STARRAIL_PROVIDER=istaroth
GAMESMCP_STARRAIL_ISTAROTH_URL=http://istaroth-starrail:8000/mcp
```

## 12.2 必测接口

### 1. Health

```text
get_game_provider_status
```

应返回：

```text
game=starrail
provider=istaroth
status=available
```

### 2. Hybrid

```text
search_game_knowledge
```

```json
{
  "game": "starrail",
  "query": "卡芙卡",
  "mode": "hybrid"
}
```

### 3. Keyword

```json
{
  "game": "starrail",
  "query": "星核猎手",
  "mode": "keyword"
}
```

### 4. Document

从 search hit 取得：

```text
documentId
```

然后：

```text
get_game_document
```

必须有正文。

### 5. Hierarchy

同一 document：

```text
get_game_document_hierarchy
```

必须返回合法结构。

## 12.3 必须走 GamesMcp MCP Server

不能只：

```ts
provider.search(...)
```

作为 Release Gate。

最终链必须：

```text
MCP test client
↓
GamesMcp MCP Server
↓
Provider Registry
↓
IstarothKnowledgeProvider
↓
IstarothMcpClient
↓
StarRail Istaroth
↓
Checkpoint
```

## 12.4 故障场景

至少验证：

### Istaroth down

```text
provider_unavailable
```

GamesMcp 进程不退出。

### Timeout

```text
provider_timeout
```

不能卡死 MCP。

### Istaroth restart

GamesMcp 能重新连接。

## 12.5 DoD

- [ ] full MCP chain hybrid PASS
- [ ] keyword PASS
- [ ] document PASS
- [ ] hierarchy PASS
- [ ] down isolation PASS
- [ ] restart recovery PASS

---

# 13. 第十一阶段：Golden Retrieval Evaluation

## 13.1 使用现有 Golden

当前已有：

```text
data/evaluation/providers/starrail-istaroth-golden.json
```

不要再先扩数据集。

先让现有真实跑起来。

## 13.2 输出

```text
artifacts/evaluation/starrail-istaroth-e2e.json
artifacts/evaluation/starrail-retrieval-eval.json
```

## 13.3 必须记录

```text
total cases
Recall@5
Recall@10
MRR
empty result rate
failure count
```

同时建议记录：

```text
P50
P95
P99
```

检索延迟。

## 13.4 LocalProvider 对照

继续保留：

```text
StarRailLocalProvider
vs
StarRail Istaroth
```

目的不是要求 Istaroth 每项都赢。

目的：

```text
建立真实迁移基线
```

## 13.5 本轮质量门槛

第一次真实跑完前不要预设不现实的绝对数字。

但必须满足：

```text
没有大规模空结果
Golden 核心实体能够被检索
Recall@10 有明确可接受基线
```

若结果很差：

```text
本轮不得默认切换 Istaroth
```

但只要原因已定位，可以先完成架构修复。

---

# 14. 第十二阶段：CI 收口

## 14.1 Main CI

必须恢复：

```text
build
typecheck
test
```

全绿。

## 14.2 Platform Matrix

至少：

```text
ubuntu-latest
windows-latest
```

如果已有 macOS：

```text
macos-latest
```

同样要求 green。

## 14.3 Fixture Corpus Test

每平台必须执行：

```text
data:starrail:corpus --source fixture
data:starrail:validate
```

## 14.4 Real Upstream Test 不要塞普通 PR CI

真实 Full TurnBasedGameData：

```text
几十 MB / 大量 JSON
```

不要让普通 PR 每次都下载和构建。

正确分层：

### Fast CI

```text
fixture
unit
schema contracts
cross-platform
```

### Scheduled / Manual Integration

```text
real TurnBasedGameData
full corpus
checkpoint
MCP E2E
Golden
```

## 14.5 Recommended Workflows

```text
ci.yml
```

负责：

```text
build
typecheck
unit
fixture corpus
cross-platform
```

```text
build-starrail-checkpoint.yml
```

负责：

```text
full source
full corpus
checkpoint artifact
```

```text
provider-integration.yml
```

负责：

```text
real Istaroth E2E
Golden evaluation
```

---

# 15. Agent 文件级修改清单

以下是高概率影响文件。Agent 必须以当前实际代码为准，不要机械照搬。

## 15.1 Source Layer

```text
packages/providers/src/starrail/source/inventory.ts
packages/providers/src/starrail/source/inventory.test.ts
packages/providers/src/starrail/source/textmap.ts
```

任务：

```text
canonical path
real schema inventory
TextMap validation
```

## 15.2 Corpus

```text
packages/providers/src/starrail/corpus/build.ts
packages/providers/src/starrail/corpus/build.test.ts
packages/providers/src/starrail/corpus/ids.ts
packages/providers/src/starrail/corpus/validator.ts
packages/providers/src/starrail/corpus/writer.ts
packages/providers/src/starrail/corpus/manifest.ts
```

## 15.3 Extractors

```text
packages/providers/src/starrail/extractors/mission.ts
packages/providers/src/starrail/extractors/story.ts
packages/providers/src/starrail/extractors/message.ts
packages/providers/src/starrail/extractors/train-visitor.ts
packages/providers/src/starrail/extractors/book.ts
packages/providers/src/starrail/extractors/character-story.ts
packages/providers/src/starrail/extractors/voice-line.ts
packages/providers/src/starrail/extractors/item-lore.ts
packages/providers/src/starrail/extractors/shared.ts
```

重点：

```text
真实 source table
真实 join
stable identity
避免 filename-only heuristic
```

## 15.4 Evaluation

```text
data/evaluation/starrail/source-schema-golden.json
data/evaluation/providers/starrail-istaroth-golden.json
scripts/evaluate-starrail-retrieval.ts
scripts/test-starrail-istaroth-provider.ts
```

新增/调整：

```text
scripts/audit-starrail-source.ts
scripts/validate-starrail-source-schema.ts
```

如果现有脚本可以复用，不强制新增。

## 15.5 Checkpoint

```text
scripts/build-starrail-checkpoint.sh
.github/workflows/build-starrail-checkpoint.yml
```

## 15.6 Provider / Config

本轮尽量少改：

```text
packages/providers/src/istaroth/provider.ts
packages/providers/src/factory.ts
packages/config/src/index.ts
```

只有真实 E2E 暴露问题时再调整。

不要重构已经正确的 Generic Provider。

## 15.7 Docker

```text
docker-compose.yml
```

只修：

```text
checkpoint mount
StarRail service env
health/readiness
```

不要扩展新服务。

---

# 16. 测试矩阵

## 16.1 Unit

### Inventory

- Windows path
- POSIX path
- canonical output

### ID

- native ID
- composite ID
- semantic hash
- reorder stability
- collision

### Normalizer

保留现有：

```text
20 markup
20 variables
20 branches
```

### Extractor

每类：

```text
known source
unknown source ignored
unresolved text
duplicate
```

## 16.2 Integration

### Fixture

```text
8 categories
manifest
metadata
validator
```

### Real source

```text
pinned TurnBasedGameData
8 categories
source mappings
```

### Checkpoint

```text
real corpus
real Istaroth build
```

### MCP

```text
real checkpoint
real Istaroth
real GamesMcp
```

---

# 17. Release Gate

本轮只有全部满足才能标记：

```text
P0 Fixed
```

## 17.1 Code Gate

- [ ] `pnpm build`
- [ ] `pnpm typecheck`
- [ ] `pnpm test`
- [ ] Windows green
- [ ] Linux green
- [ ] macOS green（若在 matrix）

## 17.2 Corpus Gate

- [ ] pinned real upstream
- [ ] 8 categories
- [ ] real mapping
- [ ] canonical paths
- [ ] stable IDs
- [ ] validator PASS
- [ ] schema drift gate PASS
- [ ] manual sample PASS

## 17.3 Checkpoint Gate

- [ ] GitHub clean runner build success
- [ ] artifact uploaded
- [ ] metadata complete
- [ ] embedding backend/model identified
- [ ] checkpoint smoke PASS

## 17.4 MCP Gate

- [ ] provider health PASS
- [ ] hybrid PASS
- [ ] BM25 PASS
- [ ] document PASS
- [ ] hierarchy PASS
- [ ] timeout PASS
- [ ] provider down isolation PASS
- [ ] reconnect PASS

## 17.5 Quality Gate

- [ ] Golden executed
- [ ] Recall@5 recorded
- [ ] Recall@10 recorded
- [ ] MRR recorded
- [ ] empty rate recorded
- [ ] latency recorded
- [ ] Local vs Istaroth comparison artifact generated

---

# 18. 明确禁止 Agent 提前做的事情

本轮 Agent 不得：

```text
“顺便”把 StarRail 默认 provider 改成 Istaroth
```

不得：

```text
删除 StarRailLocalProvider
```

不得：

```text
重写 Provider Contract
```

不得：

```text
重写 Istaroth RAG
```

不得：

```text
为了修 Message 做一个全新数据库
```

不得：

```text
为了未来图片浏览提前做 Asset Service
```

不得：

```text
引入 Redis/OpenSearch/Qdrant
```

不得：

```text
因为真实数据难解析又退回 Generic String Scraper
```

不得：

```text
把 fixture PASS 宣称为 full corpus PASS
```

不得：

```text
没有 checkpoint artifact 就宣布 checkpoint 完成
```

不得：

```text
没有 MCP real E2E 就宣布 Production Ready
```

---

# 19. 建议 Commit 拆分

建议保持可审查的小提交。

```text
fix(starrail): normalize source paths across platforms

test(starrail): add canonical path and windows regression coverage

refactor(starrail): replace heuristic source matching with dataset mappings

fix(starrail): make corpus ids stable across source reordering

feat(starrail): harden corpus validation and schema drift gates

test(starrail): validate full pinned TurnBasedGameData corpus

ci(starrail): install Istaroth Python and ML dependencies for checkpoint builds

ci(starrail): publish reproducible checkpoint metadata and artifacts

test(starrail): add real Istaroth MCP end-to-end validation

test(starrail): record golden retrieval and local-provider comparison
```

---

# 20. Rollback

本轮不能破坏现有 fallback。

保持：

```env
GAMESMCP_STARRAIL_PROVIDER=local
```

作为默认。

如果真实 Istaroth 失败：

```text
StarRailLocalProvider
```

仍可使用。

本轮不要做不可逆数据库迁移。

---

# 21. 本轮完成后的目标架构

```text
                        GamesMcp
                           │
                   Provider Registry
                           │
        ┌──────────────────┴──────────────────┐
        │                                     │
        ▼                                     ▼
StarRailLocalProvider                IstarothKnowledgeProvider
Migration Baseline                         │
                                           ▼
                                  StarRail Istaroth MCP
                                           │
                                           ▼
                                   Verified Checkpoint
                                           │
                                           ▼
                                  Validated StarRail Corpus
                                           │
                                           ▼
                              Pinned TurnBasedGameData
```

本轮完成以后：

```text
local
```

仍是：

```text
baseline / rollback
```

而：

```text
istaroth
```

已经达到：

```text
real validated candidate
```

之后再单独决定是否：

```text
default local
→
default istaroth
```

---

# 22. 最终 Definition of Done

Agent 只有在以下全部成立时才能回复“P0 修复完成”。

```text
1. main CI green
2. Windows path regression fixed
3. real pinned TurnBasedGameData full corpus built
4. 8 P0 categories verified
5. source mappings documented
6. Message source/ref correctly separated
7. no index-based stable identity
8. validator + schema drift gate pass
9. clean runner builds real checkpoint
10. checkpoint artifact exists
11. StarRail Istaroth starts from that checkpoint
12. GamesMcp real MCP E2E passes
13. hybrid / BM25 / document / hierarchy all pass
14. provider failure/recovery verified
15. Golden evaluation artifact exists
16. Recall/MRR/latency metrics recorded
17. LocalProvider remains available
18. no unrelated feature expansion
```

---

# 23. Agent 最终交付报告格式

执行完成后必须返回一份：

```text
artifacts/P0-REPAIR-REPORT.md
```

至少包含：

## Repository Revisions

```text
GamesMcp:
Istaroth:
TurnBasedGameData:
```

## Changed Files

列出所有修改。

## CI

```text
Linux:
Windows:
macOS:
```

## Corpus

```text
Documents:
Categories:
Chars:
Unresolved rate:
Duplicate count:
Skipped non-narrative:
```

## Category Counts

```text
sr_mission:
sr_story:
sr_message:
sr_train_visitor:
sr_book:
sr_character_story:
sr_voiceline:
sr_item_lore:
```

## Checkpoint

```text
Artifact:
Corpus hash:
Embedding backend:
Embedding model:
Build status:
```

## MCP E2E

```text
health:
hybrid:
keyword:
document:
hierarchy:
down isolation:
reconnect:
```

## Golden

```text
Cases:
Recall@5:
Recall@10:
MRR:
Empty result rate:
P50:
P95:
P99:
```

## Known Gaps

这里只能填写非 P0 的遗留项。

如果还有本计划 P0 未关闭：

```text
不要写“完成”
```

应明确写：

```text
PARTIAL
```

---

# 24. 一句话执行目标

> **先不要继续扩 GamesMcp 功能；把 StarRail 的真实数据源 → Corpus → Checkpoint → Istaroth → GamesMcp MCP 这条链彻底跑实，并让它在 CI、数据质量、Stable ID 和真实 Golden 证据上都可重复验证。**
