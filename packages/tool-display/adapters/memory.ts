import { diffLines } from "diff";
import { truncateToWidth } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ToolDisplayAdapter } from "../types.ts";
import { INDENT } from "./shared.ts";

interface MemoryCreateArgs {
  parent_uri?: string;
  title?: string;
  content?: string;
  priority?: number;
  disclosure?: string;
}

interface MemoryCreateDetails {
  parent_uri?: string;
  title?: string;
  content_preview?: string;
  content_lines?: number;
}

export const memoryCreateAdapter: ToolDisplayAdapter<MemoryCreateArgs> = {
  formatCallHeader(args, theme) {
    const uri = args?.parent_uri ?? "";
    const title = args?.title ?? "";
    const suffix = title ? ` → ${title}` : "";
    return (
      theme.fg("toolTitle", theme.bold("Memory create")) +
      " " +
      theme.fg("accent", uri) +
      (suffix ? theme.fg("dim", suffix) : "")
    );
  },

  formatCollapsedContent(args, _output, theme, width, details) {
    const d = details as MemoryCreateDetails | undefined;
    const preview = d?.content_preview ?? args?.content?.slice(0, 120) ?? "";
    const lines = d?.content_lines ?? args?.content?.split("\n").length ?? 0;
    const first = preview.split("\n")[0] ?? "";
    const truncated = first.length > 100 ? `${first.slice(0, 99)}…` : first;
    const moreHint = lines > 1 ? theme.fg("dim", ` · ${lines - 1} more`) : "";
    const line = `${INDENT}${theme.fg("success", "created")} ${theme.fg("dim", truncated)}${moreHint}`;
    return [truncateToWidth(line, width, "…")];
  },

  formatExpandedContent(args, _output, theme, width, details) {
    const d = details as MemoryCreateDetails | undefined;
    const content = args?.content ?? "";
    const allLines = content.split(/\r?\n/);
    const limit = 20;
    const lines = allLines
      .slice(0, limit)
      .map(
        (line) =>
          INDENT +
          theme.fg("muted", "│ ") +
          truncateToWidth(
            theme.fg("dim", line),
            width - INDENT.length - 4,
            "…",
          ),
      );
    if (allLines.length > limit) {
      lines.push(
        INDENT +
          theme.fg("muted", `│ … ${allLines.length - limit} more line(s)`),
      );
    }
    return lines;
  },
};

interface MemoryReadArgs {
  uri?: string;
}

interface MemoryReadDetails {
  uri?: string;
  content_preview?: string;
  content_lines?: number;
}

export const memoryReadAdapter: ToolDisplayAdapter<MemoryReadArgs> = {
  formatCallHeader(args, theme) {
    const uri = args?.uri ?? "";
    return (
      theme.fg("toolTitle", theme.bold("Memory read")) +
      " " +
      theme.fg("accent", uri)
    );
  },

  formatCollapsedContent(_args, _output, theme, width, details) {
    const d = details as MemoryReadDetails | undefined;
    const count = d?.content_lines ?? 0;
    const preview = d?.content_preview?.split("\n")[0] ?? "";
    const truncated =
      preview.length > 100 ? `${preview.slice(0, 99)}…` : preview;
    if (count === 0) {
      return [`${INDENT}${theme.fg("muted", "empty")}`];
    }
    const line = `${INDENT}${theme.fg("success", `${count} line${count === 1 ? "" : "s"}`)} ${theme.fg("dim", truncated)}`;
    return [truncateToWidth(line, width, "…")];
  },

  formatExpandedContent(_args, output, theme, width, details) {
    const d = details as MemoryReadDetails | undefined;
    const content = d?.content_preview ?? "";
    if (!content) return [];
    const allLines = content.split(/\r?\n/);
    const limit = 20;
    const lines = allLines
      .slice(0, limit)
      .map(
        (line) =>
          INDENT +
          theme.fg("muted", "│ ") +
          truncateToWidth(
            theme.fg("dim", line),
            width - INDENT.length - 4,
            "…",
          ),
      );
    if (allLines.length > limit) {
      lines.push(
        INDENT +
          theme.fg("muted", `│ … ${allLines.length - limit} more line(s)`),
      );
    }
    return lines;
  },
};

