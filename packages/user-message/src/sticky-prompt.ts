import { UserMessageComponent } from "@earendil-works/pi-coding-agent";
import {
  type Component,
  compositeTuiLine,
  type ScrollView,
  stripTerminalSequences,
  type TUI,
  truncateToWidth,
} from "@earendil-works/pi-tui";

interface LayoutBox {
  component: Component;
  rect: { x: number; y: number; width: number; height: number };
  clip: { x: number; y: number; width: number; height: number };
  children: LayoutBox[];
  layer: number;
  scrollView?: ScrollView;
  scrollContentLines?: readonly string[];
}

interface LayoutFrame {
  root: LayoutBox;
  primaryScrollView?: ScrollView;
}

interface FullscreenRenderHost extends TUI {
  compositeScrollToEndIndicator(screen: string[], layout: LayoutFrame, width: number): string[];
  hasActiveSelection(): boolean;
}

interface PromptBounds {
  component: UserMessageComponent;
  start: number;
  end: number;
}

interface PinnedPrompt {
  view: ScrollView;
  prompt: PromptBounds;
  row: number;
  column: number;
  markerColumn: number;
  width: number;
  clearHeight: number;
  lines: string[];
}

function findViewport(box: LayoutBox, view: ScrollView): LayoutBox | undefined {
  if (box.scrollView === view) return box;
  for (const child of box.children) {
    const found = findViewport(child, view);
    if (found) return found;
  }
  return undefined;
}

function collectPrompts(
  component: Component,
  start: number,
  height: number,
  width: number,
  prompts: PromptBounds[],
): void {
  if (height <= 0) return;
  if (component instanceof UserMessageComponent) {
    prompts.push({ component, start, end: start + height });
    return;
  }
  const layout = (
    component as Component & {
      mouseLayout?: { width: number; children: { component: Component; height: number }[] };
    }
  ).mouseLayout;
  if (layout?.width !== width) return;
  let row = start;
  for (const child of layout.children) {
    collectPrompts(child.component, row, child.height, width, prompts);
    row += child.height;
  }
}

function collectLayoutPrompts(box: LayoutBox, origin: number, prompts: PromptBounds[]): void {
  if (box.children.length === 0) {
    collectPrompts(box.component, box.rect.y - origin, box.rect.height, box.rect.width, prompts);
    return;
  }
  for (const child of box.children) collectLayoutPrompts(child, origin, prompts);
}

function getPinnedPrompt(layout: LayoutFrame): PinnedPrompt | undefined {
  const view = layout.primaryScrollView;
  if (!view || view.scrollTop <= 0) return undefined;
  const viewport = findViewport(layout.root, view);
  if (!viewport?.scrollContentLines || viewport.clip.height < 4) return undefined;

  const prompts: PromptBounds[] = [];
  const origin = viewport.rect.y - view.scrollTop;
  for (const child of viewport.children) collectLayoutPrompts(child, origin, prompts);

  const top = view.scrollTop + viewport.clip.y - viewport.rect.y;
  const bracket = findBracketingPrompt(prompts, top);
  if (!bracket) return undefined;
  return buildPinnedPrompt(view, viewport, bracket, top);
}

function findBracketingPrompt(
  prompts: PromptBounds[],
  top: number,
): { current: PromptBounds; next?: PromptBounds } | undefined {
  let current: PromptBounds | undefined;
  let next: PromptBounds | undefined;
  for (const prompt of prompts) {
    if (prompt.start > top) {
      next = prompt;
      break;
    }
    current = prompt;
  }
  if (!current || current.start === top) return undefined;
  return { current, next };
}

function buildPinnedPrompt(
  view: ScrollView,
  viewport: LayoutBox,
  bracket: { current: PromptBounds; next?: PromptBounds },
  top: number,
): PinnedPrompt | undefined {
  const source = viewport.scrollContentLines;
  if (!source) return undefined;
  const bounds = trimPromptBounds(source, bracket.current.start, bracket.current.end);
  if (!bounds) return undefined;
  const contentWidth = Math.min(view.getContentWidth(viewport.rect.width), viewport.clip.width);
  if (contentWidth < 1) return undefined;
  const pinnedLines = pinnedPromptLines(source, bounds, viewport.clip.height, contentWidth);
  if (bracket.next && bracket.next.start - top < pinnedLines.length) return undefined;
  const markerOffset = Math.floor((contentWidth - 1) / 2);
  return {
    view,
    prompt: bracket.current,
    row: viewport.clip.y,
    column: viewport.rect.x,
    markerColumn: viewport.rect.x + markerOffset,
    width: contentWidth,
    clearHeight: Math.min(viewport.clip.height, Math.max(pinnedLines.length, bracket.current.end - top)),
    lines: pinnedLines,
  };
}

