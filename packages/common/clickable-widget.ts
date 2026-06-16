import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { visibleWidth } from "@earendil-works/pi-tui";

export type WidgetPlacement = "aboveEditor" | "belowEditor";

export interface ClickableSegment {
  text: string;
  onClick?: () => void;
}

export interface ClickableRow {
  segments: ClickableSegment[];
}

export interface ClickableWidgetOptions {
  key: string;
  placement?: WidgetPlacement;
  rows: () => ClickableRow[];
  autoEnableMouse?: boolean;
}

export interface ClickableWidgetHandle {
  update(): void;
  refresh(): void;
  enableMouse(): void;
  disableMouse(): void;
  detach(): void;
}

export interface MouseEvent {
  button: number;
  col: number;
  row: number;
  type: "press" | "release" | "drag";
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
}

const ENABLE_SGR_MOUSE = "\x1b[?1000h\x1b[?1006h";
const DISABLE_SGR_MOUSE = "\x1b[?1006l\x1b[?1000l";
const SGR_MOUSE_PATTERN = /\x1b\[<(\d+);(\d+);(\d+)([mM])/g;

const MOD_SHIFT = 4;
const MOD_ALT = 8;
const MOD_CTRL = 16;
const MOD_MASK = MOD_SHIFT | MOD_ALT | MOD_CTRL;

type PatchedTui = TUI & {
  __clickableOriginalStop?: TUI["stop"];
};

type InputHandler = (data: string) => { consume?: boolean } | undefined;

function parseSgrMouseEvents(data: string): MouseEvent[] {
  const events: MouseEvent[] = [];
  SGR_MOUSE_PATTERN.lastIndex = 0;
  for (const match of data.matchAll(SGR_MOUSE_PATTERN)) {
    const button = Number.parseInt(match[1] ?? "", 10);
    const col = Number.parseInt(match[2] ?? "", 10);
    const row = Number.parseInt(match[3] ?? "", 10);
    const suffix = match[4];
    if (
      !Number.isFinite(button) ||
      !Number.isFinite(col) ||
      !Number.isFinite(row)
    ) {
      continue;
    }
    events.push({
      button: button & ~MOD_MASK,
      col,
      row,
      type: suffix === "M" ? "press" : "release",
      shift: (button & MOD_SHIFT) !== 0,
      alt: (button & MOD_ALT) !== 0,
      ctrl: (button & MOD_CTRL) !== 0,
    });
  }
  return events;
}

function isMouseInput(data: string): boolean {
  SGR_MOUSE_PATTERN.lastIndex = 0;
  return SGR_MOUSE_PATTERN.test(data);
}

interface RenderedSegment {
  text: string;
  startCol: number;
  endCol: number;
  onClick?: () => void;
}

interface RenderedRow {
  segments: RenderedSegment[];
  line: string;
  width: number;
}

function renderRows(rows: ClickableRow[]): RenderedRow[] {
  return rows.map((row) => {
    const rendered: RenderedSegment[] = [];
    let cursor = 0;
    let line = "";
    for (const seg of row.segments) {
      const w = visibleWidth(seg.text);
      const r: RenderedSegment = {
        text: seg.text,
        startCol: cursor,
        endCol: cursor + w,
        onClick: seg.onClick,
      };
      rendered.push(r);
      line += seg.text;
      cursor += w;
    }
    return { segments: rendered, line, width: cursor };
  });
}

function hitTest(
  renderedRows: RenderedRow[],
  col: number,
  row: number,
  screenStartRow: number,
): (() => void) | undefined {
  const localRow = row - screenStartRow - 1;
  if (localRow < 0 || localRow >= renderedRows.length) return undefined;
  const r = renderedRows[localRow];
  if (!r) return undefined;
  for (const seg of r.segments) {
    if (!seg.onClick) continue;
    if (col >= seg.startCol + 1 && col <= seg.endCol) {
      return seg.onClick;
    }
  }
  return undefined;
}

interface WidgetComponent extends Component {
  renderedRows: RenderedRow[];
  screenStartRow: number;
}

function computeScreenStartRow(
  tui: TUI,
  self: Component,
  width: number,
): number {
  const children = (tui as { children?: Component[] }).children ?? [];
  let start = 0;
  for (const child of children) {
    if (child === self) break;
    try {
      start += child.render(width).length;
    } catch {
      break;
    }
  }
  return start;
}

function createWidgetComponent(
  tui: TUI,
  getRows: () => ClickableRow[],
  onRendered: (c: WidgetComponent) => void,
): WidgetComponent {
  const comp: WidgetComponent = {
    renderedRows: [],
    screenStartRow: 0,
    render(width: number): string[] {
      const rows = renderRows(getRows());
      this.renderedRows = rows;
      this.screenStartRow = computeScreenStartRow(tui, this, width);
      onRendered(this);
      return rows.map((r) => {
        if (r.width <= width) return r.line;
        return r.line.slice(0, Math.max(0, width));
      });
    },
    invalidate(): void {},
  };
  return comp;
}

function patchTuiStop(tui: TUI, onExit: () => void): void {
  const patched = tui as PatchedTui;
  if (patched.__clickableOriginalStop !== undefined) return;
  const original = tui.stop.bind(tui);
  patched.__clickableOriginalStop = original;
  tui.stop = function patchedStop(this: TUI): void {
    try {
      original();
    } finally {
      onExit();
    }
  };
}

function unpatchTuiStop(tui: TUI): void {
  const patched = tui as PatchedTui;
  const original = patched.__clickableOriginalStop;
  if (original === undefined) return;
  tui.stop = original;
  delete patched.__clickableOriginalStop;
}

export function createClickableWidget(
  ctx: ExtensionContext,
  options: ClickableWidgetOptions,
): ClickableWidgetHandle {
  const placement = options.placement ?? "aboveEditor";
  const autoEnableMouse = options.autoEnableMouse ?? true;
  const widgetOptions = { placement };

  let tui: TUI | undefined;
  let component: WidgetComponent | undefined;
  let mouseEnabled = false;
  let unsubInput: (() => void) | undefined;

  function write(seq: string): void {
    tui?.terminal.write(seq);
  }

  function handleInput(data: string): { consume?: boolean } | undefined {
    if (!isMouseInput(data)) return undefined;
    const events = parseSgrMouseEvents(data);
    let consumed = false;
    for (const ev of events) {
      if (ev.type !== "press") continue;
      const onClick = component
        ? hitTest(
            component.renderedRows,
            ev.col,
            ev.row,
            component.screenStartRow,
          )
        : undefined;
      if (onClick) {
        try {
          onClick();
        } catch {
          // swallow click handler errors so a bad listener never bricks input
        }
        consumed = true;
      }
    }
    return consumed ? { consume: true } : undefined;
  }

  function attachWidget(): void {
    if (!ctx.hasUI) return;
    ctx.ui.setWidget(
      options.key,
      (t: TUI) => {
        tui = t;
        component = createWidgetComponent(t, options.rows, (c) => {
          component = c;
        });
        if (autoEnableMouse) enableMouse();
        installInput();
        return component;
      },
      widgetOptions,
    );
  }

  function detachWidget(): void {
    if (!ctx.hasUI) return;
    ctx.ui.setWidget(options.key, undefined, widgetOptions);
  }

  function installInput(): void {
    if (unsubInput || !ctx.hasUI) return;
    unsubInput = ctx.ui.onTerminalInput(handleInput as InputHandler);
  }

  function removeInput(): void {
    if (unsubInput) {
      unsubInput();
      unsubInput = undefined;
    }
  }

  function enableMouse(): void {
    if (mouseEnabled || !tui) return;
    patchTuiStop(tui, () => {
      write(DISABLE_SGR_MOUSE);
    });
    write(ENABLE_SGR_MOUSE);
    mouseEnabled = true;
  }

  function disableMouse(): void {
    if (!mouseEnabled) return;
    write(DISABLE_SGR_MOUSE);
    if (tui) unpatchTuiStop(tui);
    mouseEnabled = false;
  }

  attachWidget();

  return {
    update(): void {
      tui?.requestRender();
    },
    refresh(): void {
      attachWidget();
      tui?.requestRender();
    },
    enableMouse,
    disableMouse,
    detach(): void {
      disableMouse();
      removeInput();
      detachWidget();
      component = undefined;
      tui = undefined;
    },
  };
}

export {
  ENABLE_SGR_MOUSE,
  DISABLE_SGR_MOUSE,
  parseSgrMouseEvents,
  isMouseInput,
  hitTest as hitTestSegment,
  renderRows as renderClickableRows,
};
