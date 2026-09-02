import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

let envFileLoaded = false;

function loadLocalEnvironment(): void {
  if (envFileLoaded || typeof process.loadEnvFile !== "function") return;
  envFileLoaded = true;
  try {
    process.loadEnvFile(".env");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((value) => value || undefined);

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  WEB_PORT: z.coerce.number().int().min(1).max(65535).default(4173),
  DATABASE_URL: z.string().min(1).default("postgres://gip:gip@127.0.0.1:5432/gip"),
  DATA_DIR: z.string().min(1).default("./data"),
  CORS_ORIGINS: optionalString,
  ADMIN_TOKEN: optionalString,
  LLM_BASE_URL: optionalString,
  LLM_API_KEY: optionalString,
  LLM_MODEL_ID: optionalString,
  LLM_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(2),
  LLM_MAX_CONTEXT_CHARS: z.coerce.number().int().positive().default(24_000),
  EMBEDDING_MODEL_ID: optionalString,
  EMBEDDING_MODEL_VERSION: optionalString,
  EMBEDDING_DIMENSION: z.coerce.number().int().positive().default(1536),
  SEARCH_INDEX_VERSION: z.coerce.number().int().positive().default(1),
  LOCAL_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(60),
  GAMESMCP_ISTAROTH_ENABLED: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((value) => value === "true" || value === "1"),
  GAMESMCP_ISTAROTH_URL: optionalString,
  GAMESMCP_ISTAROTH_GAME_SLUG: z.string().trim().min(1).max(64).default("genshin"),
  GAMESMCP_PROVIDER_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(3_000),
  GAMESMCP_PROVIDER_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  GAMESMCP_PROVIDER_HEALTH_CACHE_MS: z.coerce.number().int().positive().default(15_000),
  GAMESMCP_STARRAIL_ENABLED: z
    .enum(["true", "false", "1", "0"])
    .default("false")
    .transform((value) => value === "true" || value === "1"),
  GAMESMCP_STARRAIL_DATA_DIR: optionalString,
});

export type GameProviderRuntimeEntry =
  | {
      id: "istaroth";
      game: "genshin";
      kind: "external_mcp";
      enabled: boolean;
      url?: string;
      connectTimeoutMs: number;
      requestTimeoutMs: number;
      healthCacheMs: number;
    }
  | {
      id: "starrail-local";
      game: "starrail";
      kind: "local_dataset";
      enabled: boolean;
      dataDir?: string;
      inventoryOutput: string;
    };

export type RuntimeConfig = {
  nodeEnv: "development" | "test" | "production";
  host: string;
  apiPort: number;
  webPort: number;
  databaseUrl: string;
  dataDir: string;
  corsOrigins: string[];
  adminToken?: string;
  llm: {
    baseUrl?: string;
    apiKey?: string;
    modelId?: string;
    timeoutMs: number;
    maxRetries: number;
    maxContextChars: number;
  };
  embedding: {
    modelId?: string;
    modelVersion?: string;
    dimension: number;
    indexVersion: number;
  };
  localRateLimitPerMinute: number;
  providers: {
    entries: GameProviderRuntimeEntry[];
    istaroth?: {
      enabled: boolean;
      url?: string;
      gameSlug: string;
      connectTimeoutMs: number;
      requestTimeoutMs: number;
      healthCacheMs: number;
    };
    starrail?: {
      enabled: boolean;
      dataDir?: string;
      inventoryOutput: string;
    };
  };
};

