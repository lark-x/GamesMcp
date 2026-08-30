# 外置盘存储运维

## 固定布局与安全边界

部署主机可以是 macOS 或 Windows。`DATA_DIR` 是唯一的宿主机数据根：macOS 默认使用外置 APFS 卷，Windows 原生运行建议使用外置 NTFS/ReFS 卷。Windows 的完整安装和迁移步骤见 [`windows.md`](./windows.md)。

macOS 默认数据根是：

```text
/Volumes/Lark/lark/GamesMcp/data
```

Compose 使用 `.env` 中 `DATA_DIR` 提供的 host path（仓库位于默认目录时，它们分别等价于 `./data/postgres` 和 `./data`）：

| 用途                | host path              | 容器内路径                 |
| ------------------- | ---------------------- | -------------------------- |
| PostgreSQL 数据目录 | `${DATA_DIR}/postgres` | `/var/lib/postgresql/data` |
| API 数据目录        | `${DATA_DIR}`          | `/app/data`                |
| Worker 数据目录     | `${DATA_DIR}`          | `/app/data`                |

不要把 PostgreSQL bind source 改成 named volume，也不要把数据目录改到系统盘。Windows 请使用 `D:/...` 这类 NTFS/ReFS 路径；不要直接使用 macOS APFS 盘。

## 启动前预检

在仓库目录执行：

```bash
node --import tsx scripts/check-data-storage.ts
```

macOS 预检会确认 `/Volumes/Lark` 是实际挂载点且文件系统为 APFS；Windows 预检通过 PowerShell 确认数据盘为 NTFS 或 ReFS。两者都会确认数据根可写，并检查可用空间：外置卷至少 50 GiB，系统卷至少 10 GiB。默认阈值可为测试覆盖：

```bash
STORAGE_MIN_EXTERNAL_GIB=0 \
STORAGE_MIN_SYSTEM_DATA_GIB=0 \
node --import tsx scripts/check-data-storage.ts
```

阈值低于默认值只适用于隔离测试；生产预检应使用默认值。路径覆盖（`STORAGE_EXTERNAL_VOLUME_PATH`、`STORAGE_SYSTEM_DATA_VOLUME_PATH`、`STORAGE_DATA_ROOT`）也只能用于测试，并且数据根必须仍是外置卷的子目录。

预检失败时退出码为非零，并明确拒绝系统盘 fallback；脚本不会创建替代目录、改写 Compose 配置或启动容器。任何失败都应先修复挂载、权限或空间问题，再继续。

## Docker 只启动 PostgreSQL

存储初始化和本地开发只需要 Compose 中的 PostgreSQL：

```bash
pnpm build
pnpm db:up
docker compose ps postgres
```

`pnpm db:up` 会先执行外置盘 fail-closed 预检；预检失败时不会启动 Docker，也不会创建系统盘备用目录。

不要在这一步使用 `docker compose up -d`，以免同时启动 API、Worker 和 Web。数据库迁移仍在宿主机执行：

```bash
pnpm db:migrate
pnpm db:seed
```

需要完整开发环境时，再按项目开发流程启动 API、Worker 和 Web。容器内导入路径使用 `/app/data/...`；宿主机对应 `${DATA_DIR}/...`。

仓库根目录的 `pnpm dev` 会先执行同一套外置盘预检，再并行启动 API、Worker 和 Web；预检失败时不会启动任何本机服务。直接在子项目中单独启动 API 或 Worker 时，也应先手动执行预检。

## 权限与重启恢复测试

首次使用或换盘后，先确认 bind mount 目录存在并由当前用户可写：

```bash
mkdir -p /Volumes/Lark/lark/GamesMcp/data/postgres
test -w /Volumes/Lark/lark/GamesMcp/data && \
  test -w /Volumes/Lark/lark/GamesMcp/data/postgres
```

Docker Desktop 还必须允许访问仓库所在的 `/Volumes/Lark`。不要在未确认宿主机 UID/GID 和 Docker Desktop 文件共享设置前盲目 `chown` 整个外置卷。

在隔离的测试数据上执行一次容器内写入、停止和重启恢复检查：

```bash
docker compose exec postgres sh -eu -c \
  'touch /var/lib/postgresql/data/.storage-permission-test && rm /var/lib/postgresql/data/.storage-permission-test'
docker compose exec postgres pg_isready -U gip -d gip
docker compose exec postgres psql -U gip -d gip -v ON_ERROR_STOP=1 -c 'select 1'
docker compose restart postgres
docker compose exec postgres pg_isready -U gip -d gip
docker compose exec postgres psql -U gip -d gip -v ON_ERROR_STOP=1 -c 'select 1'
```

若重启后 `pg_isready` 或查询失败，先停止应用写入，检查 `/Volumes/Lark/lark/GamesMcp/data/postgres` 的权限、磁盘是否仍挂载，以及 Compose 实际解析出的 bind source；不要切换到系统盘临时运行。

如果预检明确报告外置卷因 `noowners`/ownership 导致不可写，先在确认卷名后启用该卷的 ownership，再重新执行预检和 PostgreSQL 初始化；不要用 `chown` 整个卷，也不要静默改回内部盘。例如：

```bash
diskutil info /Volumes/Lark | grep -E "Volume Name|Owners Enabled"
sudo diskutil enableOwnership /Volumes/Lark
node --import tsx scripts/check-data-storage.ts
```

恢复演练应使用明确命名的隔离数据库和快照副本，验证迁移/恢复后的查询、快照可读、当前 Dataset Revision 和 Worker 任务状态。不要让恢复测试清理默认 `gip` 数据库。

## 备份边界

PostgreSQL 数据和 `data/snapshots/` 默认在同一个外置卷。将 `pg_dump`、快照归档或复制品放在该卷的另一个目录，只能防止单个文件损坏或误操作，不能防止外置盘丢失、文件系统损坏、误格式化、勒索软件或整盘不可用。因此同盘副本不是灾备备份。

至少定期把数据库 dump 和快照归档复制到另一块物理磁盘、离线介质或受保护的远端存储，并记录数据库与快照的同一时间点。恢复演练也应从该异盘副本进行；恢复前先校验归档可读，恢复后再运行上面的查询、版本和快照检查。
