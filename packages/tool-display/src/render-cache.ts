import { componentRenderProbeDepth } from "@htwang-contrib/common/component-tree";
import { currentFrameEpoch } from "@htwang-contrib/common/frame-epoch";

let renderEnvVersion = 0;

// Environment changes that alter rendered output without touching component
// state (e.g. the MCP tool set refreshing). Part of the render-lines key.
export function bumpRenderEnv(): void {
  renderEnvVersion++;
}

export function currentRenderEnvVersion(): number {
  return renderEnvVersion;
}

const stateVersions = new WeakMap<object, number>();

export function bumpComponentState(component: object): void {
  stateVersions.set(component, (stateVersions.get(component) ?? 0) + 1);
}

export function componentStateVersion(component: object): number {
  return stateVersions.get(component) ?? 0;
}

const frameLineCounts = new WeakMap<object, { epoch: number; count: number }>();

// Parent containers render children top-down, so when a component probes its
// preceding siblings for visibility, those siblings have already rendered this
// frame and their line counts are known without re-invoking their render.
export function recordFrameLineCount(component: object, count: number): void {
  frameLineCounts.set(component, { epoch: currentFrameEpoch(), count });
}

export function frameLineCount(component: object): number | undefined {
  const hit = frameLineCounts.get(component);
  return hit && hit.epoch === currentFrameEpoch() ? hit.count : undefined;
}

export interface RenderLinesKey {
  width: number;
  probed: boolean;
  stateVersion: number;
  hovered: boolean;
  headerAnnotation: string | undefined;
  roleSummary: string;
  prevIsTool: boolean;
  prevHasRailTail: boolean;
  spinTick: number;
  timerLabel: string | undefined;
  theme: unknown;
  envVersion: number;
  configVersion: number;
  deltaVersion: number;
}

interface RenderLinesSlot {
  key: RenderLinesKey;
  lines: string[];
}

interface RenderLinesEntry {
  top?: RenderLinesSlot;
  probe?: RenderLinesSlot;
}

const renderLinesCache = new WeakMap<object, RenderLinesEntry>();

function renderLinesKeyEquals(a: RenderLinesKey, b: RenderLinesKey): boolean {
  return layoutKeyEquals(a, b) && stateKeyEquals(a, b) && envKeyEquals(a, b);
}

function layoutKeyEquals(a: RenderLinesKey, b: RenderLinesKey): boolean {
  return a.width === b.width && a.probed === b.probed && a.stateVersion === b.stateVersion && a.hovered === b.hovered;
}

function stateKeyEquals(a: RenderLinesKey, b: RenderLinesKey): boolean {
  return (
    a.headerAnnotation === b.headerAnnotation &&
    a.roleSummary === b.roleSummary &&
    a.prevIsTool === b.prevIsTool &&
    a.prevHasRailTail === b.prevHasRailTail &&
    a.spinTick === b.spinTick &&
    a.timerLabel === b.timerLabel
  );
}

function envKeyEquals(a: RenderLinesKey, b: RenderLinesKey): boolean {
  return (
    a.theme === b.theme &&
    a.envVersion === b.envVersion &&
    a.configVersion === b.configVersion &&
    a.deltaVersion === b.deltaVersion
  );
}

// Renders reached through componentRendersLines probes run with the probe-depth
// guard active, so their spacing resolution differs from top-level renders; the
// two contexts get separate slots to avoid poisoning each other.
export function getCachedRenderLines(component: object, key: RenderLinesKey): string[] | undefined {
  const entry = renderLinesCache.get(component);
  const slot = key.probed ? entry?.probe : entry?.top;
  if (slot && renderLinesKeyEquals(slot.key, key)) return slot.lines;
  return undefined;
}

export function setCachedRenderLines(component: object, key: RenderLinesKey, lines: string[]): void {
  let entry = renderLinesCache.get(component);
  if (!entry) {
    entry = {};
    renderLinesCache.set(component, entry);
  }
  const slot: RenderLinesSlot = { key, lines };
  if (key.probed) entry.probe = slot;
  else entry.top = slot;
}

export function currentProbeDepth(): number {
  return componentRenderProbeDepth();
}

const textOutputCache = new WeakMap<object, { showImages: boolean; text: string | undefined }>();

// pi core replaces the result object wholesale in updateResult, so reference
// identity is a safe reuse key for the (potentially large) joined text output.
export function cachedTextOutput(
  result: object,
  showImages: boolean,
  compute: () => string | undefined,
): string | undefined {
  const hit = textOutputCache.get(result);
  if (hit && hit.showImages === showImages) return hit.text;
  const text = compute();
  textOutputCache.set(result, { showImages, text });
  return text;
}
