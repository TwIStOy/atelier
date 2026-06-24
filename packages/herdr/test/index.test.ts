import { beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (...args: unknown[]) => unknown;

// Mock the LLM side-call so the test focuses on the latch + event-retry
// behavior in index.ts, not on model wiring. Resolves after a short delay
// so the triggering event's immediate scheduleRender() fires BEFORE the
// title lands — mirroring real LLM latency and proving the latch must
// re-render on its own.
let sideCallDelayMs = 0;
let sideCallAnswer: { fromModel: boolean; title?: string; throw?: boolean } = {
  fromModel: false,
};
vi.mock("@htwang-contrib/common", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@htwang-contrib/common")>();
  return {
    ...actual,
    executeSideCall: vi.fn(async () => {
      if (sideCallDelayMs > 0) await new Promise((r) => setTimeout(r, sideCallDelayMs));
      if (sideCallAnswer.throw) throw new Error("boom");
      if (!sideCallAnswer.fromModel) return { ok: false, error: "no prompt yet" };
      return { ok: true, answer: sideCallAnswer.title ?? "Title" };
    }),
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
  const mod = await import("./index.ts");
  return mod;
}

describe("herdr index.ts: title latch + event retry", () => {
  beforeEach(() => {
    process.env.HERDR_ENV = "1";
    process.env.HERDR_PANE_ID = "w1:p1";
    process.env.HERDR_BIN_PATH = "/usr/bin/herdr";
    sideCallAnswer = { fromModel: false };
    sideCallDelayMs = 0;
    paneGetResponse = JSON.stringify({
      id: "r",
      result: {
        type: "pane_info",
        pane: { pane_id: "w1:p1", focused: true, tab_id: "w1:t1" },
      },
    });
    execCalls.length = 0;
    vi.resetModules();
    tabGetResponse = JSON.stringify({
      id: "r",
      result: {
        type: "tab_info",
        tab: { tab_id: "w1:t1", label: "My Logs", number: 1 },
      },
    });
  });

  it("does NOT latch on session_start when the branch is empty, then retries on before_agent_start", async () => {
    const { pi, ctx, branch, handlers } = buildPi();
    const mod = await load();
    mod.default(pi);

    // session_start fires with an EMPTY branch -> firstUserPrompt is "" ->
    // summarizeSessionTitle returns a fallback (fromModel:false). Old bug:
    // latched true here and never retried. Fix: stays unlatched.
    handlers.get("session_start")!({}, ctx);
    await vi.waitFor(() => {
      // First render happens after a 0ms timeout (scheduleRender(0)).
      expect(execCalls.some((c) => c.args[0] === "tab")).toBe(true);
    });
    const renamedWith = execCalls.filter((c) => c.args[0] === "tab" && c.args[1] === "rename").map((c) => c.args[3]);
    // No first prompt yet -> title body falls back to "Pi" state-specific text.
    expect(renamedWith.every((t) => !/RealTitle|Title/.test(t))).toBe(true);

    // Now the user's first prompt lands and before_agent_start fires.
    sideCallAnswer = { fromModel: true, title: "RealTitle" };
    branch.push({
      type: "message",
      id: "1",
      parentId: null,
      timestamp: "0",
      message: { role: "user", content: "build the thing", timestamp: 0 },
    });
    execCalls.length = 0;
    // Pass the prompt on the event — this is the real primary path now.
    handlers.get("before_agent_start")!({ prompt: "build the thing" }, ctx);
    await vi.waitFor(() => {
      const renames = execCalls.filter((c) => c.args[0] === "tab" && c.args[1] === "rename").map((c) => c.args[3]);
      expect(renames.some((t) => /RealTitle/.test(String(t)))).toBe(true);
    });
  });

  it("latches from before_agent_start event.prompt without waiting for the turn", async () => {
    // Primary path: the first prompt arrives on the before_agent_start event
    // (synchronously, before it is persisted to the branch). The title must
    // be generated immediately — no need to wait for agent_end.
    //
    // The side-call is slowed past the 150ms render debounce so the event's
    // immediate scheduleRender() fires BEFORE the title lands — mirroring real
    // LLM latency. This proves ensureSessionTitle must re-render on its own
    // once it latches (without that, the rename never happens until some
    // unrelated later event).
    const { pi, ctx, handlers } = buildPi();
    const mod = await load();
    mod.default(pi);

    sideCallDelayMs = 250;
    sideCallAnswer = { fromModel: true, title: "Instant title" };
    execCalls.length = 0;
    handlers.get("before_agent_start")!({ prompt: "do something cool" }, ctx);
    await vi.waitFor(() => {
      expect(
        execCalls
          .filter((c) => c.args[0] === "tab" && c.args[1] === "rename")
          .some((c) => /Instant title/.test(String(c.args[3]))),
      ).toBe(true);
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
    sideCallDelayMs = 250;
    sideCallAnswer = { fromModel: true, title: "Unfocused title" };
    execCalls.length = 0;
    handlers.get("before_agent_start")!({ prompt: "hello there" }, ctx);
    await vi.waitFor(() => {
      expect(
        execCalls
          .filter((c) => c.args[0] === "tab" && c.args[1] === "rename")
          .some((c) => /Unfocused title/.test(String(c.args[3]))),
      ).toBe(true);
    });
  });

  it("latches after a real title and does not call the model again", async () => {
    const { executeSideCall } = await import("@htwang-contrib/common");
    const { pi, ctx, branch, handlers } = buildPi();
    const mod = await load();
    mod.default(pi);

    branch.push({
      type: "message",
      id: "1",
      parentId: null,
      timestamp: "0",
      message: { role: "user", content: "fix the bug", timestamp: 0 },
    });
    sideCallAnswer = { fromModel: true, title: "Bugfix" };
    handlers.get("before_agent_start")!({}, ctx);
    await vi.waitFor(() => {
      expect(
        execCalls
          .filter((c) => c.args[0] === "tab" && c.args[1] === "rename")
          .some((c) => /Bugfix/.test(String(c.args[3]))),
      ).toBe(true);
    });

    const callsAfterFirst = (executeSideCall as any).mock.calls.length;
    // Subsequent agent turns must not re-invoke the model (title is stable).
    execCalls.length = 0;
    handlers.get("agent_end")!({}, ctx);
    handlers.get("before_agent_start")!({}, ctx);
    handlers.get("agent_end")!({}, ctx);
    await new Promise((r) => setTimeout(r, 30));
    expect((executeSideCall as any).mock.calls.length).toBe(callsAfterFirst);
  });

  it("restores the original tab label on session_shutdown", async () => {
    const { pi, ctx, branch, handlers } = buildPi();
    const mod = await load();
    mod.default(pi);

    // Drive one render so the original label ("My Logs") is captured before we
    // overwrite it with our own title.
    sideCallAnswer = { fromModel: true, title: "Bugfix" };
    branch.push({
      type: "message",
      id: "1",
      parentId: null,
      timestamp: "0",
      message: { role: "user", content: "fix", timestamp: 0 },
    });
    handlers.get("before_agent_start")!({}, ctx);
    await vi.waitFor(() => {
      expect(
        execCalls
          .filter((c) => c.args[0] === "tab" && c.args[1] === "rename")
          .some((c) => /Bugfix/.test(String(c.args[3]))),
      ).toBe(true);
    });

    // On shutdown we must rename back to the original label we snapshotted.
    execCalls.length = 0;
    handlers.get("session_shutdown")!({}, ctx);
    await vi.waitFor(() => {
      const last = execCalls.filter((c) => c.args[0] === "tab" && c.args[1] === "rename").map((c) => c.args[3]);
      expect(last.some((t) => t === "My Logs")).toBe(true);
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

    handlers.get("before_agent_start")!({}, ctx);
    await vi.waitFor(() => {
      expect(execCalls.some((c) => c.args[0] === "tab" && c.args[1] === "get")).toBe(true);
    });

    execCalls.length = 0;
    handlers.get("session_shutdown")!({}, ctx);
    await vi.waitFor(() => {
      const last = execCalls.filter((c) => c.args[0] === "tab" && c.args[1] === "rename").map((c) => c.args[3]);
      // The leftover "⏺ old run" is ours, so we restore the number "7".
      expect(last.some((t) => t === "7")).toBe(true);
    });
  });

  it("retries on agent_end when the first prompt lands late", async () => {
    // Reproduce the real "hi" bug: at session_start AND before_agent_start the
    // branch has no readable user message yet (promptLen=0). The first prompt
    // only becomes extractable after the turn ends — agent_end must retry.
    const { executeSideCall } = await import("@htwang-contrib/common");
    const { pi, ctx, branch, handlers } = buildPi();
    const mod = await load();
    mod.default(pi);

    // session_start: branch is empty -> fromModel:false, stays unlatched.
    sideCallAnswer = { fromModel: false };
    sideCallDelayMs = 0;
    handlers.get("session_start")!({}, ctx);
    await new Promise((r) => setTimeout(r, 30));

    // before_agent_start: branch grows but firstUserPrompt still empty.
    branch.push({ type: "session", id: "s" });
    branch.push({ type: "model_change", id: "m" });
    const callsBefore = (executeSideCall as any).mock.calls.length;
    handlers.get("before_agent_start")!({}, ctx);
    await new Promise((r) => setTimeout(r, 30));
    // Side-call may have run but produced fromModel:false (no title).
    expect((executeSideCall as any).mock.calls.length).toBe(callsBefore);

    // agent_end: NOW the user message is in the branch -> must retry + latch.
    sideCallAnswer = { fromModel: true, title: "Hi session" };
    branch.push({
      type: "message",
      id: "u1",
      parentId: null,
      timestamp: "0",
      message: { role: "user", content: "hi", timestamp: 0 },
    });
    execCalls.length = 0;
    handlers.get("agent_end")!({}, ctx);
    await vi.waitFor(() => {
      expect(
        execCalls
          .filter((c) => c.args[0] === "tab" && c.args[1] === "rename")
          .some((c) => /Hi session/.test(String(c.args[3]))),
      ).toBe(true);
    });
  });
});