interface MemoryUpdateArgs {
  uri?: string;
  old_string?: string;
  new_string?: string;
  append?: string;
  priority?: number;
  disclosure?: string;
}

interface MemoryUpdateDetails {
  uri?: string;
  mode?: string;
  diff_adds?: number;
  diff_removes?: number;
  priority?: number;
  disclosure?: string;
}

export const memoryUpdateAdapter: ToolDisplayAdapter<MemoryUpdateArgs> = {
  formatCallHeader(args, theme) {
    const uri = args?.uri ?? "";
    return (
      theme.fg("toolTitle", theme.bold("Memory update")) +
      " " +
      theme.fg("accent", uri)
    );
  },

  formatCollapsedContent(_args, _output, theme, width, details) {
    const d = details as MemoryUpdateDetails | undefined;
    const parts: string[] = [];
    if (d?.mode === "patch") {
      if ((d?.diff_adds ?? 0) > 0)
        parts.push(theme.fg("success", `+${d!.diff_adds}`));
      if ((d?.diff_removes ?? 0) > 0)
        parts.push(theme.fg("error", `-${d!.diff_removes}`));
    } else if (d?.mode === "append") {
      parts.push(theme.fg("success", "appended"));
    }
    const meta: string[] = [];
    if (d?.priority !== undefined) meta.push(`p${d.priority}`);
    if (d?.disclosure !== undefined) meta.push("disclosure");
    const diffSummary =
      parts.length > 0 ? parts.join(" ") : theme.fg("success", "updated");
    const metaStr = meta.length > 0 ? ` · ${meta.join(", ")}` : "";
    const line = `${INDENT}${diffSummary}${theme.fg("dim", metaStr)}`;
    return [truncateToWidth(line, width, "…")];
  },

  formatExpandedContent(args, _output, theme, width, details) {
    const d = details as MemoryUpdateDetails | undefined;
    if (d?.mode !== "patch") return [];
    const oldText = args?.old_string ?? "";
    const newText = args?.new_string ?? "";
    const changes = diffLines(oldText, newText);
    const lines: string[] = [];
    for (const change of changes) {
      const changeLines = change.value.replace(/\n$/, "").split("\n");
      for (const line of changeLines) {
        const prefix = change.added
          ? theme.fg("success", "+ ")
          : change.removed
            ? theme.fg("error", "- ")
            : theme.fg("dim", "  ");
        const content = change.added
          ? theme.fg("success", line)
          : change.removed
            ? theme.fg("error", line)
            : theme.fg("dim", line);
        lines.push(
          INDENT +
            prefix +
            truncateToWidth(content, width - INDENT.length - 4, "…"),
        );
      }
    }
    return lines;
  },
};

interface MemoryDeleteArgs {
  uri?: string;
}

export const memoryDeleteAdapter: ToolDisplayAdapter<MemoryDeleteArgs> = {
  formatCallHeader(args, theme) {
    const uri = args?.uri ?? "";
    return (
      theme.fg("toolTitle", theme.bold("Memory delete")) +
      " " +
      theme.fg("accent", uri)
    );
  },

  formatCollapsedContent(_args, _output, theme) {
    return [`${INDENT}${theme.fg("success", "deleted")}`];
  },

  formatExpandedContent(_args, _output, _theme) {
    return [];
  },
};

interface MemorySearchArgs {
  query?: string;
  limit?: number;
}

interface MemorySearchDetails {
  query?: string;
  total?: number;
  items?: Array<{ uri: string; snippet?: string }>;
}