export function loadConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  if (env === process.env) loadLocalEnvironment();
  const parsed = environmentSchema.parse(env);
  if (parsed.GAMESMCP_ISTAROTH_ENABLED) {
    if (!parsed.GAMESMCP_ISTAROTH_URL)
      throw new Error("GAMESMCP_ISTAROTH_URL is required when Istaroth provider is enabled");
    try {
      new URL(parsed.GAMESMCP_ISTAROTH_URL);
    } catch {
      throw new Error("GAMESMCP_ISTAROTH_URL must be a valid URL");
    }
  }
  const starRailDataDir = parsed.GAMESMCP_STARRAIL_DATA_DIR
    ? resolve(parsed.GAMESMCP_STARRAIL_DATA_DIR)
    : undefined;
  if (parsed.GAMESMCP_STARRAIL_ENABLED) {
    if (!starRailDataDir)
      throw new Error("GAMESMCP_STARRAIL_DATA_DIR is required when StarRail provider is enabled");
    if (!existsSync(starRailDataDir))
      throw new Error(`GAMESMCP_STARRAIL_DATA_DIR does not exist: ${starRailDataDir}`);
  }
  const istarothProvider: Extract<GameProviderRuntimeEntry, { id: "istaroth" }> = {
    id: "istaroth",
    game: "genshin",
    kind: "external_mcp",
    enabled: parsed.GAMESMCP_ISTAROTH_ENABLED,
    url: parsed.GAMESMCP_ISTAROTH_URL,
    connectTimeoutMs: parsed.GAMESMCP_PROVIDER_CONNECT_TIMEOUT_MS,
    requestTimeoutMs: parsed.GAMESMCP_PROVIDER_REQUEST_TIMEOUT_MS,
    healthCacheMs: parsed.GAMESMCP_PROVIDER_HEALTH_CACHE_MS,
  };
  const starrailProvider: Extract<GameProviderRuntimeEntry, { id: "starrail-local" }> = {
    id: "starrail-local",
    game: "starrail",
    kind: "local_dataset",
    enabled: parsed.GAMESMCP_STARRAIL_ENABLED,
    dataDir: starRailDataDir,
    inventoryOutput: resolve(parsed.DATA_DIR, "artifacts/starrail-source-inventory.json"),
  };
  return {
    nodeEnv: parsed.NODE_ENV,
    host: parsed.HOST,
    apiPort: parsed.API_PORT,
    webPort: parsed.WEB_PORT,
    databaseUrl: parsed.DATABASE_URL,
    dataDir: resolve(parsed.DATA_DIR),
    corsOrigins: (parsed.CORS_ORIGINS ?? "http://127.0.0.1:4173,http://localhost:4173")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    adminToken: parsed.ADMIN_TOKEN,
    llm: {
      baseUrl: parsed.LLM_BASE_URL,
      apiKey: parsed.LLM_API_KEY,
      modelId: parsed.LLM_MODEL_ID,
      timeoutMs: parsed.LLM_TIMEOUT_MS,
      maxRetries: parsed.LLM_MAX_RETRIES,
      maxContextChars: parsed.LLM_MAX_CONTEXT_CHARS,
    },
    embedding: {
      modelId: parsed.EMBEDDING_MODEL_ID,
      modelVersion: parsed.EMBEDDING_MODEL_VERSION,
      dimension: parsed.EMBEDDING_DIMENSION,
      indexVersion: parsed.SEARCH_INDEX_VERSION,
    },
    localRateLimitPerMinute: parsed.LOCAL_RATE_LIMIT_PER_MINUTE,
    providers: {
      entries: [istarothProvider, starrailProvider],
      istaroth: {
        enabled: istarothProvider.enabled,
        url: istarothProvider.url,
        gameSlug: parsed.GAMESMCP_ISTAROTH_GAME_SLUG,
        connectTimeoutMs: istarothProvider.connectTimeoutMs,
        requestTimeoutMs: istarothProvider.requestTimeoutMs,
        healthCacheMs: istarothProvider.healthCacheMs,
      },
      starrail: {
        enabled: starrailProvider.enabled,
        dataDir: starrailProvider.dataDir,
        inventoryOutput: starrailProvider.inventoryOutput,
      },
    },
  };
}

export function redactConfig(config: RuntimeConfig): Omit<RuntimeConfig, "llm"> & {
  llm: Omit<RuntimeConfig["llm"], "apiKey"> & { apiKey?: string };
} {
  return {
    ...config,
    llm: { ...config.llm, apiKey: config.llm.apiKey ? "[redacted]" : undefined },
  };
}
