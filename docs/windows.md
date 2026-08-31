# Windows 运行说明

项目现在支持在 Windows 上运行转换器、PostgreSQL、API、Worker 和 Web。Windows 主机不需要安装游戏来生成数据；游戏客户端只用于最后的人工抽样核验。

## 推荐目录

把仓库和数据放在 NTFS 卷上，例如：

```text
D:\GamesMcp\                 # 仓库
D:\GamesMcp\data\            # 数据根
D:\GamesMcp\data\postgres\   # PostgreSQL bind mount
D:\GamesMcp\data\upstream\   # AnimeGameData checkout
```

不要把 PostgreSQL 数据放在 `C:` 系统盘，也不要让 Windows 直接读当前 macOS APFS 卷。若要迁移现有数据，先复制到 NTFS，再逐个核对文件数量和 SHA-256；确认副本可用后再考虑断开原盘。

## 首次安装

在 PowerShell 中完成以下操作：

1. 安装 Node.js 22 或更高版本、pnpm 11、Git 和 Docker Desktop。
2. 将仓库复制到 NTFS 卷。
3. 复制 `.env.example` 为 `.env`。
4. 把 `.env` 中的 `DATA_DIR` 改成 Windows 路径，推荐使用正斜杠：

   ```text
   DATA_DIR=D:/GamesMcp/data
   ```

   不要同时设置一个指向 `C:` 的 `DATA_ROOT`；如果存在旧配置，应删除或改成同一个 `D:` 数据根。
   如果 Docker Desktop 的数据目录也已经迁移到 `D:`，可以同时设置：

   ```text
   STORAGE_RUNTIME_VOLUME_PATH=D:/
   ```

   这样预检会检查 `D:` 作为运行卷，而不是要求 `C:` 系统盘满足 10 GiB 运行余量。只有在 Docker/运行缓存确实已迁移时才应设置它。

5. 确认 Docker Desktop 已启动，并允许访问仓库所在的 `D:` 盘。
6. 在仓库目录执行 `pnpm install` 和 `pnpm build`，然后依次执行 `pnpm db:up`、`pnpm db:migrate`、`pnpm db:seed`。
7. 执行 `pnpm dev`，Web 默认地址为 `http://127.0.0.1:4173`。

启动前的存储预检会确认数据盘存在、文件系统为 NTFS 或 ReFS、目录可写、剩余空间不少于 50 GiB，并确认数据盘不是系统盘。默认还会确认系统盘有至少 10 GiB 运行余量；设置 `STORAGE_RUNTIME_VOLUME_PATH` 后，改为检查指定运行卷。检查失败时程序会停止，不会偷偷改用 `C:`。

## 任务剧情转换

首版剧情任务转换不需要启动游戏。确认 `data/upstream/AnimeGameData` 固定在 Commit
`26df1dfbdf05a82bbb1d97506859f3e1c40718d8` 后，在 PowerShell 执行：

```powershell
pnpm data:convert:anime-quests -- --upstream=data/upstream/AnimeGameData --commit=26df1dfbdf05a82bbb1d97506859f3e1c40718d8 --commit-date=2026-08-01T00:00:00.000Z --game-version=7.0.0 --version-label=CNRELWin7.0.0 --output=data/imports/normalized/anime-game-data/26df1dfbdf05a82bbb1d97506859f3e1c40718d8/quests
```

可先用样本验证速度和字段映射：

```powershell
pnpm data:convert:anime-quests -- --upstream=data/upstream/AnimeGameData --commit=26df1dfbdf05a82bbb1d97506859f3e1c40718d8 --commit-date=2026-08-01T00:00:00.000Z --game-version=7.0.0 --version-label=CNRELWin7.0.0 --output=data/imports/normalized/anime-game-data/sample-quests/quests --limit=200 --profile
```

生成结果仍在 `data/` 下，默认不会提交到 GitHub。后续导入、Candidate、发布和 MCP
读取需要 PostgreSQL 通过预检并完成迁移。

## 迁移已有数据

建议保持 macOS 外置盘为原始副本，另外准备 NTFS 目标盘。迁移顺序如下：

1. 停止 Mac 上的数据库和应用写入。
2. 复制 `data/upstream`、`data/imports`、`data/snapshots`、`data/verification`、`data/backups` 和 PostgreSQL 备份文件。
3. 在 Windows 上核对复制后的 Manifest、输入文件哈希和备份清单；不要直接复制正在运行的 PostgreSQL 数据目录。
4. 用 `gip.dump` 恢复数据库，并执行一次停止、启动、查询恢复测试。
5. 通过 `pnpm data:verify:anime` 重新验证转换结果；它只读取固定 Commit，不会用 LLM 补全记录。

## 游戏内核验

Windows 上的游戏客户端只承担人工核验。数据集目标是 `7.0.0 + zh-CN`；如果客户端是其他版本，记录为 `version_mismatch`，不能计入客户端一致性门禁。异常、版本不符或因未解锁无法查看的条目需要截图并上传到核验台。

## 常见问题

- `DATA_DIR` 仍显示 `/Volumes/Lark/...`：这是旧的 macOS 配置，改为 `D:/...`。
- 预检提示 APFS：说明运行的是旧版本代码或旧配置；更新仓库并检查 `.env`。
- Docker 无法挂载目录：在 Docker Desktop 的文件共享设置中允许 `D:`，并确认 `D:/GamesMcp/data` 已存在。
- Windows 只能看到最新游戏版本：可以核对内容但必须标记版本不一致，不能冒充 `7.0.0` 游戏内核验。
