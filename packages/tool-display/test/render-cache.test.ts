import { patchTuiFrameEpoch } from "@htwang-contrib/common";
import { describe, expect, it, vi } from "vitest";
import {
  bumpComponentState,
  bumpRenderEnv,
  bumpRoleMutation,
  cachedTextOutput,
  componentStateVersion,
  currentRenderEnvVersion,
  getCachedRenderLines,
  memoizedGroupRole,
  memoizedRegionBounds,
  type RenderLinesKey,
  setCachedRenderLines,
} from "../src/render-cache.ts";

function baseKey(overrides: Partial<RenderLinesKey> = {}): RenderLinesKey {
  return {
    width: 80,
    probed: false,
    stateVersion: 0,
    hovered: false,
    headerAnnotation: undefined,
    roleSummary: "none",
    prevIsTool: false,
    prevHasRailTail: false,
    spinTick: 0,
    timerLabel: undefined,
    theme: null,
    envVersion: 0,
    configVersion: 0,
    deltaVersion: 0,
    ...overrides,
  };
}

describe("component state versions", () => {
  it("increments per component independently", () => {
    const a = {};
    const b = {};
    expect(componentStateVersion(a)).toBe(0);
    bumpComponentState(a);
    bumpComponentState(a);
    bumpComponentState(b);
    expect(componentStateVersion(a)).toBe(2);
    expect(componentStateVersion(b)).toBe(1);
  });
});

describe("memoizedGroupRole", () => {
  it("computes once per frame and reuses within the same frame", () => {
    const component = {};
    const compute = vi.fn(() => "role-a");
    expect(memoizedGroupRole(component, 80, compute)).toBe("role-a");
    expect(memoizedGroupRole(component, 80, compute)).toBe("role-a");
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("recomputes when the width changes", () => {
    const component = {};
    const compute = vi.fn(() => "role-a");
    memoizedGroupRole(component, 80, compute);
    memoizedGroupRole(component, 120, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("recomputes after a role mutation bump even within one frame", () => {
    const component = {};
    const compute = vi.fn(() => "role-a");
    memoizedGroupRole(component, 80, compute);
    bumpRoleMutation();
    memoizedGroupRole(component, 80, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("recomputes after a component state bump", () => {
    const component = {};
    const compute = vi.fn(() => "role-a");
    memoizedGroupRole(component, 80, compute);
    bumpComponentState(component);
    memoizedGroupRole(component, 80, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("recomputes on a new frame", () => {
    const component = {};
    const compute = vi.fn(() => "role-a");
    memoizedGroupRole(component, 80, compute);
    patchTuiFrameEpochSeam();
    memoizedGroupRole(component, 80, compute);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});

function patchTuiFrameEpochSeam(): void {
  const tui = { doRender() {} };
  patchTuiFrameEpoch(tui);
  tui.doRender();
}

describe("memoizedRegionBounds", () => {
  it("shares one computed span with every contained index", () => {
    patchTuiFrameEpochSeam();
    const children = {};
    const compute = vi.fn(() => ({ lo: 1, hi: 3 }));
    const bounds = memoizedRegionBounds(children, 2, 80, compute);

    expect(memoizedRegionBounds(children, 1, 80, compute)).toBe(bounds);
    expect(memoizedRegionBounds(children, 3, 80, compute)).toBe(bounds);
    expect(compute).toHaveBeenCalledTimes(1);

    expect(memoizedRegionBounds(children, 2, 100, compute)).not.toBe(bounds);
    expect(compute).toHaveBeenCalledTimes(2);
  });
});

describe("render lines cache", () => {
  it("returns cached lines for an identical key", () => {
    const component = {};
    const key = baseKey();
    const lines = ["a", "b"];
    setCachedRenderLines(component, key, lines);
    expect(getCachedRenderLines(component, baseKey())).toBe(lines);
  });

  it("misses when any key field changes", () => {
    const component = {};
    setCachedRenderLines(component, baseKey(), ["a"]);
    expect(getCachedRenderLines(component, baseKey({ width: 81 }))).toBeUndefined();
    expect(getCachedRenderLines(component, baseKey({ stateVersion: 1 }))).toBeUndefined();
    expect(getCachedRenderLines(component, baseKey({ hovered: true }))).toBeUndefined();
    expect(getCachedRenderLines(component, baseKey({ headerAnnotation: "x" }))).toBeUndefined();
    expect(getCachedRenderLines(component, baseKey({ roleSummary: "lead:open:grepp" }))).toBeUndefined();
    expect(getCachedRenderLines(component, baseKey({ prevIsTool: true }))).toBeUndefined();
    expect(getCachedRenderLines(component, baseKey({ spinTick: 5 }))).toBeUndefined();
    expect(getCachedRenderLines(component, baseKey({ timerLabel: "61.00s" }))).toBeUndefined();
    expect(getCachedRenderLines(component, baseKey({ theme: {} }))).toBeUndefined();
    expect(getCachedRenderLines(component, baseKey({ envVersion: 1 }))).toBeUndefined();
    expect(getCachedRenderLines(component, baseKey({ configVersion: 1 }))).toBeUndefined();
    expect(getCachedRenderLines(component, baseKey({ deltaVersion: 1 }))).toBeUndefined();
  });

  it("keeps top-level and probe slots independent", () => {
    const component = {};
    setCachedRenderLines(component, baseKey({ probed: false }), ["top"]);
    setCachedRenderLines(component, baseKey({ probed: true }), ["probe"]);
    expect(getCachedRenderLines(component, baseKey({ probed: false }))).toEqual(["top"]);
    expect(getCachedRenderLines(component, baseKey({ probed: true }))).toEqual(["probe"]);
  });

  it("scopes entries per component", () => {
    const a = {};
    const b = {};
    setCachedRenderLines(a, baseKey(), ["a"]);
    expect(getCachedRenderLines(b, baseKey())).toBeUndefined();
  });
});

describe("cachedTextOutput", () => {
  it("reuses text for the same result object", () => {
    const result = {};
    const compute = vi.fn(() => "output");
    expect(cachedTextOutput(result, false, compute)).toBe("output");
    expect(cachedTextOutput(result, false, compute)).toBe("output");
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("recomputes for a new result object or changed showImages", () => {
    const compute = vi.fn(() => "output");
    cachedTextOutput({}, false, compute);
    cachedTextOutput({}, false, compute);
    const result = {};
    cachedTextOutput(result, false, compute);
    cachedTextOutput(result, true, compute);
    expect(compute).toHaveBeenCalledTimes(4);
  });
});

describe("render env version", () => {
  it("bumps monotonically", () => {
    const before = currentRenderEnvVersion();
    bumpRenderEnv();
    expect(currentRenderEnvVersion()).toBe(before + 1);
  });
});
