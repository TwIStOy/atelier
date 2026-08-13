import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  type ExtensionConfigSchema,
  isExtensionDisabled,
  readConfig,
  registerConfigItems,
} from "@htwang-contrib/common";
import { Type } from "@sinclair/typebox";
import { CanvasServer, externalIPv4Addresses } from "./server.ts";
import { isValidPageName, PageStore } from "./store.ts";

const CONFIG_ID = "canvas";

interface CanvasConfig {
  port: number;
  pagesDir: string;
}

const CONFIG_SCHEMA: ExtensionConfigSchema<CanvasConfig> = {
  defaults: {
    port: 7700,
    pagesDir: join(homedir(), ".pi", "agent", "canvas"),
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
      description: "Directory where published pages are persisted and shared across sessions.",
      extensionLabel: "Canvas",
      order: 10,
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

  let store: PageStore | null = null;
  let server: CanvasServer | null = null;
  let activated = false;

  async function ensureRunning(): Promise<{ store: PageStore; server: CanvasServer }> {
    if (!store) {
      store = new PageStore(loadConfig().pagesDir);
    }
    if (!server) {
      server = new CanvasServer({ store, preferredPort: loadConfig().port });
      await server.start();
    }
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
      async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
        if (!isValidPageName(params.name)) {
          return {
            content: [{ type: "text", text: `Invalid page name "${params.name}". ${NAME_RULES}.` }],
            details: { error: "invalid_name" },
          };
        }
        let running: { store: PageStore; server: CanvasServer };
        try {
          running = await ensureRunning();
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
      async execute(_toolCallId, _params, _signal, _onUpdate, _ctx) {
        let running: { store: PageStore; server: CanvasServer };
        try {
          running = await ensureRunning();
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
      pi.sendMessage({ customType: "canvas:guidance", content: guidance, display: false }, { deliverAs: "nextTurn" });
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
        const running = await ensureRunning();
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

  pi.on("session_shutdown", async () => {
    await server?.stop();
    server = null;
    store = null;
    activated = false;
  });
}
