# GamesMcp macOS 极简原生部署指南 (Ultra-Low Memory: ~250MB)

本项目专为将 Windows 端解析物化的原神/星穹铁道知识库一键迁移至 macOS 本地运行而设计。
默认采用 **macOS 本地原生运行（方案 B）**：直接运行在 Apple Silicon 统一内存上，**无需虚拟机，零 Docker 开销，总内存仅 ~250MB**。

---

## 硬件与资源开销指标

| 维度 | 原生方案 (默认) | Docker / OrbStack 方案 | 说明 |
| :--- | :--- | :--- | :--- |
| **总内存开销** | **~ 220MB - 280MB** | ~ 550MB - 650MB | 原生方案直接压到 250MB，对 16G Mac 毫无压力 |
| **空闲 CPU** | **0.00%** | 0.00% | 闲置状态零开销 |
| **虚拟机开销** | **0 MB (纯原生)** | ~ 150MB+ (Linux VM) | 原生方案无需 Linux VM 转换 |
| **查询耗时** | **~ 1-3ms** | ~ 1-3ms | 毫秒级极速响应 |

---

## 前置准备 (只需一次)

macOS 原生方案依赖标准包管理器 **Homebrew**：
如果你的 Mac 还没安装 Homebrew，在终端运行一行命令即可安装：
```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```
*(部署脚本会自动检测并自动安装缺失的 `node@22`、`postgresql@16` 和 `pgvector`)*

---

## 快速启动 (一键部署)

解压压缩包后，直接执行一键部署脚本：

```bash
# 1. 解压归档
tar -xzf gip-macos-runtime.tar.gz
cd gip-macos-runtime

# 2. 赋予脚本执行权限并启动
chmod +x *.sh
./deploy.sh
```

**`./deploy.sh` 脚本会自动完成全部操作：**
1. 自动检查并配置本地 `postgresql@16`、`pgvector` 与 `node` 环境。
2. 启动原生 PostgreSQL 后台服务（`brew services`）。
3. 自动配置 `gip` 数据库并激活 `vector` 向量扩展。
4. **自动秒级导入** `database.dump` 全量活跃游戏知识图谱。
5. 自动编译并以后台守护进程模式启动 GamesMcp 服务。
6. 健康检查通过后，**在屏幕打印实时内存占用与客户端配置 JSON**！

---

## 客户端配置指南

服务启动成功后，原生监听于：`http://127.0.0.1:4200/mcp`。

### 1. Claude Desktop 配置
打开文件：`~/Library/Application Support/Claude/claude_desktop_config.json`，添加：
```json
{
  "mcpServers": {
    "gamesmcp": {
      "command": "npx",
      "args": [
        "-y",
        "mcp-proxy",
        "http://127.0.0.1:4200/mcp"
      ]
    }
  }
}
```

### 2. Cursor / Windsurf 配置
在 IDE 的 MCP 面板中添加自定义 Server：
- **Name**: `gamesmcp`
- **Type**: `SSE` 或 `HTTP`
- **Server URL**: `http://127.0.0.1:4200/mcp`

---

## 常用运维命令

```bash
# 查看实时运行状态及精确内存占用 (MB)
./status.sh

# 停止 GamesMcp 服务 (释放 MCP 内存)
./stop.sh

# 停止 GamesMcp 及 PostgreSQL 服务 (完全释放所有内存)
./stop.sh --all

# 如需使用 Docker / OrbStack 方式运行
./deploy.sh --docker
```

---

## 后续版本增量更新流程

当你在性能较强的 Windows 端重新解析或更新了游戏数据后：
1. **Windows 端一键打包**：
   ```bash
   pnpm export:runtime
   ```
2. **拷贝到 Mac**：将新生成的 `dist-runtime/gip-macos-runtime.tar.gz` 覆盖到 Mac 解压。
3. **Mac 端重新运行**：
   ```bash
   ./deploy.sh --force
   ```
   脚本会自动使用最新 dump 覆写数据并热重启服务，全程无需手动敲 SQL。
