import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import type { ExtensionAPI, ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

type ContextUsageColor = "accent" | "success" | "warning" | "error" | "muted" | "dim" | "borderMuted" | "text";

interface ContextUsageDetailItem {
  label: string;
  tokens: number;
  description?: string;
  group?: string;
}

interface ContextUsageCategory {
  key: string;
  label: string;
  rawTokens: number;
  tokens: number;
  color: ContextUsageColor;
  icon: string;
}

export interface ContextUsageMessageDetails {
  usage: {
    contextWindow?: number;
    percent?: number;
    tokens: number;
  };
  model: {
    contextWindow?: number;
    id: string;
    label: string;
    provider: string;
    thinking?: string;
  };
  categories: ContextUsageCategory[];
  freeTokens?: number;
  contextFiles: ContextUsageDetailItem[];
  skills: ContextUsageDetailItem[];
  customAgents: ContextUsageDetailItem[];
  builtinTools: ContextUsageDetailItem[];
  extensionTools: ContextUsageDetailItem[];
  mcpTools: ContextUsageDetailItem[];
  messageStats: {
    assistant: number;
    bash: number;
    branchEntries: number;
    compact: number;
    contextMessages: number;
    custom: number;
    toolResult: number;
    user: number;
  };
  compactSummaries: ContextUsageDetailItem[];
  note?: string;
}

type QcuUsage = ReturnType<ExtensionContext["getContextUsage"]>;
type QcuModel = ExtensionContext["model"];
type QcuMessageStats = ContextUsageMessageDetails["messageStats"];

interface QcuRawTotals {
  rawBuiltinToolTokens: number;
  rawCompactSummaryTokens: number;
  rawContextFiles: number;
  rawCustomAgents: number;
  rawExtensionToolTokens: number;
  rawMcpToolTokens: number;
  rawMessageTokens: number;
  rawSkills: number;
  rawSystemPrompt: number;
}

function qcuCircularTrack(seen: WeakSet<object>, current: object): unknown {
  if (seen.has(current)) return "[Circular]";
  seen.add(current);
  return current;
}

function qcuSafeString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value == null) return "";
  const seen = new WeakSet<object>();
  try {
    return (
      JSON.stringify(value, (_key, current: unknown): unknown => {
        if (typeof current === "function") return undefined;
        if (typeof current !== "object" || current === null) return current;
        return qcuCircularTrack(seen, current);
      }) ?? ""
    );
  } catch {
    return String(value);
  }
}

