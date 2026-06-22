import { spawnSync, type SpawnSyncReturns } from "node:child_process";

export interface TerminalContext {
  terminalKind: string;
  tmuxSession: string;
  tmuxWindow: string;
  tmuxPane: string;
  tmuxSocket: string;
  zellijSession: string;
  zellijPane: string;
  herdrSession: string;
  herdrPane: string;
  herdrWorkspaceId: string;
  herdrWorkspace: string;
  herdrTabId: string;
  herdrTab: string;
}

export const EMPTY_TERMINAL_CONTEXT: TerminalContext = {
  terminalKind: "",
  tmuxSession: "",
  tmuxWindow: "",
  tmuxPane: "",
  tmuxSocket: "",
  zellijSession: "",
  zellijPane: "",
  herdrSession: "",
  herdrPane: "",
  herdrWorkspaceId: "",
  herdrWorkspace: "",
  herdrTabId: "",
  herdrTab: "",
};

export interface MoshiContextJson {
  kind?: string;
  tmux?: {
    session?: string;
    pane?: string;
    window?: string;
  };
  zellij?: {
    session?: string;
    pane?: string;
  };
  herdr?: {
    session?: string;
    paneId?: string;
    workspaceId?: string;
    workspace?: string;
    tabId?: string;
    tab?: string;
  };
}

export interface ProbeOptions {
  binary?: string;
  env?: NodeJS.ProcessEnv;
  spawnSync?: typeof import("node:child_process").spawnSync;
}

export function parseMoshiContextJson(text: string): MoshiContextJson | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object"
      ? (parsed as MoshiContextJson)
      : null;
  } catch {
    return null;
  }
}

export function contextFromMoshiJson(
  parsed: MoshiContextJson | null,
): TerminalContext {
  if (!parsed) return { ...EMPTY_TERMINAL_CONTEXT };
  const kind = parsed.kind ?? "";
  const herdr = parsed.herdr ?? {};
  const tmux = parsed.tmux ?? {};
  const zellij = parsed.zellij ?? {};
  return {
    terminalKind: kind,
    tmuxSession: tmux.session ?? "",
    tmuxWindow: tmux.window ?? "",
    tmuxPane: tmux.pane ?? "",
    tmuxSocket: "",
    zellijSession: zellij.session ?? "",
    zellijPane: zellij.pane ?? "",
    herdrSession: herdr.session ?? "",
    herdrPane: herdr.paneId ?? "",
    herdrWorkspaceId: herdr.workspaceId ?? "",
    herdrWorkspace: herdr.workspace ?? "",
    herdrTabId: herdr.tabId ?? "",
    herdrTab: herdr.tab ?? "",
  };
}

export function probeTerminalContext(
  options: ProbeOptions = {},
): TerminalContext {
  const binary = options.binary ?? "moshi-hook";
  const env = options.env ?? process.env;
  const spawnSyncFn = options.spawnSync ?? spawnSync;
  let result: SpawnSyncReturns<string>;
  try {
    result = spawnSyncFn(binary, ["context"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env,
      timeout: 500,
    });
  } catch {
    return { ...EMPTY_TERMINAL_CONTEXT };
  }
  const stdout = typeof result.stdout === "string" ? result.stdout : "";
  const parsed = parseMoshiContextJson(stdout);
  return contextFromMoshiJson(parsed);
}

let cached: TerminalContext | null = null;

export function getCachedTerminalContext(
  options: ProbeOptions = {},
): TerminalContext {
  if (cached) return cached;
  cached = probeTerminalContext(options);
  return cached;
}

export function resetTerminalContextCache(): void {
  cached = null;
}
