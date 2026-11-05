import { currentFrameEpoch } from "./frame-epoch.ts";
import { getGlobalState } from "./global-state.ts";

export interface ComponentSiblingContext {
  siblings: unknown[];
  index: number;
}

export const COMPONENT_RENDERS_LINES_PROBE_KEY = "htwang-contrib-common:component-renders-lines-probe";

export function findComponentContext(root: unknown, target: object): ComponentSiblingContext | undefined {
  if (!root || typeof root !== "object") return undefined;
  const children = (root as { children?: unknown }).children;
  if (!Array.isArray(children)) return undefined;
  const index = children.indexOf(target);
  if (index >= 0) return { siblings: children, index };
  for (const child of children) {
    const found = findComponentContext(child, target);
    if (found) return found;
  }
  return undefined;
}

interface FrameSiblingIndex {
  epoch: number;
  index: Map<object, ComponentSiblingContext>;
}

const frameSiblingIndexes = new WeakMap<object, FrameSiblingIndex>();

// Sibling lookups are requested per component per frame; indexing the tree once
// per frame turns N lookups from N full-tree walks into one walk plus O(1) hits.
// Targets attached after the index was built (mid-frame tree mutation) fall back
// to the direct walk, preserving findComponentContext semantics. An unpatched
// TUI (epoch 0, e.g. unit tests) skips the cache entirely.
export function findComponentContextInFrame(root: unknown, target: object): ComponentSiblingContext | undefined {
  if (!root || typeof root !== "object") return undefined;
  const epoch = currentFrameEpoch();
  if (epoch <= 0) return findComponentContext(root, target);
  let entry = frameSiblingIndexes.get(root);
  if (!entry || entry.epoch !== epoch) {
    entry = { epoch, index: new Map() };
    buildSiblingIndex(root, entry.index);
    frameSiblingIndexes.set(root, entry);
  }
  return entry.index.get(target) ?? findComponentContext(root, target);
}

function buildSiblingIndex(node: unknown, index: Map<object, ComponentSiblingContext>): void {
  if (!node || typeof node !== "object") return;
  const children = (node as { children?: unknown }).children;
  if (!Array.isArray(children)) return;
  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child && typeof child === "object" && !index.has(child)) {
      index.set(child, { siblings: children, index: i });
    }
  }
  for (const child of children) {
    buildSiblingIndex(child, index);
  }
}

export function componentRenderProbeDepth(): number {
  return getGlobalState(COMPONENT_RENDERS_LINES_PROBE_KEY, () => ({ depth: 0 })).depth;
}

export function componentRendersLines(component: unknown, width: number): boolean {
  if (typeof width !== "number" || width <= 0) return true;
  if (!component || typeof component !== "object") return false;
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
}
