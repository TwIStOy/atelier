import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { diffLines } from "diff";
import { loadConfig } from "../config.ts";
import type { ToolDisplayAdapter } from "../types.ts";
import { formatExpandedToolOutputLines } from "./shared.ts";

function isSingleLine(): boolean {
  return loadConfig().memoryStyle === "single-line";
}

function inlineSuffix(base: string, suffix: string, width?: number): string {
  if (!suffix) return base;
  if (width !== undefined && visibleWidth(base) + 1 + visibleWidth(suffix) > width) return base;
  return `${base} ${suffix}`;
}

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

function createSummary(theme: Theme, args: MemoryCreateArgs | undefined, details: unknown): string {
  const d = details as MemoryCreateDetails | undefined;
  const preview = d?.content_preview ?? args?.content?.slice(0, 120) ?? "";
  const lines = d?.content_lines ?? args?.content?.split("\n").length ?? 0;
  const first = preview.split("\n")[0] ?? "";
  const truncated = first.length > 100 ? `${first.slice(0, 99)}…` : first;
  const moreHint = lines > 1 ? theme.fg("dim", ` · ${lines - 1} more`) : "";
  return `${theme.fg("success", "created")} ${theme.fg("dim", truncated)}${moreHint}`;
}

export const memoryCreateAdapter: ToolDisplayAdapter<MemoryCreateArgs> = {
  formatCallHeader(args, theme, details, _isPartial, _expanded, width) {
    const uri = args?.parent_uri ?? "";
    const title = args?.title ?? "";
    const suffix = title ? ` → ${title}` : "";
    const base =
      theme.fg("toolTitle", theme.bold("Memory create")) +
      " " +
      theme.fg("accent", uri) +
      (suffix ? theme.fg("dim", suffix) : "");
    if (!isSingleLine()) return base;
    return inlineSuffix(base, createSummary(theme, args, details), width);
  },

  formatCollapsedContent(args, _output, theme, width, details) {
    if (isSingleLine()) return [];
    return [truncateToWidth(`└ ${createSummary(theme, args, details)}`, width, "…")];
  },

  formatExpandedContent(args, _output, theme, width) {
    const content = args?.content ?? "";
    const allLines = content.split(/\r?\n/);
    const limit = 20;
    const lines = allLines
      .slice(0, limit)
      .map((line) => truncateToWidth(theme.fg("dim", line), Math.max(1, width), "…"));
    if (allLines.length > limit) {
      lines.push(theme.fg("muted", `… ${allLines.length - limit} more line(s)`));
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

function readSummary(theme: Theme, details: unknown): string {
  const d = details as MemoryReadDetails | undefined;
  const count = d?.content_lines ?? 0;
  if (count === 0) return theme.fg("muted", "empty");
  const preview = d?.content_preview?.split("\n")[0] ?? "";
  const truncated = preview.length > 100 ? `${preview.slice(0, 99)}…` : preview;
  return `${theme.fg("success", `${count} line${count === 1 ? "" : "s"}`)} ${theme.fg("dim", truncated)}`;
}

export const memoryReadAdapter: ToolDisplayAdapter<MemoryReadArgs> = {
  formatCallHeader(args, theme, details, _isPartial, _expanded, width) {
    const uri = args?.uri ?? "";
    const base = `${theme.fg("toolTitle", theme.bold("Memory read"))} ${theme.fg("accent", uri)}`;
    if (!isSingleLine()) return base;
    return inlineSuffix(base, readSummary(theme, details), width);
  },

  formatCollapsedContent(_args, _output, theme, width, details) {
    if (isSingleLine()) return [];
    const d = details as MemoryReadDetails | undefined;
    if ((d?.content_lines ?? 0) === 0) {
      return [theme.fg("muted", "└ empty")];
    }
    return [truncateToWidth(`└ ${readSummary(theme, details)}`, width, "…")];
  },

  formatExpandedContent(_args, _output, theme, width, details) {
    const d = details as MemoryReadDetails | undefined;
    const content = d?.content_preview ?? "";
    if (!content) return [];
    const allLines = content.split(/\r?\n/);
    const limit = 20;
    const lines = allLines
      .slice(0, limit)
      .map((line) => truncateToWidth(theme.fg("dim", line), Math.max(1, width), "…"));
    if (allLines.length > limit) {
      lines.push(theme.fg("muted", `… ${allLines.length - limit} more line(s)`));
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

function updateSummary(theme: Theme, details: unknown): string {
  const d = details as MemoryUpdateDetails | undefined;
  const parts: string[] = [];
  if (d?.mode === "patch") {
    if ((d?.diff_adds ?? 0) > 0) parts.push(theme.fg("success", `+${d!.diff_adds}`));
    if ((d?.diff_removes ?? 0) > 0) parts.push(theme.fg("error", `-${d!.diff_removes}`));
  } else if (d?.mode === "append") {
    parts.push(theme.fg("success", "appended"));
  }
  const meta: string[] = [];
  if (d?.priority !== undefined) meta.push(`p${d.priority}`);
  if (d?.disclosure !== undefined) meta.push("disclosure");
  const diffSummary = parts.length > 0 ? parts.join(" ") : theme.fg("success", "updated");
  const metaStr = meta.length > 0 ? ` · ${meta.join(", ")}` : "";
  return `${diffSummary}${theme.fg("dim", metaStr)}`;
}

export const memoryUpdateAdapter: ToolDisplayAdapter<MemoryUpdateArgs> = {
  formatCallHeader(args, theme, details, _isPartial, _expanded, width) {
    const uri = args?.uri ?? "";
    const base = `${theme.fg("toolTitle", theme.bold("Memory update"))} ${theme.fg("accent", uri)}`;
    if (!isSingleLine()) return base;
    return inlineSuffix(base, updateSummary(theme, details), width);
  },

  formatCollapsedContent(_args, _output, theme, width, details) {
    if (isSingleLine()) return [];
    return [truncateToWidth(`└ ${updateSummary(theme, details)}`, width, "…")];
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
        lines.push(prefix + truncateToWidth(content, Math.max(1, width - 2), "…"));
      }
    }
    return lines;
  },
};

interface MemoryDeleteArgs {
  uri?: string;
}

export const memoryDeleteAdapter: ToolDisplayAdapter<MemoryDeleteArgs> = {
  formatCallHeader(args, theme, _details, _isPartial, _expanded, width) {
    const uri = args?.uri ?? "";
    const base = `${theme.fg("toolTitle", theme.bold("Memory delete"))} ${theme.fg("accent", uri)}`;
    if (!isSingleLine()) return base;
    return inlineSuffix(base, theme.fg("success", "deleted"), width);
  },

  formatCollapsedContent(_args, _output, theme) {
    if (isSingleLine()) return [];
    return [theme.fg("muted", "└ deleted")];
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

function searchSummary(theme: Theme, details: unknown): string {
  const d = details as MemorySearchDetails | undefined;
  const total = d?.total ?? 0;
  if (total === 0) return theme.fg("muted", "no results");
  const first = d?.items?.[0];
  const parts: string[] = [theme.fg("success", `${total} result${total === 1 ? "" : "s"}`)];
  if (first) {
    parts.push(" ");
    parts.push(theme.fg("accent", first.uri));
    if (first.snippet) {
      const snip = first.snippet.length > 80 ? `${first.snippet.slice(0, 79)}…` : first.snippet;
      parts.push(` ${theme.fg("dim", snip)}`);
    }
  }
  const more = total > 1 ? theme.fg("dim", ` · ${total - 1} more`) : "";
  return parts.join("") + more;
}

export const memorySearchAdapter: ToolDisplayAdapter<MemorySearchArgs> = {
  formatCallHeader(args, theme, details, _isPartial, _expanded, width) {
    const query = args?.query ?? "";
    const base = `${theme.fg("toolTitle", theme.bold("Memory search"))} ${theme.fg("accent", query)}`;
    if (!isSingleLine()) return base;
    return inlineSuffix(base, searchSummary(theme, details), width);
  },

  formatCollapsedContent(_args, _output, theme, width, details) {
    if (isSingleLine()) return [];
    const d = details as MemorySearchDetails | undefined;
    if ((d?.total ?? 0) === 0) {
      return [theme.fg("muted", "└ no results")];
    }
    return [truncateToWidth(`└ ${searchSummary(theme, details)}`, width, "…")];
  },

  formatExpandedContent(_args, _output, theme, _width, details) {
    const d = details as MemorySearchDetails | undefined;
    const items = d?.items ?? [];
    const total = d?.total ?? 0;
    const limit = 10;
    const lines: string[] = [];
    for (let i = 0; i < Math.min(limit, items.length); i++) {
      const item = items[i]!;
      lines.push(theme.fg("accent", item.uri));
      if (item.snippet) {
        const snip = item.snippet.length > 100 ? `${item.snippet.slice(0, 99)}…` : item.snippet;
        lines.push(theme.fg("dim", snip));
      }
    }
    if (total > limit) {
      lines.push(theme.fg("muted", `└ … ${total - limit} more result${total - limit === 1 ? "" : "s"}`));
    }
    return lines;
  },
};

interface MemoryListArgs {
  domain?: string;
}

function listSummary(theme: Theme, output: string): string {
  if (!output) return theme.fg("muted", "empty");
  const n = output.split("\n").length;
  return theme.fg("success", `${n} line${n === 1 ? "" : "s"}`);
}

export const memoryListAdapter: ToolDisplayAdapter<MemoryListArgs> = {
  formatCallHeader(args, theme, _details, _isPartial, _expanded, width, output) {
    const domain = args?.domain ?? "";
    const base = `${theme.fg("toolTitle", theme.bold("Memory list"))} ${theme.fg("accent", domain || "(all)")}`;
    if (!isSingleLine()) return base;
    return inlineSuffix(base, listSummary(theme, output ?? ""), width);
  },

  formatCollapsedContent(_args, output, theme) {
    if (isSingleLine()) return [];
    return [`└ ${listSummary(theme, output)}`];
  },

  formatExpandedContent(_args, output, theme, width) {
    return formatExpandedToolOutputLines(output, theme, width);
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
  formatCallHeader(args, theme, details, _isPartial, _expanded, width) {
    const isRemove = !!args?.remove_uri;
    let base: string;
    if (isRemove) {
      base =
        theme.fg("toolTitle", theme.bold("Memory alias")) +
        " " +
        theme.fg("accent", args!.remove_uri!) +
        theme.fg("dim", " (remove)");
    } else {
      const suffix = args?.target_uri ? ` → ${args.target_uri}` : "";
      base =
        theme.fg("toolTitle", theme.bold("Memory alias")) +
        " " +
        theme.fg("accent", args?.new_uri ?? "") +
        (suffix ? theme.fg("dim", suffix) : "");
    }
    if (!isSingleLine()) return base;
    const d = details as MemoryAliasDetails | undefined;
    const label = d?.is_remove ? "removed" : "created";
    return inlineSuffix(base, theme.fg("success", label), width);
  },

  formatCollapsedContent(_args, _output, theme, _width, details) {
    if (isSingleLine()) return [];
    const d = details as MemoryAliasDetails | undefined;
    const label = d?.is_remove ? "removed" : "created";
    return [`└ ${theme.fg("success", label)}`];
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

function triggersSummary(theme: Theme, details: unknown): string {
  const d = details as MemoryTriggersDetails | undefined;
  const parts: string[] = [];
  if ((d?.added ?? 0) > 0) parts.push(theme.fg("success", `+${d!.added} keyword${d!.added === 1 ? "" : "s"}`));
  if ((d?.removed ?? 0) > 0) parts.push(theme.fg("error", `-${d!.removed} keyword${d!.removed === 1 ? "" : "s"}`));
  return parts.length > 0 ? parts.join(", ") : theme.fg("success", "updated");
}

export const memoryTriggersAdapter: ToolDisplayAdapter<MemoryTriggersArgs> = {
  formatCallHeader(args, theme, details, _isPartial, _expanded, width) {
    const uri = args?.uri ?? "";
    const parts: string[] = [];
    if (args?.add?.length) parts.push(`+${args.add.length}`);
    if (args?.remove?.length) parts.push(`-${args.remove.length}`);
    const suffix = parts.length > 0 ? ` ${parts.join(" ")}` : "";
    const base =
      theme.fg("toolTitle", theme.bold("Memory triggers")) +
      " " +
      theme.fg("accent", uri) +
      (suffix ? theme.fg("dim", suffix) : "");
    if (!isSingleLine()) return base;
    return inlineSuffix(base, triggersSummary(theme, details), width);
  },

  formatCollapsedContent(_args, _output, theme, _width, details) {
    if (isSingleLine()) return [];
    return [`└ ${triggersSummary(theme, details)}`];
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

function historySummary(theme: Theme, details: unknown): string {
  const d = details as MemoryHistoryDetails | undefined;
  const total = d?.total ?? 0;
  if (total === 0) return theme.fg("muted", "no versions");
  const first = d?.versions?.[0] ?? "";
  const more = total > 1 ? theme.fg("dim", ` · ${total - 1} more`) : "";
  return `${theme.fg("success", `${total} version${total === 1 ? "" : "s"}`)} ${theme.fg("dim", first)}${more}`;
}

export const memoryHistoryAdapter: ToolDisplayAdapter<MemoryHistoryArgs> = {
  formatCallHeader(args, theme, details, _isPartial, _expanded, width) {
    const uri = args?.uri ?? "";
    const base = `${theme.fg("toolTitle", theme.bold("Memory history"))} ${theme.fg("accent", uri)}`;
    if (!isSingleLine()) return base;
    return inlineSuffix(base, historySummary(theme, details), width);
  },

  formatCollapsedContent(_args, _output, theme, width, details) {
    if (isSingleLine()) return [];
    const d = details as MemoryHistoryDetails | undefined;
    if ((d?.total ?? 0) === 0) {
      return [theme.fg("muted", "└ no versions")];
    }
    return [truncateToWidth(`└ ${historySummary(theme, details)}`, width, "…")];
  },

  formatExpandedContent(_args, _output, theme, _width, details) {
    const d = details as MemoryHistoryDetails | undefined;
    const versions = d?.versions ?? [];
    const total = d?.total ?? 0;
    const limit = 15;
    const lines = versions.slice(0, limit).map((v) => theme.fg("dim", v));
    if (total > limit) {
      lines.push(theme.fg("muted", `└ … ${total - limit} more version${total - limit === 1 ? "" : "s"}`));
    }
    return lines;
  },
};

interface MemoryDomainsDetails {
  total?: number;
  domains?: string[];
}

function domainsSummary(theme: Theme, details: unknown): string {
  const d = details as MemoryDomainsDetails | undefined;
  const total = d?.total ?? 0;
  if (total === 0) return theme.fg("muted", "none");
  const first = d?.domains?.[0] ?? "";
  const more = total > 1 ? theme.fg("dim", ` · ${total - 1} more`) : "";
  return `${theme.fg("success", `${total} domain${total === 1 ? "" : "s"}`)} ${theme.fg("dim", first)}${more}`;
}

export const memoryDomainsAdapter: ToolDisplayAdapter<Record<string, unknown>> = {
  formatCallHeader(_args, theme, details, _isPartial, _expanded, width) {
    const base = theme.fg("toolTitle", theme.bold("Memory domains"));
    if (!isSingleLine()) return base;
    return inlineSuffix(base, domainsSummary(theme, details), width);
  },

  formatCollapsedContent(_args, _output, theme, width, details) {
    if (isSingleLine()) return [];
    const d = details as MemoryDomainsDetails | undefined;
    if ((d?.total ?? 0) === 0) {
      return [theme.fg("muted", "└ none")];
    }
    return [truncateToWidth(`└ ${domainsSummary(theme, details)}`, width, "…")];
  },

  formatExpandedContent(_args, _output, theme, _width, details) {
    const d = details as MemoryDomainsDetails | undefined;
    const items = d?.domains ?? [];
    return items.map((item) => theme.fg("dim", item));
  },
};
