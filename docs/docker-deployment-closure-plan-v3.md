# GamesMcp Docker 部署收口计划（精简完整版）

> 版本：v3.0  
> 目标：在**不继续扩大 Docker 架构复杂度**的前提下，把当前剩余问题收口到“可稳定使用”的状态。  
> 核心标准只有四条：  
> **CI 全绿、失败代码不能发布镜像、生产部署固定版本、部署失败不能伪装成功。**

---

# 1. 当前基础

当前已经完成，不再重做：

```text
统一 Multi-stage Dockerfile
BuildKit pnpm cache
API / Worker / Web 定向构建
API / Worker runtime 镜像瘦身
docker-compose.prod.yml
GHCR 镜像发布
deploy.sh
update.sh
rollback.sh
health-check.sh
```

因此本轮**不再做大规模 Docker 架构重构**。

---

# 2. 当前真正需要解决的问题

只处理以下 5 类问题：

```text
1. docker-smoke CI 当前失败
2. CI 失败时仍然可能发布 GHCR 镜像
3. 生产环境仍然允许 fallback 到 latest
4. deploy / update / rollback 错误处理不够严格
5. health-check 对关键服务检查过于宽松
```

---

# 3. 本轮完成定义

满足以下条件即可结束 Docker 专项：

```text
DOCKER_DEPLOY_READY = true
```

必须满足：

- [ ] 主 CI 全绿
- [ ] docker-smoke PASS
- [ ] API runtime build PASS
- [ ] Worker runtime build PASS
- [ ] Web runtime build PASS
- [ ] CI 失败时不发布 Docker 镜像
- [ ] 生产部署必须明确指定 SHA / Tag
- [ ] 生产不默认使用 latest
- [ ] 镜像拉取失败立即停止
- [ ] Health Check 失败立即停止
- [ ] 失败部署不能修改 `.current_version`
- [ ] Rollback 目标镜像不存在时立即失败
- [ ] PostgreSQL / API / Worker / Web 必须健康
- [ ] 启用的 Istaroth Provider 必须健康

不要求本轮完成：

```text
自动回滚
部署锁
数据库自动备份
SBOM
漏洞扫描
Kubernetes
镜像 Digest 管理
复杂性能报告
```

---

# 4. Step 1：修复 docker-smoke CI

## 当前问题

CI 会执行：

```bash
docker compose config
docker compose -f docker-compose.prod.yml config
```

但 Compose 依赖：

```text
DATA_DIR
ISTAROTH_IMAGE
GAMESMCP_VERSION
```

CI 没有提供完整变量，因此 `docker-smoke` 失败。

---

## 修改方案

在 `docker-smoke` Job 中增加测试环境变量：

```yaml
env:
  DATA_DIR: /tmp/gamesmcp-data
  GAMESMCP_VERSION: test
  ISTAROTH_IMAGE: ghcr.io/example/istaroth:test
```

然后：

```bash
mkdir -p /tmp/gamesmcp-data
cp .env.example .env

docker compose config
docker compose -f docker-compose.prod.yml config
```

> 注意：因为 `docker-compose.prod.yml` 明确声明了 `env_file: .env`，在干净 CI runner 上缺少 `.env` 会报 `env file not found`，因此必须前置 `cp .env.example .env`。

继续构建：

```bash
docker build \
  --target api-runtime \
  -f docker/Dockerfile .

docker build \
  --target worker-runtime \
  -f docker/Dockerfile .

docker build \
  --target web-runtime \
  -f docker/Dockerfile .
```

---

## 验收

CI 必须明确：

```text
Validate Compose Configs     PASS
Build API Runtime Target     PASS
Build Worker Runtime Target  PASS
Build Web Runtime Target     PASS
```

不能因为前置失败而被 skipped。

---

# 5. Step 2：Docker Release 必须接 CI Gate

## 当前风险

现在可能出现：

```text
CI               ❌
Docker Release   ✅
```

这意味着：

> 没有通过测试的代码仍然可能生成并发布生产镜像。

这是本轮最优先修的问题。

