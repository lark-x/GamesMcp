# AnimeGameData 采集与核验操作手册

这套流程分成两部分：程序在外置盘上完成采集、转换、导入和自动检查；人工只在最后用《原神》客户端做抽样核验。因此，下载或启动游戏不是程序采集的前置条件。

Windows 原生运行和数据迁移见 [`windows.md`](./windows.md)。本手册中的 `/Volumes/Lark` 和 POSIX 命令是 macOS 示例；Windows 使用 `.env` 中的 `DATA_DIR`（例如 `D:/GamesMcp/data`）和 PowerShell 等价命令。

## 一次完整运行

1. 确认外置数据卷已连接。macOS 必须是挂载到 `/Volumes/Lark` 的 APFS 卷；Windows 原生运行建议使用 NTFS 或 ReFS 卷，并在 `.env` 中把 `DATA_DIR` 指向该卷。所有命令都会先执行 fail-closed 预检：卷类型不受支持、不可写、剩余空间小于 50 GiB，或系统卷剩余小于 10 GiB 时，流程直接停止，不会改用系统盘。

2. 确认上游目录和固定 Commit（Windows 可在 PowerShell 中运行 `git -C D:/GamesMcp/data/upstream/AnimeGameData rev-parse HEAD`）：

   ```bash
   git -C /Volumes/Lark/lark/GamesMcp/data/upstream/AnimeGameData rev-parse HEAD
   ```

   输出必须是 `26df1dfbdf05a82bbb1d97506859f3e1c40718d8`。

3. 重新执行确定性转换（不会启动游戏，也不会调用 LLM）：

   ```bash
   pnpm data:convert:anime
   pnpm data:verify:anime
   ```

   `data:verify:anime` 会检查 Commit、全部输入文件 SHA-256、三类记录、字段出处、规范化哈希、重复 key 和 accounted coverage。当前阶段三类输出应为：书籍 293 个发现、288 个成功、5 个有原因排除；角色故事 958 个成功；物品描述 1166 个成功；三类 accounted coverage 都是 100%。

   转换和导入默认按上游 checkout 的当前 Git Commit 读写对应快照目录，不再固定指向某个旧版本；导入时还会核对 Manifest 的 Commit、版本和语言。若通过 `ANIME_GAME_OUTPUT_DIR` 指定已有快照，Manifest 仍必须位于外置数据根目录，并与 `ANIME_GAME_COMMIT` 或 checkout Commit 一致。

4. 先启动 PostgreSQL，再按类别导入。每次只导入一种类别；命令只创建 `review_required` 批次，不会自动发布：

   ```bash
   pnpm db:up
   ANIME_GAME_CATEGORY=book pnpm data:import:anime
   ANIME_GAME_CATEGORY=character_story pnpm data:import:anime
   ANIME_GAME_CATEGORY=item_description pnpm data:import:anime
   ```

   批次、快照和观察记录会写入外置盘上的 `data/postgres/`、`data/snapshots/` 和 `data/imports/normalized/`。旧批次不会覆盖新快照；若同一类别重新转换，应在管理界面把旧批次备注为“superseded”，保留其审计记录。

   如果一个批次只有部分记录转换失败，失败记录会留在错误清单中，成功解析的记录仍会写入 Source Observation 和出处核验批次；这样不会因为单条坏记录而丢失其余记录的审计链。
   AnimeGameData Manifest 中的 `failures` 会在导入时转换为带 canonical key 的阻塞错误，并额外加入核验台；无法稳定生成 canonical key 的失败仍保留在 Manifest/错误清单中，不会被静默当作成功记录。

5. 启动本机 API、Worker 和 Web 后打开管理页面，展开“数据管理”，输入管理 Token（开发环境可留空），选择对应批次并刷新。管理页面可以查看：

   - 记录数量、Diff、失败和明确排除原因；
   - 每条记录的 canonical key、上游 Commit、文件相对路径、字段映射、TextMap Hash、原始/规范化哈希和转换步骤；
   - 按 Manifest 和风险项生成的分层抽样，以及额外加入的失败项和冲突项；
   - 待裁决冲突。冲突不会静默覆盖，管理端可展开查看各来源观察的标题、正文、哈希和出处；多来源冲突必须先展开详情、选择采用的来源观察并记录理由，双方原文继续保留。若采用来源的正文与当前批次不同，必须重新导入采用来源后才能发布。

