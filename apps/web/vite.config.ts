import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

function portFromEnv(value: string | undefined, fallback: number): number {
  const port = Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const webPort = portFromEnv(env.WEB_PORT, 4173);
  const apiPort = portFromEnv(env.API_PORT, 4100);
  return {
    plugins: [react()],
    server: {
      port: webPort,
      host: "127.0.0.1",
      proxy: { "/api": `http://127.0.0.1:${apiPort}` },
    },
  };
});
