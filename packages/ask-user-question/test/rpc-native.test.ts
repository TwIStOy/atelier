import { describe, expect, it, vi } from "vitest";
import { DECLINE_MESSAGE, ENVELOPE_PREFIX } from "../src/tool/response-envelope.ts";
import { registerAskUserQuestionTool } from "../src/tool.ts";
import { createMockCtx, createMockPi, createMockUI, oneQuestion, runTool } from "./helpers.ts";

describe("ask_user_question — RPC native dialogs", () => {
  it("single-select drives ctx.ui.select and echoes the chosen label", async () => {
    const { tools, pi } = createMockPi();
    registerAskUserQuestionTool(pi);
    const select = vi.fn(async () => "Beta — second");
    const ctx = createMockCtx({ mode: "rpc", ui: createMockUI({ select }) });

    const res = await runTool(tools, oneQuestion(), ctx);

    expect(select).toHaveBeenCalledTimes(1);
    expect(res.details.cancelled).toBe(false);
    const answer = res.details.answers[0] as { kind: string; answer: string };
    expect(answer.kind).toBe("option");
    expect(answer.answer).toBe("Beta");
    expect(res.content[0].text).toContain('"Beta"');
    expect(res.content[0].text).toContain(ENVELOPE_PREFIX);
  });

  it("multi-select drives ctx.ui.input and parses comma-separated indices", async () => {
    const { tools, pi } = createMockPi();
    registerAskUserQuestionTool(pi);
    const input = vi.fn(async () => "1, 2");
    const ctx = createMockCtx({ mode: "rpc", ui: createMockUI({ input }) });

    const res = await runTool(tools, oneQuestion({ multiSelect: true }), ctx);

    expect(input).toHaveBeenCalledTimes(1);
    const answer = res.details.answers[0] as { kind: string; selected: string[] };
    expect(answer.kind).toBe("multi");
    expect(answer.selected).toEqual(["Alpha", "Beta"]);
    expect(res.content[0].text).toContain("Alpha, Beta");
  });

  it("cancel (dialog returns undefined) yields the decline envelope", async () => {
    const { tools, pi } = createMockPi();
    registerAskUserQuestionTool(pi);
    const select = vi.fn(async () => undefined);
    const ctx = createMockCtx({ mode: "rpc", ui: createMockUI({ select }) });

    const res = await runTool(tools, oneQuestion(), ctx);

    expect(res.content[0].text).toBe(DECLINE_MESSAGE);
    expect(res.details.cancelled).toBe(true);
  });

  it("no-UI host returns an explicit chat-fallback error", async () => {
    const { tools, pi } = createMockPi();
    registerAskUserQuestionTool(pi);
    const ctx = createMockCtx({ mode: "json", hasUI: false });

    const res = await runTool(tools, oneQuestion(), ctx);

    expect(res.details.cancelled).toBe(true);
    expect(res.details.error).toBe("no_ui");
    expect(res.content[0].text).toMatch(/ask the user/i);
  });

  it("tui mode still routes through ctx.ui.custom", async () => {
    const { tools, pi } = createMockPi();
    registerAskUserQuestionTool(pi);
    const canned = {
      answers: [{ questionIndex: 0, question: "Which option?", kind: "option", answer: "Alpha" }],
      cancelled: false,
    };
    const custom = vi.fn(async () => canned);
    const select = vi.fn(async () => "Alpha");
    const ctx = createMockCtx({ mode: "tui", ui: createMockUI({ custom, select }) });

    const res = await runTool(tools, oneQuestion(), ctx);

    expect(custom).toHaveBeenCalledTimes(1);
    expect(select).not.toHaveBeenCalled();
    expect(res.details.cancelled).toBe(false);
    expect(res.content[0].text).toContain('"Alpha"');
  });

  it("single-select folds option previews into the select title", async () => {
    const { tools, pi } = createMockPi();
    registerAskUserQuestionTool(pi);
    let title = "";
    const select = vi.fn(async (t: string) => {
      title = t;
      return "Alpha — first";
    });
    const ctx = createMockCtx({
      mode: "rpc",
      ui: createMockUI({ select }),
    });

    await runTool(tools, oneQuestion({ previews: ["alpha-mockup", "beta-mockup"] }), ctx);

    expect(select).toHaveBeenCalledTimes(1);
    expect(title).toContain("alpha-mockup");
    expect(title).toContain("beta-mockup");
  });

  it("bare option label (args-driven host) resolves to the option", async () => {
    const { tools, pi } = createMockPi();
    registerAskUserQuestionTool(pi);
    const select = vi.fn(async () => "Beta");
    const ctx = createMockCtx({ mode: "rpc", ui: createMockUI({ select }) });

    const res = await runTool(tools, oneQuestion(), ctx);

    expect(res.details.cancelled).toBe(false);
    const answer = res.details.answers[0] as { kind: string; answer: string };
    expect(answer.kind).toBe("option");
    expect(answer.answer).toBe("Beta");
  });

  it("free-text answer becomes a custom answer instead of cancelling", async () => {
    const { tools, pi } = createMockPi();
    registerAskUserQuestionTool(pi);
    const select = vi.fn(async () => "Actually, use chrono instead");
    const ctx = createMockCtx({ mode: "rpc", ui: createMockUI({ select }) });

    const res = await runTool(tools, oneQuestion(), ctx);

    expect(res.details.cancelled).toBe(false);
    const answer = res.details.answers[0] as { kind: string; answer: string };
    expect(answer.kind).toBe("custom");
    expect(answer.answer).toBe("Actually, use chrono instead");
    expect(res.content[0].text).toContain("Actually, use chrono instead");
  });

  it("single-select folds option descriptions into the dropdown and maps back to the pure label", async () => {
    const { tools, pi } = createMockPi();
    registerAskUserQuestionTool(pi);
    let options: string[] = [];
    const select = vi.fn(async (_t: string, opts: string[]) => {
      options = opts;
      return "Beta — second";
    });
    const ctx = createMockCtx({ mode: "rpc", ui: createMockUI({ select }) });

    const res = await runTool(tools, oneQuestion(), ctx);

    expect(options).toContain("Alpha — first");
    expect(options).toContain("Beta — second");
    const answer = res.details.answers[0] as { kind: string; answer: string };
    expect(answer.kind).toBe("option");
    expect(answer.answer).toBe("Beta");
  });
});
