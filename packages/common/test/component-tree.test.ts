import { describe, expect, it } from "vitest";
import {
  COMPONENT_RENDERS_LINES_PROBE_KEY,
  componentRendersLines,
  findComponentContext,
} from "../src/component-tree.ts";
import { getGlobalState } from "../src/global-state.ts";

describe("findComponentContext", () => {
  it("returns the containing children array and index", () => {
    const target = { id: "t" };
    const root = { children: [{ id: "a" }, target, { id: "c" }] };
    expect(findComponentContext(root, target)).toEqual({ siblings: root.children, index: 1 });
  });

  it("walks nested children arrays", () => {
    const target = { id: "t" };
    const inner = { children: [target] };
    const root = { children: [{ id: "a" }, inner] };
    expect(findComponentContext(root, target)).toEqual({ siblings: inner.children, index: 0 });
  });
});

describe("componentRendersLines", () => {
  it("is true when render returns any lines", () => {
    expect(componentRendersLines({ render: () => ["line"] }, 80)).toBe(true);
  });

  it("is false when render returns no lines", () => {
    expect(componentRendersLines({ render: () => [] }, 80)).toBe(false);
  });

  it("does not recurse without bound when two renders probe each other", () => {
    const a: { render: (width: number) => string[] } = {
      render(width) {
        return componentRendersLines(b, width) ? ["a"] : [];
      },
    };
    const b: { render: (width: number) => string[] } = {
      render(width) {
        return componentRendersLines(a, width) ? ["b"] : [];
      },
    };
    expect(componentRendersLines(a, 80)).toBe(true);
    expect(componentRendersLines(b, 80)).toBe(true);
    expect(a.render(80)).toEqual(["a"]);
    expect(b.render(80)).toEqual(["b"]);
  });

  it("still reports empty siblings after a nested probe", () => {
    const empty = { render: () => [] as string[] };
    const nested: { render: (width: number) => string[] } = {
      render(width) {
        componentRendersLines(empty, width);
        return ["visible"];
      },
    };
    expect(componentRendersLines(nested, 80)).toBe(true);
    expect(componentRendersLines(empty, 80)).toBe(false);
  });

  it("shares probe depth across independent copies of the helper", () => {
    function makeProbe() {
      return (component: unknown, width: number): boolean => {
        const render = (component as { render?: (w: number) => string[] }).render;
        if (typeof render !== "function") return false;
        const probe = getGlobalState(COMPONENT_RENDERS_LINES_PROBE_KEY, () => ({ depth: 0 }));
        if (probe.depth > 0) return true;
        probe.depth++;
        try {
          return render.call(component, width).length > 0;
        } finally {
          probe.depth--;
        }
      };
    }

    const probeA = makeProbe();
    const probeB = makeProbe();
    const thinking: { render: (width: number) => string[] } = {
      render(width) {
        return probeA(tool, width) ? ["thinking"] : [];
      },
    };
    const tool: { render: (width: number) => string[] } = {
      render(width) {
        return probeB(thinking, width) ? ["tool"] : [];
      },
    };

    expect(thinking.render(80)).toEqual(["thinking"]);
    expect(tool.render(80)).toEqual(["tool"]);
  });
});
