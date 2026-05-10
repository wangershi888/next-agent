/** 将 undici / Node fetch 的错误展开为可读字符串（含 cause） */
export function describeFetchError(err: unknown, context: string): string {
  if (!(err instanceof Error)) {
    return `${context}：${String(err)}`;
  }
  let m = err.message || "unknown";
  const c = err.cause;
  if (c instanceof Error) {
    m += ` | cause: ${c.message}`;
  } else if (c != null) {
    m += ` | cause: ${String(c)}`;
  }
  return `${context}：${m}`;
}

export async function fetchWithContext(
  url: string,
  init: RequestInit | undefined,
  context: string,
  timeoutMs = 25_000,
): Promise<Response> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      return await fetch(url, {
        ...init,
        signal: ctrl.signal,
      });
    } finally {
      clearTimeout(t);
    }
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(
        `${context}：请求超时（>${timeoutMs}ms）。请检查网络或稍后重试。`,
      );
    }
    throw new Error(describeFetchError(err, context));
  }
}

function isTransientFetchFailure(err: unknown): boolean {
  const msg = err instanceof Error ? `${err.message} ${String(err.cause ?? "")}` : String(err);
  return /other side closed|ECONNRESET|ETIMEDOUT|ECONNREFUSED|UND_ERR|socket|closed|reset|timed out/i.test(
    msg,
  );
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit | undefined,
  context: string,
  timeoutMs = 25_000,
  maxAttempts = 3,
): Promise<Response> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetchWithContext(url, init, context, timeoutMs);
    } catch (err) {
      lastErr = err;
      if (attempt >= maxAttempts || !isTransientFetchFailure(err)) {
        throw err instanceof Error ? err : new Error(String(err));
      }
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
