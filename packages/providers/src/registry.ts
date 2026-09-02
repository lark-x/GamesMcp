import { GameProviderError } from "./errors.js";
import type {
  GameKnowledgeProvider,
  GameProviderCapability,
  GameProviderHealth,
  GameProviderKind,
} from "./types.js";

export class GameProviderRegistry {
  private readonly providers = new Map<string, GameKnowledgeProvider>();

  register(provider: GameKnowledgeProvider): void {
    const key = registryKey(provider.gameSlug, provider.kind);
    const existing = this.providers.get(key);
    if (existing)
      throw new GameProviderError(
        "provider_protocol_error",
        `Duplicate ${provider.kind} provider for game ${provider.gameSlug}: ${existing.id}`,
      );
    this.providers.set(key, provider);
  }

  get(gameSlug: string, kind: GameProviderKind = "knowledge"): GameKnowledgeProvider {
    const provider = this.providers.get(registryKey(gameSlug, kind));
    if (!provider) throw new GameProviderError("game_provider_not_found");
    return provider;
  }

  hasCapability(gameSlug: string, capability: GameProviderCapability): boolean {
    return this.get(gameSlug).capabilities.includes(capability);
  }

  requireCapability(gameSlug: string, capability: GameProviderCapability): GameKnowledgeProvider {
    const provider = this.get(gameSlug);
    if (!provider.capabilities.includes(capability))
      throw new GameProviderError("provider_not_supported");
    return provider;
  }

  list(gameSlug?: string): GameKnowledgeProvider[] {
    const normalized = gameSlug ? normalizeGameSlug(gameSlug) : undefined;
    return [...this.providers.values()].filter(
      (provider) => !normalized || normalizeGameSlug(provider.gameSlug) === normalized,
    );
  }

  async health(gameSlug?: string): Promise<GameProviderHealth[]> {
    const providers = this.list(gameSlug);
    const checks = await Promise.allSettled(providers.map((provider) => provider.health()));
    return checks.map((item, index) => {
      if (item.status === "fulfilled") return item.value;
      const provider = providers[index];
      return {
        id: provider?.id ?? "unknown",
        game: provider?.gameSlug ?? normalizeGameSlug(gameSlug ?? "unknown"),
        kind: provider?.kind ?? "knowledge",
        status: "unavailable",
        capabilities: provider?.capabilities ?? [],
        checkedAt: new Date().toISOString(),
        message: "Provider health check failed.",
      };
    });
  }

  async close(): Promise<void> {
    await Promise.allSettled([...this.providers.values()].map((provider) => provider.close?.()));
  }
}

function registryKey(gameSlug: string, kind: GameProviderKind): string {
  return `${normalizeGameSlug(gameSlug)}:${kind}`;
}

export function normalizeGameSlug(gameSlug: string): string {
  const normalized = gameSlug.trim().toLowerCase();
  if (["genshin", "genshin-impact", "genshin_impact"].includes(normalized)) return "genshin";
  return normalized;
}
