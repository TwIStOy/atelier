import { describe, expect, it } from "vitest";
import { FishVarsWatcher, type FsWatchHandle, type WatchDeps } from "../src/watcher.ts";

interface FakeTimer {
  fn: () => void;
  fired: boolean;
}

interface FakeHandle extends FsWatchHandle {
  closed: boolean;
}

function makeDeps(initialContent: string): {
  deps: WatchDeps & {
    setContent(s: string): void;
    emit(): void;
    timers: FakeTimer[];
    watchHandle: FakeHandle | null;
    readThrowOnce: boolean;
    readCount: number;
    watchThrow: boolean;
  };
} {
  let content = initialContent;
  const timers: FakeTimer[] = [];
  let watchHandle: FakeHandle | null = null;
  let readThrow = false;
  let watchThrow = false;
  let readCount = 0;
  const deps = {
    setContent(s: string) {
      content = s;
    },
    get readCount() {
      return readCount;
    },
    set readThrowOnce(v: boolean) {
      readThrow = v;
    },
    set watchThrow(v: boolean) {
      watchThrow = v;
    },
    get watchHandle() {
      return watchHandle;
    },
    timers,
    readFile() {
      readCount += 1;
      if (readThrow) {
        readThrow = false;
        throw new Error("read failed");
      }
      return content;
    },
    watch(_path: string, listener: (et: string) => void): FakeHandle {
      if (watchThrow) throw new Error("watch failed");
      watchHandle = {
        closed: false,
        close() {
          if (watchHandle) watchHandle.closed = true;
        },
      };
      deps.emit = () => listener("change");
      return watchHandle;
    },
    emit() {
      // replaced by watch()
    },
    now() {
      return Date.now();
    },
    setTimeout(fn: () => void) {
      const t: FakeTimer = { fn, fired: false };
      timers.push(t);
      return t;
    },
    clearTimeout(handle: unknown) {
      const idx = timers.indexOf(handle as FakeTimer);
      if (idx >= 0) timers.splice(idx, 1);
    },
  };
  return { deps };
}

describe("FishVarsWatcher - start", () => {
  it("applies exported vars from initial content and starts watching", () => {
    const env: Record<string, string> = {};
    const { deps } = makeDeps("SETUVAR --export FOO:bar\n");
    const w = new FishVarsWatcher({ path: "/p", env, deps });
    expect(w.start()).toBe(true);
    expect(env.FOO).toBe("bar");
    expect(deps.watchHandle?.closed).toBe(false);
    w.stop();
  });

  it("returns false and does not mutate env when initial read throws", () => {
    const env: Record<string, string> = {};
    const { deps } = makeDeps("SETUVAR --export FOO:bar\n");
    deps.readThrowOnce = true;
    const logs: string[] = [];
    const w = new FishVarsWatcher({
      path: "/p",
      env,
      deps,
      logger: {
        info: (m) => logs.push(`info:${m}`),
        warn: (m) => logs.push(`warn:${m}`),
        error: (m) => logs.push(`error:${m}`),
      },
    });
    expect(w.start()).toBe(false);
    expect(env.FOO).toBeUndefined();
    expect(deps.watchHandle).toBeNull();
    expect(logs.some((l) => l.startsWith("warn:") && l.includes("Failed to read"))).toBe(true);
  });

  it("returns false when watch() throws, but initial merge still happened", () => {
    const env: Record<string, string> = {};
    const { deps } = makeDeps("SETUVAR --export FOO:bar\n");
    deps.watchThrow = true;
    const logs: string[] = [];
    const w = new FishVarsWatcher({
      path: "/p",
      env,
      deps,
      logger: {
        info: () => {},
        warn: (m) => logs.push(m),
        error: () => {},
      },
    });
    expect(w.start()).toBe(false);
    expect(env.FOO).toBe("bar");
    expect(logs.some((l) => l.includes("Failed to watch"))).toBe(true);
  });
});

describe("FishVarsWatcher - debounce", () => {
  it("coalesces multiple rapid events into a single flush", () => {
    const env: Record<string, string> = {};
    const { deps } = makeDeps("SETUVAR --export FOO:bar\n");
    const w = new FishVarsWatcher({ path: "/p", env, deps, debounceMs: 100 });
    expect(w.start()).toBe(true);
    deps.setContent("SETUVAR --export FOO:bar\nSETUVAR --export BAZ:qux\n");
    deps.emit();
    expect(deps.timers).toHaveLength(1);
    deps.emit();
    deps.emit();
    expect(deps.timers).toHaveLength(1);
    deps.timers[0].fn();
    expect(env.BAZ).toBe("qux");
    w.stop();
  });

  it("does not flush until the debounce timer fires", () => {
    const env: Record<string, string> = {};
    const { deps } = makeDeps("SETUVAR --export FOO:bar\n");
    const w = new FishVarsWatcher({ path: "/p", env, deps, debounceMs: 100 });
    w.start();
    deps.setContent("SETUVAR --export FOO:updated\n");
    deps.emit();
    expect(env.FOO).toBe("bar");
    deps.timers[0].fn();
    expect(env.FOO).toBe("updated");
    w.stop();
  });
});

describe("FishVarsWatcher - fail-safe", () => {
  it("logs and skips a flush when re-read throws, keeps prior env", () => {
    const env: Record<string, string> = {};
    const { deps } = makeDeps("SETUVAR --export FOO:bar\n");
    const logs: string[] = [];
    const w = new FishVarsWatcher({
      path: "/p",
      env,
      deps,
      debounceMs: 50,
      logger: {
        info: () => {},
        warn: (m) => logs.push(m),
        error: () => {},
      },
    });
    w.start();
    deps.readThrowOnce = true;
    deps.emit();
    deps.timers[0].fn();
    expect(env.FOO).toBe("bar");
    expect(logs.some((l) => l.includes("re-read") && l.includes("failed"))).toBe(true);
    w.stop();
  });
});

describe("FishVarsWatcher - stop", () => {
  it("closes the watch handle and clears any pending timer", () => {
    const env: Record<string, string> = {};
    const { deps } = makeDeps("SETUVAR --export FOO:bar\n");
    const w = new FishVarsWatcher({ path: "/p", env, deps, debounceMs: 100 });
    w.start();
    deps.emit();
    expect(deps.timers).toHaveLength(1);
    w.stop();
    expect(deps.timers).toHaveLength(0);
    expect(deps.watchHandle?.closed).toBe(true);
  });

  it("ignores file events after stop", () => {
    const env: Record<string, string> = {};
    const { deps } = makeDeps("SETUVAR --export FOO:bar\n");
    const w = new FishVarsWatcher({ path: "/p", env, deps, debounceMs: 0 });
    w.start();
    w.stop();
    deps.setContent("SETUVAR --export FOO:should-not-apply\n");
    deps.emit();
    expect(deps.timers).toHaveLength(0);
    expect(env.FOO).toBe("bar");
  });
});
