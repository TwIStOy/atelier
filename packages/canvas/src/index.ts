import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext, MessageRenderer } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { type ExtensionConfigSchema, readConfig, registerConfigItems } from "@htwang-contrib/common/config";
import { isExtensionDisabled } from "@htwang-contrib/common/extension-disable";
import { getLocalRexContext } from "@htwang-contrib/common/rex";
import { Type } from "@sinclair/typebox";
import { canvasPublishAdapter } from "./display.ts";
import { openCanvasPreview } from "./preview.ts";
import { CanvasServer, externalIPv4Addresses } from "./server.ts";
import { isValidPageName, PageStore } from "./store.ts";

const CONFIG_ID = "canvas";
const GUIDANCE_MESSAGE_TYPE = "canvas:guidance";

interface CanvasConfig {
  port: number;
  pagesDir: string;
  terminalBrowser: string;
}

const CONFIG_SCHEMA: ExtensionConfigSchema<CanvasConfig> = {
  defaults: {
    port: 7700,
    pagesDir: join(homedir(), ".pi", "agent", "canvas"),
    terminalBrowser: "terminal-browser",
  },
};

function loadConfig(): CanvasConfig {
  return readConfig(CONFIG_ID, CONFIG_SCHEMA);
}

function registerConfig(): void {
  registerConfigItems(CONFIG_ID, [
    {
      key: "port",
      type: "number",
      label: "Port",
      value: () => loadConfig().port,
      min: 1,
      max: 65535,
      description:
        "Preferred port for the canvas HTTP server. If occupied (e.g. by another pi session), the next free port is used.",
      extensionLabel: "Canvas",
      order: 0,
    },
    {
      key: "pagesDir",
      type: "string",
      label: "Pages Directory",
      value: () => loadConfig().pagesDir,
      description:
        "Base directory for published pages. Each pi session writes to its own subdirectory (keyed by session id) so canvases never collide across sessions.",
      extensionLabel: "Canvas",
      order: 10,
    },
    {
      key: "terminalBrowser",
      type: "string",
      label: "Terminal Browser",
      value: () => loadConfig().terminalBrowser,
      description: "Executable name or absolute path used by /canvas-open to open a preview inside Rex.",
      extensionLabel: "Canvas",
      order: 20,
    },
  ]);
}

function pageUrls(port: number, path: string): string[] {
  const hosts = ["127.0.0.1", ...externalIPv4Addresses()];
  return hosts.map((host) => `http://${host}:${port}${path}`);
}

const NAME_RULES = "1-64 chars: letters, digits, '-' or '_'";

type ToolError = { content: [{ type: "text"; text: string }]; details: { error: string } };

