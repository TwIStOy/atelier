import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => unknown;

// The title latch/retry semantics live in the shared session-title service
// (covered by common's tests). Here we mock the service surface herdr
// consumes: the current title, the latch notification, and the ensure call.
// Real LLM latency is simulated by setting the title AFTER the event's
// immediate render fired, then invoking the captured listener — proving herdr
// must re-render on its own when the title lands.
let sharedTitle = "";
const titleListeners: Array<(title: string) => void> = [];
vi.mock("@htwang-contrib/common", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@htwang-contrib/common")>();
  return {
    ...actual,
    ensureSessionTitle: vi.fn(async () => {}),
    getSessionTitle: vi.fn(() => sharedTitle),
    onSessionTitle: vi.fn((listener: (title: string) => void) => {
      titleListeners.push(listener);
      return () => {};
    }),
    resetSessionTitle: vi.fn(() => {}),
    abortSessionTitle: vi.fn(() => {}),
    captureSessionFirstPrompt: vi.fn(),
  };
});

// Herdr CLI is driven by pi.exec. We capture its calls and stub responses.
let paneGetResponse = JSON.stringify({
  id: "r",
  result: {
    type: "pane_info",
    pane: { pane_id: "w1:p1", focused: true, tab_id: "w1:t1" },
  },
});
let tabGetResponse = JSON.stringify({
  id: "r",
  result: {
    type: "tab_info",
    tab: { tab_id: "w1:t1", label: "My Logs", number: 1 },
  },
});
const execCalls: { cmd: string; args: string[] }[] = [];

function buildPi() {
  const handlers = new Map<string, Handler>();
  const eventHandlers = new Map<string, Handler>();
  const branch: unknown[] = [];
  const model = { provider: "test", id: "m1" };
  const pi = {
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
    },
    events: {
      on(channel: string, handler: Handler) {
        eventHandlers.set(channel, handler);
      },
      emit(channel: string, data: unknown) {
        eventHandlers.get(channel)?.(data);
      },
    },
    async exec(cmd: string, args: string[]) {
      execCalls.push({ cmd, args });
      if (args[0] === "pane" && args[1] === "get") {
        return { stdout: paneGetResponse, stderr: "", code: 0, killed: false };
      }
      if (args[0] === "tab" && args[1] === "get") {
        return { stdout: tabGetResponse, stderr: "", code: 0, killed: false };
      }
      return { stdout: "{}", stderr: "", code: 0, killed: false };
    },
  };
  const ctx = {
    modelRegistry: { getAvailable: () => [] },
    sessionManager: { getBranch: () => branch },
    model,
  };
  return { pi: pi as any, ctx: ctx as any, handlers, eventHandlers, branch };
}

async function load() {
  const mod = await import("../src/index.ts");
  return mod;
}

function renames(): string[] {
  return execCalls.filter((c) => c.args[0] === "tab" && c.args[1] === "rename").map((c) => String(c.args[3]));
}

/** Simulate the shared service latching a title (async LLM latency). */
function latchTitle(title: string): void {
  sharedTitle = title;
  for (const listener of [...titleListeners]) listener(title);
}

