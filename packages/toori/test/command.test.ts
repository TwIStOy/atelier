import { afterEach, describe, expect, test, vi } from "vitest";
import { ENV_VAR, handleRefreshCommand, PROVIDER_ID } from "../src/command.ts";

const originalEnv = process.env[ENV_VAR];

afterEach(() => {
  if (originalEnv === undefined) delete process.env[ENV_VAR];
  else process.env[ENV_VAR] = originalEnv;
});

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
      getAll: () => options?.models ?? [{ provider: PROVIDER_ID, id: "glm-5.2" }],
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
  test("errors when the API key env var is missing", async () => {
    delete process.env[ENV_VAR];
    const { ctx, refresh, notifications } = makeCtx();
    await handleRefreshCommand("", ctx);
    expect(refresh).not.toHaveBeenCalled();
    expect(notifications).toEqual([{ message: `${ENV_VAR} is not set`, type: "error" }]);
  });

  test("force-refreshes the provider catalog", async () => {
    process.env[ENV_VAR] = "sk-test";
    const { ctx, refresh, notifications } = makeCtx({
      models: [
        { provider: PROVIDER_ID, id: "glm-5.2" },
        { provider: PROVIDER_ID, id: "kimi-k3" },
        { provider: "anthropic", id: "claude-opus-5" },
      ],
    });
    await handleRefreshCommand("", ctx);
    expect(refresh).toHaveBeenCalledWith({
      providers: [PROVIDER_ID],
      allowNetwork: true,
      force: true,
      signal: undefined,
    });
    expect(notifications).toEqual([{ message: "Refreshed toori catalog (2): glm-5.2, kimi-k3", type: "info" }]);
  });

  test("reports abort", async () => {
    process.env[ENV_VAR] = "sk-test";
    const { ctx, notifications } = makeCtx({ aborted: true });
    await handleRefreshCommand("", ctx);
    expect(notifications).toEqual([{ message: "toori catalog refresh aborted", type: "warning" }]);
  });

  test("reports provider error", async () => {
    process.env[ENV_VAR] = "sk-test";
    const { ctx, notifications } = makeCtx({ error: new Error("gateway 503") });
    await handleRefreshCommand("", ctx);
    expect(notifications).toEqual([{ message: "toori catalog refresh failed: gateway 503", type: "error" }]);
  });

  test("warns when the catalog is empty", async () => {
    process.env[ENV_VAR] = "sk-test";
    const { ctx, notifications } = makeCtx({ models: [] });
    await handleRefreshCommand("", ctx);
    expect(notifications).toEqual([{ message: "toori catalog refresh returned no models", type: "warning" }]);
  });
});
