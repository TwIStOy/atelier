import { EventEmitter } from "node:events";
import { describe, expect, test } from "vitest";
import {
  type DaemonResponse,
  resolveSocketPath,
  sendEnvelopeToSocket,
  socketFileExists,
} from "../src/socket.ts";

describe("resolveSocketPath", () => {
  test("honors MOSHI_SOCKET_PATH override above all", () => {
    const path = resolveSocketPath({
      env: { MOSHI_SOCKET_PATH: "/custom/path.sock" },
      platform: "linux",
    });
    expect(path).toBe("/custom/path.sock");
  });

  test("darwin default lives under Application Support", () => {
    const path = resolveSocketPath({
      env: {},
      platform: "darwin",
      homedir: "/Users/test",
    });
    expect(path).toBe(
      "/Users/test/Library/Application Support/Moshi/moshi-hook.sock",
    );
  });

  test("linux uses XDG_RUNTIME_DIR when present", () => {
    const path = resolveSocketPath({
      env: { XDG_RUNTIME_DIR: "/run/user/1000" },
      platform: "linux",
    });
    expect(path).toBe("/run/user/1000/moshi-hook.sock");
  });

  test("linux falls back to /tmp when XDG absent", () => {
    const path = resolveSocketPath({
      env: {},
      platform: "linux",
    });
    expect(path).toBe("/tmp/moshi-hook.sock");
  });
});

describe("socketFileExists", () => {
  test("returns false when stat throws", () => {
    const statSync = () => {
      throw new Error("ENOENT");
    };
    expect(socketFileExists({ statSync: statSync as never, env: {} })).toBe(
      false,
    );
  });

  test("returns true only for socket filetype", () => {
    const socket = { isSocket: () => true };
    const file = { isSocket: () => false };
    expect(socketFileExists({ statSync: () => socket as never, env: {} })).toBe(
      true,
    );
    expect(socketFileExists({ statSync: () => file as never, env: {} })).toBe(
      false,
    );
  });
});

type FakeSocket = EventEmitter & {
  setNoDelay: () => void;
  write: (data: string) => void;
  end: () => void;
  destroy: () => void;
};

function makeFakeSocket(): FakeSocket {
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

function connectThen(sock: FakeSocket, fn: () => void): FakeSocket {
  queueMicrotask(() => {
    sock.emit("connect");
    fn();
  });
  return sock;
}

describe("sendEnvelopeToSocket", () => {
  test("fire-and-forget resolves sent after server half-closes", async () => {
    const sock = makeFakeSocket();
    let written = "";
    sock.write = (data: string) => {
      written = data;
      return true;
    };
    sock.end = () => {
      queueMicrotask(() => {
        sock.emit("end");
      });
    };
    const createConnection = () => connectThen(sock, () => {});

    const status = await sendEnvelopeToSocket(
      { type: "session.update", sessionId: "s1" },
      { createConnection: createConnection as never },
    );

    expect(status.status).toBe("sent");
    expect(written.endsWith("\n")).toBe(true);
    expect(JSON.parse(written).sessionId).toBe("s1");
  });

  test("connect ENOENT maps to connect-failed so caller can fall back", async () => {
    const sock = makeFakeSocket();
    const createConnection = () => {
      queueMicrotask(() =>
        sock.emit(
          "error",
          Object.assign(new Error("connect ENOENT"), { code: "ENOENT" }),
        ),
      );
      return sock;
    };
    const status = await sendEnvelopeToSocket(
      { type: "session.update" },
      { createConnection: createConnection as never },
    );
    expect(status.status).toBe("connect-failed");
  });

  test("ECONNREFUSED maps to connect-failed", async () => {
    const sock = makeFakeSocket();
    const createConnection = () => {
      queueMicrotask(() =>
        sock.emit(
          "error",
          Object.assign(new Error("refused"), { code: "ECONNREFUSED" }),
        ),
      );
      return sock;
    };
    const status = await sendEnvelopeToSocket(
      { type: "session.update" },
      { createConnection: createConnection as never },
    );
    expect(status.status).toBe("connect-failed");
  });

  test("wait mode parses daemon response", async () => {
    const sock = makeFakeSocket();
    sock.end = () => {};
    sock.destroy = () => {
      sock.removeAllListeners();
    };
    const response: DaemonResponse = { type: "approval", decision: "approve" };
    sock.write = () => {
      queueMicrotask(() => {
        sock.emit("data", Buffer.from(`${JSON.stringify(response)}\n`));
        sock.emit("end");
      });
      return true;
    };
    const createConnection = () => connectThen(sock, () => {});
    const status = await sendEnvelopeToSocket(
      { type: "approval.request" },
      {
        wait: true,
        waitTimeoutMs: 1000,
        createConnection: createConnection as never,
      },
    );
    expect(status.status).toBe("sent");
    if (status.status === "sent") {
      expect(status.response?.decision).toBe("approve");
    }
  });

  test("wait mode times out when daemon never replies", async () => {
    const sock = makeFakeSocket();
    sock.end = () => {};
    sock.destroy = () => {
      sock.removeAllListeners();
    };
    sock.write = () => true;
    const createConnection = () => sock;
    const status = await sendEnvelopeToSocket(
      { type: "approval.request" },
      {
        wait: true,
        waitTimeoutMs: 10,
        createConnection: createConnection as never,
      },
    );
    expect(status.status).toBe("error");
  });

  test("unparsable response resolves sent with null response", async () => {
    const sock = makeFakeSocket();
    sock.end = () => {
      queueMicrotask(() => sock.emit("end"));
    };
    sock.write = () => {
      queueMicrotask(() => {
        sock.emit("data", Buffer.from("not-json"));
      });
      return true;
    };
    const createConnection = () => connectThen(sock, () => {});
    const status = await sendEnvelopeToSocket(
      { type: "session.update" },
      { createConnection: createConnection as never },
    );
    expect(status.status).toBe("sent");
    if (status.status === "sent") expect(status.response).toBeNull();
  });
});
