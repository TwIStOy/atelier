export function memoizeAsyncWithRetry<T>(factory: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => {
    cached ??= factory().catch((error: unknown) => {
      cached = null;
      throw error;
    });
    return cached;
  };
}