export const memorySearchAdapter: ToolDisplayAdapter<MemorySearchArgs> = {
  formatCallHeader(args, theme) {
    const query = args?.query ?? "";
    return (
      theme.fg("toolTitle", theme.bold("Memory search")) +
      " " +
      theme.fg("accent", query)
    );
  },

  formatCollapsedContent(_args, _output, theme, width, details) {
    const d = details as MemorySearchDetails | undefined;
    const total = d?.total ?? 0;
    if (total === 0) {
      return [`${INDENT}${theme.fg("muted", "no results")}`];
    }
    const first = d?.items?.[0];
    const parts: string[] = [
      INDENT,
      theme.fg("success", `${total} result${total === 1 ? "" : "s"}`),
    ];
    if (first) {
      parts.push(" ");
      parts.push(theme.fg("accent", first.uri));
      if (first.snippet) {
        const snip =
          first.snippet.length > 80
            ? `${first.snippet.slice(0, 79)}…`
            : first.snippet;
        parts.push(` ${theme.fg("dim", snip)}`);
      }
    }
    const more = total > 1 ? theme.fg("dim", ` · ${total - 1} more`) : "";
    return [truncateToWidth(parts.join("") + more, width, "…")];
  },

  formatExpandedContent(_args, _output, theme, width, details) {
    const d = details as MemorySearchDetails | undefined;
    const items = d?.items ?? [];
    const total = d?.total ?? 0;
    const limit = 10;
    const lines: string[] = [];
    for (let i = 0; i < Math.min(limit, items.length); i++) {
      const item = items[i]!;
      const isLast = i === Math.min(limit, items.length) - 1 && total <= limit;
      const connector = isLast ? "  └ " : "  │ ";
      lines.push(
        INDENT +
          theme.fg("muted", connector.replace(/^\s{2}/, "")) +
          theme.fg("accent", item.uri),
      );
      if (item.snippet) {
        const snip =
          item.snippet.length > 100
            ? `${item.snippet.slice(0, 99)}…`
            : item.snippet;
        lines.push(
          `${INDENT}${theme.fg("muted", "    │ ")}${theme.fg("dim", snip)}`,
        );
      }
    }
    if (total > limit) {
      lines.push(
        `${INDENT}${theme.fg("muted", `  └ … ${total - limit} more result${total - limit === 1 ? "" : "s"}`)}`,
      );
    }
    return lines;
  },
};

interface MemoryListArgs {
  domain?: string;
}

export const memoryListAdapter: ToolDisplayAdapter<MemoryListArgs> = {
  formatCallHeader(args, theme) {
    const domain = args?.domain ?? "";
    return (
      theme.fg("toolTitle", theme.bold("Memory list")) +
      " " +
      theme.fg("accent", domain || "(all)")
    );
  },

  formatCollapsedContent(_args, output, theme, width) {
    if (!output) return [`${INDENT}${theme.fg("muted", "empty")}`];
    const n = output.split("\n").length;
    return [
      `${INDENT}${theme.fg("success", `${n} line${n === 1 ? "" : "s"}`)}`,
    ];
  },

  formatExpandedContent(_args, output, theme, width) {
    if (!output) return [];
    return output
      .split("\n")
      .map(
        (line) =>
          INDENT +
          truncateToWidth(
            theme.fg("toolOutput", line),
            width - INDENT.length,
            "…",
          ),
      );
  },
};

interface MemoryAliasArgs {
  new_uri?: string;
  target_uri?: string;
  remove_uri?: string;
}

interface MemoryAliasDetails {
  is_remove?: boolean;
  uri?: string;
  target_uri?: string;
}

export const memoryAliasAdapter: ToolDisplayAdapter<MemoryAliasArgs> = {
  formatCallHeader(args, theme, _details) {
    const isRemove = !!args?.remove_uri;
    if (isRemove) {
      return (
        theme.fg("toolTitle", theme.bold("Memory alias")) +
        " " +
        theme.fg("accent", args!.remove_uri!) +
        theme.fg("dim", " (remove)")
      );
    }
    const suffix = args?.target_uri ? ` → ${args.target_uri}` : "";
    return (
      theme.fg("toolTitle", theme.bold("Memory alias")) +
      " " +
      theme.fg("accent", args?.new_uri ?? "") +
      (suffix ? theme.fg("dim", suffix) : "")
    );
  },

  formatCollapsedContent(_args, _output, theme, _width, details) {
    const d = details as MemoryAliasDetails | undefined;
    const label = d?.is_remove ? "removed" : "created";
    return [`${INDENT}${theme.fg("success", label)}`];
  },

  formatExpandedContent(_args, _output, _theme) {
    return [];
  },
};

interface MemoryTriggersArgs {
  uri?: string;
  add?: string[];
  remove?: string[];
}

interface MemoryTriggersDetails {
  uri?: string;
  added?: number;
  removed?: number;
}