## 游戏内抽样核验

程序生成的核验批次不会被自动标记为正确。请逐条处理页面显示的全部必需样本；额外的失败项和冲突项也必须处理。

1. 启动与数据集相同的《原神》正式服客户端，语言选择简体中文，并记录客户端版本。只有 `7.0.0 + zh-CN` 的游戏客户端结果能计入正式发布门禁。

2. 按类别查找对应位置：

   - 书籍：图鉴/书籍或背包中的对应卷册；
   - 角色故事：角色资料页中的故事条目；
   - 物品描述：背包或图鉴中的物品详情。

3. 将客户端显示的标题和正文与页面出处面板逐字比较。状态只能选择：

   - `逐字一致`：标题和正文完全一致；
   - `仅格式差异`：文字一致，仅颜色、换行或图片标签不同；
   - `内容不一致`：存在文字差异；
   - `尚未解锁`：因角色未拥有、好感度不足或物品未取得无法查看；
   - `版本不一致`：客户端版本不是本批次版本；
   - `未核验`：尚未处理。

   如果选择 `尚未解锁`，系统会按本次运行的固定种子从同类别中自动补入一条未抽过的替代记录；
   替代记录也必须处理。若同类别没有更多记录，页面会保留该异常并由发布门禁报告。

   每条样本都要在“核验版本”和“核验语言”中记录实际查看客户端的版本与语言。若选择 `版本不一致`，
   不要把版本改写成预期版本；应保留客户端实际版本，便于审计和后续补抽。

   抽样不是无分层的随机抽样：固定种子会先为正文长度的四个分位各保留样本，再按格式标签、备用字段、重复物品映射等风险标签纳入记录，最后才补齐普通记录；因此相同 Commit 和类别每次都会得到可复现、可解释的样本。

4. 默认渠道选“游戏客户端”。如果只能用 HoYoWiki 辅助核对，切换渠道并在备注中写明原因；HoYoWiki 结果不能冒充游戏内逐字核验。

5. `内容不一致`、`版本不一致` 和 `尚未解锁` 必须上传 PNG/JPEG/WebP 截图；截图会按 SHA-256 命名保存到 `data/verification/`。普通一致项截图可选。尚未解锁的项要补抽其他可访问记录，直到每类至少有 10 条同版本游戏内 `逐字一致`。

6. 任意真实不一致都会阻止发布。回到出处面板定位字段映射，修复转换器后重新转换受影响类别，并生成新的抽样批次；不要直接手改数据库正文。

在核验过程中可随时查看机器可读的进度报告，不会修改数据库或快照：

```bash
pnpm data:status:anime
```

报告会列出每个待审核批次的样本总数、未处理数、同版本游戏内逐字一致数、异常数、开放冲突数，以及最近一次备份的校验信息；它会重新计算 dump 和 Manifest 副本的 SHA-256，并确认备份时间不早于当前待审核批次。

如果需要把这次报告作为外置盘上的审计附件保存，可显式写入固定文件（默认命令只打印，不写文件）：

```bash
pnpm data:status:anime:write
```

文件保存为 `data/verification/reports/latest-anime-status.json`，其中还会记录备份是否与当前 Manifest 完全匹配。
`blockingReasons` 和 `releaseGate.blockingReasons` 是机器可读的当前阻塞清单，例如
`item_description:pending_30`、`item_description:exact_game_client_0_of_10` 或
`book:missing_screenshots_2`；完成对应核验后重新生成报告，清单会自动消失。

数据管理页面的“采集完整性审计”面板读取的就是这份缓存报告，不会在浏览器中重新扫描上游目录或数据库。
因此每次完成一轮核验、冲突裁决或备份后，先运行 `pnpm data:status:anime:write`，再刷新管理页面；
如果页面发现报告时间早于最新导入批次，会明确显示“报告可能过期”提示，不应据此判断可以发布。
报告不可用时面板会隐藏，数据库中的导入和核验操作不受影响。该管理接口只返回相对定位和审计统计，
不会把外置盘的绝对路径发送到浏览器。

