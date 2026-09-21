/**
 * Cross-platform launcher for the GamesMcp Docker Compose stack.
 *
 * The npm entry points used to shell out to `bash scripts/docker-*.sh`. On
 * Windows that is a trap: the `bash` on PATH is WSL's bash, which talks to
 * WSL's own Docker engine (invisible to Docker Desktop) and treats a path such
 * as `F:/Project/GamesMcp/data` as relative, creating a literal `F:` directory
 * inside the repository and mounting nothing. Driving `docker compose` from
 * Node removes the shell from the equation and keeps one implementation that
 * behaves the same on Windows, macOS and Linux.
 *
 * Actions:
 *   deploy [--with-providers]  compose config -> build -> PostgreSQL -> app ->
 *                              health gate -> MCP protocol smoke
 *   stop                       compose down (DATA_DIR and volumes preserved)
 *   status                     compose ps plus the live health endpoints
 *   logs [service]             follow logs, optionally for a single service
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, posix, resolve, win32 } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export type StackAction = "deploy" | "stop" | "status" | "logs";

export interface StackInvocation {
  action: StackAction;
  withProviders: boolean;
  service?: string;
}

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(SCRIPT_DIR, "..");

const COMPOSE_FILE = process.env.COMPOSE_FILE ?? "docker-compose.yml";
const ENV_FILE = process.env.ENV_FILE ?? ".env";

const API_HEALTH_URL = "http://127.0.0.1:4100/api/health";
const MCP_ENDPOINT = "http://127.0.0.1:4200/mcp";
const MCP_HEALTH_URL = "http://127.0.0.1:4200/health";
const MCP_READY_URL = "http://127.0.0.1:4200/ready";
const WEB_URL = "http://127.0.0.1:4173/";

function log(message: string): void {
  const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`\n[${stamp}] ${message}`);
}

function fail(message: string): never {
  console.error(`\nERROR: ${message}`);
  process.exit(1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => setTimeout(done, ms));
}

export function parseInvocation(argv: readonly string[]): StackInvocation {
  const [rawAction, ...rest] = argv;
  const action = rawAction ?? "deploy";

  if (action !== "deploy" && action !== "stop" && action !== "status" && action !== "logs") {
    throw new Error(`未知操作 "${action}"（可用: deploy | stop | status | logs）`);
  }

  let withProviders = false;
  const positional: string[] = [];

  for (const arg of rest) {
    if (arg === "--with-providers") {
      withProviders = true;
      continue;
    }
    if (arg.startsWith("--")) throw new Error(`未知参数: ${arg}`);
    positional.push(arg);
  }

  if (withProviders && action !== "deploy") {
    throw new Error("--with-providers 仅适用于 deploy");
  }
  if (action === "logs" && positional.length > 1) {
    throw new Error("logs 最多接受一个服务名");
  }

  return { action, withProviders, service: positional[0] };
}

/**
 * Variables compose cannot interpolate without. DATA_DIR and ISTAROTH_IMAGE
 * are required for every action because all services are interpolated at parse
 * time; the bearer token gate only applies to deploy, mirroring the rule in
 * docker-compose.yml (mcp is pinned to production + 0.0.0.0).
 */
export function missingRequiredEnv(
  env: Record<string, string | undefined>,
  action: StackAction,
): string[] {
  const missing: string[] = [];

  if (!env.DATA_DIR?.trim()) missing.push("DATA_DIR");
  if (!env.ISTAROTH_IMAGE?.trim()) missing.push("ISTAROTH_IMAGE");
  if (action === "deploy" && !env.MCP_AUTH_TOKEN?.trim()) missing.push("MCP_AUTH_TOKEN");

  return missing;
}

export function composeArgs(
  args: readonly string[],
  options: { composeFile?: string; envFile?: string } = {},
): string[] {
  return [
    "compose",
    "--env-file",
    options.envFile ?? ENV_FILE,
    "-f",
    options.composeFile ?? COMPOSE_FILE,
    ...args,
  ];
}

