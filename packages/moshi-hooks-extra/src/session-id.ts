export interface SessionIdContext {
  cwd?: unknown;
  sessionManager?: unknown;
}

export interface SessionIdEvent {
  session_id?: unknown;
  sessionId?: unknown;
}

function firstNonEmptyString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

function readSessionManagerValue(sessionManager: unknown, methodName: "getSessionId" | "getSessionFile"): string {
  if (!sessionManager || typeof sessionManager !== "object") return "";
  const method = (sessionManager as Record<string, unknown>)[methodName];
  if (typeof method !== "function") return "";
  try {
    return String(method.call(sessionManager) ?? "");
  } catch {
    return "";
  }
}

function sessionManagerIdentity(ctx: SessionIdContext): { sessionId: string; sessionFile: string } {
  return {
    sessionId: readSessionManagerValue(ctx.sessionManager, "getSessionId"),
    sessionFile: readSessionManagerValue(ctx.sessionManager, "getSessionFile"),
  };
}

export function sessionIdFromCtx(ctx: SessionIdContext): string {
  const identity = sessionManagerIdentity(ctx);
  return firstNonEmptyString(identity.sessionId, identity.sessionFile);
}

export function sessionIdFromEventCtx(event: SessionIdEvent, ctx: SessionIdContext): string {
  const identity = sessionManagerIdentity(ctx);
  return firstNonEmptyString(
    identity.sessionId,
    event.session_id,
    event.sessionId,
    identity.sessionFile,
    ctx.cwd,
    "pi",
  );
}
