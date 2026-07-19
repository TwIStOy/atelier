import { createLogger } from "@htwang-contrib/common";
import { mergeVarsIntoEnv } from "./merge.ts";
import type { FishUniversalVar } from "./parse.ts";
import { parseFishVariables } from "./parse.ts";

export interface FsWatchHandle {
  close(): void;
}

export interface WatchDeps {
  readFile(path: string): string;
  watch(path: string, listener: (eventType: string) => void): FsWatchHandle;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface WatchOptions {
  path: string;
  debounceMs?: number;
  env: Record<string, string | undefined>;
  deps: WatchDeps;
  logger?: { info(msg: string): void; warn(msg: string): void; error(msg: string): void };
}

const DEFAULT_DEBOUNCE_MS = 300;

export class FishVarsWatcher {
  private readonly opts: WatchOptions;
  private readonly logger: NonNullable<WatchOptions["logger"]>;
  private handle: FsWatchHandle | null = null;
  private pendingTimer: unknown = null;
  private lastFire = 0;
  private closed = false;

  constructor(opts: WatchOptions) {
    this.opts = opts;
    this.logger = opts.logger ?? createLogger("fish-env-sync");
  }

  start(): boolean {
    let initial: FishUniversalVar[] = [];
    try {
      const content = this.opts.deps.readFile(this.opts.path);
      initial = parseFishVariables(content);
    } catch (err) {
      this.logger.warn(
        `Failed to read fish_variables at ${this.opts.path}: ${describeError(err)}; watcher not started.`,
      );
      return false;
    }
    mergeVarsIntoEnv(initial, this.opts.env);
    this.logger.info(
      `fish-env-sync: applied ${countExported(initial)} exported universal var(s) from ${this.opts.path}.`,
    );
    try {
      this.handle = this.opts.deps.watch(this.opts.path, () => this.onFileEvent());
    } catch (err) {
      this.logger.warn(`Failed to watch ${this.opts.path}: ${describeError(err)}; live updates disabled.`);
      return false;
    }
    return true;
  }

  stop(): void {
    this.closed = true;
    if (this.pendingTimer !== null) {
      this.opts.deps.clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
    if (this.handle !== null) {
      try {
        this.handle.close();
      } catch {}
      this.handle = null;
    }
  }

  private onFileEvent(): void {
    if (this.closed) return;
    if (this.pendingTimer !== null) {
      this.opts.deps.clearTimeout(this.pendingTimer);
    }
    const delay = this.opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.pendingTimer = this.opts.deps.setTimeout(() => this.flush(), delay);
    this.lastFire = this.opts.deps.now();
  }

  private flush(): void {
    this.pendingTimer = null;
    if (this.closed) return;
    let content: string;
    try {
      content = this.opts.deps.readFile(this.opts.path);
    } catch (err) {
      this.logger.warn(
        `fish-env-sync: re-read of ${this.opts.path} failed: ${describeError(err)}; skipping this change.`,
      );
      return;
    }
    const vars = parseFishVariables(content);
    mergeVarsIntoEnv(vars, this.opts.env);
    this.logger.info(
      `fish-env-sync: re-applied ${countExported(vars)} exported universal var(s) (changed at ${new Date(this.lastFire).toISOString()}).`,
    );
  }
}

function countExported(vars: FishUniversalVar[]): number {
  let n = 0;
  for (const v of vars) if (v.exported) n += 1;
  return n;
}

function describeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}
