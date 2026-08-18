import type { ModelsRefreshOptions, ModelsRefreshResult } from "@earendil-works/pi-ai";
import { ENV_VAR } from "./catalog.ts";

export const PROVIDER_ID = "toori";
export const COMMAND_NAME = "refresh-toori";
export { ENV_VAR };

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

export async function handleRefreshCommand(_args: string, ctx: RefreshCommandContext): Promise<void> {
  if (!process.env[ENV_VAR]) {
    ctx.ui.notify(`${ENV_VAR} is not set`, "error");
    return;
  }

  const result = await ctx.modelRegistry.refresh({
    providers: [PROVIDER_ID],
    allowNetwork: true,
    force: true,
    signal: ctx.signal,
  });

  if (result.aborted) {
    ctx.ui.notify("toori catalog refresh aborted", "warning");
    return;
  }

  const error = result.errors.get(PROVIDER_ID);
  if (error) {
    ctx.ui.notify(`toori catalog refresh failed: ${error.message}`, "error");
    return;
  }

  const ids = ctx.modelRegistry
    .getAll()
    .filter((model) => model.provider === PROVIDER_ID)
    .map((model) => model.id);
  if (ids.length === 0) {
    ctx.ui.notify("toori catalog refresh returned no models", "warning");
    return;
  }
  ctx.ui.notify(`Refreshed toori catalog (${ids.length}): ${ids.join(", ")}`, "info");
}
