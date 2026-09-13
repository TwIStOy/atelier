import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../src/side-call.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/side-call.ts")>();
  return {
    ...actual,
    executeSideCall: vi.fn(),
  };
});

import {
  captureSessionFirstPrompt,
  ensureSessionTitle,
  firstUserPrompt,
  getSessionTitle,
  onSessionTitle,
  parseSessionTitle,
  resetSessionTitle,
} from "../src/session-title.ts";
import { executeSideCall } from "../src/side-call.ts";

function msgEntry(message: AgentMessage, id: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date(Number(id)).toISOString(),
    message,
  } as SessionEntry;
}

function userEntry(text: string, id: string): SessionEntry {
  return msgEntry({ role: "user", content: text, timestamp: Number(id) } as AgentMessage, id);
}

function assistantEntry(text: string, id: string): SessionEntry {
  return msgEntry(
    {
      role: "assistant",
      content: [{ type: "text", text }],
      stopReason: "end_turn",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, total: 0 },
      },
      timestamp: Number(id),
    } as unknown as AgentMessage,
    id,
  );
}

const model = { provider: "test", id: "m1" };
const sideCall = executeSideCall as ReturnType<typeof vi.fn>;

function ctxWith(branch: SessionEntry[] = []): ExtensionContext {
  return {
    model,
    modelRegistry: { getAvailable: () => [model] },
    sessionManager: { getBranch: () => branch },
  } as unknown as ExtensionContext;
}

describe("parseSessionTitle", () => {
  test("takes the first line and strips surrounding quotes + trailing punctuation", () => {
    expect(parseSessionTitle('"Refactor auth"')).toBe("Refactor auth");
    expect(parseSessionTitle("`Add tests`")).toBe("Add tests");
    expect(parseSessionTitle("Fix the bug.")).toBe("Fix the bug");
    expect(parseSessionTitle("Update deps:")).toBe("Update deps");
    expect(parseSessionTitle("Title line\nextra line")).toBe("Title line");
  });

  test("clips long titles to TITLE_MAX with an ellipsis", () => {
    const long = "a".repeat(120);
    const out = parseSessionTitle(long);
    expect(out.length).toBe(60);
    expect(out.endsWith("…")).toBe(true);
  });

  test("returns empty string for blank input", () => {
    expect(parseSessionTitle("")).toBe("");
    expect(parseSessionTitle("   \n  ")).toBe("");
  });
});

describe("firstUserPrompt", () => {
  test("returns an empty string when the branch has no messages", () => {
    expect(firstUserPrompt([])).toBe("");
  });

  test("returns the first non-empty user message", () => {
    const entries: SessionEntry[] = [
      userEntry("Add a login page", "1"),
      assistantEntry("I created src/login.tsx", "2"),
      userEntry("Now add validation", "3"),
    ];
    expect(firstUserPrompt(entries)).toBe("Add a login page");
  });

  test("ignores leading assistant-only turns and skips empty user messages", () => {
    const entries: SessionEntry[] = [
      assistantEntry("hello", "1"),
      userEntry("   ", "2"),
      userEntry("Fix the off-by-one", "3"),
    ];
    expect(firstUserPrompt(entries)).toBe("Fix the off-by-one");
  });

  test("collapses internal whitespace and clips very long prompts", () => {
    const long = "do ".repeat(500).trim();
    const entries: SessionEntry[] = [userEntry(long, "1")];
    const out = firstUserPrompt(entries);
    expect(out.length).toBeLessThanOrEqual(800);
    expect(out.endsWith("…")).toBe(true);
    expect(out.includes("\n")).toBe(false);
  });
});

describe("session title service", () => {
  beforeEach(() => {
    resetSessionTitle();
    sideCall.mockReset();
  });

  test("latches a model-produced title and never re-calls", async () => {
    const branch = [userEntry("build the thing", "1")];
    sideCall.mockResolvedValue({ ok: true, answer: "Build the thing" });
    await ensureSessionTitle(ctxWith(branch));
    expect(getSessionTitle()).toBe("Build the thing");
    expect(sideCall.mock.calls.length).toBe(1);

    await ensureSessionTitle(ctxWith(branch));
    await ensureSessionTitle(ctxWith(branch));
    expect(sideCall.mock.calls.length).toBe(1);
  });

  test("stays unlatched on failure and retries on the next call", async () => {
    sideCall.mockResolvedValue({ ok: false, error: "no prompt yet" });
    await ensureSessionTitle(ctxWith());
    expect(getSessionTitle()).toBe("");

    const branch = [userEntry("fix the bug", "1")];
    sideCall.mockResolvedValue({ ok: true, answer: "Bugfix" });
    await ensureSessionTitle(ctxWith(branch));
    expect(getSessionTitle()).toBe("Bugfix");
  });

  test("notifies listeners once when the title latches", async () => {
    const seen: string[] = [];
    const unsubscribe = onSessionTitle((title) => seen.push(title));
    const branch = [userEntry("do something", "1")];
    sideCall.mockResolvedValue({ ok: true, answer: "Do something" });
    await ensureSessionTitle(ctxWith(branch));
    expect(seen).toEqual(["Do something"]);

    await ensureSessionTitle(ctxWith(branch));
    expect(seen).toEqual(["Do something"]);

    unsubscribe();
    resetSessionTitle();
    sideCall.mockResolvedValue({ ok: true, answer: "Again" });
    await ensureSessionTitle(ctxWith(branch));
    expect(seen).toEqual(["Do something"]);
  });

  test("concurrent ensures share one in-flight side-call", async () => {
    let resolveCall: (value: { ok: true; answer: string }) => void = () => {};
    sideCall.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCall = resolve;
        }),
    );
    const branch = [userEntry("hello", "1")];
    const ctx = ctxWith(branch);
    const first = ensureSessionTitle(ctx);
    const second = ensureSessionTitle(ctx);
    resolveCall({ ok: true, answer: "Hello" });
    await Promise.all([first, second]);
    expect(sideCall.mock.calls.length).toBe(1);
    expect(getSessionTitle()).toBe("Hello");
  });

  test("resetSessionTitle clears the latch and allows a new title", async () => {
    const branch = [userEntry("first session", "1")];
    sideCall.mockResolvedValue({ ok: true, answer: "First" });
    await ensureSessionTitle(ctxWith(branch));
    expect(getSessionTitle()).toBe("First");

    resetSessionTitle();
    expect(getSessionTitle()).toBe("");
    sideCall.mockResolvedValue({ ok: true, answer: "Second" });
    await ensureSessionTitle(ctxWith(branch));
    expect(getSessionTitle()).toBe("Second");
  });

  test("the captured first prompt feeds the side-call even with an empty branch", async () => {
    captureSessionFirstPrompt("");
    captureSessionFirstPrompt("  ");
    captureSessionFirstPrompt("first prompt");
    captureSessionFirstPrompt("second prompt");

    sideCall.mockImplementation(async (opts: { messages: Array<{ content: string }> }) => {
      expect(opts.messages[0]?.content).toContain("first prompt");
      return { ok: true, answer: "First prompt" };
    });
    await ensureSessionTitle(ctxWith());
    expect(getSessionTitle()).toBe("First prompt");
  });
});