export const memoryTriggersAdapter: ToolDisplayAdapter<MemoryTriggersArgs> = {
  formatCallHeader(args, theme) {
    const uri = args?.uri ?? "";
    const parts: string[] = [];
    if (args?.add?.length) parts.push(`+${args.add.length}`);
    if (args?.remove?.length) parts.push(`-${args.remove.length}`);
    const suffix = parts.length > 0 ? ` ${parts.join(" ")}` : "";
    return (
      theme.fg("toolTitle", theme.bold("Memory triggers")) +
      " " +
      theme.fg("accent", uri) +
      (suffix ? theme.fg("dim", suffix) : "")
    );
  },

  formatCollapsedContent(_args, _output, theme, _width, details) {
    const d = details as MemoryTriggersDetails | undefined;
    const parts: string[] = [];
    if ((d?.added ?? 0) > 0)
      parts.push(
        theme.fg("success", `+${d!.added} keyword${d!.added === 1 ? "" : "s"}`),
      );
    if ((d?.removed ?? 0) > 0)
      parts.push(
        theme.fg(
          "error",
          `-${d!.removed} keyword${d!.removed === 1 ? "" : "s"}`,
        ),
      );
    const detail =
      parts.length > 0 ? parts.join(", ") : theme.fg("success", "updated");
    return [`${INDENT}${detail}`];
  },

  formatExpandedContent(_args, _output, _theme) {
    return [];
  },
};

interface MemoryHistoryArgs {
  uri?: string;
  limit?: number;
}

interface MemoryHistoryDetails {
  uri?: string;
  total?: number;
  versions?: string[];
}

export const memoryHistoryAdapter: ToolDisplayAdapter<MemoryHistoryArgs> = {
  formatCallHeader(args, theme) {
    const uri = args?.uri ?? "";
    return (
      theme.fg("toolTitle", theme.bold("Memory history")) +
      " " +
      theme.fg("accent", uri)
    );
  },

  formatCollapsedContent(_args, _output, theme, width, details) {
    const d = details as MemoryHistoryDetails | undefined;
    const total = d?.total ?? 0;
    if (total === 0) {
      return [`${INDENT}${theme.fg("muted", "no versions")}`];
    }
    const first = d?.versions?.[0] ?? "";
    const more = total > 1 ? theme.fg("dim", ` · ${total - 1} more`) : "";
    const line = `${INDENT}${theme.fg("success", `${total} version${total === 1 ? "" : "s"}`)} ${theme.fg("dim", first)}${more}`;
    return [truncateToWidth(line, width, "…")];
  },

  formatExpandedContent(_args, _output, theme, width, details) {
    const d = details as MemoryHistoryDetails | undefined;
    const versions = d?.versions ?? [];
    const total = d?.total ?? 0;
    const limit = 15;
    const lines = versions
      .slice(0, limit)
      .map((v) => `${INDENT}${theme.fg("muted", "│ ")}${theme.fg("dim", v)}`);
    if (total > limit) {
      lines.push(
        `${INDENT}${theme.fg("muted", `│ … ${total - limit} more version${total - limit === 1 ? "" : "s"}`)}`,
      );
    }
    return lines;
  },
};

interface MemoryDomainsDetails {
  total?: number;
  domains?: string[];
}

export const memoryDomainsAdapter: ToolDisplayAdapter<Record<string, unknown>> =
  {
    formatCallHeader(_args, theme) {
      return theme.fg("toolTitle", theme.bold("Memory domains"));
    },

    formatCollapsedContent(_args, _output, theme, width, details) {
      const d = details as MemoryDomainsDetails | undefined;
      const total = d?.total ?? 0;
      if (total === 0) {
        return [`${INDENT}${theme.fg("muted", "none")}`];
      }
      const first = d?.domains?.[0] ?? "";
      const more = total > 1 ? theme.fg("dim", ` · ${total - 1} more`) : "";
      const line = `${INDENT}${theme.fg("success", `${total} domain${total === 1 ? "" : "s"}`)} ${theme.fg("dim", first)}${more}`;
      return [truncateToWidth(line, width, "…")];
    },

    formatExpandedContent(_args, _output, theme, _width, details) {
      const d = details as MemoryDomainsDetails | undefined;
      const items = d?.domains ?? [];
      return items.map(
        (item) => `${INDENT}${theme.fg("muted", "│ ")}${theme.fg("dim", item)}`,
      );
    },
  };