export default function (pi: ExtensionAPI): void {
  if (isExtensionDisabled(CONFIG_ID)) return;
  registerConfig();

  const guidanceRenderer: MessageRenderer = (_message, _options, theme) =>
    new Text(
      theme.fg("dim", "Canvas guidance loaded — design rules and publishing conventions are now in context."),
      0,
      0,
    );
  pi.registerMessageRenderer(GUIDANCE_MESSAGE_TYPE, guidanceRenderer);

  let store: PageStore | null = null;
  let server: CanvasServer | null = null;
  let serverStart: Promise<number> | null = null;
  let activated = false;

  async function ensureRunning(ctx: ExtensionContext): Promise<{ store: PageStore; server: CanvasServer }> {
    if (!store) {
      const sessionId = ctx.sessionManager.getSessionId();
      store = new PageStore(join(loadConfig().pagesDir, sessionId));
    }
    if (!server) {
      server = new CanvasServer({ store, preferredPort: loadConfig().port });
    }
    serverStart ??= server.start().catch((error: unknown) => {
      serverStart = null;
      throw error;
    });
    await serverStart;
    return { store, server };
  }

  function startError(err: unknown): ToolError {
    return {
      content: [{ type: "text", text: `Failed to start canvas server: ${String(err)}` }],
      details: { error: "start_failed" },
    };
  }

  function activateCanvas(): void {
    if (activated) return;
    activated = true;

    pi.events.emit("tool-display:register", {
      toolName: "canvas_publish",
      adapter: canvasPublishAdapter,
    });

    pi.registerTool({
      name: "canvas_publish",
      label: "Canvas Publish",
      description:
        "Publish a self-contained HTML page to the canvas server at /p/<name>. " +
        "Publishing an existing name overwrites it, and browsers viewing the page auto-reload. " +
        "Use it for standalone visual artifacts (dashboards, charts, diagrams, data-heavy analyses) " +
        "that are easier to explore in a browser than in chat.",
      parameters: Type.Object({
        name: Type.String({
          description: `Page slug used in the URL /p/<name>. ${NAME_RULES}.`,
        }),
        html: Type.String({ description: "Full HTML document for the page." }),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
        if (!isValidPageName(params.name)) {
          return {
            content: [{ type: "text", text: `Invalid page name "${params.name}". ${NAME_RULES}.` }],
            details: { error: "invalid_name" },
          };
        }
        let running: { store: PageStore; server: CanvasServer };
        try {
          running = await ensureRunning(ctx);
        } catch (err) {
          return startError(err);
        }
        running.store.upsert(params.name, params.html);
        running.server.notifyChanged(params.name);
        const urls = pageUrls(running.server.port, `/p/${params.name}`);
        return {
          content: [{ type: "text", text: `Published "${params.name}".\n${urls.join("\n")}` }],
          details: { name: params.name, urls },
        };
      },
    });

    pi.registerTool({
      name: "canvas_delete",
      label: "Canvas Delete",
      description: "Delete a page previously published with canvas_publish.",
      parameters: Type.Object({
        name: Type.String({ description: "Page slug to delete." }),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        if (!store) {
          return {
            content: [{ type: "text", text: `No page named "${params.name}".` }],
            details: { error: "not_found" },
          };
        }
        const existed = store.remove(params.name);
        if (existed) {
          server?.notifyChanged(params.name);
          return {
            content: [{ type: "text", text: `Deleted "${params.name}".` }],
            details: { name: params.name },
          };
        }
        return {
          content: [{ type: "text", text: `No page named "${params.name}".` }],
          details: { error: "not_found" },
        };
      },
    });

    pi.registerTool({
      name: "canvas_list",
      label: "Canvas List",
      description: "List pages published on the canvas server, with URLs.",
      parameters: Type.Object({}),
      annotations: { readOnlyHint: true },
      async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
        let running: { store: PageStore; server: CanvasServer };
        try {
          running = await ensureRunning(ctx);
        } catch (err) {
          return startError(err);
        }
        const pages = running.store.list();
        if (pages.length === 0) {
          return {
            content: [{ type: "text", text: "No pages published yet." }],
            details: { pages: [] },
          };
        }
        const lines = pages.map((p) => `- ${p.name} (updated ${new Date(p.updatedAt).toISOString()})`);
        const urls = pageUrls(running.server.port, "/");
        return {
          content: [{ type: "text", text: `${lines.join("\n")}\n\nIndex:\n${urls.join("\n")}` }],
          details: { pages: pages.map((p) => p.name), urls },
        };
      },
    });

    // Skill-style expansion: guidance lands in conversation history once,
    // attached to the next user prompt (no turn triggered).
    try {
      const guidance = readFileSync(fileURLToPath(new URL("./guidance.md", import.meta.url)), "utf8");
      pi.sendMessage(
        { customType: GUIDANCE_MESSAGE_TYPE, content: guidance, display: true },
        { deliverAs: "nextTurn" },
      );
    } catch {
      // guidance missing or unreadable: tools still work without it
    }
  }

  pi.registerCommand("canvas", {
    description:
      "Enable canvas publishing (loads the canvas_* tools into context) and start the canvas server. " +
      "Any trailing text is sent to the agent as a normal prompt.",
    handler: async (args, ctx) => {
      activateCanvas();
      try {
        const running = await ensureRunning(ctx);
        const count = running.store.list().length;
        const urls = pageUrls(running.server.port, "/");
        ctx.ui.notify(
          `Canvas tools loaded. Server on port ${running.server.port}, ${count} page(s).\n${urls.join("\n")}`,
          "info",
        );
      } catch (err) {
        ctx.ui.notify(`Failed to start canvas server: ${String(err)}`, "error");
      }
      const prompt = args.trim();
      if (prompt) {
        if (ctx.isIdle()) {
          pi.sendUserMessage(prompt);
        } else {
          pi.sendUserMessage(prompt, { deliverAs: "followUp" });
        }
      }
    },
  });

  pi.registerCommand("canvas-open", {
    description: "Open the Canvas index or a named page in a new Rex pane on the right. Usage: /canvas-open [name]",
    getArgumentCompletions: (prefix) => {
      const matches = (store?.list() ?? [])
        .filter((page) => page.name.startsWith(prefix))
        .map((page) => ({ value: page.name, label: page.name }));
      return matches.length ? matches : null;
    },
    handler: async (args, ctx) => {
      const name = args.trim();
      if (name && !isValidPageName(name)) {
        ctx.ui.notify(`Invalid page name "${name}". ${NAME_RULES}. Usage: /canvas-open [name]`, "error");
        return;
      }
      try {
        const rex = await getLocalRexContext(pi.exec);
        const running = await ensureRunning(ctx);
        if (name && !running.store.get(name)) {
          ctx.ui.notify(`No page named "${name}". Use /canvas-open to browse the page index.`, "error");
          return;
        }
        const url = `http://127.0.0.1:${running.server.port}${name ? `/p/${name}` : "/"}`;
        await openCanvasPreview(pi.exec, rex, { url, cwd: ctx.cwd, terminalBrowser: loadConfig().terminalBrowser });
        activateCanvas();
        ctx.ui.notify(`Canvas opened on the right: ${url}\nClose the preview with Ctrl+Q.`, "info");
      } catch (error) {
        ctx.ui.notify(`Could not open Canvas: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.on("session_shutdown", async () => {
    await serverStart?.catch(() => {});
    await server?.stop();
    server = null;
    serverStart = null;
    store = null;
    activated = false;
  });
}