报告中的 `observations.bySource` 和 `observations.byCategory` 用于检查各渠道是否实际写入观察层；`observations.sourceCoverage` 会把每个 AnimeGameData 渠道的每个快照与当前 Manifest 的 canonical key 集合逐一比对，给出 `observedCount`、`expectedCount`、`missingKeys`、`unexpectedKeys`、版本、语言和 `complete`。只有三类都存在完整的启用渠道，`releaseGate.sourceCoverageComplete` 才会为 `true`；这能区分“总数看起来相同”与“具体 key 真正一一对应”。`observations.integrity` 会检查空字段、非法 SHA-256、哈希与出处不一致、缺失字段 lineage、空出处、孤立快照和重复 `(sourceSnapshot, canonicalKey)`；`conflicts.byKind` 会分别统计 `exact_match`、`formatting_only`、`version_difference`、`missing_field` 和 `content_conflict`，不会把不同版本或不同渠道静默合并。观察层完整性或渠道覆盖为 `false` 时，发布门禁也会阻止发布。

如果历史快照是在冲突追踪启用前导入的，先执行一次观察层回填审计：

```bash
pnpm data:reconcile:anime
```

该命令只根据不可变的 Source Observation 重建冲突索引；如果历史记录的表内哈希落后于其 provenance 中已有的合法哈希，它会修复这两个审计字段，但不会修改原始仓库、快照或规范化记录。之后重新生成状态报告即可查看各类一致性和开放冲突数。

如果希望脱离 Web 页面逐条核对，可导出外置盘上的 Markdown 清单（包含正文和完整出处栏，不会写入核验结果）：

```bash
pnpm data:checklist:anime
```

清单会写入 `data/verification/checklists/verification-<batchId>.md`；实际客户端版本、语言、状态和备注仍应回填到管理页面，以便发布门禁读取。
导出命令也会包含尚未终结的失败采集批次，因此转换失败项不会因为批次状态为 `failed` 而从核验留档中消失。

不同游戏版本的同一 canonical key 会被记录为 `version_difference`，按版本隔离且不作为同版本文本冲突；
同一版本同一语言的内容差异仍会生成待裁决冲突。状态报告还会汇总待审核批次的游戏版本和语言；如果混用了多个版本或语言，`releaseGate.manifestComplete` 会为 `false`，必须拆分批次后再发布。

## 发布前门禁和备份

只有以下条件全部满足时，管理界面的“发布版本”才会成功：所有必需样本已处理、每类至少 10 条游戏内逐字一致、异常项有截图、未解决冲突为 0、mismatch 为 0、输入 accounted coverage 为 100%、无重复 key 和无效引用，并且存在一份在该批次生成后创建且 SHA-256 校验通过的数据库/Manifest 备份。备份中的 Manifest SHA-256 还必须与该批次来源快照记录的当前 Manifest 完全一致；仅仅使用相同 upstream Commit 的旧备份也不能通过。缺少备份或 Manifest 不匹配时接口会直接拒绝发布。

在真正执行发布时，接口还会重新读取该批次 Manifest，逐项核对三类 records 文件、批次 canonical key、版本/语言/Commit、启用渠道的最新快照覆盖，以及观察层的哈希和字段 lineage；报告生成后如果文件或数据库状态发生变化，发布仍会被拒绝。`pnpm test:backup-gate` 覆盖了不完整 Manifest、旧备份和完整批次三种边界。

发布前先备份数据库和当前 Manifest：

```bash
pnpm data:backup
```

备份目录为 `data/backups/<UTC 时间>/`，包括 `gip.dump`、Manifest 副本和 `backup-manifest.json`（含 SHA-256）。脚本默认跟随 `ANIME_GAME_DATA_DIR` 当前 checkout 的 Commit 选择对应快照；也可以用 `ANIME_GAME_OUTPUT_DIR` 显式指定。无法唯一确定快照时会停止，不会回退到旧版本。若主机没有 `pg_dump`，脚本会通过健康的 PostgreSQL Compose 容器导出。备份完成后再在管理页面审核并发布。

同一外置盘上的备份只能用于误操作恢复，不是灾难备份；稳定版本发布后，应把加密备份复制到第二块磁盘或其他独立位置。
