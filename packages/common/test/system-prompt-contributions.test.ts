import type { BeforeAgentStartEvent, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, test } from "vitest";
import {
  applySystemPromptContributions,
  clearSystemPromptContributions,
  installSystemPromptAssembler,
  listSystemPromptContributions,
  registerSystemPromptContribution,
  SYSTEM_PROMPT_CONTRIBUTION_PRIORITIES,
  unregisterSystemPromptContribution,
} from "../src/system-prompt-contributions.ts";

const documentedPriorities = {
  subagents: 100,
  memory: 200,
  "inject-prompt-by-model": 300,
} as const;

afterEach(() => {
  clearSystemPromptContributions();
});

function fakeEvent(systemPrompt = "BASE"): BeforeAgentStartEvent {
  return {
    type: "before_agent_start",
    messageType: "user",
    prompt: "hi",
    systemPrompt,
    systemPromptOptions: {} as BeforeAgentStartEvent["systemPromptOptions"],
  };
}

const fakeCtx = {} as ExtensionContext;

function mockPi(): {
  pi: Pick<ExtensionAPI, "on">;
  handlers: Array<(event: BeforeAgentStartEvent, ctx: ExtensionContext) => unknown>;
} {
  const handlers: Array<(event: BeforeAgentStartEvent, ctx: ExtensionContext) => unknown> = [];
  const pi = {
    on(event: string, handler: (event: BeforeAgentStartEvent, ctx: ExtensionContext) => unknown) {
      if (event === "before_agent_start") handlers.push(handler);
    },
  };
  return { pi: pi as Pick<ExtensionAPI, "on">, handlers };
}

describe("SYSTEM_PROMPT_CONTRIBUTION_PRIORITIES", () => {
  test("matches the documented ledger", () => {
    expect(SYSTEM_PROMPT_CONTRIBUTION_PRIORITIES).toEqual(documentedPriorities);
  });
});

describe("registerSystemPromptContribution", () => {
  test("rejects an empty id", () => {
    const { pi } = mockPi();
    expect(() => registerSystemPromptContribution(pi, { id: "  ", priority: 10, contribute: () => "x" })).toThrow(
      /non-empty/,
    );
  });

  test("rejects a non-finite priority", () => {
    const { pi } = mockPi();
    expect(() =>
      registerSystemPromptContribution(pi, { id: "custom", priority: Number.NaN, contribute: () => "x" }),
    ).toThrow(/finite number/);
  });

  test("rejects a documented id with the wrong priority", () => {
    const { pi } = mockPi();
    expect(() => registerSystemPromptContribution(pi, { id: "memory", priority: 1, contribute: () => "x" })).toThrow(
      /does not match documented 200/,
    );
  });

  test("accepts a documented id with the ledger priority", () => {
    const { pi } = mockPi();
    registerSystemPromptContribution(pi, {
      id: "memory",
      priority: SYSTEM_PROMPT_CONTRIBUTION_PRIORITIES.memory,
      contribute: () => "mem",
    });
    expect(listSystemPromptContributions().map((c) => c.id)).toEqual(["memory"]);
  });

  test("upserts the same id", () => {
    const { pi } = mockPi();
    registerSystemPromptContribution(pi, { id: "custom", priority: 10, contribute: () => "first" });
    registerSystemPromptContribution(pi, { id: "custom", priority: 20, contribute: () => "second" });
    const listed = listSystemPromptContributions();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.priority).toBe(20);
  });
});

