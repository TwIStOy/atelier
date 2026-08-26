import type { Task } from "../tool/types.ts";
import { formatTaskListLine } from "../view/format.ts";

const REMINDER_NUDGE =
  "The todo tools haven't been used recently. If you're working on tasks that would benefit from tracking progress, use todo_update to keep task status current (in_progress when starting, completed when done) and todo_create for newly discovered work. Also consider cleaning up the list if it has become stale. Only do so if it's relevant to the current work. This is just a gentle reminder - ignore if not applicable.";

const REMINDER_SECRECY = "Make sure that you NEVER mention this reminder to the user.";

export function buildReminderMessage(tasks: readonly Task[]): string {
  const lines = ["<system-reminder>", REMINDER_NUDGE, "", "Current todo list:"];
  for (const task of tasks) {
    lines.push(formatTaskListLine(task));
  }
  lines.push("", REMINDER_SECRECY, "</system-reminder>");
  return lines.join("\n");
}
