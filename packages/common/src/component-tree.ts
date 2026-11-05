import { currentFrameEpoch } from "./frame-epoch.ts";
import { getGlobalState } from "./global-state.ts";

export interface ComponentSiblingContext {
  siblings: unknown[];
  index: number;
}

export const COMPONENT_RENDERS_LINES_PROBE_KEY = "htwang-contrib-common:component-renders-lines-probe";

// A TUI renders its layout under `children` but keeps overlays in a separate
// `overlayStack`. Extension overlays (dialogs, viewers) render their own trees,
// so a lookup rooted at the TUI has to cover both: otherwise components inside
// an overlay resolve no siblings and their grouping/spacing logic goes idle.
function searchRoots(root: unknown): unknown[] {
  const stack = (root as { overlayStack?: unknown }).overlayStack;
  if (!Array.isArray(stack)) return [root];
  const roots = [root];
  for (const entry of stack) {
    const component = (entry as { component?: unknown } | null | undefined)?.component;
    if (component) roots.push(component);
  }
  return roots;
}

function findComponentContextInTree(root: unknown, target: object): ComponentSiblingContext | undefined {
  if (!root || typeof root !== "object") return undefined;
  const children = (root as { children?: unknown }).children;
  if (!Array.isArray(children)) return undefined;
  const index = children.indexOf(target);
  if (index >= 0) return { siblings: children, index };
  for (const child of children) {
    const found = findComponentContextInTree(child, target);
    if (found) return found;
  }
  return undefined;
}

export function findComponentContext(root: unknown, target: object): ComponentSiblingContext | undefined {
  for (const candidate of searchRoots(root)) {
    const found = findComponentContextInTree(candidate, target);
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
    for (const candidate of searchRoots(root)) buildSiblingIndex(candidate, entry.index);
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

interface ComponentVisibilityCacheEntry {
  epoch: number;
  width: number;
  visible: boolean;
}

const componentVisibilityCache = new WeakMap<object, ComponentVisibilityCacheEntry>();

export function componentRendersLines(component: unknown, width: number): boolean {
  if (typeof width !== "number" || width <= 0) return true;
  if (!component || typeof component !== "object") return false;
  const render = (component as { render?: (w: number) => string[] }).render;
  if (typeof render !== "function") return false;
  const probe = getGlobalState(COMPONENT_RENDERS_LINES_PROBE_KEY, () => ({ depth: 0 }));
  if (probe.depth > 0) return true;
  const epoch = currentFrameEpoch();
  const cached = componentVisibilityCache.get(component);
  if (epoch > 0 && cached?.epoch === epoch && cached.width === width) return cached.visible;
  probe.depth++;
  try {
    const visible = render.call(component, width).length > 0;
    if (epoch > 0) componentVisibilityCache.set(component, { epoch, width, visible });
    return visible;
  } finally {
    probe.depth--;
  }
}
