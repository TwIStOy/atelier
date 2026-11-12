import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findExecutable } from "../src/executable.ts";
import { getLocalRexContext, openRexPane, type RexContext } from "../src/rex.ts";

describe("Rex pane launches", () => {
  let directory: string;
  let executable: string;
  let env: NodeJS.ProcessEnv;
  let context: RexContext;
  const exec = vi.fn<ExtensionAPI["exec"]>();

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "pi-rex-"));
    executable = join(directory, "rex");
    writeFileSync(executable, "", { mode: 0o700 });
    env = {
      PATH: directory,
      REX_BIN_DIR: directory,
      REX_SERVER: "unix:///run/rex/server.sock",
      REX_SESSION: "session:source",
      REX_BLOCK: "block:source",
    };
    context = {
      executable,
      endpoint: "unix:///run/rex/server.sock",
      sessionId: "session:source",
      blockId: "block:source",
    };
    exec.mockReset();
    exec.mockResolvedValue({
      code: 0,
      killed: false,
      stderr: "",
      stdout: JSON.stringify({
        endpoint: context.endpoint,
        session_id: context.sessionId,
        block_id: context.blockId,
      }),
      truncated: false,
    });
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it("resolves executables without a shell and rejects non-executable files", () => {
    expect(findExecutable("rex", env)).toBe(executable);
    expect(findExecutable(executable, {})).toBe(executable);
    expect(findExecutable(directory, env)).toBeUndefined();
    chmodSync(executable, 0o600);
    expect(findExecutable("rex", env)).toBeUndefined();
    expect(findExecutable("missing", env)).toBeUndefined();
  });

  it("requires both session and block even when an endpoint is globally configured", async () => {
    await expect(getLocalRexContext(exec, { REX_SERVER: env.REX_SERVER })).rejects.toThrow("inside a Rex");
    await expect(getLocalRexContext(exec, { ...env, REX_BLOCK: " " })).rejects.toThrow("inside a Rex");
    expect(exec).not.toHaveBeenCalled();
  });

  it("uses the server's injected binary and pins the resolved local endpoint", async () => {
    expect(await getLocalRexContext(exec, env)).toEqual(context);
    expect(exec).toHaveBeenCalledWith(
      executable,
      ["--autostart=false", "--server", context.endpoint, "whoami", "--json"],
      { timeout: 15_000 },
    );
  });

  it.each([
    {
      session_id: "session:other",
      block_id: "block:source",
      endpoint: "unix:///run/rex/server.sock",
    },
    {
      session_id: "session:source",
      block_id: "block:other",
      endpoint: "unix:///run/rex/server.sock",
    },
    {
      session_id: "session:source",
      block_id: "block:source",
      endpoint: "https://remote.example",
    },
  ])("rejects mismatched or remote contexts", async (identity) => {
    exec.mockResolvedValueOnce({
      code: 0,
      killed: false,
      stderr: "",
      stdout: JSON.stringify(identity),
      truncated: false,
    });
    await expect(getLocalRexContext(exec, env)).rejects.toThrow();
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it("anchors the new pane to the originating block and preserves literal argv and focus", async () => {
    exec.mockResolvedValueOnce({
      code: 0,
      killed: false,
      stderr: "",
      stdout: '{"block_ids":["block:new"]}',
      truncated: false,
    });
    const command: [string, ...string[]] = ["/path with spaces/browser", "open", "http://127.0.0.1:7700/?x=$(touch)"];
    expect(await openRexPane(exec, context, { cwd: "/work tree", label: "Canvas", direction: "right", command })).toBe(
      "block:new",
    );
    const [, args] = exec.mock.calls[0];
    expect(args).toEqual([
      "--autostart=false",
      "--server",
      context.endpoint,
      "run",
      "--session",
      context.sessionId,
      "--block",
      context.blockId,
      "--split",
      "right",
      "--focus=false",
      "--shell=none",
      "--cwd",
      "/work tree",
      "--label",
      "Canvas",
      "--json",
      "--",
      ...command,
    ]);
  });

  it.each([
    { code: 1, killed: false, stderr: "anchor not found", stdout: "", truncated: false },
    { code: 0, killed: true, stderr: "", stdout: "", truncated: false },
    { code: 0, killed: false, stderr: "", stdout: "null", truncated: false },
    { code: 0, killed: false, stderr: "", stdout: '{"block_ids":[]}', truncated: false },
  ])("reports failed or malformed launches without retrying", async (result) => {
    exec.mockResolvedValueOnce(result);
    await expect(
      openRexPane(exec, context, { cwd: directory, label: "Canvas", direction: "right", command: ["browser"] }),
    ).rejects.toThrow();
    expect(exec).toHaveBeenCalledTimes(1);
  });
});
