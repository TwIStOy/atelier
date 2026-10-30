import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import canvas from "../src/index.ts";

const testHome = vi.hoisted(() => ({ path: process.env.HOME ?? "/tmp" }));
let directory: string;
let terminalBrowser: string;
const exec = vi.fn<ExtensionAPI["exec"]>();
const notify = vi.fn();
const registerTool = vi.fn();
const sendUserMessage = vi.fn();
const commands = new Map<string, Parameters<ExtensionAPI["registerCommand"]>[1]>();
let shutdown: () => Promise<void>;

vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  homedir: () => testHome.path,
}));

vi.mock("@htwang-contrib/common", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isExtensionDisabled: () => false,
  registerConfigItems: vi.fn(),
  readConfig: () => ({ port: 0, pagesDir: join(directory, "pages"), terminalBrowser }),
}));

function runCommand(args = "") {
  const ctx = {
    cwd: directory,
    sessionManager: { getSessionId: () => "pi-session" },
    ui: { notify },
  } as unknown as ExtensionCommandContext;
  return commands.get("canvas-open")!.handler(args, ctx);
}

describe("/canvas-open", () => {
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "canvas-command-"));
    testHome.path = directory;
    terminalBrowser = join(directory, "terminal browser");
    writeFileSync(terminalBrowser, "", { mode: 0o700 });
    writeFileSync(join(directory, "rex"), "", { mode: 0o700 });
    vi.stubEnv("REX_BIN_DIR", directory);
    vi.stubEnv("REX_SERVER", "unix:///run/rex/server.sock");
    vi.stubEnv("REX_SESSION", "session:source");
    vi.stubEnv("REX_BLOCK", "block:source");
    vi.stubEnv("XDG_RUNTIME_DIR", join(directory, "runtime"));
    commands.clear();
    notify.mockClear();
    registerTool.mockClear();
    sendUserMessage.mockClear();
    exec.mockReset();
    exec.mockImplementation(async (_command, args) => ({
      code: 0,
      killed: false,
      stderr: "",
      stdout: args.includes("whoami")
        ? JSON.stringify({
            endpoint: "unix:///run/rex/server.sock",
            session_id: "session:source",
            block_id: "block:source",
          })
        : args.includes("run")
          ? '{"block_ids":["block:preview"]}'
          : "",
    }));
    const pi = {
      exec,
      registerCommand: (name: string, command: Parameters<ExtensionAPI["registerCommand"]>[1]) => {
        commands.set(name, command);
      },
      registerMessageRenderer: vi.fn(),
      registerTool,
      sendUserMessage,
      sendMessage: vi.fn(),
      events: { emit: vi.fn() },
      on: (event: string, handler: () => Promise<void>) => {
        if (event === "session_shutdown") shutdown = handler;
      },
    } as unknown as ExtensionAPI;
    canvas(pi);
  });

  afterEach(async () => {
    await shutdown();
    vi.unstubAllEnvs();
    rmSync(directory, { recursive: true, force: true });
  });

  it("opens the live index beside the source pane with an isolated browser and keeps Pi focus", async () => {
    expect(registerTool).not.toHaveBeenCalled();
    await runCommand();
    const launch = exec.mock.calls.find(([, args]) => args.includes("run"))![1];
    const url = launch.at(-1)!;
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect((await (await fetch(url)).text()).includes("No pages yet")).toBe(true);
    expect(launch).toContain("--focus=false");
    expect(launch.slice(launch.indexOf("--block"), launch.indexOf("--block") + 2)).toEqual(["--block", "block:source"]);
    expect(launch.slice(launch.indexOf("--split"), launch.indexOf("--split") + 2)).toEqual(["--split", "right"]);
    expect(launch.slice(-4)).toEqual([terminalBrowser, "open", "--no-merge", url]);
    expect(launch).toContain("TERMINAL_BROWSER_PRESENT=animation");
    expect(launch).toContain("TERMINAL_BROWSER_NO_TELEMETRY=1");
    expect(launch).toContain(`PATH=${process.env.PATH}`);
    expect(launch.some((arg) => arg.startsWith("XDG_RUNTIME_DIR="))).toBe(true);
    expect(launch.some((arg) => arg.startsWith("HOME="))).toBe(false);
    const config = exec.mock.calls.find(([, args]) => args.includes("config"))![1];
    expect(config.slice(-4)).toEqual(["config", "set", "render.fps", "30"]);
    expect(registerTool).toHaveBeenCalledTimes(3);
    expect(sendUserMessage).not.toHaveBeenCalled();
    expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("Canvas opened on the right"), "info");
  });

  it("opens an existing named page with live reload instead of interpreting it as a prompt", async () => {
    const pages = join(directory, "pages", "pi-session");
    mkdirSync(pages, { recursive: true });
    writeFileSync(join(pages, "metrics.html"), "<html><body><h1>Metrics</h1></body></html>");
    await runCommand("metrics");
    const url = exec.mock.calls.find(([, args]) => args.includes("run"))![1].at(-1)!;
    expect(url).toMatch(/\/p\/metrics$/);
    const html = await (await fetch(url)).text();
    expect(html).toContain("<h1>Metrics</h1>");
    expect(html).toContain("EventSource");
    expect(await commands.get("canvas-open")!.getArgumentCompletions!("met")).toEqual([
      { value: "metrics", label: "metrics" },
    ]);
    expect(sendUserMessage).not.toHaveBeenCalled();
  });

  it("rejects non-Rex environments without starting a pane", async () => {
    vi.stubEnv("REX_BLOCK", undefined);
    await runCommand();
    expect(exec).not.toHaveBeenCalled();
    expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("inside a Rex terminal"), "error");
  });

  it.each(["../private", "https://example.com", "two names"])("rejects invalid page input %s", async (name) => {
    await runCommand(name);
    expect(exec).not.toHaveBeenCalled();
    expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("Invalid page name"), "error");
  });

  it("rejects a missing page before launching a browser", async () => {
    await runCommand("missing");
    expect(exec).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenLastCalledWith(expect.stringContaining('No page named "missing"'), "error");
  });

  it("reports missing terminal-browser with configuration guidance before creating a pane", async () => {
    terminalBrowser = join(directory, "missing-browser");
    await runCommand();
    expect(exec).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("Canvas > Terminal Browser in /config"), "error");
  });

  it("reports browser configuration errors without creating a pane", async () => {
    exec.mockImplementation(async (_command, args) => ({
      code: args.includes("config") ? 1 : 0,
      killed: false,
      stderr: args.includes("config") ? "unsupported setting" : "",
      stdout: JSON.stringify({
        endpoint: "unix:///run/rex/server.sock",
        session_id: "session:source",
        block_id: "block:source",
      }),
    }));
    await runCommand();
    expect(exec.mock.calls.some(([, args]) => args.includes("run"))).toBe(false);
    expect(notify).toHaveBeenLastCalledWith(expect.stringContaining("unsupported setting"), "error");
  });

  it("waits for one ready server when commands start concurrently", async () => {
    await Promise.all([runCommand(), runCommand()]);
    const urls = exec.mock.calls.filter(([, args]) => args.includes("run")).map(([, args]) => args.at(-1)!);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe(urls[1]);
    expect(urls[0]).not.toContain(":0/");
    expect((await fetch(urls[0])).status).toBe(200);
  });
});
