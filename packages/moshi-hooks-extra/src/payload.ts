export function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

export function textFromContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((chunk) => {
      if (typeof chunk === "string") return chunk;
      if (chunk && typeof chunk === "object" && "text" in chunk) {
        const text = (chunk as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      }
      return "";
    })
    .filter(Boolean)
    .join(" ");
}

export function textFromMessage(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const message = value as Record<string, unknown>;
  return firstString(
    textFromContent(message.content),
    textFromContent((message.message as Record<string, unknown> | undefined)?.content),
    textFromContent((message.entry as Record<string, unknown> | undefined)?.content),
  );
}

export function modelLabel(model: unknown): string {
  if (!model || typeof model !== "object") return "";
  const obj = model as Record<string, unknown>;
  return firstString(
    obj.displayName as string,
    obj.display_name as string,
    obj.name as string,
    obj.id as string,
    obj.modelId as string,
  );
}

export type MoshiHookEvent = Record<string, unknown>;
export type MoshiHookCtx = Record<string, unknown>;

export interface MoshiPayload {
  hook_event_name: string;
  session_id: string;
  cwd: string;
  model: string;
  event: unknown;
  [extra: string]: unknown;
}

export function sessionID(event: MoshiHookEvent, ctx: MoshiHookCtx): string {
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

export function buildMoshiPayload(
  hookEventName: string,
  event: unknown,
  ctx: unknown,
  extra: Record<string, unknown> = {},
): MoshiPayload {
  const eventObj = event && typeof event === "object" ? (event as MoshiHookEvent) : {};
  const ctxObj = ctx && typeof ctx === "object" ? (ctx as MoshiHookCtx) : {};
  return {
    hook_event_name: hookEventName,
    session_id: sessionID(eventObj, ctxObj),
    cwd: firstString(ctxObj.cwd as string, process.cwd()),
    model: modelLabel(ctxObj.model),
    event,
    ...extra,
  };
}
