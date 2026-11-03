import type {
  ModelsRefreshOptions,
  ModelsRefreshResult,
  ModelsStoreEntry,
  RefreshModelsContext,
} from "@earendil-works/pi-ai";
import type { ProviderModelConfig } from "@earendil-works/pi-coding-agent";

export type RefreshCommandContext = {
  signal: AbortSignal | undefined;
  modelRegistry: {
    refresh: (options?: ModelsRefreshOptions) => Promise<ModelsRefreshResult>;
    getAll: () => ReadonlyArray<{ provider: string; id: string }>;
  };
  ui: {
    notify: (message: string, type?: "info" | "warning" | "error") => void;
  };
};

/**
 * Refresh-command handler shared by gateway provider extensions (magpie,
 * toori): forces a provider catalog refresh and reports the resulting model
 * ids. `opts.envVar` gates the refresh on the variable being set.
 */
export function makeRefreshCommandHandler(
  providerId: string,
  displayName: string,
  opts?: { envVar?: string },
): (_args: string, ctx: RefreshCommandContext) => Promise<void> {
  return async (_args, ctx) => {
    if (opts?.envVar && !process.env[opts.envVar]) {
      ctx.ui.notify(`${opts.envVar} is not set`, "error");
      return;
    }

    const result = await ctx.modelRegistry.refresh({
      providers: [providerId],
      allowNetwork: true,
      force: true,
      signal: ctx.signal,
    });

    if (result.aborted) {
      ctx.ui.notify(`${displayName} catalog refresh aborted`, "warning");
      return;
    }

    const error = result.errors.get(providerId);
    if (error) {
      ctx.ui.notify(`${displayName} catalog refresh failed: ${error.message}`, "error");
      return;
    }

    const ids = ctx.modelRegistry
      .getAll()
      .filter((model) => model.provider === providerId)
      .map((model) => model.id);
    if (ids.length === 0) {
      ctx.ui.notify(`${displayName} catalog refresh returned no models`, "warning");
      return;
    }
    ctx.ui.notify(`Refreshed ${displayName} catalog (${ids.length}): ${ids.join(", ")}`, "info");
  };
}

/**
 * Fetch and decode `<base>/models` from a gateway, throwing on HTTP errors.
 */
export async function fetchGatewayModels<T>(
  baseUrl: string,
  headers: Record<string, string>,
  signal?: AbortSignal,
): Promise<T> {
  const url = new URL("models", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
  const response = await fetch(url, { headers, signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * Cached-refresh skeleton shared by gateway provider extensions: return the
 * stored catalog unless network refresh is allowed, forced, or the cached one
 * is older than `refreshIntervalMs`; otherwise fetch, publish, and return.
 */
export async function refreshModelsCatalog(
  context: RefreshModelsContext,
  fetchCatalog: (context: RefreshModelsContext) => Promise<ProviderModelConfig[]>,
  refreshIntervalMs = 4 * 60 * 60 * 1000,
): Promise<ProviderModelConfig[]> {
  if (!context.allowNetwork || context.signal?.aborted) {
    return storedAsConfig(context.stored);
  }
  if (
    !context.force &&
    context.stored?.checkedAt !== undefined &&
    Date.now() - context.stored.checkedAt < refreshIntervalMs
  ) {
    return storedAsConfig(context.stored);
  }
  const refreshed = await fetchCatalog(context);
  if (context.signal?.aborted) return storedAsConfig(context.stored);
  await context.publish({
    persist: {
      models: refreshed as unknown as ModelsStoreEntry["models"],
      checkedAt: Date.now(),
    },
  });
  return refreshed;
}

function storedAsConfig(stored: { models: readonly ProviderModelConfig[] } | undefined): ProviderModelConfig[] {
  return [...(stored?.models ?? [])] as ProviderModelConfig[];
}
