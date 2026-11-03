import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Task, TaskStatus } from "../tool/types.ts";

export function statusGlyph(status: TaskStatus): string {
  switch (status) {
    case "pending":
      return "\u{F0131}"; // nf-md-checkbox_blank_outline
    case "in_progress":
      return "\u{F0856}"; // nf-md-checkbox_intermediate
    case "completed":
      return "\u{F0132}"; // nf-md-checkbox_marked
    case "deleted":
      return "\u{F0157}"; // nf-md-close_box
  }
}

function overlayStatusGlyph(status: TaskStatus, theme: Theme): string {
  switch (status) {
    case "pending":
      return theme.fg("dim", statusGlyph(status));
    case "in_progress":
      return theme.fg("warning", statusGlyph(status));
    case "completed":
      return theme.fg("success", statusGlyph(status));
    case "deleted":
      return theme.fg("error", statusGlyph(status));
  }
}

export function formatOverlayTaskLine(t: Task, theme: Theme, showId: boolean): string {
  const glyph = overlayStatusGlyph(t.status, theme);
  const subjectColor = t.status === "completed" || t.status === "deleted" ? "dim" : "text";
  let subject = theme.fg(subjectColor, t.subject);
  if (t.status === "completed" || t.status === "deleted") {
    subject = theme.strikethrough(subject);
  }
  let line = `${glyph}`;
  if (showId) line += ` ${theme.fg("accent", `#${t.id}`)}`;
  line += ` ${subject}`;
  if (t.status === "in_progress" && t.activeForm) {
    line += ` ${theme.fg("dim", `(${t.activeForm})`)}`;
  }
  if (t.blockedBy && t.blockedBy.length > 0) {
    line += ` ${theme.fg("dim", `⛓ ${t.blockedBy.map((id) => `#${id}`).join(",")}`)}`;
  }
  return line;
}

export function formatCommandTaskLine(t: Task, glyph: string): string {
  const form = t.status === "in_progress" && t.activeForm ? ` (${t.activeForm})` : "";
  const block = t.blockedBy?.length ? `    ⛓ ${t.blockedBy.map((id) => `#${id}`).join(",")}` : "";
  return `  ${glyph} #${t.id} ${t.subject}${form}${block}`;
}

export function formatTaskListLine(t: Task): string {
  const block = t.blockedBy?.length ? ` ⛓ ${t.blockedBy.map((id) => `#${id}`).join(",")}` : "";
  const form = t.status === "in_progress" && t.activeForm ? ` (${t.activeForm})` : "";
  return `[${t.status}] #${t.id} ${t.subject}${form}${block}`;
}
