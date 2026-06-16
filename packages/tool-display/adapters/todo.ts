import type { ThemeColor } from "@earendil-works/pi-coding-agent";
import {
  truncateToWidth,
  visibleWidth,
  wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatExpandedToolOutputLines } from "./shared.ts";

interface TodoArgs {
  action?: string;
  subject?: string;
  id?: number;
  status?: string;
}

interface DetailsShape {
  tasks?: Array<{ id?: number; subject?: string }>;
}

function firstLine(text: string): string {
  return (text.split("\n")[0] ?? "").trim();
}

function stateColor(status: string): ThemeColor {
  switch (status) {
    case "in_progress":
      return "warning";
    case "completed":
      return "success";
    case "deleted":
      return "error";
    default:
      return "dim";
  }
}

function findSubjectById(details: unknown, id: number): string | null {
  const tasks = (details as DetailsShape | undefined)?.tasks;
  if (!Array.isArray(tasks)) return null;
  const t = tasks.find((x) => x?.id === id);
  return t?.subject ?? null;
}

function attachSubject(
  core: string,
  styledSubject: string,
  width: number | undefined,
): string {
  if (!width) return `${core} ${styledSubject}`;
  const line0Budget = width - 2;
  if (visibleWidth(core) + 1 + visibleWidth(styledSubject) <= line0Budget) {
    return `${core} ${styledSubject}`;
  }
  const contBudget = Math.max(1, width - 4);
  const wrapped = wrapTextWithAnsi(styledSubject, contBudget);
  return [core, ...wrapped].join("\n");
}

export const todoAdapter: ToolDisplayAdapter<TodoArgs> = {
  formatCallHeader(args, theme, details, _isPartial, _expanded, width) {
    const label = theme.fg("toolTitle", theme.bold("Todo"));
    const action = args.action ?? "";
    if (!action) return label;
    const actionLabel = theme.fg("accent", action);
    let core = `${label} ${actionLabel}`;
    let subject: string | null = null;

    switch (action) {
      case "create":
        subject = args.subject?.trim() || null;
        break;
      case "update":
        if (args.status)
          core += ` ${theme.fg(stateColor(args.status), `[${args.status}]`)}`;
        if (args.id !== undefined) core += ` ${theme.fg("dim", `#${args.id}`)}`;
        if (args.id !== undefined) subject = findSubjectById(details, args.id);
        break;
      case "get":
      case "delete":
        if (args.id !== undefined) core += ` ${theme.fg("dim", `#${args.id}`)}`;
        if (args.id !== undefined) subject = findSubjectById(details, args.id);
        break;
      case "list":
        if (args.status) core += ` ${theme.fg("muted", args.status)}`;
        break;
      case "clear":
        break;
    }

    if (!subject) return core;
    return attachSubject(core, theme.fg("dim", subject), width);
  },

  formatCollapsedContent(args, output, theme, width, details) {
    if (!output) return [];

    const d = details as { error?: string } | undefined;
    const action = args.action ?? "";
    const line = firstLine(output);

    if (d?.error || line.startsWith("Error:")) {
      return [truncateToWidth(theme.fg("muted", `└ ${line}`), width, "…")];
    }

    switch (action) {
      case "list": {
        if (line === "No tasks" || !line) {
          return [truncateToWidth(theme.fg("muted", "└ 0 tasks"), width, "…")];
        }
        const count = output.split("\n").filter((l) => l.trim()).length;
        return [
          truncateToWidth(
            theme.fg("muted", `└ ${count} task${count === 1 ? "" : "s"}`),
            width,
            "…",
          ),
        ];
      }
      default:
        return [truncateToWidth(theme.fg("muted", `└ ${line}`), width, "…")];
    }
  },

  formatExpandedContent(_args, output, theme, width) {
    if (!output) return [];
    return formatExpandedToolOutputLines(output, theme, width);
  },
};