---

## 推荐方案

优先采用最简单的方式：

```text
主 CI
↓
所有 Required Jobs PASS
↓
Docker Release Job
↓
GHCR
```

如果 Docker Release 放在主 workflow 中：

```yaml
docker-release:
  needs:
    - verify
    - database
    - story-gates
    - archive-e2e
    - docker-smoke
```

并限制：

```yaml
if: github.ref == 'refs/heads/main' && github.event_name == 'push'
```

---

## 如果继续保留独立 docker-release.yml

则改成：

```yaml
on:
  workflow_run:
    workflows: ["ci"]
    types: [completed]
```

执行条件：

```yaml
if: >
  github.event.workflow_run.conclusion == 'success' &&
  github.event.workflow_run.head_branch == 'main'
```

同时必须 checkout：

```text
github.event.workflow_run.head_sha
```

不能重新 checkout 最新 main。

---

## 验收

必须证明：

```text
CI FAIL
→ Docker Release 不运行

CI PASS
→ Docker Release 正常运行
```

---

# 6. Step 3：生产版本禁止 fallback 到 latest

## 当前问题

生产 Compose 类似：

```yaml
${GAMESMCP_VERSION:-latest}
```

这会让：

```text
版本变量漏配
↓
自动部署 latest
```

存在不可控风险。

---

## 修改方案

改成：

```yaml
${GAMESMCP_VERSION:?GAMESMCP_VERSION is required}
```

API / Worker / Web 三个服务全部统一。

---

## deploy.sh

推荐使用：

```bash
bash scripts/deploy.sh <SHA>
```

例如：

```bash
bash scripts/deploy.sh dccf91a8166585cbbdc398ccdd6910817fd3e010
```

规则：

```text
命令行参数存在
→ 使用参数

否则 .env 有 GAMESMCP_VERSION
→ 使用 .env

否则
→ ERROR
→ exit 1
```

禁止：

```text
自动 fallback latest
```

---

## update.sh

必须：

```bash
bash scripts/update.sh <SHA>
```

没有参数：

```text
ERROR
exit 1
```

---

## rollback.sh

允许：

```bash
bash scripts/rollback.sh <SHA>
```

或者：

```text
读取 .previous_version
```

但 `.previous_version` 为空时必须失败。

禁止：

```text
.previous_version = latest
```

---

# 7. Step 4：修 deploy / update / rollback

这一阶段只处理三个核心原则。

---

## 7.1 镜像 pull 失败必须停止

禁止：

```bash
docker compose pull api worker web || true
```

也禁止：

```bash
pull || echo WARNING
```

应改成：

```bash
if ! docker compose -f docker-compose.prod.yml pull api worker web; then
  echo "ERROR: failed to pull application images"
  exit 1
fi
```

---

## 7.2 Health Check 通过之后才能写 current_version

错误顺序：

```text
启动 B
↓
写 current_version=B
↓
health FAIL
```

正确：

```text
启动 B
↓
health
↓
PASS
↓
写 current_version=B
```

如果 Health 失败：

```text
.current_version
```

仍然保持旧的成功版本。

---

## 7.3 Rollback 镜像拉不到必须停止

禁止：

```bash
docker compose pull ... || true
```

正确：

```text
pull rollback target
↓
失败
↓
ERROR
exit 1
```

不能用机器上“碰巧存在的旧镜像”继续回滚。

---

# 8. deploy.sh 最终建议流程

```text
[1/7] Validate environment
[2/7] Validate production version
[3/7] Pull required images
[4/7] Start database/providers
[5/7] Start API/Worker/Web
[6/7] Health check
[7/7] Save version & complete
```

---

## 推荐逻辑

```text
检查 Docker
↓
检查 docker compose
↓
检查 .env
↓
检查 DATA_DIR
↓
检查 GAMESMCP_VERSION
↓
docker compose config
↓
pull
↓
start
↓
health
↓
current_version
```

---

# 9. update.sh 最终建议流程

