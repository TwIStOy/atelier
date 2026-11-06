import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@htwang-contrib/common/extension-disable", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@htwang-contrib/common/extension-disable")>();
  return {
    ...actual,
    isExtensionDisabled: () => false,
  };
});

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import factory from "../src/index.ts";
import { reconcileAskUserQuestionTool, registerAskUserQuestionReconciler } from "../src/reconcile.ts";
import { ASK_USER_QUESTION_TOOL_NAME } from "../src/tool.ts";

type Handler = (event: unknown, ctx: ExtensionContext) => unknown;

interface MockState {
  pi: ExtensionAPI;
  activeTools: string[];
  registeredTools: Map<string, unknown>;
  handlers: Map<string, Handler>;
}

const OTHER_TOOL = "other";

function ctx(overrides: Partial<ExtensionContext> = {}): ExtensionContext {
  return { hasUI: true, mode: "tui", ...overrides } as unknown as ExtensionContext;
}

function buildPi(initialActive: string[] = []): MockState {
  const activeTools = [...initialActive];
  const registeredTools = new Map<string, unknown>();
  const handlers = new Map<string, Handler>();
  const pi = {
    registerTool(def: { name: string }) {
      registeredTools.set(def.name, def);
      if (!activeTools.includes(def.name)) activeTools.push(def.name);
    },
    getActiveTools: () => [...activeTools],
    setActiveTools(names: string[]) {
      activeTools.length = 0;
      activeTools.push(...names);
    },
    on(event: string, handler: Handler) {
      handlers.set(event, handler);
    },
    events: { emit: () => {}, on: () => {} },
  };
  return { pi: pi as unknown as ExtensionAPI, activeTools, registeredTools, handlers };
}

describe("reconcileAskUserQuestionTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("strips the tool when !hasUI and the tool is active", () => {
    const { pi } = buildPi([ASK_USER_QUESTION_TOOL_NAME, OTHER_TOOL]);
    const setSpy = vi.spyOn(pi, "setActiveTools");
    reconcileAskUserQuestionTool(pi, ctx({ hasUI: false, mode: "print" }));
    expect(setSpy).toHaveBeenCalledWith([OTHER_TOOL]);
    expect(pi.getActiveTools()).toEqual([OTHER_TOOL]);
  });

  it("no-ops when !hasUI and the tool is already absent", () => {
    const { pi } = buildPi([OTHER_TOOL]);
    const setSpy = vi.spyOn(pi, "setActiveTools");
    reconcileAskUserQuestionTool(pi, ctx({ hasUI: false, mode: "json" }));
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("restores the tool when hasUI and the tool is absent", () => {
    const { pi } = buildPi([OTHER_TOOL]);
    const setSpy = vi.spyOn(pi, "setActiveTools");
    reconcileAskUserQuestionTool(pi, ctx({ hasUI: true, mode: "tui" }));
    expect(setSpy).toHaveBeenCalledWith([OTHER_TOOL, ASK_USER_QUESTION_TOOL_NAME]);
    expect(pi.getActiveTools()).toEqual([OTHER_TOOL, ASK_USER_QUESTION_TOOL_NAME]);
  });

  it("no-ops when hasUI and the tool is already active", () => {
    const { pi } = buildPi([ASK_USER_QUESTION_TOOL_NAME, OTHER_TOOL]);
    const setSpy = vi.spyOn(pi, "setActiveTools");
    reconcileAskUserQuestionTool(pi, ctx({ hasUI: true, mode: "tui" }));
    expect(setSpy).not.toHaveBeenCalled();
  });

  it("does not clobber sibling tools on strip", () => {
    const { pi } = buildPi([ASK_USER_QUESTION_TOOL_NAME, OTHER_TOOL]);
    reconcileAskUserQuestionTool(pi, ctx({ hasUI: false, mode: "print" }));
    expect(pi.getActiveTools()).toEqual([OTHER_TOOL]);
  });

  it("does not clobber sibling tools on restore", () => {
    const { pi } = buildPi([OTHER_TOOL]);
    reconcileAskUserQuestionTool(pi, ctx({ hasUI: true, mode: "tui" }));
    expect(pi.getActiveTools()).toEqual([OTHER_TOOL, ASK_USER_QUESTION_TOOL_NAME]);
  });

  it("strip then restore round-trips back to present", () => {
    const { pi } = buildPi([ASK_USER_QUESTION_TOOL_NAME, OTHER_TOOL]);
    reconcileAskUserQuestionTool(pi, ctx({ hasUI: false, mode: "print" }));
    expect(pi.getActiveTools()).toEqual([OTHER_TOOL]);
    reconcileAskUserQuestionTool(pi, ctx({ hasUI: true, mode: "tui" }));
    expect(pi.getActiveTools()).toEqual([OTHER_TOOL, ASK_USER_QUESTION_TOOL_NAME]);
  });

  it("is idempotent in stripped mode (one setActiveTools, stable set)", () => {
    const { pi } = buildPi([ASK_USER_QUESTION_TOOL_NAME, OTHER_TOOL]);
    const setSpy = vi.spyOn(pi, "setActiveTools");
    const noUi = ctx({ hasUI: false, mode: "print" });
    reconcileAskUserQuestionTool(pi, noUi);
    reconcileAskUserQuestionTool(pi, noUi);
    expect(setSpy).toHaveBeenCalledTimes(1);
    expect(pi.getActiveTools()).toEqual([OTHER_TOOL]);
  });

  it("is idempotent in restored mode (zero setActiveTools, stable set)", () => {
    const { pi } = buildPi([ASK_USER_QUESTION_TOOL_NAME, OTHER_TOOL]);
    const setSpy = vi.spyOn(pi, "setActiveTools");
    const withUi = ctx({ hasUI: true, mode: "tui" });
    reconcileAskUserQuestionTool(pi, withUi);
    reconcileAskUserQuestionTool(pi, withUi);
    expect(setSpy).not.toHaveBeenCalled();
    expect(pi.getActiveTools()).toEqual([ASK_USER_QUESTION_TOOL_NAME, OTHER_TOOL]);
  });

  it("keys only off hasUI, not mode (RPC hasUI:true keeps the tool)", () => {
    const { pi } = buildPi([ASK_USER_QUESTION_TOOL_NAME, OTHER_TOOL]);
    const setSpy = vi.spyOn(pi, "setActiveTools");
    reconcileAskUserQuestionTool(pi, ctx({ hasUI: true, mode: "rpc" }));
    expect(setSpy).not.toHaveBeenCalled();
    expect(pi.getActiveTools()).toEqual([ASK_USER_QUESTION_TOOL_NAME, OTHER_TOOL]);
  });
});

