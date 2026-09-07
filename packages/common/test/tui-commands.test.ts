import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, test } from "vitest";
import { registerTuiCommands } from "../src/tui-commands.ts";

interface RecordedHandler {
  event: string;
  handler: (event: unknown, ctx: { mode: string }) => unknown;
}

function createApi() {
  const handlers: RecordedHandler[] = [];
  const commands = new Map<string, unknown>();
  const pi = {
    on(event: string, handler: RecordedHandler["handler"]) {
      handlers.push({ event, handler });
    },
    registerCommand(name: string, options: unknown) {
      commands.set(name, options);
    },
  } as unknown as ExtensionAPI;
  return { pi, handlers, commands };
}

describe("registerTuiCommands", () => {
  test("registers commands when session starts in tui mode", async () => {
    const { pi, handlers, commands } = createApi();
    registerTuiCommands(pi, (api) => {
      api.registerCommand("demo", { description: "demo" });
    });

    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.event).toBe("session_start");
    expect(commands.size).toBe(0);

    await handlers[0]?.handler({ type: "session_start", reason: "startup" }, { mode: "tui" });
    expect([...commands.keys()]).toEqual(["demo"]);
  });

  test("does not register in rpc mode", async () => {
    const { pi, handlers, commands } = createApi();
    registerTuiCommands(pi, (api) => {
      api.registerCommand("demo", { description: "demo" });
    });

    await handlers[0]?.handler({ type: "session_start", reason: "startup" }, { mode: "rpc" });
    expect(commands.size).toBe(0);
  });

  test("does not register in print or json mode", async () => {
    const { pi, handlers, commands } = createApi();
    registerTuiCommands(pi, (api) => {
      api.registerCommand("demo", { description: "demo" });
    });

    await handlers[0]?.handler({ type: "session_start", reason: "startup" }, { mode: "print" });
    await handlers[0]?.handler({ type: "session_start", reason: "reload" }, { mode: "json" });
    expect(commands.size).toBe(0);
  });

  test("re-registering on repeated session_start is idempotent", async () => {
    const { pi, handlers, commands } = createApi();
    registerTuiCommands(pi, (api) => {
      api.registerCommand("demo", { description: "demo" });
    });

    await handlers[0]?.handler({ type: "session_start", reason: "startup" }, { mode: "tui" });
    await handlers[0]?.handler({ type: "session_start", reason: "reload" }, { mode: "tui" });
    expect([...commands.keys()]).toEqual(["demo"]);
  });
});
