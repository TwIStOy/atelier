export function getGlobalState<T>(key: string, init: () => T): T {
  const sym = Symbol.for(key);
  const g = globalThis as unknown as Record<symbol, T | undefined>;
  let state = g[sym];
  if (state === undefined) {
    state = init();
    g[sym] = state;
  }
  return state;
}

export function clearGlobalState(key: string): boolean {
  const sym = Symbol.for(key);
  const g = globalThis as unknown as Record<symbol, unknown>;
  if (!(sym in g)) return false;
  delete g[sym];
  return true;
}
