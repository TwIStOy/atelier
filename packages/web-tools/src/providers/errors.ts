export class ProviderError extends Error {
  readonly providerName: string;
  readonly statusCode: number;
  readonly isRateLimit: boolean;

  constructor(providerName: string, statusCode: number, message: string, opts?: { isRateLimit?: boolean }) {
    super(`${providerName} API error (${statusCode}): ${message}`);
    this.name = "ProviderError";
    this.providerName = providerName;
    this.statusCode = statusCode;
    this.isRateLimit = opts?.isRateLimit ?? false;
  }
}

const RATE_LIMIT_CODES = new Set([429, 402, 432, 433]);

export function throwIfApiError(providerName: string, status: number, body: string): void {
  if (status < 400) return;
  throw new ProviderError(providerName, status, body, {
    isRateLimit: RATE_LIMIT_CODES.has(status),
  });
}

const MAX_ERROR_DEPTH = 5;

function errorText(err: Error): string | undefined {
  const code = "code" in err && typeof err.code === "string" && err.code.length > 0 ? err.code : undefined;
  const message = err.message.trim();
  if (message.length === 0) return code;
  if (!code || message.includes(code)) return message;
  return `${message} (${code})`;
}

function nextCause(err: Error): unknown {
  if (err.cause != null) return err.cause;
  if (err instanceof AggregateError) {
    for (const nested of err.errors) {
      if (nested != null) return nested;
    }
  }
  return undefined;
}

export function describeError(err: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = err;
  for (let depth = 0; depth < MAX_ERROR_DEPTH && current != null; depth++) {
    if (seen.has(current)) break;
    seen.add(current);
    if (!(current instanceof Error)) {
      const text = String(current).trim();
      if (text.length > 0 && !parts.includes(text)) parts.push(text);
      break;
    }
    const text = errorText(current);
    if (text && !parts.includes(text)) parts.push(text);
    current = nextCause(current);
  }
  return parts.join(": ") || "unknown error";
}
