import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  ASK_USER_BLOCKED_EVENT,
  ASK_USER_PROMPT_EVENT,
  GOAL_UPDATE_EVENT,
  MODAL_ACTIVE_EVENT,
} from "@htwang-contrib/common";
import { describe, expect, test, vi } from "vitest";
import type { QuestionnaireResult, QuestionParams } from "../src/tool/types.ts";
import { registerAskUserQuestionTool } from "../src/tool.ts";

interface EmittedEvent {
  name: string;
  payload: unknown;
}

interface RegisteredTool {
  execute: (
    toolCallId: string,
    params: unknown,
    signal: unknown,
    onUpdate: unknown,
    ctx: ExtensionContext,
  ) => Promise<unknown>;
}

function harness() {
  const emitted: EmittedEvent[] = [];
  const subscribers = new Map<string, Array<(data: unknown) => void>>();
  const pi = {
    events: {
      emit: (name: string, payload?: unknown) => {
        emitted.push({ name, payload });
      },
      on: (name: string, handler: (data: unknown) => void) => {
        const list = subscribers.get(name) ?? [];
        list.push(handler);
        subscribers.set(name, list);
      },
    },
    registerTool: (def: RegisteredTool) => {
      captured = def;
    },
  } as unknown as ExtensionAPI;
  let captured: RegisteredTool | undefined;
  registerAskUserQuestionTool(pi);
  if (!captured) throw new Error("tool was not registered");
  const dispatchGoalUpdate = (payload: unknown) => {
    for (const handler of subscribers.get(GOAL_UPDATE_EVENT) ?? []) handler(payload);
  };
  return { pi, emitted, tool: captured, dispatchGoalUpdate };
}

function mockCtx(customImpl: () => Promise<QuestionnaireResult | null>): ExtensionContext {
  return {
    hasUI: true,
    ui: {
      custom: vi.fn(customImpl),
    },
  } as unknown as ExtensionContext;
}

function mockRpcCtx(selectImpl: (title: string, displays: string[]) => Promise<string | undefined>): ExtensionContext {
  return {
    hasUI: true,
    mode: "rpc",
    ui: {
      select: vi.fn(selectImpl),
    },
  } as unknown as ExtensionContext;
}

const VALID_PARAMS: QuestionParams = {
  questions: [
    {
      question: "Which option?",
      header: "Choice",
      options: [
        { label: "Alpha", description: "first" },
        { label: "Beta", description: "second" },
      ],
    },
  ],
};

function namesOf(events: EmittedEvent[]): string[] {
  return events.map((e) => e.name);
}

function blockedPayloads(events: EmittedEvent[]): unknown[] {
  return events.filter((e) => e.name === ASK_USER_BLOCKED_EVENT).map((e) => e.payload);
}

