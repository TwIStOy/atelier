import { firstString, modelLabel, textFromContent } from "./payload.ts";

export type MoshiHookEvent = Record<string, unknown>;
export type MoshiHookCtx = Record<string, unknown>;

export function firstStrings(...values: unknown[]): string {
  return firstString(...values);
}

export function trimPreview(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…[truncated]`;
}

export function previewContent(content: unknown, maxChars = 2000): string {
  return trimPreview(textFromContent(content), maxChars);
}

export interface EnvelopeParts {
  source: "pi";
  sessionId: string;
  eventName: string;
  cwd: string;
  modelName: string;
  projectName: string;
  requestedAt: string;
  expiresAt: string;
}

export interface TerminalContextLike {
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

export function projectNameForCwd(cwd: string, ctx: TerminalContextLike): string {
  if (ctx.tmuxSession) return ctx.tmuxSession;
  if (ctx.herdrSession) return ctx.herdrSession;
  if (ctx.zellijSession) return ctx.zellijSession;
  if (!cwd) return "";
  const trimmed = cwd.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
}

export function buildSessionUpdateEnvelope(
  parts: EnvelopeParts,
  ctx: TerminalContextLike,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    type: "session.update",
    source: "pi",
    sessionId: parts.sessionId,
    eventName: parts.eventName,
    cwd: parts.cwd,
    projectName: parts.projectName,
    terminalKind: ctx.terminalKind,
    tmuxSession: ctx.tmuxSession,
    tmuxWindow: ctx.tmuxWindow,
    tmuxPane: ctx.tmuxPane,
    tmuxSocket: ctx.tmuxSocket,
    zellijSession: ctx.zellijSession,
    zellijPane: ctx.zellijPane,
    herdrSession: ctx.herdrSession,
    herdrPane: ctx.herdrPane,
    herdrWorkspaceId: ctx.herdrWorkspaceId,
    herdrWorkspace: ctx.herdrWorkspace,
    herdrTabId: ctx.herdrTabId,
    herdrTab: ctx.herdrTab,
    modelName: parts.modelName,
    expiresAt: parts.expiresAt,
    requestedAt: parts.requestedAt,
    ...extra,
  };
}

export function sessionIdFromEventCtx(event: MoshiHookEvent, ctx: MoshiHookCtx): string {
  const sessionManager = ctx.sessionManager as
    | (Record<string, unknown> & {
        getSessionFile?: (...args: unknown[]) => unknown;
      })
    | undefined;
  const getSessionFile = sessionManager?.getSessionFile;
  let sessionFile = "";
  if (typeof getSessionFile === "function") {
    try {
      sessionFile = String(getSessionFile.call(sessionManager) ?? "");
    } catch {
      sessionFile = "";
    }
  }
  return firstString(event.session_id as string, event.sessionId as string, sessionFile, ctx.cwd as string, "pi");
}

export function modelNameFromCtx(ctx: MoshiHookCtx): string {
  return modelLabel(ctx.model);
}

export function emptyExpiresAt(): string {
  return "0001-01-01T00:00:00Z";
}

export function nowIso(): string {
  return new Date().toISOString();
}