function qcuEstimateTokens(value: unknown): number {
  const text = qcuSafeString(value);
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

function qcuFormatTokens(value: number | undefined): string {
  const n = Math.max(0, Math.round(Number(value) || 0));
  const trim = (input: number) => input.toFixed(input >= 10 ? 0 : 1).replace(/\.0$/, "");
  if (n >= 1_000_000) return `${trim(n / 1_000_000)}M`;
  if (n >= 1_000) return `${trim(n / 1_000)}K`;
  return n.toLocaleString();
}

function qcuPercent(tokens: number, contextWindow?: number): string {
  if (!contextWindow || contextWindow <= 0) return "--";
  return `${((tokens / contextWindow) * 100).toFixed(1)}%`;
}

function qcuPadAnsi(text: string, width: number): string {
  const clipped = truncateToWidth(text, Math.max(0, width), "");
  return `${clipped}${" ".repeat(Math.max(0, width - visibleWidth(clipped)))}`;
}

function qcuOneLine(text: string, maxWidth: number): string {
  return truncateToWidth(
    text
      .replace(/[\r\n\t]+/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
    maxWidth,
    "…",
  );
}

function qcuAsRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function qcuStringProp(obj: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = obj?.[key];
  return typeof value === "string" ? value : undefined;
}

function qcuFirstDefined(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = obj[key];
    if (value != null) return value;
  }
  return undefined;
}

const QCU_LABEL_KEYS = ["name", "title", "label", "id", "path", "file", "filePath", "sourcePath", "description"];
const QCU_TEXT_KEYS = ["content", "text", "markdown", "body", "instructions", "description", "prompt"];
const QCU_PATH_KEYS = ["path", "file", "filePath", "sourcePath"];

function qcuObjectLabel(obj: Record<string, unknown>, fallback: string): string {
  const raw = qcuFirstDefined(obj, QCU_LABEL_KEYS) ?? fallback;
  const label = typeof raw === "string" ? raw : fallback;
  return qcuOneLine(label, 90) || fallback;
}

function qcuNonStringLabel(item: unknown, fallback: string): string {
  if (!item || typeof item !== "object") return fallback;
  return qcuObjectLabel(item as Record<string, unknown>, fallback);
}

function qcuDetailLabel(item: unknown, fallback: string): string {
  if (typeof item === "string") return qcuOneLine(item, 90) || fallback;
  return qcuNonStringLabel(item, fallback);
}

function qcuDirectText(obj: Record<string, unknown>): string | undefined {
  const direct = qcuFirstDefined(obj, QCU_TEXT_KEYS);
  return typeof direct === "string" ? direct : undefined;
}

function qcuFileText(obj: Record<string, unknown>): string | undefined {
  const pathValue = qcuFirstDefined(obj, QCU_PATH_KEYS);
  if (typeof pathValue !== "string" || !isAbsolute(pathValue) || !existsSync(pathValue)) return undefined;
  try {
    return readFileSync(pathValue, "utf8");
  } catch {
    // Fall through to a safe structural estimate.
    return undefined;
  }
}

function qcuObjectText(obj: Record<string, unknown>, item: unknown): string {
  return qcuDirectText(obj) ?? qcuFileText(obj) ?? qcuSafeString(item);
}

function qcuNonStringText(item: unknown): string {
  if (!item || typeof item !== "object") return qcuSafeString(item);
  return qcuObjectText(item as Record<string, unknown>, item);
}

function qcuDetailText(item: unknown): string {
  if (typeof item === "string") return item;
  return qcuNonStringText(item);
}

function qcuDetailGroup(
  obj: Record<string, unknown> | undefined,
  sourceInfo: Record<string, unknown> | undefined,
  fallbackGroup?: string,
): string | undefined {
  return (
    qcuStringProp(obj, "scope") ??
    qcuStringProp(sourceInfo, "scope") ??
    qcuStringProp(sourceInfo, "source") ??
    fallbackGroup
  );
}

function qcuDetailItemFrom(item: unknown, index: number, fallbackGroup?: string): ContextUsageDetailItem {
  const obj = qcuAsRecord(item);
  const sourceInfo = qcuAsRecord(obj?.sourceInfo);
  const description = qcuStringProp(obj, "description");
  return {
    description: description ? qcuOneLine(description, 120) : undefined,
    group: qcuDetailGroup(obj, sourceInfo, fallbackGroup),
    label: qcuDetailLabel(item, `item-${index + 1}`),
    tokens: qcuEstimateTokens(qcuDetailText(item)),
  };
}

function qcuDetailsFromItems(items: unknown[], fallbackGroup?: string): ContextUsageDetailItem[] {
  return items
    .map((item, index) => qcuDetailItemFrom(item, index, fallbackGroup))
    .filter((item) => item.tokens > 0 || item.label.length > 0);
}

function qcuPromptOptionArray(options: unknown, keys: string[]): unknown[] {
  if (!options || typeof options !== "object") return [];
  const obj = options as Record<string, unknown>;
  for (const key of keys) {
    const value = obj[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function qcuUniqDetails(items: ContextUsageDetailItem[]): ContextUsageDetailItem[] {
  const byLabel = new Map<string, ContextUsageDetailItem>();
  for (const item of items) {
    const key = `${item.group ?? ""}:${item.label}`;
    const existing = byLabel.get(key);
    if (!existing || item.tokens > existing.tokens) byLabel.set(key, item);
  }
  return Array.from(byLabel.values()).sort((a, b) => b.tokens - a.tokens || a.label.localeCompare(b.label));
}

function qcuTokenSum(items: ContextUsageDetailItem[]): number {
  return items.reduce((sum, item) => sum + Math.max(0, item.tokens), 0);
}

function qcuPartRawValue(part: any): unknown {
  if (part?.type === "text") return part.text ?? "";
  return qcuThinkingPartRawValue(part);
}

function qcuThinkingPartRawValue(part: any): unknown {
  if (part?.type === "thinking") return part.thinking ?? "";
  return part;
}

function qcuPartTokens(part: any): number {
  if (part?.type === "image") return 85;
  return qcuEstimateTokens(qcuPartRawValue(part));
}

function qcuContentTokens(content: unknown): number {
  if (typeof content === "string") return qcuEstimateTokens(content);
  if (!Array.isArray(content)) return qcuEstimateTokens(content);
  return content.reduce((sum: number, part: any) => sum + qcuPartTokens(part), 0);
}

function qcuSummaryRoleTokens(message: any): number | undefined {
  if (message.role === "compactionSummary" || message.role === "branchSummary")
    return qcuEstimateTokens(message.summary ?? "");
  return undefined;
}

function qcuRoleTokens(message: any): number | undefined {
  const summaryTokens = qcuSummaryRoleTokens(message);
  if (summaryTokens !== undefined) return summaryTokens;
  if (message.role === "custom") return qcuEstimateTokens(message.content ?? "");
  return undefined;
}

function qcuObjectMessageTokens(message: any): number {
  if (message.role === "bashExecution" && message.excludeFromContext === true) return 0;
  const roleTokens = qcuRoleTokens(message);
  if (roleTokens !== undefined) return roleTokens;
  return qcuContentTokens(message.content);
}

function qcuMessageTokens(message: any): number {
  if (!message || typeof message !== "object") return 0;
  return qcuObjectMessageTokens(message);
}

const QCU_MESSAGE_STAT_KEYS: Record<string, "user" | "assistant" | "toolResult" | "bash" | "custom"> = {
  assistant: "assistant",
  bashExecution: "bash",
  custom: "custom",
  toolResult: "toolResult",
  user: "user",
};

function qcuIsCompactRole(role: unknown): boolean {
  return role === "compactionSummary" || role === "branchSummary";
}

function qcuEmptyStats(branchEntries: number, contextMessages: number): QcuMessageStats {
  return { assistant: 0, bash: 0, branchEntries, compact: 0, contextMessages, custom: 0, toolResult: 0, user: 0 };
}

function qcuTallyRole(stats: QcuMessageStats, role: unknown): "compact" | "message" {
  const key = typeof role === "string" ? QCU_MESSAGE_STAT_KEYS[role] : undefined;
  if (key) {
    stats[key] += 1;
    return "message";
  }
  if (qcuIsCompactRole(role)) {
    stats.compact += 1;
    return "compact";
  }
  return "message";
}

function qcuAccumulateMessages(
  messages: any[],
  stats: QcuMessageStats,
): { rawCompactTokens: number; rawMessageTokens: number } {
  let rawMessageTokens = 0;
  let rawCompactTokens = 0;
  for (const message of messages) {
    const tokens = qcuMessageTokens(message);
    if (qcuTallyRole(stats, message?.role) === "compact") rawCompactTokens += tokens;
    else rawMessageTokens += tokens;
  }
  return { rawCompactTokens, rawMessageTokens };
}

function qcuBranchMessages(branch: any[]): any[] {
  return branch.filter((entry: any) => entry?.type === "message").map((entry: any) => entry.message);
}

function qcuContextMessages(sm: any, branch: any[]): any[] {
  const built = typeof sm.buildSessionContext === "function" ? sm.buildSessionContext() : undefined;
  if (Array.isArray(built?.messages)) return built.messages;
  return qcuBranchMessages(branch);
}

function qcuCompactionLabel(entry: any): string {
  return `Compaction${entry.tokensBefore ? ` (${qcuFormatTokens(Number(entry.tokensBefore))} before)` : ""}`;
}

function qcuCompactSummaryItem(entry: any): ContextUsageDetailItem {
  const isCompaction = entry.type === "compaction";
  return {
    group: isCompaction ? "compaction" : "branch",
    label: isCompaction ? qcuCompactionLabel(entry) : "Branch summary",
    tokens: qcuEstimateTokens(entry.summary ?? ""),
  };
}

function qcuCompactSummaries(branch: any[]): ContextUsageDetailItem[] {
  return branch
    .filter((entry: any) => entry?.type === "compaction" || entry?.type === "branch_summary")
    .map(qcuCompactSummaryItem)
    .reverse();
}

function qcuBuildMessageStats(ctx: ExtensionContext): {
  rawMessageTokens: number;
  rawCompactTokens: number;
  stats: ContextUsageMessageDetails["messageStats"];
  compactSummaries: ContextUsageDetailItem[];
} {
  const sm = ctx.sessionManager as any;
  const branch = Array.isArray(sm.getBranch?.()) ? sm.getBranch() : [];
  const messages = qcuContextMessages(sm, branch);
  const stats = qcuEmptyStats(branch.length, messages.length);
  const { rawCompactTokens, rawMessageTokens } = qcuAccumulateMessages(messages, stats);
  const compactSummaries = qcuCompactSummaries(branch);
  return { compactSummaries, rawCompactTokens, rawMessageTokens, stats };
}

function qcuActiveToolNames(api: any): Set<string> {
  return new Set<string>(Array.isArray(api.getActiveTools?.()) ? api.getActiveTools() : []);
}

function qcuAllTools(api: any): any[] {
  return Array.isArray(api.getAllTools?.()) ? api.getAllTools() : [];
}

function qcuIsActiveTool(tool: any, activeNames: Set<string>): boolean {
  if (typeof tool?.name !== "string") return false;
  return activeNames.size === 0 || activeNames.has(tool.name);
}

function qcuToolDetail(tool: any): ContextUsageDetailItem {
  const sourceInfo = qcuAsRecord(tool.sourceInfo);
  return {
    description: typeof tool.description === "string" ? qcuOneLine(tool.description, 120) : undefined,
    group: qcuStringProp(sourceInfo, "source"),
    label: tool.name,
    tokens: qcuEstimateTokens({
      description: tool.description,
      name: tool.name,
      parameters: tool.parameters,
      promptGuidelines: tool.promptGuidelines,
      promptSnippet: tool.promptSnippet,
    }),
  };
}

function qcuIsMcpTool(tool: ContextUsageDetailItem): boolean {
  return /^mcp_{1,2}/i.test(tool.label) || /mcp/i.test(tool.group ?? "");
}

function qcuIsBuiltinTool(tool: ContextUsageDetailItem): boolean {
  return !qcuIsMcpTool(tool) && (tool.group === "builtin" || tool.group === "sdk");
}

function qcuIsExtensionTool(tool: ContextUsageDetailItem): boolean {
  return !qcuIsMcpTool(tool) && tool.group !== "builtin" && tool.group !== "sdk";
}

function qcuToolDetails(pi: ExtensionAPI): {
  builtinTools: ContextUsageDetailItem[];
  extensionTools: ContextUsageDetailItem[];
  mcpTools: ContextUsageDetailItem[];
  rawBuiltinToolTokens: number;
  rawExtensionToolTokens: number;
  rawMcpToolTokens: number;
} {
  const api = pi as any;
  const activeNames = qcuActiveToolNames(api);
  const allTools = qcuAllTools(api);
  const activeTools = allTools.filter((tool: any) => qcuIsActiveTool(tool, activeNames));
  const details = activeTools.map(qcuToolDetail);
  const mcpTools = details.filter(qcuIsMcpTool);
  const builtinTools = details.filter(qcuIsBuiltinTool);
  const extensionTools = details.filter(qcuIsExtensionTool);
  return {
    builtinTools: qcuUniqDetails(builtinTools),
    extensionTools: qcuUniqDetails(extensionTools),
    mcpTools: qcuUniqDetails(mcpTools),
    rawBuiltinToolTokens: qcuTokenSum(builtinTools),
    rawExtensionToolTokens: qcuTokenSum(extensionTools),
    rawMcpToolTokens: qcuTokenSum(mcpTools),
  };
}

function qcuSkillCommandGroup(command: any): string {
  const sourceInfo = qcuAsRecord(command.sourceInfo);
  return qcuStringProp(sourceInfo, "scope") ?? qcuStringProp(sourceInfo, "source") ?? "skill";
}

function qcuSkillCommandTokens(command: any): number {
  return qcuEstimateTokens(`${command.name ?? ""}\n${command.description ?? ""}`);
}

function qcuSkillCommandDetail(command: any): ContextUsageDetailItem {
  return {
    description: typeof command.description === "string" ? qcuOneLine(command.description, 120) : undefined,
    group: qcuSkillCommandGroup(command),
    label: String(command.name ?? "skill").replace(/^skill:/, ""),
    tokens: qcuSkillCommandTokens(command),
  };
}

function qcuSkillDetails(pi: ExtensionAPI, promptOptions: unknown): ContextUsageDetailItem[] {
  const fromOptions = qcuDetailsFromItems(
    qcuPromptOptionArray(promptOptions, ["skills", "loadedSkills", "availableSkills"]),
    "loaded",
  );
  const commands = Array.isArray((pi as any).getCommands?.()) ? (pi as any).getCommands() : [];
  const fromCommands = commands.filter((command: any) => command?.source === "skill").map(qcuSkillCommandDetail);
  return qcuUniqDetails([...fromOptions, ...fromCommands]);
}

function qcuFallbackCategories(totalTokens: number): ContextUsageCategory[] {
  return [
    {
      color: "accent",
      icon: "◉",
      key: "messages",
      label: "Messages",
      rawTokens: totalTokens,
      tokens: totalTokens,
    },
  ];
}

function qcuScaleRawCategories(
  rawCategories: Array<Omit<ContextUsageCategory, "tokens">>,
  ratio: number,
): ContextUsageCategory[] {
  return rawCategories
    .map((category) => ({
      ...category,
      tokens: Math.max(0, Math.round(category.rawTokens * ratio)),
    }))
    .filter((category) => category.tokens > 0 || category.rawTokens > 0);
}

function qcuReconcileDelta(categories: ContextUsageCategory[], totalTokens: number): void {
  const scaledTotal = categories.reduce((sum, category) => sum + category.tokens, 0);
  const delta = totalTokens - scaledTotal;
  const messages = categories.find((category) => category.key === "messages") ?? categories[categories.length - 1];
  if (messages && delta !== 0) messages.tokens = Math.max(0, messages.tokens + delta);
}

function qcuAppendOther(categories: ContextUsageCategory[], totalTokens: number, contextWindow?: number): void {
  if (!contextWindow) return;
  const used = categories.reduce((sum, category) => sum + category.tokens, 0);
  const other = totalTokens - used;
  if (used < totalTokens && other > 0)
    categories.push({
      color: "dim",
      icon: "◉",
      key: "other",
      label: "Other",
      rawTokens: other,
      tokens: other,
    });
}

function qcuScaleCategories(
  rawCategories: Array<Omit<ContextUsageCategory, "tokens">>,
  totalTokens: number,
  contextWindow?: number,
): ContextUsageCategory[] {
  const rawTotal = rawCategories.reduce((sum, category) => sum + Math.max(0, category.rawTokens), 0);
  if (rawTotal <= 0) return qcuFallbackCategories(totalTokens);
  const categories = qcuScaleRawCategories(rawCategories, totalTokens / rawTotal);
  qcuReconcileDelta(categories, totalTokens);
  qcuAppendOther(categories, totalTokens, contextWindow);
  return categories;
}

function qcuAgentGroupFallback(hint: string | undefined): string {
  if (hint?.includes("user")) return "user";
  return "agent";
}

function qcuAgentGroup(hint: string | undefined): string {
  if (hint?.includes("project")) return "project";
  return qcuAgentGroupFallback(hint);
}

function qcuAgentDescription(match: RegExpMatchArray | null): string | undefined {
  return match?.[2] ? qcuOneLine(match[2], 120) : undefined;
}

function qcuAgentLabel(match: RegExpMatchArray | null, line: string): string {
  return qcuOneLine(match?.[1] ?? line.replace(/^[-\s]+/, ""), 90);
}

function qcuAgentLine(line: string): ContextUsageDetailItem {
  const match = line.match(/^-\s*([^:]+):\s*(.*?)(?:\s*\(([^)]*)\))?$/);
  return {
    description: qcuAgentDescription(match),
    group: qcuAgentGroup(match?.[3]),
    label: qcuAgentLabel(match, line),
    tokens: qcuEstimateTokens(line),
  };
}

function qcuExtractProjectAgents(systemPrompt: string): {
  agents: ContextUsageDetailItem[];
  tokens: number;
} {
  const marker = systemPrompt.includes("## Project Agents") ? "## Project Agents" : "## Project Subagents";
  const start = systemPrompt.indexOf(marker);
  if (start < 0) return { agents: [], tokens: 0 };
  const rest = systemPrompt.slice(start);
  const next = rest.slice(marker.length).search(/\n##\s+/);
  const section = next >= 0 ? rest.slice(0, marker.length + next) : rest;
  const agents = section
    .split(/\r?\n/)
    .filter((line) => line.startsWith("- "))
    .map(qcuAgentLine);
  return { agents: qcuUniqDetails(agents), tokens: qcuEstimateTokens(section) };
}

function qcuUsageTokens(usage: QcuUsage): number | undefined {
  const tokens = Number(usage?.tokens);
  return Number.isFinite(tokens) && tokens > 0 ? tokens : undefined;
}

function qcuModelWindow(model: QcuModel): number {
  return model?.contextWindow ?? 0;
}

function qcuRawContextWindow(usage: QcuUsage, model: QcuModel): number {
  return usage?.contextWindow ?? qcuModelWindow(model);
}

function qcuSafeContextWindow(usage: QcuUsage, model: QcuModel): number | undefined {
  const contextWindow = qcuRawContextWindow(usage, model);
  return Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : undefined;
}

function qcuUsagePercent(usage: QcuUsage, tokens: number, safeContextWindow: number | undefined): number | undefined {
  const percent = Number(usage?.percent);
  if (Number.isFinite(percent)) return percent;
  return safeContextWindow ? (tokens / safeContextWindow) * 100 : undefined;
}

function qcuSystemPrompt(ctx: ExtensionContext): string {
  return ctx.getSystemPrompt?.() ?? "";
}

function qcuGatherBreakdowns(pi: ExtensionAPI, ctx: ExtensionContext, promptOptions: unknown, systemPrompt: string) {
  const contextFiles = qcuUniqDetails(
    qcuDetailsFromItems(qcuPromptOptionArray(promptOptions, ["contextFiles", "agentsFiles", "memoryFiles"]), "context"),
  );
  const skills = qcuSkillDetails(pi, promptOptions);
  const extractedAgents = qcuExtractProjectAgents(systemPrompt);
  const customAgents = qcuUniqDetails([
    ...qcuDetailsFromItems(qcuPromptOptionArray(promptOptions, ["customAgents", "agents", "agentSnippets"]), "agent"),
    ...extractedAgents.agents,
  ]);
  const tools = qcuToolDetails(pi);
  const messageStats = qcuBuildMessageStats(ctx);
  return { contextFiles, customAgents, extractedAgents, messageStats, skills, tools };
}

function qcuRawTotals(gathered: ReturnType<typeof qcuGatherBreakdowns>, systemPrompt: string): QcuRawTotals {
  const rawCompactSummaryTokens =
    gathered.messageStats.rawCompactTokens > 0
      ? gathered.messageStats.rawCompactTokens
      : qcuTokenSum(gathered.messageStats.compactSummaries);
  const rawContextFiles = qcuTokenSum(gathered.contextFiles);
  const rawSkills = qcuTokenSum(gathered.skills);
  const rawCustomAgents = Math.max(qcuTokenSum(gathered.customAgents), gathered.extractedAgents.tokens);
  const rawSystemPromptTotal = qcuEstimateTokens(systemPrompt);
  const rawSystemPrompt = Math.max(0, rawSystemPromptTotal - rawContextFiles - rawSkills - rawCustomAgents);
  return {
    rawBuiltinToolTokens: gathered.tools.rawBuiltinToolTokens,
    rawCompactSummaryTokens,
    rawContextFiles,
    rawCustomAgents,
    rawExtensionToolTokens: gathered.tools.rawExtensionToolTokens,
    rawMcpToolTokens: gathered.tools.rawMcpToolTokens,
    rawMessageTokens: gathered.messageStats.rawMessageTokens,
    rawSkills,
    rawSystemPrompt,
  };
}

function qcuRawCategories(totals: QcuRawTotals): Array<Omit<ContextUsageCategory, "tokens">> {
  return [
    { color: "muted", icon: "◉", key: "system", label: "System prompt", rawTokens: totals.rawSystemPrompt },
    {
      color: "warning",
      icon: "◉",
      key: "builtinTools",
      label: "Built-in tools",
      rawTokens: totals.rawBuiltinToolTokens,
    },
    {
      color: "error",
      icon: "◉",
      key: "extensionTools",
      label: "Extension tools",
      rawTokens: totals.rawExtensionToolTokens,
    },
    { color: "warning", icon: "◉", key: "mcpTools", label: "MCP tools", rawTokens: totals.rawMcpToolTokens },
    { color: "success", icon: "◉", key: "agents", label: "Custom agents", rawTokens: totals.rawCustomAgents },
    {
      color: "error",
      icon: "◉",
      key: "contextFiles",
      label: "Context / memory files",
      rawTokens: totals.rawContextFiles,
    },
    { color: "success", icon: "◉", key: "skills", label: "Skills", rawTokens: totals.rawSkills },
    { color: "accent", icon: "◉", key: "messages", label: "Messages", rawTokens: totals.rawMessageTokens },
    { color: "muted", icon: "◉", key: "compact", label: "Compact buffer", rawTokens: totals.rawCompactSummaryTokens },
  ];
}

function qcuModelId(model: QcuModel): string {
  return model?.id ?? "unknown";
}

function qcuModelLabel(model: QcuModel): string {
  return model?.name ?? qcuModelId(model);
}

function qcuModelProvider(model: QcuModel): string {
  return model?.provider ?? "unknown";
}

function qcuThinkingLabel(thinking: unknown): string | undefined {
  return typeof thinking === "string" && thinking !== "off" ? thinking : undefined;
}

function qcuModelInfo(
  pi: ExtensionAPI,
  model: QcuModel,
  safeContextWindow: number | undefined,
): ContextUsageMessageDetails["model"] {
  return {
    contextWindow: safeContextWindow,
    id: qcuModelId(model),
    label: qcuModelLabel(model),
    provider: qcuModelProvider(model),
    thinking: qcuThinkingLabel(pi.getThinkingLevel?.()),
  };
}

function qcuFreeTokens(safeContextWindow: number | undefined, tokens: number): number | undefined {
  return safeContextWindow ? Math.max(0, safeContextWindow - tokens) : undefined;
}

function qcuNote(promptOptions: unknown): string | undefined {
  return promptOptions ? undefined : "Context-file and skill breakdowns become more precise after the next agent turn.";
}

export function buildContextUsageDetails(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  promptOptions: unknown,
): ContextUsageMessageDetails | undefined {
  const usage = ctx.getContextUsage();
  const tokens = qcuUsageTokens(usage);
  if (tokens === undefined) return undefined;
  const safeContextWindow = qcuSafeContextWindow(usage, ctx.model);
  const systemPrompt = qcuSystemPrompt(ctx);
  const gathered = qcuGatherBreakdowns(pi, ctx, promptOptions, systemPrompt);
  const rawTotals = qcuRawTotals(gathered, systemPrompt);
  const categories = qcuScaleCategories(qcuRawCategories(rawTotals), tokens, safeContextWindow);
  return {
    builtinTools: gathered.tools.builtinTools,
    categories,
    compactSummaries: gathered.messageStats.compactSummaries,
    contextFiles: gathered.contextFiles,
    customAgents: gathered.customAgents,
    extensionTools: gathered.tools.extensionTools,
    freeTokens: qcuFreeTokens(safeContextWindow, tokens),
    mcpTools: gathered.tools.mcpTools,
    messageStats: gathered.messageStats.stats,
    model: qcuModelInfo(pi, ctx.model, safeContextWindow),
    note: qcuNote(promptOptions),
    skills: gathered.skills,
    usage: {
      contextWindow: safeContextWindow,
      percent: qcuUsagePercent(usage, tokens, safeContextWindow),
      tokens,
    },
  };
}

function qcuLimitDetails(items: ContextUsageDetailItem[], limit: number): ContextUsageDetailItem[] {
  return items.slice(0, Math.max(0, limit));
}

function qcuBranch(theme: Theme, branch: "├" | "└" | "│"): string {
  if (branch === "│") return theme.fg("muted", "│  ");
  return theme.fg("muted", `${branch}─ `);
}

function qcuStem(theme: Theme, isLast: boolean): string {
  return isLast ? theme.fg("borderMuted", "   ") : qcuBranch(theme, "│");
}

interface QcuDetailSectionOptions {
  empty?: string;
  limit?: number;
  showDescriptions?: boolean;
}

function qcuRenderEmptySection(lines: string[], title: string, empty: string, theme: Theme): void {
  lines.push("");
  lines.push(`${theme.fg("customMessageLabel", theme.bold(title))}`);
  lines.push(`${qcuBranch(theme, "└")}${theme.fg("dim", empty)}`);
}

function qcuDetailItemLine(theme: Theme, item: ContextUsageDetailItem, isLast: boolean): string {
  const branch = isLast ? "└" : "├";
  const group = item.group ? theme.fg("dim", ` ${item.group}`) : "";
  return `${qcuBranch(theme, branch)}${theme.fg("text", qcuOneLine(item.label, 72))}: ${theme.fg("accent", qcuFormatTokens(item.tokens))} tokens${group}`;
}

function qcuRenderDetailItem(
  lines: string[],
  item: ContextUsageDetailItem,
  isLast: boolean,
  theme: Theme,
  showDescriptions: boolean | undefined,
): void {
  lines.push(qcuDetailItemLine(theme, item, isLast));
  if (showDescriptions && item.description)
    lines.push(`${qcuStem(theme, isLast)}${theme.fg("dim", qcuOneLine(item.description, 100))}`);
}

function qcuRenderDetailItems(
  lines: string[],
  title: string,
  items: ContextUsageDetailItem[],
  theme: Theme,
  options: QcuDetailSectionOptions,
): void {
  const visible = qcuLimitDetails(items, options.limit ?? 10);
  lines.push("");
  lines.push(`${theme.fg("customMessageLabel", theme.bold(title))}`);
  visible.forEach((item, index) => {
    const isLast = index === visible.length - 1 && visible.length === items.length;
    qcuRenderDetailItem(lines, item, isLast, theme, options.showDescriptions);
  });
  if (items.length > visible.length)
    lines.push(`${qcuBranch(theme, "└")}${theme.fg("dim", `… ${items.length - visible.length} more`)}`);
}

function qcuRenderDetailSection(
  lines: string[],
  title: string,
  items: ContextUsageDetailItem[],
  theme: Theme,
  options: QcuDetailSectionOptions = {},
): void {
  if (items.length === 0) {
    if (options.empty) qcuRenderEmptySection(lines, title, options.empty, theme);
    return;
  }
  qcuRenderDetailItems(lines, title, items, theme, options);
}

function qcuGridLayout(safeWidth: number): { gridCols: number; gridRows: number } {
  const gridCols = safeWidth >= 112 ? 28 : safeWidth >= 88 ? 22 : 16;
  const gridRows = safeWidth >= 88 ? 7 : 6;
  return { gridCols, gridRows };
}

function qcuCategoryBlockCount(category: ContextUsageCategory, gridDenominator: number, totalBlocks: number): number {
  const count = Math.round((category.tokens / gridDenominator) * totalBlocks);
  return count === 0 && category.tokens > 0 ? 1 : count;
}

function qcuPushCategoryBlocks(
  blockCategories: ContextUsageCategory[],
  category: ContextUsageCategory,
  count: number,
  totalBlocks: number,
): void {
  for (let index = 0; index < count && blockCategories.length < totalBlocks; index += 1) blockCategories.push(category);
}

function qcuMaybePushCategory(
  blockCategories: ContextUsageCategory[],
  category: ContextUsageCategory,
  gridDenominator: number,
  totalBlocks: number,
): void {
  if (category.tokens <= 0) return;
  qcuPushCategoryBlocks(
    blockCategories,
    category,
    qcuCategoryBlockCount(category, gridDenominator, totalBlocks),
    totalBlocks,
  );
}

function qcuBlockCategories(details: ContextUsageMessageDetails, totalBlocks: number): ContextUsageCategory[] {
  const gridDenominator = details.usage.contextWindow ?? details.usage.tokens;
  const blockCategories: ContextUsageCategory[] = [];
  if (!gridDenominator) return blockCategories;
  for (const category of details.categories)
    qcuMaybePushCategory(blockCategories, category, gridDenominator, totalBlocks);
  return blockCategories;
}

function qcuGridCell(theme: Theme, category: ContextUsageCategory | undefined): string {
  return category ? theme.fg(category.color as any, category.icon) : theme.fg("borderMuted", "□");
}

function qcuGridRow(theme: Theme, blockCategories: ContextUsageCategory[], gridCols: number, row: number): string {
  let line = "";
  for (let col = 0; col < gridCols; col += 1) {
    line += qcuGridCell(theme, blockCategories[row * gridCols + col]);
    if (col !== gridCols - 1) line += " ";
  }
  return line;
}

function qcuGridLines(theme: Theme, details: ContextUsageMessageDetails, gridCols: number, gridRows: number): string[] {
  const blockCategories = qcuBlockCategories(details, gridCols * gridRows);
  const gridLines: string[] = [];
  for (let row = 0; row < gridRows; row += 1) gridLines.push(qcuGridRow(theme, blockCategories, gridCols, row));
  return gridLines;
}

function qcuUsageTokensLine(theme: Theme, details: ContextUsageMessageDetails): string {
  const contextWindow = details.usage.contextWindow;
  const windowPart = contextWindow ? `/${qcuFormatTokens(contextWindow)}` : "";
  const percentPart = details.usage.percent != null ? ` (${details.usage.percent.toFixed(1)}%)` : "";
  return `${theme.fg("accent", qcuFormatTokens(details.usage.tokens))}${windowPart} tokens${percentPart}`;
}

function qcuModelHeaderLines(theme: Theme, details: ContextUsageMessageDetails): string[] {
  const contextWindow = details.usage.contextWindow;
  const modelBits = [`${details.model.provider}/${details.model.id}`];
  if (details.model.thinking) modelBits.push(`thinking ${details.model.thinking}`);
  return [
    `${theme.fg("text", theme.bold(details.model.label))}${contextWindow ? theme.fg("muted", ` (${qcuFormatTokens(contextWindow)} context)`) : ""}`,
    theme.fg("muted", modelBits.join(" · ")),
    qcuUsageTokensLine(theme, details),
  ];
}

function qcuCategorySummaryLines(theme: Theme, details: ContextUsageMessageDetails): string[] {
  const contextWindow = details.usage.contextWindow;
  const lines = details.categories.map(
    (category) =>
      `${theme.fg(category.color as any, category.icon)} ${theme.fg("text", `${category.label}:`)} ${qcuFormatTokens(category.tokens)} tokens ${theme.fg("muted", `(${qcuPercent(category.tokens, contextWindow)})`)}`,
  );
  if (details.freeTokens != null)
    lines.push(
      `${theme.fg("borderMuted", "□")} ${theme.fg("text", "Free space:")} ${qcuFormatTokens(details.freeTokens)} ${theme.fg("muted", `(${qcuPercent(details.freeTokens, contextWindow)})`)}`,
    );
  return lines;
}

function qcuSummaryLines(theme: Theme, details: ContextUsageMessageDetails): string[] {
  return [
    ...qcuModelHeaderLines(theme, details),
    "",
    theme.fg("muted", theme.italic("Estimated usage by category")),
    ...qcuCategorySummaryLines(theme, details),
  ];
}

function qcuSideBySideRow(gridLines: string[], summaryLines: string[], leftWidth: number, index: number): string {
  return `  ${qcuPadAnsi(gridLines[index] ?? "", leftWidth)}    ${summaryLines[index] ?? ""}`.trimEnd();
}

function qcuSideBySideLines(gridLines: string[], summaryLines: string[]): string[] {
  const leftWidth = visibleWidth(gridLines[0] ?? "");
  const maxRows = Math.max(gridLines.length, summaryLines.length);
  const rows: string[] = [];
  for (let index = 0; index < maxRows; index += 1)
    rows.push(qcuSideBySideRow(gridLines, summaryLines, leftWidth, index));
  return rows;
}

function qcuOverviewLines(gridLines: string[], summaryLines: string[], safeWidth: number): string[] {
  if (safeWidth >= 82) return qcuSideBySideLines(gridLines, summaryLines);
  return [...gridLines.map((line) => `  ${line}`), "", ...summaryLines.map((line) => `  ${line}`)];
}

function qcuConversationLines(theme: Theme, messageStats: QcuMessageStats): string[] {
  return [
    "",
    `${theme.fg("customMessageLabel", theme.bold("Conversation"))}`,
    `${qcuBranch(theme, "├")}context messages: ${theme.fg("accent", String(messageStats.contextMessages))} ${theme.fg("dim", `(${messageStats.branchEntries} branch entries)`)}`,
    `${qcuBranch(theme, "├")}user: ${messageStats.user} · assistant: ${messageStats.assistant} · tool results: ${messageStats.toolResult}`,
    `${qcuBranch(theme, "└")}bash: ${messageStats.bash} · custom: ${messageStats.custom} · compact summaries: ${messageStats.compact}`,
  ];
}

function qcuAllDetailSections(lines: string[], details: ContextUsageMessageDetails, theme: Theme): void {
  qcuRenderDetailSection(lines, "MCP tools", details.mcpTools, theme, { limit: 12, showDescriptions: false });
  qcuRenderDetailSection(lines, "Built-in tools", details.builtinTools, theme, {
    limit: details.mcpTools.length > 0 ? 8 : 12,
    showDescriptions: false,
  });
  qcuRenderDetailSection(lines, "Extension tools", details.extensionTools, theme, {
    limit: 12,
    showDescriptions: false,
  });
  qcuRenderDetailSection(lines, "Custom agents · /agents", details.customAgents, theme, {
    limit: 12,
    showDescriptions: false,
  });
  qcuRenderDetailSection(lines, "Context / memory files", details.contextFiles, theme, {
    limit: 12,
    showDescriptions: false,
  });
  qcuRenderDetailSection(lines, "Skills · /skills", details.skills, theme, {
    empty: "No skill commands discovered.",
    limit: 14,
    showDescriptions: false,
  });
  qcuRenderDetailSection(lines, "Compact buffer", details.compactSummaries, theme, {
    limit: 6,
    showDescriptions: false,
  });
}

export function renderContextUsageMessage(
  message: any,
  _options: any,
  theme: Theme,
): { render(width: number): string[]; invalidate(): void } {
  const details = message?.details as ContextUsageMessageDetails | undefined;
  return {
    invalidate() {},
    render(width: number): string[] {
      if (!details) return [theme.fg("warning", "Context usage details unavailable.")];
      const safeWidth = Math.max(48, width);
      const lines: string[] = [];
      lines.push(`${theme.fg("customMessageLabel", theme.bold("Context Usage"))}`);
      const { gridCols, gridRows } = qcuGridLayout(safeWidth);
      const gridLines = qcuGridLines(theme, details, gridCols, gridRows);
      const summaryLines = qcuSummaryLines(theme, details);
      lines.push("");
      lines.push(...qcuOverviewLines(gridLines, summaryLines, safeWidth));
      if (details.note) lines.push("", theme.fg("dim", details.note));
      lines.push(...qcuConversationLines(theme, details.messageStats));
      qcuAllDetailSections(lines, details, theme);
      return lines.map((line) => truncateToWidth(line, safeWidth, ""));
    },
  };
}
