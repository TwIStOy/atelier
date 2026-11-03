import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { diffLines } from "diff";
import { loadConfig } from "../config.ts";
import type { ToolDisplayAdapter } from "../types.ts";
import { countFirstSummary, formatDimPreviewLines, formatExpandedToolOutputLines, listLines } from "./shared.ts";

function isSingleLine(): boolean {
  return loadConfig().memoryStyle === "single-line";
}

function inlineSuffix(base: string, suffix: string, width?: number): string {
  if (!suffix) return base;
  if (width !== undefined && visibleWidth(base) + 1 + visibleWidth(suffix) > width) return base;
  return `${base} ${suffix}`;
}

function textArg(value: string | undefined): string {
  return value ?? "";
}

function countArg(value: number | undefined): number {
  return value ?? 0;
}

function dimSuffix(theme: Theme, value: string): string {
  return value ? theme.fg("dim", value) : "";
}

function memoryHeader(
  theme: Theme,
  title: string,
  uri: string,
  suffix: string,
  summary: string,
  width: number | undefined,
): string {
  const base = `${theme.fg("toolTitle", theme.bold(title))} ${theme.fg("accent", uri)}${suffix}`;
  if (!isSingleLine()) return base;
  return inlineSuffix(base, summary, width);
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

function createPreview(d: MemoryCreateDetails | undefined, args: MemoryCreateArgs | undefined): string {
  return d?.content_preview ?? args?.content?.slice(0, 120) ?? "";
}

function createLineCount(d: MemoryCreateDetails | undefined, args: MemoryCreateArgs | undefined): number {
  return d?.content_lines ?? args?.content?.split("\n").length ?? 0;
}

function createSummary(theme: Theme, args: MemoryCreateArgs | undefined, details: unknown): string {
  const d = details as MemoryCreateDetails | undefined;
  const preview = createPreview(d, args);
  const lines = createLineCount(d, args);
  const first = preview.split("\n")[0] ?? "";
  const truncated = first.length > 100 ? `${first.slice(0, 99)}…` : first;
  const moreHint = lines > 1 ? theme.fg("dim", ` · ${lines - 1} more`) : "";
  return `${theme.fg("success", "created")} ${theme.fg("dim", truncated)}${moreHint}`;
}

export const memoryCreateAdapter: ToolDisplayAdapter<MemoryCreateArgs> = {
  formatCallHeader(args, theme, details, _isPartial, _expanded, width) {
    const title = textArg(args?.title);
    const uri = textArg(args?.parent_uri);
    const suffix = dimSuffix(theme, title ? ` → ${title}` : "");
    return memoryHeader(theme, "Memory create", uri, suffix, createSummary(theme, args, details), width);
  },

  formatCollapsedContent(args, _output, theme, width, details) {
    if (isSingleLine()) return [];
    return [truncateToWidth(`└ ${createSummary(theme, args, details)}`, width, "…")];
  },

  formatExpandedContent(args, _output, theme, width) {
    return formatDimPreviewLines(args?.content ?? "", theme, width);
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
    return formatDimPreviewLines(d?.content_preview ?? "", theme, width);
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

function patchParts(theme: Theme, d: MemoryUpdateDetails): string[] {
  const parts: string[] = [];
  if (countArg(d.diff_adds) > 0) parts.push(theme.fg("success", `+${d.diff_adds}`));
  if (countArg(d.diff_removes) > 0) parts.push(theme.fg("error", `-${d.diff_removes}`));
  return parts;
}

function diffParts(theme: Theme, d: MemoryUpdateDetails | undefined): string[] {
  const mode = d?.mode;
  if (mode === "patch") return patchParts(theme, d!);
  if (mode === "append") return [theme.fg("success", "appended")];
  return [];
}

function updateMeta(d: MemoryUpdateDetails | undefined): string[] {
  const meta: string[] = [];
  if (d?.priority !== undefined) meta.push(`p${d.priority}`);
  if (d?.disclosure !== undefined) meta.push("disclosure");
  return meta;
}

function updateSummary(theme: Theme, details: unknown): string {
  const d = details as MemoryUpdateDetails | undefined;
  const parts = diffParts(theme, d);
  const meta = updateMeta(d);
  const diffSummary = parts.length > 0 ? parts.join(" ") : theme.fg("success", "updated");
  const metaStr = meta.length > 0 ? ` · ${meta.join(", ")}` : "";
  return `${diffSummary}${theme.fg("dim", metaStr)}`;
}

type DiffChange = ReturnType<typeof diffLines>[number];

function changeStyle(change: DiffChange): { role: "success" | "error" | "dim"; mark: string } {
  if (change.added) return { role: "success", mark: "+ " };
  if (change.removed) return { role: "error", mark: "- " };
  return { role: "dim", mark: "  " };
}

function diffLine(change: DiffChange, line: string, theme: Theme, width: number): string {
  const style = changeStyle(change);
  const content = theme.fg(style.role, line);
  return theme.fg(style.role, style.mark) + truncateToWidth(content, Math.max(1, width - 2), "…");
}

function renderDiffLines(changes: DiffChange[], theme: Theme, width: number): string[] {
  const lines: string[] = [];
  for (const change of changes) {
    const changeLines = change.value.replace(/\n$/, "").split("\n");
    for (const line of changeLines) {
      lines.push(diffLine(change, line, theme, width));
    }
  }
  return lines;
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
    const changes = diffLines(textArg(args?.old_string), textArg(args?.new_string));
    return renderDiffLines(changes, theme, width);
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

function searchFirstParts(theme: Theme, d: MemorySearchDetails | undefined): string[] {
  const first = d?.items?.[0];
  if (!first) return [];
  const parts: string[] = [" ", theme.fg("accent", first.uri)];
  if (first.snippet) {
    const snip = first.snippet.length > 80 ? `${first.snippet.slice(0, 79)}…` : first.snippet;
    parts.push(` ${theme.fg("dim", snip)}`);
  }
  return parts;
}

function searchSummary(theme: Theme, details: unknown): string {
  const d = details as MemorySearchDetails | undefined;
  const total = d?.total ?? 0;
  if (total === 0) return theme.fg("muted", "no results");
  const parts: string[] = [theme.fg("success", `${total} result${total === 1 ? "" : "s"}`)];
  parts.push(...searchFirstParts(theme, d));
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
    return listLines(d?.items ?? [], d?.total ?? 0, 10, "result", theme, (item) => {
      const lines = [theme.fg("accent", item.uri)];
      if (item.snippet) {
        lines.push(theme.fg("dim", item.snippet.length > 100 ? `${item.snippet.slice(0, 99)}…` : item.snippet));
      }
      return lines;
    });
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

function aliasBase(theme: Theme, args: MemoryAliasArgs | undefined): string {
  const title = theme.fg("toolTitle", theme.bold("Memory alias"));
  if (args?.remove_uri) {
    return `${title} ${theme.fg("accent", args.remove_uri)}${theme.fg("dim", " (remove)")}`;
  }
  const target = args?.target_uri ? ` → ${args.target_uri}` : "";
  return `${title} ${theme.fg("accent", textArg(args?.new_uri))}${dimSuffix(theme, target)}`;
}

export const memoryAliasAdapter: ToolDisplayAdapter<MemoryAliasArgs> = {
  formatCallHeader(args, theme, details, _isPartial, _expanded, width) {
    const base = aliasBase(theme, args);
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

function triggersPart(theme: Theme, role: "success" | "error", sign: "+" | "-", count: number | undefined): string {
  if ((count ?? 0) <= 0) return "";
  return theme.fg(role, `${sign}${count} keyword${count === 1 ? "" : "s"}`);
}

function triggersSummary(theme: Theme, details: unknown): string {
  const d = details as MemoryTriggersDetails | undefined;
  const parts = [triggersPart(theme, "success", "+", d?.added), triggersPart(theme, "error", "-", d?.removed)].filter(
    (part) => part !== "",
  );
  return parts.length > 0 ? parts.join(", ") : theme.fg("success", "updated");
}

function joinedParts(parts: string[]): string {
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

export const memoryTriggersAdapter: ToolDisplayAdapter<MemoryTriggersArgs> = {
  formatCallHeader(args, theme, details, _isPartial, _expanded, width) {
    const parts: string[] = [];
    if (args?.add?.length) parts.push(`+${args.add.length}`);
    if (args?.remove?.length) parts.push(`-${args.remove.length}`);
    const uri = textArg(args?.uri);
    const suffix = dimSuffix(theme, joinedParts(parts));
    return memoryHeader(theme, "Memory triggers", uri, suffix, triggersSummary(theme, details), width);
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
  return countFirstSummary(theme, "version", "no versions", countArg(d?.total), textArg(d?.versions?.[0]));
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
    return listLines(d?.versions ?? [], d?.total ?? 0, 15, "version", theme, (v) => [theme.fg("dim", v)]);
  },
};

interface MemoryDomainsDetails {
  total?: number;
  domains?: string[];
}

function domainsSummary(theme: Theme, details: unknown): string {
  const d = details as MemoryDomainsDetails | undefined;
  return countFirstSummary(theme, "domain", "none", countArg(d?.total), textArg(d?.domains?.[0]));
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
