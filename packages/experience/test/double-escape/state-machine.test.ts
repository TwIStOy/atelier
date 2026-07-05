import * as assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it, type Mock, vi } from "vitest";
import { DoubleEscapeController, decideEscape } from "../../src/double-escape/state-machine.ts";

describe("decideEscape", () => {
  it("dismisses autocomplete immediately regardless of streaming/armed state", () => {
    assert.equal(decideEscape({ autocompleteShowing: true, streaming: true, armed: false }), "dismiss");
    assert.equal(decideEscape({ autocompleteShowing: true, streaming: true, armed: true }), "dismiss");
    assert.equal(decideEscape({ autocompleteShowing: true, streaming: false, armed: false }), "dismiss");
  });

  it("aborts immediately when not streaming", () => {
    assert.equal(decideEscape({ autocompleteShowing: false, streaming: false, armed: false }), "abort");
    assert.equal(decideEscape({ autocompleteShowing: false, streaming: false, armed: true }), "abort");
  });

  it("arms on the first escape while streaming", () => {
    assert.equal(decideEscape({ autocompleteShowing: false, streaming: true, armed: false }), "arm");
  });

  it("aborts on the second escape within the window", () => {
    assert.equal(decideEscape({ autocompleteShowing: false, streaming: true, armed: true }), "abort");
  });
});

function makeController(
  overrides?: Partial<{
    isStreaming: () => boolean;
    isShowingAutocomplete: () => boolean;
    debounceMs: () => number;
    onChange: Mock;
  }>,
): { controller: DoubleEscapeController; onChange: Mock } {
  const onChange = overrides?.onChange ?? vi.fn();
  const controller = new DoubleEscapeController({
    isStreaming: overrides?.isStreaming ?? (() => true),
    isShowingAutocomplete: overrides?.isShowingAutocomplete ?? (() => false),
    debounceMs: overrides?.debounceMs ?? (() => 600),
    onChange,
  });
  return { controller, onChange };
}

describe("DoubleEscapeController", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes through (abort) immediately when not streaming, never arms", () => {
    const { controller, onChange } = makeController({ isStreaming: () => false });
    assert.equal(controller.handleEscape(), "abort");
    assert.equal(controller.isArmed(), false);
    assert.equal(onChange.mock.calls.length, 0);
  });

  it("dismisses autocomplete without arming", () => {
    const { controller, onChange } = makeController({ isShowingAutocomplete: () => true });
    assert.equal(controller.handleEscape(), "dismiss");
    assert.equal(controller.isArmed(), false);
    assert.equal(onChange.mock.calls.length, 0);
  });

  it("arms on first escape while streaming and renders the hint", () => {
    const { controller, onChange } = makeController();
    assert.equal(controller.handleEscape(), "arm");
    assert.equal(controller.isArmed(), true);
    assert.equal(onChange.mock.calls.length, 1);
  });

  it("aborts on second escape within the debounce window", () => {
    const { controller, onChange } = makeController();
    controller.handleEscape();
    onChange.mockClear();
    assert.equal(controller.handleEscape(), "abort");
    assert.equal(controller.isArmed(), false);
    assert.equal(onChange.mock.calls.length, 1);
  });

  it("clears the hint and resets after the debounce window expires", () => {
    const { controller, onChange } = makeController({ debounceMs: () => 500 });
    controller.handleEscape();
    onChange.mockClear();
    vi.advanceTimersByTime(499);
    assert.equal(controller.isArmed(), true);
    assert.equal(onChange.mock.calls.length, 0);
    vi.advanceTimersByTime(1);
    assert.equal(controller.isArmed(), false);
    assert.equal(onChange.mock.calls.length, 1);
  });

  it("second escape after the window expired re-arms instead of aborting", () => {
    const { controller } = makeController({ debounceMs: () => 500 });
    controller.handleEscape();
    vi.advanceTimersByTime(500);
    assert.equal(controller.isArmed(), false);
    assert.equal(controller.handleEscape(), "arm");
    assert.equal(controller.isArmed(), true);
  });

  it("reset() clears an armed hint immediately", () => {
    const { controller, onChange } = makeController();
    controller.handleEscape();
    onChange.mockClear();
    controller.reset();
    assert.equal(controller.isArmed(), false);
    assert.equal(onChange.mock.calls.length, 1);
  });

  it("reset() is a no-op when not armed", () => {
    const { controller, onChange } = makeController();
    controller.reset();
    assert.equal(controller.isArmed(), false);
    assert.equal(onChange.mock.calls.length, 0);
  });

  it("a fresh debounce window is started on the next arm after expiry", () => {
    const { controller, onChange } = makeController({ debounceMs: () => 300 });
    controller.handleEscape();
    vi.advanceTimersByTime(300);
    onChange.mockClear();
    controller.handleEscape();
    assert.equal(controller.isArmed(), true);
    vi.advanceTimersByTime(299);
    assert.equal(controller.isArmed(), true);
    vi.advanceTimersByTime(1);
    assert.equal(controller.isArmed(), false);
  });

  it("switching to not-streaming mid-window aborts on the next escape", () => {
    let streaming = true;
    const { controller } = makeController({ isStreaming: () => streaming });
    controller.handleEscape();
    streaming = false;
    assert.equal(controller.handleEscape(), "abort");
    assert.equal(controller.isArmed(), false);
  });
});
