import { componentRenderProbeDepth, getConfigFileVersion } from "@htwang-contrib/common";

let frameEpoch = 0;
let roleMutationVersion = 0;
let renderEnvVersion = 0;
const epochPatchedTuis = new WeakSet<object>();

export function currentFrameEpoch(): number {
  return frameEpoch;
}

// Role-relevant changes: any tool state update, aggregate-group toggles,
// aggregate-rule registrations. Only invalidates the frame-scoped role memo.
export function bumpRoleMutation(): void {
  roleMutationVersion++;
}

// Environment changes that alter rendered output without touching component
// state (e.g. the MCP tool set refreshing). Part of the render-lines key.
export function bumpRenderEnv(): void {
  renderEnvVersion++;
}

export function currentRenderEnvVersion(): number {
  return renderEnvVersion;
}

// One bump per rendered frame, driven by the TUI's doRender. Within a frame no
// component state changes, so frame-scoped memos need no finer invalidation.
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

const stateVersions = new WeakMap<object, number>();

export function bumpComponentState(component: object): void {
  stateVersions.set(component, (stateVersions.get(component) ?? 0) + 1);
  roleMutationVersion++;
}

export function componentStateVersion(component: object): number {
  return stateVersions.get(component) ?? 0;
}

interface RoleMemoEntry {
  epoch: number;
  mutation: number;
  configVersion: number;
  width: number;
  role: unknown;
}

const roleMemo = new WeakMap<object, RoleMemoEntry>();

// Group roles are recomputed at most once per component per frame; the mutation
// and config versions keep the memo honest if the frame epoch never advances
// (e.g. unit tests rendering without a patched TUI).
export function memoizedGroupRole<T>(component: object, width: number, compute: () => T): T {
  const epoch = frameEpoch;
  const mutation = roleMutationVersion;
  const configVersion = getConfigFileVersion();
  const hit = roleMemo.get(component);
  if (
    hit &&
    hit.epoch === epoch &&
    hit.mutation === mutation &&
    hit.configVersion === configVersion &&
    hit.width === width
  ) {
    return hit.role as T;
  }
  const role = compute();
  roleMemo.set(component, { epoch, mutation, configVersion, width, role });
  return role;
}

interface RegionRolesCacheEntry {
  epoch: number;
  mutation: number;
  configVersion: number;
  regions: Map<string, Map<number, unknown>>;
}

const regionRolesCache = new WeakMap<object, RegionRolesCacheEntry>();

// All components in one hard-break-bounded region share a single grouping
// computation per frame, instead of each component re-scanning the region.
export function memoizedRegionRoles<T>(
  children: object,
  lo: number,
  hi: number,
  width: number,
  compute: () => Map<number, T>,
): Map<number, T> {
  const epoch = frameEpoch;
  const mutation = roleMutationVersion;
  const configVersion = getConfigFileVersion();
  let entry = regionRolesCache.get(children);
  if (!entry || entry.epoch !== epoch || entry.mutation !== mutation || entry.configVersion !== configVersion) {
    entry = { epoch, mutation, configVersion, regions: new Map() };
    regionRolesCache.set(children, entry);
  }
  const key = `${lo}:${hi}:${width}`;
  const hit = entry.regions.get(key);
  if (hit) return hit as Map<number, T>;
  const roles = compute();
  entry.regions.set(key, roles);
  return roles;
}

const frameLineCounts = new WeakMap<object, { epoch: number; count: number }>();

// Parent containers render children top-down, so when a component probes its
// preceding siblings for visibility, those siblings have already rendered this
// frame and their line counts are known without re-invoking their render.
export function recordFrameLineCount(component: object, count: number): void {
  frameLineCounts.set(component, { epoch: frameEpoch, count });
}

export function frameLineCount(component: object): number | undefined {
  const hit = frameLineCounts.get(component);
  return hit && hit.epoch === frameEpoch ? hit.count : undefined;
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
  return a.theme === b.theme && a.envVersion === b.envVersion && a.configVersion === b.configVersion;
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
