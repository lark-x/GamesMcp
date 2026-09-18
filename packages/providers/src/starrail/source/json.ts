/** Preserve integer identifiers without modifying quoted text or decimal tokens. */
export function parseSourceJson<T = unknown>(raw: string): T {
  return JSON.parse(
    raw.replace(/"(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/gu, (token) => {
      if (/^-?\d+$/u.test(token) && !Number.isSafeInteger(Number(token))) {
        return JSON.stringify(token);
      }
      return token;
    }),
  ) as T;
}