```text
Current = A
Target  = B

↓
保存 previous=A
↓
pull B
↓
启动 B
↓
health B
↓
PASS
↓
current=B
```

如果失败：

```text
current 仍然是 A
previous 仍然是 A
exit 1
```

不要求本轮自动 rollback。

失败时只提示：

```bash
bash scripts/rollback.sh
```

即可。

---

# 10. rollback.sh 最终建议流程

```text
读取目标 A
↓
确认目标不为空
↓
pull A
↓
启动 A
↓
health A
↓
PASS
↓
current=A
```

任一步失败：

```text
exit 1
```

---

# 11. Step 5：Health Check 简化但严格

本轮不做复杂的健康检查系统。

只区分：

```text
必须健康
启用时必须健康
```

---

# 12. 必须健康的服务

以下任何一个失败：

```text
exit 1
```

必须检查：

```text
Web
API
PostgreSQL
Worker
```

---

## API

```text
GET /api/health
```

必须返回成功。

---

## Web

检查：

```text
GET /
GET /api/health
```

用于确认：

```text
Nginx 正常
API Proxy 正常
```

---

## PostgreSQL

使用：

```text
/api/ready
```

或直接：

```bash
pg_isready
```

只要最终能明确：

```text
database = up
```

即可。

失败不能只 WARNING。

---

## Worker

检查：

```text
/api/ready/worker
```

必须依据真实返回 contract 判断是否 ready。

失败：

```text
exit 1
```

---

# 13. Istaroth Provider

当前项目存在：

```text
Genshin Istaroth
StarRail Istaroth
```

建议分别配置：

```text
GAMESMCP_GENSHIN_ISTAROTH_ENABLED=true/false
GAMESMCP_STARRAIL_ISTAROTH_ENABLED=true/false
```

---

## Genshin Enabled

如果：

```text
true
```

则必须：

```text
启动 istaroth
检查 istaroth
```

失败：

```text
exit 1
```

---

## StarRail Enabled

同理：

```text
启动 istaroth-starrail
检查 istaroth-starrail
```

失败：

```text
exit 1
```

---

## Provider 检查方式

优先复用 Compose 里已有 MCP initialize healthcheck。

不要简单：

```bash
curl GET /mcp
```

因为 MCP endpoint 未必支持普通 GET。

---

# 14. Search Readiness

Search 暂时可以不作为本轮强制 blocker。

如果：

```text
/api/ready/search
```

失败：

```text
WARNING
```

即可。

以后如果 Search 成为生产必需能力，再改为严格。

---

# 15. Step 6：CI 全绿验收

最终主 CI 至少：

```text
verify              PASS
database            PASS
candidate-flow      PASS
story-gates         PASS
archive-e2e         PASS
docker-smoke        PASS
```

---

# 16. Docker Release 验收

需要手动或自动证明两种情况。

---

## Case A：CI 失败

制造一个临时测试失败或通过 workflow 条件验证：

```text
CI = FAIL
```

必须：

```text
Docker Release = skipped / not triggered
```

---

## Case B：CI 成功

```text
CI = PASS
```

然后：

```text
Docker Release = PASS
```

并生成：

```text
API image
Worker image
Web image
```

---

# 17. 生产部署 Smoke Test

不需要做复杂 shell 单元测试矩阵。

实际验证以下 4 个场景即可。

---

## Test 1：正常部署

```bash
bash scripts/deploy.sh <VALID_SHA>
```

结果：

```text
pull PASS
start PASS
health PASS
.current_version = VALID_SHA
```

---

## Test 2：错误版本

```bash
bash scripts/deploy.sh does-not-exist
```

结果：

```text
pull FAIL
deployment STOP
.current_version unchanged
```

---

## Test 3：正常更新

```bash
bash scripts/update.sh <NEW_SHA>
```

结果：

```text
previous = OLD_SHA
current = NEW_SHA
```

---

## Test 4：正常回滚

```bash
bash scripts/rollback.sh <OLD_SHA>
```

结果：

```text
current = OLD_SHA
```

---

# 18. 数据安全

本轮只需要确认：