/**
 * Resolve DATA_DIR against the repository root. Node understands both
 * `F:/Project/GamesMcp/data` (Windows) and `./data` (macOS/Linux), whereas the
 * MSYS/WSL `mkdir` turned the former into a relative `F:` directory.
 *
 * A Windows drive path is not absolute on macOS/Linux, so carrying a
 * Windows-authored .env over to a Mac would silently recreate that same junk
 * directory. Fail loudly instead of mounting the wrong location.
 */
export function resolveDataDir(raw: string, cwd: string, platform = process.platform): string {
  const pathApi = platform === "win32" ? win32 : posix;

  if (pathApi.isAbsolute(raw)) return raw;

  if (platform !== "win32" && /^[A-Za-z]:[\\/]/u.test(raw)) {
    throw new Error(
      `DATA_DIR "${raw}" 是 Windows 路径，在当前系统上会被当成相对目录。` +
        "请改成当前系统上的绝对路径（macOS 示例：/Volumes/Lark/lark/GamesMcp/data）。",
    );
  }

  return pathApi.resolve(cwd, raw);
}

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function run(
  command: string,
  args: readonly string[],
  options: { capture?: boolean; env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  return new Promise((done, reject) => {
    const child = spawn(command, [...args], {
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      env: options.env ?? process.env,
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => done({ code: code ?? 1, stdout, stderr }));
  });
}

async function must(
  command: string,
  args: readonly string[],
  failure: string,
  options: { env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  const result = await run(command, args, options);
  if (result.code !== 0) fail(failure);
  return result;
}

async function dumpLogs(service: string): Promise<void> {
  await run("docker", composeArgs(["logs", "--tail=200", service]));
}

async function waitForHttp(url: string, name: string, attempts = 40): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
      if (response.ok) {
        log(`${name} ready: ${url}`);
        return true;
      }
    } catch {
      // Nothing listening yet; keep polling.
    }
    await sleep(2_000);
  }
  return false;
}

async function waitForPostgres(): Promise<void> {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    const listed = await run("docker", composeArgs(["ps", "-q", "postgres"]), { capture: true });
    const containerId = listed.stdout.trim();

    if (containerId) {
      const inspected = await run(
        "docker",
        [
          "inspect",
          "--format",
          "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
          containerId,
        ],
        { capture: true },
      );

      if (inspected.stdout.trim() === "healthy") return;
    }

    if (attempt === 30) {
      await dumpLogs("postgres");
      fail("PostgreSQL 未进入 healthy");
    }

    await sleep(2_000);
  }
}

function loadEnvironment(): void {
  if (!existsSync(resolve(ROOT_DIR, ENV_FILE))) {
    fail(`找不到 ${ENV_FILE}，请先由 .env.example 创建`);
  }
  if (typeof process.loadEnvFile !== "function") {
    fail("需要 Node 20.12 及以上版本才能读取 .env");
  }
  process.loadEnvFile(resolve(ROOT_DIR, ENV_FILE));
}

async function ensureDocker(): Promise<void> {
  try {
    const result = await run("docker", ["compose", "version"], { capture: true });
    if (result.code !== 0) {
      fail("docker compose 不可用，请确认 Docker Desktop / Docker Engine 已启动");
    }
  } catch {
    fail("未找到 docker 命令，请先安装并启动 Docker");
  }
}

