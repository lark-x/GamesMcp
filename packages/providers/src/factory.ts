import { GameProviderRegistry } from "./registry.js";
import { IstarothMcpClient } from "./istaroth/client.js";
import { IstarothKnowledgeProvider } from "./istaroth/provider.js";
import { StarRailLocalProvider } from "./starrail/provider.js";

export type GameProviderRuntimeEntry =
  | {
      id: "istaroth";
      game: "genshin" | "starrail";
      kind: "external_mcp";
      enabled: boolean;
      url?: string;
      connectTimeoutMs: number;
      requestTimeoutMs: number;
      healthCacheMs?: number;
    }
  | {
      id: "starrail-local";
      game: "starrail";
      kind: "local_dataset";
      enabled: boolean;
      dataDir?: string;
      inventoryOutput?: string;
    };

export interface ProviderRuntimeConfig {
  entries?: GameProviderRuntimeEntry[];
  istaroth?: {
    enabled: boolean;
    url?: string;
    gameSlug: string;
    connectTimeoutMs: number;
    requestTimeoutMs: number;
    healthCacheMs?: number;
  };
  starrail?: {
    enabled: boolean;
    provider?: "local" | "istaroth";
    dataDir?: string;
    inventoryOutput?: string;
    istarothUrl?: string;
  };
}

export function createProviderRegistry(config: ProviderRuntimeConfig): GameProviderRegistry {
  const registry = new GameProviderRegistry();
  const entries = config.entries ?? legacyEntries(config);
  for (const entry of entries) {
    if (!entry.enabled) continue;
    if (entry.id === "istaroth")
      registry.register(
        new IstarothKnowledgeProvider({
          gameSlug: entry.game,
          client: new IstarothMcpClient({
            url: entry.url ?? "",
            connectTimeoutMs: entry.connectTimeoutMs,
            requestTimeoutMs: entry.requestTimeoutMs,
          }),
          requestTimeoutMs: entry.requestTimeoutMs,
          healthCacheMs: entry.healthCacheMs,
        }),
      );
    if (entry.id === "starrail-local")
      registry.register(
        new StarRailLocalProvider({
          dataDir: entry.dataDir ?? "",
          inventoryOutput: entry.inventoryOutput,
          gameSlug: entry.game,
        }),
      );
  }
  return registry;
}

function legacyEntries(config: ProviderRuntimeConfig): GameProviderRuntimeEntry[] {
  const entries: GameProviderRuntimeEntry[] = [];
  if (config.istaroth)
    entries.push({
      id: "istaroth",
      game: "genshin",
      kind: "external_mcp",
      enabled: config.istaroth.enabled,
      url: config.istaroth.url,
      connectTimeoutMs: config.istaroth.connectTimeoutMs,
      requestTimeoutMs: config.istaroth.requestTimeoutMs,
      healthCacheMs: config.istaroth.healthCacheMs,
    });
  if (config.starrail)
    entries.push({
      id: config.starrail.provider === "istaroth" ? "istaroth" : "starrail-local",
      game: "starrail",
      kind: config.starrail.provider === "istaroth" ? "external_mcp" : "local_dataset",
      enabled: config.starrail.enabled,
      ...(config.starrail.provider === "istaroth"
        ? {
            url: config.starrail.istarothUrl,
            connectTimeoutMs: config.istaroth?.connectTimeoutMs ?? 3_000,
            requestTimeoutMs: config.istaroth?.requestTimeoutMs ?? 15_000,
            healthCacheMs: config.istaroth?.healthCacheMs,
          }
        : {
            dataDir: config.starrail.dataDir,
            inventoryOutput: config.starrail.inventoryOutput,
          }),
    } as GameProviderRuntimeEntry);
  return entries;
}