生产脚本不存在：

```bash
docker compose down -v
docker volume rm
```

执行：

```bash
rg 'down.*-v|docker volume rm|volume rm' \
  scripts docker-compose*.yml
```

如果存在需要删除。

---

# 19. 文档调整

更新：

```text
docs/deployment.md
```

只保留清晰的两种使用方式。

---

## 开发模式

```bash
docker compose up -d --build
```

适合：

```text
本地
开发机
测试环境
```

---

## 生产模式

首次：

```bash
bash scripts/deploy.sh <SHA>
```

更新：

```bash
bash scripts/update.sh <SHA>
```

回滚：

```bash
bash scripts/rollback.sh <SHA>
```

---

# 20. Agent 执行顺序

只按下面 6 个 Step 执行：

```text
Step 1
修 docker-smoke CI

Step 2
Docker Release 接 CI Gate

Step 3
禁止 Production latest fallback

Step 4
修 deploy / update / rollback 严格错误处理

Step 5
强化 health-check

Step 6
跑完整 CI + 部署 Smoke Test
```

---

# 21. 不要做的事情

本轮禁止：

```text
❌ 再次重构 Dockerfile 架构
❌ 改 Monorepo
❌ 改业务 API
❌ 改 Archive 前端
❌ 引入 Kubernetes
❌ 自动数据库备份
❌ 自动 rollback
❌ 部署锁
❌ SBOM
❌ 漏洞扫描
❌ Buildx Bake
❌ 镜像 digest 管理
❌ 复杂性能分析
```

避免把简单收口重新做成大型基础设施项目。

---

# 22. 最终验收表

## CI

- [ ] verify PASS
- [ ] database PASS
- [ ] story-gates PASS
- [ ] archive-e2e PASS
- [ ] docker-smoke PASS

## Docker Build

- [ ] api-runtime PASS
- [ ] worker-runtime PASS
- [ ] web-runtime PASS

## Release

- [ ] CI FAIL 不发布镜像
- [ ] CI PASS 才发布镜像
- [ ] GHCR API image 正常
- [ ] GHCR Worker image 正常
- [ ] GHCR Web image 正常

## Production Version

- [ ] 必须明确 VERSION
- [ ] 无 `latest` fallback
- [ ] deploy 可指定 SHA
- [ ] update 可指定 SHA
- [ ] rollback 可指定 SHA

## Deploy

- [ ] pull fail → STOP
- [ ] health fail → STOP
- [ ] health fail → current_version 不变
- [ ] health pass → current_version 更新

## Health

- [ ] API 必须健康
- [ ] Web 必须健康
- [ ] PostgreSQL 必须健康
- [ ] Worker 必须健康
- [ ] Enabled Genshin Istaroth 必须健康
- [ ] Enabled StarRail Istaroth 必须健康

## Data Safety

- [ ] 没有 `down -v`
- [ ] 没有自动删除 volume

---

# 23. 最终完成定义

满足：

```text
CI = GREEN
```

并且：

```text
失败代码不会发布镜像

生产环境不会偷偷使用 latest

错误镜像拉不到时部署会停止

服务没启动成功时部署会停止

部署失败不会把 current_version 写成成功版本
```

即可标记：

```text
DOCKER_DEPLOY_READY = true
```

---

# 24. Agent 最终报告

Agent 最后只需要给出：

```text
Commit SHA:

CI Run ID:
CI Conclusion:

verify:
database:
story-gates:
archive-e2e:
docker-smoke:

Docker Release:
Release After CI Green: yes/no

Production Version Required: yes/no
Latest Fallback Removed: yes/no

Deploy Pull Failure Stops: yes/no
Update Failure Keeps Current Version: yes/no
Rollback Pull Failure Stops: yes/no

API Health:
Web Health:
Database Health:
Worker Health:
Genshin Istaroth Health:
StarRail Istaroth Health:

Deploy Smoke:
Update Smoke:
Rollback Smoke:

DOCKER_DEPLOY_READY = true / false
```

不要求额外提交复杂性能报告。
