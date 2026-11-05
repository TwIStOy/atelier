const epochPatchedTuis = new WeakSet<object>();
let frameEpoch = 0;

export function currentFrameEpoch(): number {
  return frameEpoch;
}

// One bump per rendered frame, driven by the TUI's doRender. Within a frame no
// component state changes, so frame-scoped memos need no finer invalidation.
// The counter is shared across extensions so several frame-scoped caches key on
// one number; patching the same TUI instance twice is a no-op.
export function patchTuiFrameEpoch(tui: unknown): void {
  if (!tui || typeof tui !== "object" || epochPatchedTuis.has(tui)) return;
  const target = tui as { doRender?: unknown };
  if (typeof target.doRender !== "function") return;
  const original = target.doRender as (this: unknown) => void;
  target.doRender = function (this: unknown) {
    frameEpoch++;
    original.call(this);
  };
  epochPatchedTuis.add(tui);
}