describe("herdr index.ts: tab title from the shared session-title service", () => {
  beforeEach(() => {
    process.env.HERDR_ENV = "1";
    process.env.HERDR_PANE_ID = "w1:p1";
    process.env.HERDR_BIN_PATH = "/usr/bin/herdr";
    sharedTitle = "";
    titleListeners.length = 0;
    paneGetResponse = JSON.stringify({
      id: "r",
      result: {
        type: "pane_info",
        pane: { pane_id: "w1:p1", focused: true, tab_id: "w1:t1" },
      },
    });
    execCalls.length = 0;
    vi.resetModules();
    vi.clearAllMocks();
    tabGetResponse = JSON.stringify({
      id: "r",
      result: {
        type: "tab_info",
        tab: { tab_id: "w1:t1", label: "My Logs", number: 1 },
      },
    });
  });

  it("renders a fallback until the title latches, then re-renders on its own", async () => {
    const { pi, ctx, handlers } = buildPi();
    const mod = await load();
    mod.default(pi);

    // The event's immediate render fires BEFORE the title lands (LLM latency).
    handlers.get("before_agent_start")!({ prompt: "build the thing" }, ctx);
    await vi.waitFor(() => {
      expect(execCalls.some((c) => c.args[0] === "tab" && c.args[1] === "rename")).toBe(true);
    });
    // No title yet -> the body falls back to state-specific text.
    expect(renames().every((t) => !/RealTitle/.test(t))).toBe(true);

    // The shared service latches and notifies -> herdr re-renders by itself.
    latchTitle("RealTitle");
    await vi.waitFor(() => {
      expect(renames().some((t) => /RealTitle/.test(t))).toBe(true);
    });
  });

  it("renames even when the pane is not focused when the title lands", async () => {
    // Regression: the active-pane guard used to skip rename when our pane was
    // unfocused at the moment the (async) side-call resolved — losing the
    // title update entirely. The tab is OURS, so we must always rename it.
    const { pi, ctx, handlers } = buildPi();
    const mod = await load();
    mod.default(pi);

    // Make the pane report as NOT focused on every pane get.
    paneGetResponse = JSON.stringify({
      id: "r",
      result: {
        type: "pane_info",
        pane: { pane_id: "w1:p1", focused: false, tab_id: "w1:t1" },
      },
    });
    handlers.get("before_agent_start")!({ prompt: "hello there" }, ctx);
    latchTitle("Unfocused title");
    await vi.waitFor(() => {
      expect(renames().some((t) => /Unfocused title/.test(t))).toBe(true);
    });
  });

  it("asks the shared service to ensure the title on the retry points", async () => {
    const { ensureSessionTitle } = await import("@htwang-contrib/common");
    const { pi, ctx, handlers } = buildPi();
    const mod = await load();
    mod.default(pi);

    handlers.get("session_start")!({}, ctx);
    handlers.get("before_agent_start")!({ prompt: "fix the bug" }, ctx);
    handlers.get("agent_end")!({}, ctx);
    await new Promise((r) => setTimeout(r, 30));
    // The latch/retry dedup is the service's job; herdr just retries at the
    // three natural points (resume, first prompt, late first prompt).
    expect((ensureSessionTitle as ReturnType<typeof vi.fn>).mock.calls.length).toBe(3);
  });

  it("restores the original tab label on session_shutdown", async () => {
    const { pi, ctx, handlers } = buildPi();
    const mod = await load();
    mod.default(pi);

    // Drive one render so the original label ("My Logs") is captured before we
    // overwrite it with our own title.
    handlers.get("before_agent_start")!({ prompt: "fix" }, ctx);
    latchTitle("Bugfix");
    await vi.waitFor(() => {
      expect(renames().some((t) => /Bugfix/.test(t))).toBe(true);
    });

    // On shutdown we must rename back to the original label we snapshotted.
    execCalls.length = 0;
    handlers.get("session_shutdown")!({}, ctx);
    await vi.waitFor(() => {
      expect(renames().some((t) => t === "My Logs")).toBe(true);
    });
  });

  it("falls back to the tab number when the original label was already ours", async () => {
    // Simulate a leftover title from a previous run.
    tabGetResponse = JSON.stringify({
      id: "r",
      result: {
        type: "tab_info",
        tab: { tab_id: "w1:t1", label: "⏺ old run", number: 7 },
      },
    });
    const { pi, ctx, handlers } = buildPi();
    const mod = await load();
    mod.default(pi);

    handlers.get("before_agent_start")!({ prompt: "fix" }, ctx);
    await vi.waitFor(() => {
      expect(execCalls.some((c) => c.args[0] === "tab" && c.args[1] === "get")).toBe(true);
    });

    execCalls.length = 0;
    handlers.get("session_shutdown")!({}, ctx);
    await vi.waitFor(() => {
      // The leftover "⏺ old run" is ours, so we restore the number "7".
      expect(renames().some((t) => t === "7")).toBe(true);
    });
  });
});