function trimPromptBounds(
  source: readonly string[],
  start: number,
  end: number,
): { start: number; end: number } | undefined {
  const trimmedStart = firstContentLine(source, start, end);
  const trimmedEnd = lastContentLine(source, trimmedStart, end);
  if (trimmedStart === trimmedEnd) return undefined;
  return { start: trimmedStart, end: trimmedEnd };
}

function firstContentLine(source: readonly string[], start: number, end: number): number {
  let index = start;
  while (index < end && !stripTerminalSequences(source[index] ?? "").trim()) index++;
  return index;
}

function lastContentLine(source: readonly string[], start: number, end: number): number {
  let index = end;
  while (index > start && !stripTerminalSequences(source[index - 1] ?? "").trim()) index--;
  return index;
}

function pinnedPromptLines(
  source: readonly string[],
  bounds: { start: number; end: number },
  clipHeight: number,
  contentWidth: number,
): string[] {
  const maxLines = Math.min(3, Math.floor(clipHeight / 2) - 1);
  const lines = source.slice(bounds.start, Math.min(bounds.end, bounds.start + maxLines)).map(stripPromptMarker);
  if (bounds.end - bounds.start > maxLines) {
    lines[lines.length - 1] = `${truncateToWidth(lines.at(-1) ?? "", contentWidth - 1, "")}…`;
  }
  const markerOffset = Math.floor((contentWidth - 1) / 2);
  return [...lines.map((line) => truncateToWidth(line, contentWidth, "")), `${" ".repeat(markerOffset)}▲`];
}

function stripPromptMarker(line: string): string {
  return line.replace(/\x1b\]133;[ABC](?:\x07|\x1b\\)/g, "");
}

export function installStickyPrompt(tui: TUI): () => void {
  const host = tui as Partial<FullscreenRenderHost>;
  const original = host.compositeScrollToEndIndicator;
  if (tui.mode !== "fullscreen" || typeof original !== "function") return () => {};

  let active = true;
  let pinned: PinnedPrompt | undefined;
  let pressed: PinnedPrompt | undefined;
  const jumpMarker: Component = {
    render: () => ["▲"],
    invalidate() {},
    handleMouse(event) {
      if (!markerAcceptsEvent(event)) return undefined;
      const update = markerPressUpdate(event);
      if (update) return update;
      if (event.type === "release") return { handled: true, render: false };
      if (event.type !== "click") return undefined;
      return markerClick();
    },
  };

  function markerAcceptsEvent(event: { button?: string }): boolean {
    if (!active || !pinned) return false;
    if (tui.hasOverlay() || event.button !== "left") return false;
    return true;
  }

  function markerPressUpdate(event: { type: string }): { handled: boolean; render: boolean } | undefined {
    if (event.type === "press") {
      pressed = pinned;
      return { handled: true, render: false };
    }
    if (event.type === "drag") {
      pressed = undefined;
      return { handled: true, render: false };
    }
    return undefined;
  }

  function markerClick(): { handled: boolean } {
    const current = pinned;
    if (current && pressed?.view === current.view && pressed.prompt.component === current.prompt.component) {
      current.view.scrollTo(current.prompt.start, { disableFollow: true });
    }
    pressed = undefined;
    return { handled: true };
  }
  const patched = (screen: string[], layout: LayoutFrame, width: number): string[] => {
    pinned = undefined;
    const rendered = original.call(tui, screen, layout, width);
    if (!active || tui.hasOverlay() || host.hasActiveSelection?.()) return rendered;
    pinned = getPinnedPrompt(layout);
    if (!pinned) return rendered;
    const result = [...rendered];
    for (let index = 0; index < pinned.clearHeight; index++) {
      const row = pinned.row + index;
      result[row] = compositeTuiLine(result[row] ?? "", pinned.lines[index] ?? "", pinned.column, pinned.width, width);
    }
    const rect = { x: pinned.markerColumn, y: pinned.row + pinned.lines.length - 1, width: 1, height: 1 };
    layout.root.children.push({ component: jumpMarker, rect, clip: rect, children: [], layer: 1 });
    return result;
  };
  host.compositeScrollToEndIndicator = patched;
  tui.requestRender();
  return () => {
    active = false;
    pinned = undefined;
    pressed = undefined;
    if (host.compositeScrollToEndIndicator === patched) host.compositeScrollToEndIndicator = original;
    tui.requestRender();
  };
}