describe("applySystemPromptContributions", () => {
  test("returns undefined when nothing is registered", async () => {
    expect(await applySystemPromptContributions(fakeEvent(), fakeCtx)).toBeUndefined();
  });

  test("sorts by priority then id and appends with blank lines", async () => {
    const { pi } = mockPi();
    registerSystemPromptContribution(pi, { id: "b", priority: 20, contribute: () => "B" });
    registerSystemPromptContribution(pi, { id: "a", priority: 10, contribute: () => "A" });
    registerSystemPromptContribution(pi, { id: "c", priority: 20, contribute: () => "C" });
    expect(await applySystemPromptContributions(fakeEvent(), fakeCtx)).toBe("BASE\n\nA\n\nB\n\nC");
  });

  test("skips null, undefined, and whitespace-only results", async () => {
    const { pi } = mockPi();
    registerSystemPromptContribution(pi, { id: "n", priority: 1, contribute: () => null });
    registerSystemPromptContribution(pi, { id: "u", priority: 2, contribute: () => undefined });
    registerSystemPromptContribution(pi, { id: "w", priority: 3, contribute: () => "  \n" });
    registerSystemPromptContribution(pi, { id: "ok", priority: 4, contribute: () => "keep" });
    expect(await applySystemPromptContributions(fakeEvent(), fakeCtx)).toBe("BASE\n\nkeep");
  });

  test("awaits async callbacks", async () => {
    const { pi } = mockPi();
    registerSystemPromptContribution(pi, {
      id: "async",
      priority: 1,
      contribute: async () => "later",
    });
    expect(await applySystemPromptContributions(fakeEvent(), fakeCtx)).toBe("BASE\n\nlater");
  });

  test("skips a throwing contribution and keeps the rest", async () => {
    const { pi } = mockPi();
    registerSystemPromptContribution(pi, {
      id: "boom",
      priority: 1,
      contribute: () => {
        throw new Error("nope");
      },
    });
    registerSystemPromptContribution(pi, { id: "ok", priority: 2, contribute: () => "kept" });
    expect(await applySystemPromptContributions(fakeEvent(), fakeCtx)).toBe("BASE\n\nkept");
  });

  test("unregister removes a contribution", async () => {
    const { pi } = mockPi();
    registerSystemPromptContribution(pi, { id: "gone", priority: 1, contribute: () => "x" });
    unregisterSystemPromptContribution("gone");
    expect(await applySystemPromptContributions(fakeEvent(), fakeCtx)).toBeUndefined();
  });

  test("replace overwrites the current prompt", async () => {
    const { pi } = mockPi();
    registerSystemPromptContribution(pi, {
      id: "swap",
      priority: 1,
      mode: "replace",
      contribute: () => "NEW",
    });
    expect(await applySystemPromptContributions(fakeEvent(), fakeCtx)).toBe("NEW");
  });

  test("later appends apply after a replace", async () => {
    const { pi } = mockPi();
    registerSystemPromptContribution(pi, {
      id: "swap",
      priority: 1,
      mode: "replace",
      contribute: () => "NEW",
    });
    registerSystemPromptContribution(pi, { id: "tail", priority: 2, contribute: () => "TAIL" });
    expect(await applySystemPromptContributions(fakeEvent(), fakeCtx)).toBe("NEW\n\nTAIL");
  });

  test("a later replace discards earlier appends", async () => {
    const { pi } = mockPi();
    registerSystemPromptContribution(pi, { id: "head", priority: 1, contribute: () => "HEAD" });
    registerSystemPromptContribution(pi, {
      id: "swap",
      priority: 2,
      mode: "replace",
      contribute: (event) => event.systemPrompt.replace("HEAD", "GONE"),
    });
    expect(await applySystemPromptContributions(fakeEvent(), fakeCtx)).toBe("BASE\n\nGONE");
  });

  test("the later replace wins when two replace", async () => {
    const { pi } = mockPi();
    registerSystemPromptContribution(pi, {
      id: "first",
      priority: 1,
      mode: "replace",
      contribute: () => "FIRST",
    });
    registerSystemPromptContribution(pi, {
      id: "second",
      priority: 2,
      mode: "replace",
      contribute: () => "SECOND",
    });
    expect(await applySystemPromptContributions(fakeEvent(), fakeCtx)).toBe("SECOND");
  });

  test("replace returning null sits out", async () => {
    const { pi } = mockPi();
    registerSystemPromptContribution(pi, {
      id: "swap",
      priority: 1,
      mode: "replace",
      contribute: () => null,
    });
    registerSystemPromptContribution(pi, { id: "tail", priority: 2, contribute: () => "TAIL" });
    expect(await applySystemPromptContributions(fakeEvent(), fakeCtx)).toBe("BASE\n\nTAIL");
  });

  test("rejects an invalid mode", () => {
    const { pi } = mockPi();
    expect(() =>
      registerSystemPromptContribution(pi, {
        id: "bad",
        priority: 1,
        mode: "merge" as "append",
        contribute: () => "x",
      }),
    ).toThrow(/mode must be "append" or "replace"/);
  });
});

describe("installSystemPromptAssembler", () => {
  test("is idempotent on the same pi instance", () => {
    const { pi, handlers } = mockPi();
    installSystemPromptAssembler(pi);
    installSystemPromptAssembler(pi);
    expect(handlers).toHaveLength(1);
  });

  test("appends collected contributions to the current system prompt", async () => {
    const { pi, handlers } = mockPi();
    registerSystemPromptContribution(pi, { id: "a", priority: 1, contribute: () => "A" });
    registerSystemPromptContribution(pi, { id: "b", priority: 2, contribute: () => "B" });
    expect(handlers).toHaveLength(1);
    const result = await handlers[0]?.(fakeEvent("BASE"), fakeCtx);
    expect(result).toEqual({ systemPrompt: "BASE\n\nA\n\nB" });
  });

  test("returns undefined when every contribution sits out", async () => {
    const { pi, handlers } = mockPi();
    registerSystemPromptContribution(pi, { id: "skip", priority: 1, contribute: () => null });
    const result = await handlers[0]?.(fakeEvent("BASE"), fakeCtx);
    expect(result).toBeUndefined();
  });
});
