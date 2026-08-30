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
});

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
};

export function loadConfig(env: Record<string, string | undefined> = process.env): RuntimeConfig {
  if (env === process.env) loadLocalEnvironment();
  const parsed = environmentSchema.parse(env);
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
