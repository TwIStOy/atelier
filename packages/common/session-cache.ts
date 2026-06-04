import type {
  ExtensionContext,
  SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { convertToLlm } from "@earendil-works/pi-coding-agent";
import type { Message } from "@earendil-works/pi-ai";
import { getGlobalState } from "./global-state.ts";

export function isStaleCtxError(e: unknown): boolean {
  return /stale after session replacement/.test(String(e));
}

export function branchToMessages(branch: SessionEntry[]): Message[] {
  const agentMessages = branch
    .filter(
      (e): e is SessionEntry & { type: "message" } => e.type === "message",
    )
    .map((e) => e.message);
  return convertToLlm(agentMessages);
}

export interface SessionCache<V> {
  get(ctx: ExtensionContext): V | undefined;
  set(ctx: ExtensionContext, value: V): void;
  invalidate(ctx: ExtensionContext): void;
  safeInvalidate(ctx: ExtensionContext): void;
}

interface SessionCacheState<V> {
  entries: Map<string, V>;
}

export function createSessionCache<V>(stateKey: string): SessionCache<V> {
  const state = () =>
    getGlobalState<SessionCacheState<V>>(stateKey, () => ({
      entries: new Map(),
    }));

  function sessionKey(ctx: ExtensionContext): string {
    return (
      ctx.sessionManager.getSessionFile() ??
      `memory:${ctx.sessionManager.getSessionId()}`
    );
  }

  return {
    get(ctx: ExtensionContext): V | undefined {
      return state().entries.get(sessionKey(ctx));
    },
    set(ctx: ExtensionContext, value: V): void {
      state().entries.set(sessionKey(ctx), value);
    },
    invalidate(ctx: ExtensionContext): void {
      state().entries.delete(sessionKey(ctx));
    },
    safeInvalidate(ctx: ExtensionContext): void {
      try {
        state().entries.delete(sessionKey(ctx));
      } catch (e) {
        if (!isStaleCtxError(e)) throw e;
      }
    },
  };
}
