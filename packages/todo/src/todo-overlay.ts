import type { ExtensionUIContext, Theme } from "@earendil-works/pi-coding-agent";
import { type TUI, truncateToWidth } from "@earendil-works/pi-tui";
import {
  type OverlayLayout,
  selectHasActive,
  selectOverlayLayout,
  selectShowTaskIds,
  selectTodoCounts,
} from "./state/selectors.ts";
import type { TaskState } from "./state/state.ts";
import { getState } from "./state/store.ts";
import type { Task } from "./tool/types.ts";
import { formatOverlayTaskLine } from "./view/format.ts";

function replaceLastBranch(lines: string[]): void {
  const last = lines.length - 1;
  lines[last] = lines[last].replace("├─", "└─");
}

function overlayOverflowLine(layout: OverlayLayout, theme: Theme, width: number): string {
  const totalHidden = layout.hiddenCompleted + layout.truncatedTail;
  const parts = overlayParts(layout);
  const summary =
    parts.length > 0 ? `+${totalHidden} ${OVERLAY_MORE} (${parts.join(", ")})` : `+${totalHidden} ${OVERLAY_MORE}`;
  return truncateToWidth(`${theme.fg("dim", "└─")} ${theme.fg("dim", summary)}`, width, "…");
}

function overlayParts(layout: OverlayLayout): string[] {
  const parts: string[] = [];
  if (layout.hiddenCompleted > 0) parts.push(`${layout.hiddenCompleted} completed`);
  if (layout.truncatedTail > 0) parts.push(`${layout.truncatedTail} pending`);
  return parts;
}

const WIDGET_KEY = "rpiv-todos";
const MAX_WIDGET_LINES = 12;

const OVERLAY_HEADING = "Todos";
const OVERLAY_MORE = "more";

export class TodoOverlay {
  private uiCtx: ExtensionUIContext | undefined;
  private widgetRegistered = false;
  private tui: TUI | undefined;
  private completedTaskIdsPendingHide = new Set<number>();
  private hiddenCompletedTaskIds = new Set<number>();
  private lastNextId: number | undefined;

  setUICtx(ctx: ExtensionUIContext): void {
    if (ctx !== this.uiCtx) {
      this.uiCtx = ctx;
      this.widgetRegistered = false;
      this.tui = undefined;
    }
  }

  update(): void {
    if (!this.uiCtx) return;
    const snapshot = this.getSnapshot();
    const visible = this.selectOverlayTasks(snapshot);

    if (visible.length === 0) {
      if (this.widgetRegistered) {
        this.uiCtx.setWidget(WIDGET_KEY, undefined);
        this.widgetRegistered = false;
        this.tui = undefined;
      }
      return;
    }

    if (!this.widgetRegistered) {
      this.uiCtx.setWidget(
        WIDGET_KEY,
        (tui, theme) => {
          this.tui = tui;
          return {
            render: (width: number) => this.renderWidget(theme, width),
            invalidate: () => {
              this.widgetRegistered = false;
              this.tui = undefined;
            },
          };
        },
        { placement: "aboveEditor" },
      );
      this.widgetRegistered = true;
    } else {
      this.tui?.requestRender();
    }
  }

  resetCompletedDisplayState(): void {
    this.completedTaskIdsPendingHide.clear();
    this.hiddenCompletedTaskIds.clear();
    this.lastNextId = undefined;
  }

  hideCompletedTasksFromPreviousTurn(): void {
    if (this.completedTaskIdsPendingHide.size === 0) return;
    for (const taskId of this.completedTaskIdsPendingHide) {
      this.hiddenCompletedTaskIds.add(taskId);
    }
    this.completedTaskIdsPendingHide.clear();
    this.tui?.requestRender();
  }

  private getSnapshot() {
    const state = getState();
    if (this.lastNextId !== undefined && state.nextId < this.lastNextId) {
      this.resetCompletedDisplayState();
    }
    this.lastNextId = state.nextId;
    const completedTaskIds = new Set(state.tasks.filter((task) => task.status === "completed").map((task) => task.id));
    for (const taskId of this.completedTaskIdsPendingHide) {
      if (!completedTaskIds.has(taskId)) this.completedTaskIdsPendingHide.delete(taskId);
    }
    for (const taskId of this.hiddenCompletedTaskIds) {
      if (!completedTaskIds.has(taskId)) this.hiddenCompletedTaskIds.delete(taskId);
    }
    return { tasks: [...state.tasks], nextId: state.nextId };
  }

  private selectOverlayTasks(snapshot: ReturnType<TodoOverlay["getSnapshot"]>) {
    return snapshot.tasks.filter((task) => task.status !== "deleted" && !this.shouldHideCompletedTask(task));
  }

  private shouldHideCompletedTask(task: ReturnType<TodoOverlay["getSnapshot"]>["tasks"][number]): boolean {
    return task.status === "completed" && this.hiddenCompletedTaskIds.has(task.id);
  }

  private renderWidget(theme: Theme, width: number): string[] {
    const snapshot = this.getSnapshot();
    const overlayTasks = this.selectOverlayTasks(snapshot);
    if (overlayTasks.length === 0) return [];

    const overlayState = { tasks: overlayTasks, nextId: snapshot.nextId };
    const layout = selectOverlayLayout(overlayState, MAX_WIDGET_LINES - 1);
    this.trackNewlyDisplayedCompleted(overlayTasks);

    const lines = this.overlayBodyLines(overlayState, layout, theme, width);
    if (layout.hiddenCompleted === 0 && layout.truncatedTail === 0) {
      replaceLastBranch(lines);
      return this.withTrailingSpacer(lines);
    }
    lines.push(overlayOverflowLine(layout, theme, width));
    return this.withTrailingSpacer(lines);
  }

  private overlayBodyLines(overlayState: TaskState, layout: OverlayLayout, theme: Theme, width: number): string[] {
    const truncate = (line: string): string => truncateToWidth(line, width, "…");
    const counts = selectTodoCounts(overlayState);
    const hasActive = selectHasActive(overlayState);
    const showIds = selectShowTaskIds(overlayState);

    const headingColor = hasActive ? "accent" : "dim";
    const headingIcon = hasActive ? "●" : "○";
    const headingText = `${OVERLAY_HEADING} (${counts.completed}/${counts.total})`;
    const heading = truncate(`${theme.fg(headingColor, headingIcon)} ${theme.fg(headingColor, headingText)}`);

    const lines: string[] = [heading];
    for (const task of layout.visible) {
      lines.push(truncate(`${theme.fg("dim", "├─")} ${formatOverlayTaskLine(task, theme, showIds)}`));
    }
    return lines;
  }

  private trackNewlyDisplayedCompleted(overlayTasks: readonly Task[]): void {
    const newlyDisplayed = overlayTasks.filter(
      (task) =>
        task.status === "completed" &&
        !this.completedTaskIdsPendingHide.has(task.id) &&
        !this.hiddenCompletedTaskIds.has(task.id),
    );
    for (const task of newlyDisplayed) {
      this.completedTaskIdsPendingHide.add(task.id);
    }
  }

  private withTrailingSpacer(lines: string[]): string[] {
    if (lines.length === 0) return lines;
    lines.push("");
    return lines;
  }

  dispose(): void {
    if (this.uiCtx) this.uiCtx.setWidget(WIDGET_KEY, undefined);
    this.widgetRegistered = false;
    this.tui = undefined;
    this.uiCtx = undefined;
    this.resetCompletedDisplayState();
  }
}
