import { isAbsolute, relative } from "node:path";
import type { InjectionCache } from "./cache.ts";
import type { AgentsSource } from "./types.ts";

const STATUS_KEY = "ext:agents-mirror:status";
const WIDGET_KEY = "ext:agents-mirror:widget";

export interface ThemeFn {
  fg(color: string, text: string): string;
}

export type StatusSetter = (key: string, text: string | undefined) => void;

export type WidgetSetter = (
  key: string,
  lines: string[] | undefined,
  options?: { placement?: "aboveEditor" | "belowEditor" },
) => void;

export interface UiSurface {
  hasUI: boolean;
  cwd: string;
  ui?: {
    theme?: ThemeFn;
    setStatus?: StatusSetter;
    setWidget?: WidgetSetter;
    notify?(message: string, level?: "info" | "warn" | "warning" | "error"): void;
  };
}

export interface InjectedFileMeta {
  absolutePath: string;
  source: "project" | "mirror";
  truncated: boolean;
}

export function updateStatus(ctx: UiSurface, cache: InjectionCache, sessionKey: string, hasErrors: boolean): void {
  const setStatus = ctx.hasUI ? ctx.ui?.setStatus : undefined;
  if (!setStatus) return;
  setStatus(STATUS_KEY, statusText(ctx.ui?.theme, cache.getCacheSize(sessionKey), hasErrors));
}

function statusText(theme: ThemeFn | undefined, count: number, hasErrors: boolean): string | undefined {
  if (count === 0) return undefined;
  const fg = (theme ?? identityTheme).fg;
  let text = fg("dim", `◆ ${count}`);
  if (hasErrors) text += fg("warning", " \u26A0");
  return text;
}

export function clearStatus(ctx: UiSurface): void {
  if (!ctx.hasUI || !ctx.ui?.setStatus) return;
  ctx.ui.setStatus(STATUS_KEY, undefined);
}

export function updateWidget(ctx: UiSurface, visible: boolean, files: InjectedFileMeta[]): void {
  const setWidget = ctx.hasUI ? ctx.ui?.setWidget : undefined;
  if (!setWidget) return;
  if (!visible || files.length === 0) {
    setWidget(WIDGET_KEY, undefined);
    return;
  }
  setWidget(WIDGET_KEY, widgetLines(ctx, files), { placement: "aboveEditor" });
}

function widgetLines(ctx: UiSurface, files: InjectedFileMeta[]): string[] {
  const theme = ctx.ui?.theme ?? identityTheme;
  const lines = [theme.fg("accent", "Agents Mirror Context:")];
  for (const file of files) {
    lines.push(widgetLine(theme, file, displayPath(ctx.cwd, file.absolutePath)));
  }
  return lines;
}

function widgetLine(theme: ThemeFn, file: InjectedFileMeta, display: string): string {
  const tag = file.source === "mirror" ? "[mirror] " : "";
  const text = file.truncated ? `  ${tag}${display} (truncated)` : `  ${tag}${display}`;
  return theme.fg(file.truncated ? "warning" : "dim", text);
}

export function clearWidget(ctx: UiSurface): void {
  if (!ctx.hasUI || !ctx.ui?.setWidget) return;
  ctx.ui.setWidget(WIDGET_KEY, undefined);
}

export function buildDebugRecord(input: {
  cache: InjectionCache;
  sessionKey: string;
  files: InjectedFileMeta[];
}): Record<string, unknown> {
  return {
    sessionKey: input.sessionKey,
    cacheSize: input.cache.getCacheSize(input.sessionKey),
    injectedDirectories: input.cache.listInjected(input.sessionKey),
    injectedFiles: input.files.map((f) => ({ path: f.absolutePath, source: f.source, truncated: f.truncated })),
  };
}

function displayPath(cwd: string, absolutePath: string): string {
  return relativeToBase(cwd, absolutePath);
}

export function relativeToBase(base: string, absolutePath: string): string {
  if (!isAbsolute(absolutePath)) return absolutePath;
  const rel = relative(base, absolutePath);
  if (rel === "" || rel === ".." || rel.startsWith("../") || isAbsolute(rel)) return absolutePath;
  return rel;
}

export interface InjectedEntryFile {
  display: string;
  source: AgentsSource;
  truncated: boolean;
}

export interface InjectedEntryData {
  readPath: string;
  files: InjectedEntryFile[];
}

export function buildInjectedEntryData(input: {
  readPath: string;
  files: { absolutePath: string; source: AgentsSource; truncated: boolean }[];
  cwd: string;
  mirrorRoot: string | null;
}): InjectedEntryData {
  return {
    readPath: relativeToBase(input.cwd, input.readPath),
    files: input.files.map((f) => ({
      display: relativeToBase(f.source === "mirror" && input.mirrorRoot ? input.mirrorRoot : input.cwd, f.absolutePath),
      source: f.source,
      truncated: f.truncated,
    })),
  };
}

const identityTheme: ThemeFn = {
  fg: (_color: string, text: string) => text,
};
