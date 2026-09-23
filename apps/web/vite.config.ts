import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { createConnection } from "node:net";

function portFromEnv(value: string | undefined, fallback: number): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

async function isPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "127.0.0.1" });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

async function detectApiPort(preferredPort: number): Promise<number> {
  const candidates = [preferredPort, 4100, 4101, 4102].filter((p, i, arr) => arr.indexOf(p) === i);
  for (const port of candidates) {
    if (await isPortOpen(port)) return port;
  }
  return preferredPort;
}

export default defineConfig(async ({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const webPort = portFromEnv(process.env.WEB_PORT ?? env.WEB_PORT, 4173);
  const preferredApiPort = portFromEnv(process.env.API_PORT ?? env.API_PORT, 4100);
  const apiPort = await detectApiPort(preferredApiPort);
  return {
    plugins: [react()],
    server: {
      port: webPort,
      host: "127.0.0.1",
      proxy: { "/api": `http://127.0.0.1:${apiPort}` },
    },
  };
});
