import type { ExtensionAPI, ExtensionContext, ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";
import type { QuestionnaireState } from "../src/state/state.ts";
import type { OptionData, QuestionData, QuestionParams } from "../src/tool/types.ts";

type Tool = Record<string, unknown>;

export interface CapturedEmit {
  event: string;
  payload: unknown;
}

export function createMockPi(): {
  tools: Map<string, Tool>;
  eventsEmits: CapturedEmit[];
  pi: ExtensionAPI;
} {
  const tools = new Map<string, Tool>();
  const eventsEmits: CapturedEmit[] = [];
  const pi = {
    registerTool(tool: Tool) {
      tools.set(tool.name as string, tool);
    },
    events: {
      emit(event: string, payload: unknown) {
        eventsEmits.push({ event, payload });
      },
      on: () => {},
    },
  } as unknown as ExtensionAPI;
  return { tools, eventsEmits, pi };
}

export function createMockUI(
  overrides: { select?: unknown; input?: unknown; custom?: unknown } = {},
): ExtensionUIContext {
  return {
    select: overrides.select ?? vi.fn(),
    input: overrides.input ?? vi.fn(),
    custom: overrides.custom ?? vi.fn(),
    confirm: vi.fn(),
    notify: vi.fn(),
  } as unknown as ExtensionUIContext;
}

export function createMockCtx(
  opts: { mode?: "tui" | "rpc" | "json" | "print"; hasUI?: boolean; ui?: ExtensionUIContext } = {},
): ExtensionContext {
  return {
    mode: opts.mode ?? "rpc",
    hasUI: opts.hasUI ?? true,
    ui: opts.ui ?? createMockUI(),
  } as unknown as ExtensionContext;
}

export interface ToolResult {
  content: { type: string; text: string }[];
  details: {
    answers: unknown[];
    cancelled: boolean;
    error?: string;
  };
}

export async function runTool(
  tools: Map<string, Tool>,
  params: QuestionParams,
  ctx: ExtensionContext,
): Promise<ToolResult> {
  const tool = tools.get("ask_user_question");
  if (!tool) throw new Error("ask_user_question tool not registered");
  const execute = tool.execute as (...args: unknown[]) => Promise<ToolResult>;
  return execute("tc", params, undefined, undefined, ctx);
}

export function oneQuestion(opts: { multiSelect?: boolean; previews?: string[] } = {}): QuestionParams {
  const options: OptionData[] = [
    { label: "Alpha", description: "first" },
    { label: "Beta", description: "second" },
  ];
  if (opts.previews?.[0]) options[0].preview = opts.previews[0];
  if (opts.previews?.[1]) options[1].preview = opts.previews[1];
  const question: QuestionData = { question: "Which option?", header: "Pick", options };
  if (opts.multiSelect) question.multiSelect = true;
  return { questions: [question] };
}

/** Canonical base state for router/view tests. Override only the fields under test. */
export function baseState(overrides: Partial<QuestionnaireState> = {}): QuestionnaireState {
  return {
    currentTab: 0,
    optionIndex: 0,
    inputMode: false,
    notesVisible: false,
    answers: new Map(),
    multiSelectChecked: new Set(),
    notesByTab: new Map(),
    customDraftsByTab: new Map(),
    submitChoiceIndex: 0,
    notesDraft: "",
    ...overrides,
  };
}
