import type { Theme, ThemeColor } from "@earendil-works/pi-coding-agent";
import { visibleWidth, wrapTextWithAnsi } from "@earendil-works/pi-tui";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatExpandedToolOutputLines } from "./shared.ts";

interface TodoArgs {
  id?: number;
  subject?: string;
  status?: string;
  includeDeleted?: boolean;
}

interface DetailsShape {
  tasks?: Array<{ id?: number; subject?: string }>;
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

function attachSubject(core: string, styledSubject: string, width: number | undefined): string {
  if (!width) return `${core} ${styledSubject}`;
  if (visibleWidth(core) + 1 + visibleWidth(styledSubject) <= width) {
    return `${core} ${styledSubject}`;
  }
  const wrapped = wrapTextWithAnsi(styledSubject, Math.max(1, width));
  return [core, ...wrapped].join("\n");
}

function idTaggedCore(core: string, args: TodoArgs, theme: Theme): string {
  if (args.id !== undefined) return `${core} ${theme.fg("dim", `#${args.id}`)}`;
  return core;
}

function idSubject(args: TodoArgs, details: unknown): string | null {
  if (args.id !== undefined) return findSubjectById(details, args.id);
  return null;
}

function listCore(core: string, args: TodoArgs, theme: Theme): string {
  let out = core;
  if (args.status) out += ` ${theme.fg("muted", args.status)}`;
  if (args.includeDeleted) out += ` ${theme.fg("muted", "+deleted")}`;
  return out;
}

function todoCore(
  displayName: string,
  toolName: string,
  args: TodoArgs,
  theme: Theme,
  details: unknown,
): { core: string; subject: string | null } {
  let core = theme.fg("toolTitle", theme.bold(displayName));
  let subject: string | null = null;

  switch (toolName) {
    case "todo_create":
      subject = args.subject?.trim() || null;
      break;
    case "todo_update":
      if (args.status) core += ` ${theme.fg(stateColor(args.status), `[${args.status}]`)}`;
      core = idTaggedCore(core, args, theme);
      subject = idSubject(args, details);
      break;
    case "todo_get":
    case "todo_delete":
      core = idTaggedCore(core, args, theme);
      subject = idSubject(args, details);
      break;
    case "todo_list":
      core = listCore(core, args, theme);
      break;
  }

  return { core, subject };
}

export function createTodoAdapter(toolName: string): ToolDisplayAdapter<TodoArgs> {
  const displayName = toolName
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

  return {
    formatCallHeader(args, theme, details, _isPartial, _expanded, width) {
      const { core, subject } = todoCore(displayName, toolName, args, theme, details);
      if (!subject) return core;
      return attachSubject(core, theme.fg("dim", subject), width);
    },

    formatCollapsedContent() {
      return [];
    },

    formatExpandedContent(_args, output, theme, width) {
      if (!output) return [];
      return formatExpandedToolOutputLines(output, theme, width);
    },
  };
}

export const todoCreateAdapter = createTodoAdapter("todo_create");
export const todoUpdateAdapter = createTodoAdapter("todo_update");
export const todoListAdapter = createTodoAdapter("todo_list");
export const todoGetAdapter = createTodoAdapter("todo_get");
export const todoDeleteAdapter = createTodoAdapter("todo_delete");
export const todoClearAdapter = createTodoAdapter("todo_clear");
