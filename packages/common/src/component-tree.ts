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
