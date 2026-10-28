import { describe, expect, test, vi } from "vitest";
import { handleRefreshCommand, PROVIDER_ID } from "../src/command.ts";

function makeCtx(options?: { aborted?: boolean; error?: Error; models?: Array<{ provider: string; id: string }> }) {
  const notifications: Array<{ message: string; type?: "info" | "warning" | "error" }> = [];
  const refresh = vi.fn(async () => ({
    aborted: options?.aborted ?? false,
    errors: new Map(options?.error ? [[PROVIDER_ID, options.error]] : []),
  }));
  const ctx = {
    signal: undefined,
    modelRegistry: {
      refresh,
      getAll: () => options?.models ?? [{ provider: PROVIDER_ID, id: "group/cn-flagships" }],
    },
    ui: {
      notify: (message: string, type?: "info" | "warning" | "error") => {
        notifications.push({ message, type });
      },
    },
  };
  return { ctx, refresh, notifications };
}

describe("handleRefreshCommand", () => {
  test("force-refreshes the provider catalog", async () => {
    const { ctx, refresh, notifications } = makeCtx({
      models: [
        { provider: PROVIDER_ID, id: "group/cn-flagships" },
        { provider: PROVIDER_ID, id: "kimi-code-cn/kimi-k3" },
        { provider: "toori", id: "glm-5.3" },
      ],
    });
    await handleRefreshCommand("", ctx);
    expect(refresh).toHaveBeenCalledWith({
      providers: [PROVIDER_ID],
      allowNetwork: true,
      force: true,
      signal: undefined,
    });
    expect(notifications).toEqual([
      { message: "Refreshed magpie catalog (2): group/cn-flagships, kimi-code-cn/kimi-k3", type: "info" },
    ]);
  });

  test("reports abort", async () => {
    const { ctx, notifications } = makeCtx({ aborted: true });
    await handleRefreshCommand("", ctx);
    expect(notifications).toEqual([{ message: "magpie catalog refresh aborted", type: "warning" }]);
  });

  test("reports provider error", async () => {
    const { ctx, notifications } = makeCtx({ error: new Error("gateway 401") });
    await handleRefreshCommand("", ctx);
    expect(notifications).toEqual([{ message: "magpie catalog refresh failed: gateway 401", type: "error" }]);
  });

  test("warns when the catalog is empty", async () => {
    const { ctx, notifications } = makeCtx({ models: [] });
    await handleRefreshCommand("", ctx);
    expect(notifications).toEqual([{ message: "magpie catalog refresh returned no models", type: "warning" }]);
  });
});
