export interface SessionKeyContext {
  sessionManager?: {
    getSessionFile?(): string | null | undefined;
  };
}

export const SINGLETON_SESSION_KEY = "__htwang_agents_mirror_singleton__";

export function getSessionKey(ctx: SessionKeyContext): string {
  const file = ctx.sessionManager?.getSessionFile?.();
  if (typeof file === "string" && file.length > 0) return file;
  return SINGLETON_SESSION_KEY;
}
