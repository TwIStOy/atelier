const MAX_TIMEOUT_MS = 86_400_000;

export function mergeAbortWithTimeoutMs(primary: AbortSignal | undefined, timeoutMs: number): AbortSignal | undefined {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return primary;
  const ms = Math.min(Math.floor(timeoutMs), MAX_TIMEOUT_MS);
  if (ms <= 0) return primary;
  const t = AbortSignal.timeout(ms);
  if (!primary) return t;
  return AbortSignal.any([primary, t]);
}
