import { spawn } from "node:child_process";
import { createServer } from "node:net";

const preferred = {
  api: Number(process.env.API_PORT ?? 4100),
  web: Number(process.env.WEB_PORT ?? 4173),
};

async function isFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

async function nextFree(port: number): Promise<number> {
  for (let candidate = port; candidate < port + 100; candidate += 1) {
    if (await isFree(candidate)) return candidate;
  }
  throw new Error(`${port} 附近没有可用端口，请关闭占用端口的程序后重试`);
}

const apiPort = await nextFree(preferred.api);
const webPort = await nextFree(preferred.web);
const env = { ...process.env, API_PORT: String(apiPort), WEB_PORT: String(webPort) };
const apiChanged = apiPort !== preferred.api;
const webChanged = webPort !== preferred.web;
console.log("开发环境启动配置：");
console.log(
  `  API 服务：${apiChanged ? "默认端口被占用，已自动切换" : "使用默认端口"} http://127.0.0.1:${apiPort}`,
);
console.log(
  `  Web 页面：${webChanged ? "默认端口被占用，已自动切换" : "使用默认端口"} http://127.0.0.1:${webPort}`,
);
console.log("  Worker：将与 API 一起启动");

const pnpmArgs = [
  "--parallel",
  "--filter",
  "@gip/api",
  "--filter",
  "@gip/web",
  "--filter",
  "@gip/worker",
  "dev",
];
const child = spawn(
  process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : "pnpm",
  process.platform === "win32" ? ["/d", "/s", "/c", "pnpm", ...pnpmArgs] : pnpmArgs,
  {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    shell: false,
  },
);
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
process.on("SIGINT", () => child.kill("SIGINT"));
process.on("SIGTERM", () => child.kill("SIGTERM"));
