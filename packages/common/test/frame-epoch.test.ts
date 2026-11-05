import { describe, expect, it } from "vitest";
import { currentFrameEpoch, patchTuiFrameEpoch } from "../src/frame-epoch.ts";

describe("patchTuiFrameEpoch", () => {
  it("bumps the frame epoch on every doRender call", () => {
    const before = currentFrameEpoch();
    const calls: string[] = [];
    const tui = {
      doRender() {
        calls.push("render");
      },
    };
    patchTuiFrameEpoch(tui);
    tui.doRender();
    tui.doRender();
    expect(currentFrameEpoch()).toBe(before + 2);
    expect(calls).toEqual(["render", "render"]);
  });

  it("patches a given tui only once", () => {
    const before = currentFrameEpoch();
    const tui = { doRender() {} };
    patchTuiFrameEpoch(tui);
    patchTuiFrameEpoch(tui);
    tui.doRender();
    expect(currentFrameEpoch()).toBe(before + 1);
  });

  it("ignores objects without doRender", () => {
    const before = currentFrameEpoch();
    patchTuiFrameEpoch({});
    patchTuiFrameEpoch(undefined);
    expect(currentFrameEpoch()).toBe(before);
  });
});
