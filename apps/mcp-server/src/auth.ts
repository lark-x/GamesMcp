import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { RuntimeConfig } from "@gip/config";

/**
 * Bearer-token check for the Streamable HTTP MCP endpoint. When no token is
 * configured (local development) every request is allowed; the production
 * config gate already refuses non-loopback bindings without a token.
 */
export function verifyMcpAuth(request: IncomingMessage, config: RuntimeConfig["mcp"]): boolean {
  if (!config.authToken) return true;
  const header = request.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return false;
  return timingSafeEqualTokens(header.slice("Bearer ".length).trim(), config.authToken);
}

/** Length-independent constant-time comparison; both sides are hashed to a
 * fixed digest first so token length never leaks through timing. */
function timingSafeEqualTokens(provided: string, expected: string): boolean {
  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  try {
    return timingSafeEqual(providedDigest, expectedDigest);
  } catch {
    return false;
  }
}
