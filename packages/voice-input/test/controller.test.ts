import { describe, expect, it, vi } from "vitest";
import type { FlowContext } from "../src/flow.ts";
import { VoiceInputController, type VoiceInputFlowLike } from "../src/index.ts";

interface FakeFlow {
  startRecording: ReturnType<typeof vi.fn>;
  finalizeRecording: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
}

function makeFakeFlow(): FakeFlow {
  return {
    startRecording: vi.fn(async () => {}),
    finalizeRecording: vi.fn(async () => ({ inserted: true })),
    cancel: vi.fn(async () => {}),
  };
}

function asFlowLike(flow: FakeFlow): VoiceInputFlowLike {
  return flow as unknown as VoiceInputFlowLike;
}

function makeController(flow: FakeFlow): VoiceInputController {
  return new VoiceInputController(vi.fn(async () => asFlowLike(flow)));
}

function makeCtx(): {
  ctx: FlowContext;
  calls: { widgets: string[]; notifies: string[] };
} {
  const calls = { widgets: [] as string[], notifies: [] as string[] };
  return {
    calls,
    ctx: {
      ui: {
        setWidget(_key: string, content: string[] | undefined) {
          calls.widgets.push(content ? content.join("|") : "<cleared>");
        },
        getEditorText() {
          return "";
        },
        setEditorText() {},
        notify(message: string) {
          calls.notifies.push(message);
        },
      },
    },
  };
}

describe("VoiceInputController.toggle — start", () => {
  it("creates a flow and starts recording when idle", async () => {
    const flow = makeFakeFlow();
    const newFlow = vi.fn(async () => asFlowLike(flow));
    const ctrl = new VoiceInputController(newFlow);
    const { ctx } = makeCtx();
    expect(ctrl.isRecording()).toBe(false);
    await ctrl.toggle(ctx);
    expect(newFlow).toHaveBeenCalledWith(ctx);
    expect(flow.startRecording).toHaveBeenCalledTimes(1);
    expect(ctrl.isRecording()).toBe(true);
  });

  it("does not clear the widget on a successful start", async () => {
    const flow = makeFakeFlow();
    const ctrl = makeController(flow);
    const { ctx, calls } = makeCtx();
    await ctrl.toggle(ctx);
    expect(calls.widgets).not.toContain("<cleared>");
  });
});

describe("VoiceInputController.toggle — stop", () => {
  it("finalizes the active recording and returns to idle", async () => {
    const flow = makeFakeFlow();
    const ctrl = makeController(flow);
    const { ctx } = makeCtx();
    await ctrl.toggle(ctx);
    expect(ctrl.isRecording()).toBe(true);
    await ctrl.toggle(ctx);
    expect(flow.finalizeRecording).toHaveBeenCalledTimes(1);
    expect(ctrl.isRecording()).toBe(false);
  });

  it("nulls the flow BEFORE awaiting finalize (reentrancy-safe)", async () => {
    const flow = makeFakeFlow();
    let resolveFinalize!: () => void;
    flow.finalizeRecording.mockReturnValue(
      new Promise<unknown>((r) => {
        resolveFinalize = () => r(undefined);
      }),
    );
    const ctrl = makeController(flow);
    const { ctx } = makeCtx();
    await ctrl.toggle(ctx);
    expect(ctrl.isRecording()).toBe(true);

    const secondToggle = ctrl.toggle(ctx);
    expect(ctrl.isRecording()).toBe(false);
    resolveFinalize();
    await secondToggle;
    expect(flow.finalizeRecording).toHaveBeenCalledTimes(1);
  });
});

describe("VoiceInputController.toggle — failure paths", () => {
  it("cleans up and notifies when startRecording fails", async () => {
    const flow = makeFakeFlow();
    flow.startRecording.mockRejectedValueOnce(new Error("mic busy"));
    const ctrl = makeController(flow);
    const { ctx, calls } = makeCtx();
    await ctrl.toggle(ctx);
    expect(flow.cancel).toHaveBeenCalledTimes(1);
    expect(ctrl.isRecording()).toBe(false);
    expect(calls.widgets.at(-1)).toBe("<cleared>");
    expect(calls.notifies[0]).toMatch(/Voice toggle failed.*mic busy/);
  });

  it("notifies and returns to idle when finalizeRecording fails", async () => {
    const flow = makeFakeFlow();
    flow.finalizeRecording.mockRejectedValueOnce(new Error("transcribe failed"));
    const ctrl = makeController(flow);
    const { ctx, calls } = makeCtx();
    await ctrl.toggle(ctx);
    await ctrl.toggle(ctx);
    expect(ctrl.isRecording()).toBe(false);
    expect(calls.notifies[0]).toMatch(/Voice toggle failed.*transcribe failed/);
  });

  it("rethrows nothing (swallows) and resets when newFlow rejects", async () => {
    const ctrl = new VoiceInputController(
      vi.fn(async () => {
        throw new Error("missing_api_key: no key");
      }),
    );
    const { ctx, calls } = makeCtx();
    await ctrl.toggle(ctx);
    expect(ctrl.isRecording()).toBe(false);
    expect(calls.notifies[0]).toMatch(/missing_api_key/);
  });

  it("redacts secrets in the failure notification", async () => {
    const flow = makeFakeFlow();
    flow.startRecording.mockRejectedValueOnce(new Error("Authorization: Bearer sk-leak failed"));
    const ctrl = makeController(flow);
    const { ctx, calls } = makeCtx();
    await ctrl.toggle(ctx);
    expect(calls.notifies[0]).not.toContain("sk-leak");
    expect(calls.notifies[0]).toContain("<redacted>");
  });
});

describe("VoiceInputController.cancel", () => {
  it("cancels an active recording and returns to idle", async () => {
    const flow = makeFakeFlow();
    const ctrl = makeController(flow);
    const { ctx, calls } = makeCtx();
    await ctrl.toggle(ctx);
    await ctrl.cancel(ctx);
    expect(flow.cancel).toHaveBeenCalledTimes(1);
    expect(ctrl.isRecording()).toBe(false);
    expect(calls.widgets.at(-1)).toBe("<cleared>");
    expect(calls.notifies.at(-1)).toMatch(/cancelled/i);
  });

  it("is a safe no-op when idle", async () => {
    const ctrl = new VoiceInputController(vi.fn());
    const { ctx, calls } = makeCtx();
    await expect(ctrl.cancel(ctx)).resolves.toBeUndefined();
    expect(ctrl.isRecording()).toBe(false);
    expect(calls.notifies.at(-1)).toMatch(/cancelled/i);
  });

  it("nulls the flow before awaiting cancel (reentrancy-safe)", async () => {
    const flow = makeFakeFlow();
    let resolveCancel!: () => void;
    flow.cancel.mockReturnValue(
      new Promise<void>((r) => {
        resolveCancel = () => r();
      }),
    );
    const ctrl = makeController(flow);
    const { ctx } = makeCtx();
    await ctrl.toggle(ctx);
    const cancelPromise = ctrl.cancel(ctx);
    expect(ctrl.isRecording()).toBe(false);
    resolveCancel();
    await cancelPromise;
  });
});

describe("VoiceInputController.reset", () => {
  it("clears active flow state", async () => {
    const flow = makeFakeFlow();
    const ctrl = makeController(flow);
    const { ctx } = makeCtx();
    await ctrl.toggle(ctx);
    expect(ctrl.isRecording()).toBe(true);
    ctrl.reset();
    expect(ctrl.isRecording()).toBe(false);
  });
});
