import { truncateToWidth } from "@earendil-works/pi-tui";
import type { ToolDisplayAdapter } from "../types.ts";
import { INDENT } from "./shared.ts";

interface JournalWriteArgs {
  title?: string;
  body?: string;
  tags?: string[];
}

export const journalWriteAdapter: ToolDisplayAdapter<JournalWriteArgs> = {
  formatCallHeader(args, theme) {
    const title = args?.title ?? "";
    return `${theme.fg("toolTitle", theme.bold("Journal write"))} ${theme.fg("accent", title)}`;
  },

  formatCollapsedContent(_args, _output, theme) {
    return [`${INDENT}${theme.fg("success", "written")}`];
  },

  formatExpandedContent(_args, _output, _theme) {
    return [];
  },
};

interface JournalReadArgs {
  id?: string;
}

interface JournalReadDetails {
  id?: string;
  content_preview?: string;
  content_lines?: number;
}

export const journalReadAdapter: ToolDisplayAdapter<JournalReadArgs> = {
  formatCallHeader(args, theme) {
    const id = args?.id ?? "";
    return `${theme.fg("toolTitle", theme.bold("Journal read"))} ${theme.fg("accent", id)}`;
  },

  formatCollapsedContent(_args, _output, theme, width, details) {
    const d = details as JournalReadDetails | undefined;
    const count = d?.content_lines ?? 0;
    if (count === 0) return [`${INDENT}${theme.fg("muted", "empty")}`];
    const preview = d?.content_preview?.split("\n")[0] ?? "";
    const truncated = preview.length > 100 ? `${preview.slice(0, 99)}…` : preview;
    const line = `${INDENT}${theme.fg("success", `${count} line${count === 1 ? "" : "s"}`)} ${theme.fg("dim", truncated)}`;
    return [truncateToWidth(line, width, "…")];
  },

  formatExpandedContent(_args, _output, theme, width, details) {
    const d = details as JournalReadDetails | undefined;
    const content = d?.content_preview ?? "";
    if (!content) return [];
    const allLines = content.split(/\r?\n/);
    const limit = 20;
    const lines = allLines
      .slice(0, limit)
      .map(
        (line) =>
          INDENT + theme.fg("muted", "│ ") + truncateToWidth(theme.fg("dim", line), width - INDENT.length - 4, "…"),
      );
    if (allLines.length > limit) {
      lines.push(INDENT + theme.fg("muted", `│ … ${allLines.length - limit} more line(s)`));
    }
    return lines;
  },
};

interface JournalSearchArgs {
  text?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}

interface JournalSearchDetails {
  query?: unknown;
  total?: number;
  items?: Array<{ id: string; title: string }>;
}

export const journalSearchAdapter: ToolDisplayAdapter<JournalSearchArgs> = {
  formatCallHeader(args, theme) {
    const query = args?.text ?? (args?.tags?.length ? args.tags.join(",") : "");
    return `${theme.fg("toolTitle", theme.bold("Journal search"))} ${theme.fg("accent", query || "(all)")}`;
  },

  formatCollapsedContent(_args, _output, theme, width, details) {
    const d = details as JournalSearchDetails | undefined;
    const total = d?.total ?? 0;
    if (total === 0) {
      return [`${INDENT}${theme.fg("muted", "no results")}`];
    }
    const first = d?.items?.[0];
    const parts: string[] = [INDENT, theme.fg("success", `${total} result${total === 1 ? "" : "s"}`)];
    if (first) {
      parts.push(" ");
      parts.push(theme.fg("dim", first.id));
      if (first.title) {
        const snip = first.title.length > 80 ? `${first.title.slice(0, 79)}…` : first.title;
        parts.push(` ${theme.fg("dim", snip)}`);
      }
    }
    const more = total > 1 ? theme.fg("dim", ` · ${total - 1} more`) : "";
    return [truncateToWidth(parts.join("") + more, width, "…")];
  },

  formatExpandedContent(_args, _output, theme, _width, details) {
    const d = details as JournalSearchDetails | undefined;
    const items = d?.items ?? [];
    const total = d?.total ?? 0;
    const limit = 10;
    const lines: string[] = [];
    for (let i = 0; i < Math.min(limit, items.length); i++) {
      const item = items[i]!;
      const isLast = i === Math.min(limit, items.length) - 1 && total <= limit;
      const connector = isLast ? "  └ " : "  │ ";
      const idLine =
        theme.fg("dim", item.id) +
        (item.title ? ` ${theme.fg("dim", item.title.length > 100 ? `${item.title.slice(0, 99)}…` : item.title)}` : "");
      lines.push(INDENT + theme.fg("muted", connector.replace(/^\s{2}/, "")) + idLine);
    }
    if (total > limit) {
      lines.push(INDENT + theme.fg("muted", `  └ … ${total - limit} more result${total - limit === 1 ? "" : "s"}`));
    }
    return lines;
  },
};
