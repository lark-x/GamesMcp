export type GameProviderErrorCode =
  | "provider_disabled"
  | "provider_unavailable"
  | "provider_timeout"
  | "provider_protocol_error"
  | "provider_bad_response"
  | "provider_not_supported"
  | "game_provider_not_found";

const defaultMessages: Record<GameProviderErrorCode, string> = {
  provider_disabled: "Game knowledge provider is disabled.",
  provider_unavailable: "Game knowledge provider is currently unavailable.",
  provider_timeout: "Game knowledge provider request timed out.",
  provider_protocol_error: "Game knowledge provider returned a protocol error.",
  provider_bad_response: "Game knowledge provider returned an unsupported response.",
  provider_not_supported: "Game knowledge provider does not support this capability.",
  game_provider_not_found: "No game knowledge provider is registered for this game.",
};

export class GameProviderError extends Error {
  constructor(
    readonly code: GameProviderErrorCode,
    message = defaultMessages[code],
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "GameProviderError";
  }
}

export function providerErrorFrom(error: unknown): GameProviderError {
  if (error instanceof GameProviderError) return error;
  if (error instanceof Error && error.name === "AbortError")
    return new GameProviderError("provider_timeout");
  const message = error instanceof Error ? error.message : "";
  if (/timeout|timed out|RequestTimeout/iu.test(message))
    return new GameProviderError("provider_timeout");
  if (/tool|json-rpc|protocol|mcp/iu.test(message))
    return new GameProviderError("provider_protocol_error");
  return new GameProviderError("provider_unavailable");
}