async function deploy(invocation: StackInvocation): Promise<void> {
  if (invocation.withProviders) {
    const image = process.env.ISTAROTH_IMAGE ?? "";
    if (image.includes("not-used") || image.startsWith("example/")) {
      fail(
        `--with-providers 需要真实的 ISTAROTH_IMAGE，当前仍是占位值 "${image}"。` +
          "请改成固定的 tag 或 digest 后再部署。",
      );
    }
  }

  log("检查 Compose 配置");
  await must("docker", composeArgs(["config"]), "Compose 配置校验失败");

  log("构建 API / Worker / MCP / Web");
  await must("docker", composeArgs(["build", "api", "worker", "mcp", "web"]), "镜像构建失败");

  log("启动 PostgreSQL");
  await must("docker", composeArgs(["up", "-d", "postgres"]), "PostgreSQL 启动失败");

  log("等待 PostgreSQL 健康");
  await waitForPostgres();

  log("启动 GamesMcp 核心服务");
  await must(
    "docker",
    composeArgs(["up", "-d", "api", "worker", "mcp", "web"]),
    "核心服务启动失败",
  );

  if (invocation.withProviders) {
    log("启动 Provider（istaroth / istaroth-starrail）");
    await must(
      "docker",
      composeArgs(["up", "-d", "istaroth", "istaroth-starrail"]),
      "Provider 启动失败",
    );
  }

  log("等待 API / MCP / Web");
  const targets = [
    { name: "API", url: API_HEALTH_URL, service: "api" },
    { name: "MCP", url: MCP_HEALTH_URL, service: "mcp" },
    { name: "Web", url: WEB_URL, service: "web" },
  ];

  for (const target of targets) {
    if (!(await waitForHttp(target.url, target.name))) {
      await dumpLogs(target.service);
      fail(`${target.name} health check 失败`);
    }
  }

  log("检查 MCP Ready");
  try {
    const response = await fetch(MCP_READY_URL, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`status=${response.status}`);
  } catch (error) {
    await dumpLogs("mcp");
    fail(`MCP ready check 失败: ${String(error)}`);
  }

  log("运行 MCP 协议冒烟（initialize / tools/list / list_games）");
  const smoke = await run(process.execPath, ["--import", "tsx", "scripts/test-mcp-http.ts"], {
    env: {
      ...process.env,
      MCP_SMOKE_URL: MCP_ENDPOINT,
      MCP_SMOKE_TOKEN: process.env.MCP_AUTH_TOKEN ?? "",
    },
  });

  if (smoke.code !== 0) {
    await dumpLogs("mcp");
    fail("MCP 协议冒烟失败");
  }

  console.log("\nGamesMcp 部署完成：");
  console.log("  Web: http://127.0.0.1:4173/");
  console.log("  API: http://127.0.0.1:4100/api/");
  console.log("  MCP: http://127.0.0.1:4200/mcp");
  console.log("  MCP via Web: http://127.0.0.1:4173/mcp");
}

async function stop(): Promise<void> {
  log("停止 GamesMcp（保留数据卷与 DATA_DIR）");
  await must("docker", composeArgs(["down"]), "停止失败");
  log("已停止。DATA_DIR 与数据卷未被删除。");
}

async function status(): Promise<void> {
  await must("docker", composeArgs(["ps"]), "compose ps 失败");

  const probes = [
    { name: "API /api/health", url: API_HEALTH_URL },
    { name: "MCP /health", url: MCP_HEALTH_URL },
    { name: "MCP /ready", url: MCP_READY_URL },
    { name: "Web /", url: WEB_URL },
  ];

  console.log("");
  for (const probe of probes) {
    try {
      const response = await fetch(probe.url, { signal: AbortSignal.timeout(5_000) });
      console.log(`${probe.name}: HTTP ${response.status}`);
    } catch {
      console.log(`${probe.name}: 不可达`);
    }
  }
}

async function followLogs(service?: string): Promise<void> {
  const args = ["logs", "-f", "--tail=200"];
  if (service) args.push(service);
  await must("docker", composeArgs(args), "日志跟踪失败");
}

async function main(): Promise<void> {
  const invocation = parseInvocation(process.argv.slice(2));

  process.chdir(ROOT_DIR);
  loadEnvironment();

  const missing = missingRequiredEnv(process.env, invocation.action);
  if (missing.length > 0) {
    fail(`${ENV_FILE} 缺少必填项: ${missing.join(", ")}`);
  }

  await ensureDocker();

  if (invocation.action === "deploy") {
    mkdirSync(resolveDataDir(process.env.DATA_DIR ?? "", process.cwd()), { recursive: true });
    await deploy(invocation);
    return;
  }

  if (invocation.action === "stop") {
    await stop();
    return;
  }

  if (invocation.action === "status") {
    await status();
    return;
  }

  await followLogs(invocation.service);
}

// Imported by scripts/docker-stack.test.ts for the pure helpers; only run when
// this file is the process entry point.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await main();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