describe("ask_user_question: blocked state event", () => {
  test("confirm path emits paired blocked events in order prompt -> blocked(true) -> blocked(false)", async () => {
    const { emitted, tool } = harness();
    const result: QuestionnaireResult = {
      answers: [{ questionIndex: 0, question: "Which option?", kind: "option", answer: "Alpha" }],
      cancelled: false,
    };
    const ctx = mockCtx(async () => result);

    await tool.execute("call-1", VALID_PARAMS, undefined, undefined, ctx);

    const names = namesOf(emitted);
    const promptIdx = names.indexOf(ASK_USER_PROMPT_EVENT);
    const blockedTrueIdx = names.indexOf(ASK_USER_BLOCKED_EVENT);
    const blockedFalseIdx = names.lastIndexOf(ASK_USER_BLOCKED_EVENT);

    expect(promptIdx).toBeGreaterThanOrEqual(0);
    expect(blockedTrueIdx).toBeGreaterThan(promptIdx);
    expect(blockedFalseIdx).toBeGreaterThan(blockedTrueIdx);
    expect(blockedPayloads(emitted)).toEqual([{ active: true }, { active: false }]);
  });

  test("cancel path still emits paired blocked(false) in finally", async () => {
    const { emitted, tool } = harness();
    const ctx = mockCtx(async () => ({ answers: [], cancelled: true }));

    await tool.execute("call-1", VALID_PARAMS, undefined, undefined, ctx);

    expect(blockedPayloads(emitted)).toEqual([{ active: true }, { active: false }]);
  });

  test("null result path still emits paired blocked(false) in finally", async () => {
    const { emitted, tool } = harness();
    const ctx = mockCtx(async () => null);

    await tool.execute("call-1", VALID_PARAMS, undefined, undefined, ctx);

    expect(blockedPayloads(emitted)).toEqual([{ active: true }, { active: false }]);
  });

  test("UI-throw path still emits blocked(false) in finally", async () => {
    const { emitted, tool } = harness();
    const ctx = mockCtx(async () => {
      throw new Error("UI blew up");
    });

    await expect(tool.execute("call-1", VALID_PARAMS, undefined, undefined, ctx)).rejects.toThrow("UI blew up");

    expect(blockedPayloads(emitted)).toEqual([{ active: true }, { active: false }]);
  });

  test("modal-active brackets the custom call alongside blocked", async () => {
    const { emitted, tool } = harness();
    const ctx = mockCtx(async () => ({ answers: [], cancelled: true }));

    await tool.execute("call-1", VALID_PARAMS, undefined, undefined, ctx);

    expect(namesOf(emitted)).toEqual([
      ASK_USER_PROMPT_EVENT,
      ASK_USER_BLOCKED_EVENT,
      MODAL_ACTIVE_EVENT,
      MODAL_ACTIVE_EVENT,
      ASK_USER_BLOCKED_EVENT,
    ]);
    const modalPayloads = emitted.filter((e) => e.name === MODAL_ACTIVE_EVENT).map((e) => e.payload);
    expect(modalPayloads).toEqual([true, false]);
  });

  test("no-UI path does not emit blocked events", async () => {
    const { emitted, tool } = harness();
    const ctx = { hasUI: false } as unknown as ExtensionContext;

    await tool.execute("call-1", VALID_PARAMS, undefined, undefined, ctx);

    expect(blockedPayloads(emitted)).toEqual([]);
  });

  test("RPC path emits paired blocked events on confirm", async () => {
    const { emitted, tool } = harness();
    const ctx = mockRpcCtx(async () => "Alpha — first");

    await tool.execute("call-1", VALID_PARAMS, undefined, undefined, ctx);

    expect(blockedPayloads(emitted)).toEqual([{ active: true }, { active: false }]);
    const names = namesOf(emitted);
    expect(names.indexOf(ASK_USER_PROMPT_EVENT)).toBeLessThan(names.indexOf(ASK_USER_BLOCKED_EVENT));
  });

  test("RPC path emits paired blocked(false) on cancel", async () => {
    const { emitted, tool } = harness();
    const ctx = mockRpcCtx(async () => undefined);

    await tool.execute("call-1", VALID_PARAMS, undefined, undefined, ctx);

    expect(blockedPayloads(emitted)).toEqual([{ active: true }, { active: false }]);
  });
});

describe("ask_user_question: goal mode guard", () => {
  test("refuses without opening the modal while the goal is active", async () => {
    const { emitted, tool, dispatchGoalUpdate } = harness();
    dispatchGoalUpdate({ status: "active" });
    const custom = vi.fn(async () => ({ answers: [], cancelled: true }) as QuestionnaireResult);
    const ctx = { hasUI: true, ui: { custom } } as unknown as ExtensionContext;

    const result = (await tool.execute("call-1", VALID_PARAMS, undefined, undefined, ctx)) as {
      content: { type: string; text: string }[];
      details: { answers: unknown[]; cancelled: boolean; error?: string };
      isError?: boolean;
    };

    expect(custom).not.toHaveBeenCalled();
    expect(result.isError).toBeUndefined();
    expect(result.details).toEqual({ answers: [], cancelled: true, error: "goal_mode" });
    const text = result.content[0].text;
    expect(text).toContain("Do not retry");
    expect(text).toContain("reasonable default decision");
    expect(text).toContain("pause the goal");
    expect(namesOf(emitted)).toEqual([]);
  });

  test.each(["paused", "budgetLimited", "complete", null] as const)(
    "opens the modal normally when the goal is %s",
    async (payload) => {
      const { emitted, tool, dispatchGoalUpdate } = harness();
      dispatchGoalUpdate(payload === null ? null : { status: payload });
      const ctx = mockCtx(async () => ({ answers: [], cancelled: true }));

      await tool.execute("call-1", VALID_PARAMS, undefined, undefined, ctx);

      expect(ctx.ui.custom).toHaveBeenCalled();
      expect(namesOf(emitted)).toContain(MODAL_ACTIVE_EVENT);
    },
  );

  test("behaves as today when no goal event was ever received", async () => {
    const { emitted, tool } = harness();
    const ctx = mockCtx(async () => ({ answers: [], cancelled: true }));

    await tool.execute("call-1", VALID_PARAMS, undefined, undefined, ctx);

    expect(ctx.ui.custom).toHaveBeenCalled();
    expect(namesOf(emitted)).toContain(ASK_USER_PROMPT_EVENT);
  });

  test("an active goal followed by a non-active update re-enables the modal", async () => {
    const { emitted, tool, dispatchGoalUpdate } = harness();
    dispatchGoalUpdate({ status: "active" });
    dispatchGoalUpdate({ status: "paused" });
    const ctx = mockCtx(async () => ({ answers: [], cancelled: true }));

    await tool.execute("call-1", VALID_PARAMS, undefined, undefined, ctx);

    expect(ctx.ui.custom).toHaveBeenCalled();
    expect(namesOf(emitted)).toContain(ASK_USER_PROMPT_EVENT);
  });
});
