export class ProviderError extends Error {
  readonly providerName: string;
  readonly statusCode: number;
  readonly isRateLimit: boolean;

  constructor(
    providerName: string,
    statusCode: number,
    message: string,
    opts?: { isRateLimit?: boolean },
  ) {
    super(`${providerName} API error (${statusCode}): ${message}`);
    this.name = "ProviderError";
    this.providerName = providerName;
    this.statusCode = statusCode;
    this.isRateLimit = opts?.isRateLimit ?? false;
  }
}

const RATE_LIMIT_CODES = new Set([429, 402, 432, 433]);

export function throwIfApiError(
  providerName: string,
  label: string,
  status: number,
  body: string,
): void {
  if (status < 400) return;
  throw new ProviderError(providerName, status, body, {
    isRateLimit: RATE_LIMIT_CODES.has(status),
  });
}