describe("registerAskUserQuestionReconciler", () => {
  it("registers exactly one before_agent_start handler", () => {
    const { pi, handlers } = buildPi();
    registerAskUserQuestionReconciler(pi);
    expect(handlers.get("before_agent_start")).toBeTruthy();
  });

  it("invoking the handler with !hasUI strips the tool", () => {
    const { pi, handlers } = buildPi([ASK_USER_QUESTION_TOOL_NAME, OTHER_TOOL]);
    registerAskUserQuestionReconciler(pi);
    const handler = handlers.get("before_agent_start")!;
    vi.spyOn(pi, "setActiveTools").mockClear();
    handler(undefined, ctx({ hasUI: false, mode: "print" }));
    expect(pi.setActiveTools).toHaveBeenCalledWith([OTHER_TOOL]);
  });

  it("invoking the handler with hasUI restores the tool", () => {
    const { pi, handlers } = buildPi([OTHER_TOOL]);
    registerAskUserQuestionReconciler(pi);
    const handler = handlers.get("before_agent_start")!;
    handler(undefined, ctx({ hasUI: true, mode: "tui" }));
    expect(pi.getActiveTools()).toEqual([OTHER_TOOL, ASK_USER_QUESTION_TOOL_NAME]);
  });
});

describe("factory wiring (index.ts default export)", () => {
  it("registers the tool and attaches the before_agent_start reconciler", async () => {
    const { pi, registeredTools, handlers } = buildPi();
    factory(pi);
    expect(registeredTools.has(ASK_USER_QUESTION_TOOL_NAME)).toBe(true);
    expect(pi.getActiveTools()).toContain(ASK_USER_QUESTION_TOOL_NAME);
    expect(handlers.get("before_agent_start")).toBeTruthy();
  });
});
