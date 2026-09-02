import { GameProviderRegistry } from "./registry.js";
import { IstarothMcpClient } from "./istaroth/client.js";
import { GenshinIstarothProvider } from "./istaroth/provider.js";

export interface ProviderRuntimeConfig {
  istaroth?: {
    enabled: boolean;
    url?: string;
    gameSlug: string;
    connectTimeoutMs: number;
    requestTimeoutMs: number;
    healthCacheMs?: number;
  };
}

export function createProviderRegistry(config: ProviderRuntimeConfig): GameProviderRegistry {
  const registry = new GameProviderRegistry();
  if (config.istaroth?.enabled) {
    registry.register(
      new GenshinIstarothProvider({
        gameSlug: config.istaroth.gameSlug,
        client: new IstarothMcpClient({
          url: config.istaroth.url ?? "",
          connectTimeoutMs: config.istaroth.connectTimeoutMs,
          requestTimeoutMs: config.istaroth.requestTimeoutMs,
        }),
        requestTimeoutMs: config.istaroth.requestTimeoutMs,
        healthCacheMs: config.istaroth.healthCacheMs,
      }),
    );
  }
  return registry;
}
