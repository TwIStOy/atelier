import { EventEmitter } from "node:events";
import { describe, expect, test } from "vitest";
import { buildEnvelope, isMoshiHookAvailable, resolveTransportMode, sendEnvelope } from "../src/moshi-client.ts";
import { getCachedTerminalContext, resetTerminalContextCache } from "../src/terminal-context.ts";

const HERDR_PAYLOAD = JSON.stringify({
  kind: "herdr",
  herdr: {
    session: "proj",
    paneId: "w-1",
    workspaceId: "w",
    tabId: "w:1",
    tab: "1",
  },
  cwd: "/home/hawtian/pi-extensions",
  git: { branch: "master" },
});

describe("isMoshiHookAvailable", () => {
  test("true when version subcommand exits 0", () => {
    const spawnSync = ((_bin: string, args: string[]) => {
      expect(args).toEqual(["version"]);
      return { status: 0 };
    }) as never;
    expect(isMoshiHookAvailable({ spawnSync })).toBe(true);
  });

  test("false on non-zero exit", () => {
    const spawnSync = (() => ({ status: 1 })) as never;
    expect(isMoshiHookAvailable({ spawnSync })).toBe(false);
  });

  test("false on throw", () => {
    const spawnSync = (() => {
      throw new Error("ENOENT");
    }) as never;
    expect(isMoshiHookAvailable({ spawnSync })).toBe(false);
  });
});

describe("resolveTransportMode", () => {
  test("socket when socket file present", () => {
    const statSync = (() => ({ isSocket: () => true })) as never;
    const spawnSync = (() => ({ status: 0 })) as never;
    expect(resolveTransportMode({ statSync, spawnSync: spawnSync as never })).toBe("socket");
  });

  test("spawn when socket absent but binary ok", () => {
    const statSync = (() => {
      throw new Error("ENOENT");
    }) as never;
    const spawnSync = (() => ({ status: 0 })) as never;
    expect(resolveTransportMode({ statSync, spawnSync: spawnSync as never })).toBe("spawn");
  });

  test("none when socket absent and binary missing", () => {
    const statSync = (() => {
      throw new Error("ENOENT");
    }) as never;
    const spawnSync = (() => {
      throw new Error("ENOENT");
    }) as never;
    expect(resolveTransportMode({ statSync, spawnSync: spawnSync as never })).toBe("none");
  });
});

describe("buildEnvelope", () => {
  test("emits session.update with all terminal context fields", () => {
    resetTerminalContextCache();
    const spawnSync = (() => ({ stdout: HERDR_PAYLOAD, status: 0 })) as never;
    const ctx = getCachedTerminalContext({ spawnSync });
    const envelope = buildEnvelope({
      eventName: "ToolCallStart",
      event: { toolCallId: "t1" },
      ctx: {
        cwd: "/home/hawtian/pi-extensions",
        model: { name: "glm-4.6" },
      },
      terminalContext: ctx,
      extra: { tool_name: "bash" },
    });
    expect(envelope.type).toBe("session.update");
    expect(envelope.source).toBe("pi");
    expect(envelope.eventName).toBe("ToolCallStart");
    expect(envelope.terminalKind).toBe("herdr");
    expect(envelope.herdrPane).toBe("w-1");
    expect(envelope.modelName).toBe("glm-4.6");
    expect(envelope.projectName).toBe("proj");
    expect(envelope.tool_name).toBe("bash");
    expect(typeof envelope.requestedAt).toBe("string");
    expect(envelope.expiresAt).toBe("0001-01-01T00:00:00Z");
  });

  test("projectName falls back to cwd basename when no terminal session", () => {
    const envelope = buildEnvelope({
      eventName: "ToolCallStart",
      event: {},
      ctx: { cwd: "/home/user/my-repo", model: {} },
      terminalContext: {
        terminalKind: "shell",
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
      },
    });
    expect(envelope.projectName).toBe("my-repo");
  });

  test("sessionId prefers event.session_id", () => {
    const envelope = buildEnvelope({
      eventName: "x",
      event: { session_id: "evt-sid" },
      ctx: { sessionManager: { getSessionFile: () => "ctx-file" } },
      terminalContext: {
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
      },
    });
    expect(envelope.sessionId).toBe("evt-sid");
  });
});

type FakeSocket = EventEmitter & {
  setNoDelay: () => void;
  write: (data: string) => void;
  end: () => void;
  destroy: () => void;
};

function socketThatEnds(): FakeSocket {
  const ee = new EventEmitter() as FakeSocket;
  ee.setNoDelay = () => {};
  ee.write = () => true;
  ee.end = () => {
    queueMicrotask(() => ee.emit("end"));
  };
  ee.destroy = () => {
    ee.removeAllListeners();
  };
  return ee;
}

function connectThen(sock: FakeSocket): FakeSocket {
  queueMicrotask(() => sock.emit("connect"));
  return sock;
}

describe("sendEnvelope dispatch", () => {
  test("prefers socket when present", async () => {
    const sock = socketThatEnds();
    let connectPath: string | undefined;
    const createConnection = (opts: { path?: string }) => {
      connectPath = opts.path;
      return connectThen(sock);
    };
    const statSync = (() => ({ isSocket: () => true })) as never;
    const spawnSync = (() => ({ status: 0 })) as never;

    const result = await sendEnvelope(
      {
        eventName: "ToolCallStart",
        event: {},
        ctx: { cwd: "/tmp", model: {} },
        terminalContext: {
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
        },
      },
      {
        preferSocket: true,
        createConnection: createConnection as never,
        statSync,
        spawnSync: spawnSync as never,
      },
    );
    expect(result.outcome.transport).toBe("socket");
    expect(connectPath).toBeDefined();
  });

  test("falls back to spawn on socket connect failure", async () => {
    const sock = new EventEmitter() as FakeSocket;
    sock.setNoDelay = () => {};
    sock.write = () => true;
    sock.end = () => {};
    sock.destroy = () => {
      sock.removeAllListeners();
    };
    const createConnection = () => {
      queueMicrotask(() => sock.emit("error", Object.assign(new Error("no"), { code: "ECONNREFUSED" })));
      return sock;
    };
    const statSync = (() => ({ isSocket: () => true })) as never;
    const spawnCalls: Array<{ binary: string; args: string[] }> = [];
    const spawn = ((binary: string, args: string[]) => {
      spawnCalls.push({ binary, args });
      return {
        stdin: { end: () => {} },
        unref: () => {},
      };
    }) as never;
    const spawnSync = (() => ({ status: 0 })) as never;

    const result = await sendEnvelope(
      {
        eventName: "ToolCallStart",
        event: { session_id: "s" },
        ctx: { cwd: "/tmp", model: {} },
        terminalContext: {
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
        },
      },
      {
        preferSocket: true,
        createConnection: createConnection as never,
        statSync,
        spawn,
        spawnSync: spawnSync as never,
      },
    );
    expect(result.outcome.transport).toBe("spawn");
    expect(result.fallbackFromSocket).toBe(true);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].args).toEqual(["pi-hook"]);
  });

  test("returns none when socket absent and binary unavailable", async () => {
    const statSync = (() => {
      throw new Error("ENOENT");
    }) as never;
    const spawnSync = (() => {
      throw new Error("ENOENT");
    }) as never;
    const result = await sendEnvelope(
      {
        eventName: "ToolCallStart",
        event: {},
        ctx: { cwd: "/tmp", model: {} },
        terminalContext: {
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
        },
      },
      { preferSocket: true, statSync, spawnSync: spawnSync as never },
    );
    expect(result.outcome.transport).toBe("none");
  });
});
