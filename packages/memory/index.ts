import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { buildReorganizeMemoryPrompt } from "./commands/reorganize-memory-template.js";
import { buildSelfImprovePrompt } from "./commands/self-improve-template.js";
import { buildMemoryStatusReport } from "./memory-status.js";
import { registerJournalTools, registerMemoryTools } from "./tools/index.js";
import {
  getNamespace,
  isDisabledByEnv,
  isMemoryEnabled,
  setSessionNamespace,
} from "./settings.js";
import { generateSystemPrompt } from "./system-prompt.js";

const INSTALL_GUARD = Symbol.for("pi.memory.installed");

let toolsRegistered = false;

function ensureToolsRegistered(pi: ExtensionAPI, ctx: ExtensionContext): void {
  if (toolsRegistered) return;
  toolsRegistered = true;
  registerMemoryTools(pi);
  registerJournalTools(pi, () => ctx.cwd);
}

export default function initMemory(pi: ExtensionAPI): void {
  const guard = pi as unknown as Record<symbol, boolean>;
  if (guard[INSTALL_GUARD]) return;
  guard[INSTALL_GUARD] = true;

  pi.registerCommand("memory-status", {
    description:
      "Show memory extension enablement, CLI health, resolved binary, and domain list.",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      setSessionNamespace(getNamespace(ctx));
      const report = await buildMemoryStatusReport(ctx);
      if (ctx.hasUI) {
        ctx.ui.notify(report, "info");
      }
    },
  });

  pi.registerCommand("self-improve", {
    description:
      "Reflect on the current session, identify learnings, persist to memory/journal, and improve skills",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      if (!ctx.isIdle()) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            "Agent is busy. Wait for the current turn to finish, then run /self-improve again.",
            "warning",
          );
        }
        return;
      }

      if (!isMemoryEnabled(ctx)) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            "memory tools are disabled (settings or DOTPI_MEMORY). Reflection can continue, but memory-* and journal-* writes may fail until enabled.",
            "warning",
          );
        }
      }

      setSessionNamespace(getNamespace(ctx));
      pi.sendUserMessage(buildSelfImprovePrompt(args));
    },
  });

  pi.registerCommand("reorganize-memory", {
    description:
      "Audit the full memory tree — fix domain placement, parent relationships, groupings, priorities, and triggers",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      if (!ctx.isIdle()) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            "Agent is busy. Wait for the current turn to finish, then run /reorganize-memory again.",
            "warning",
          );
        }
        return;
      }

      if (!isMemoryEnabled(ctx)) {
        if (ctx.hasUI) {
          ctx.ui.notify(
            "memory tools are disabled. Enable memory tools before reorganizing the graph.",
            "warning",
          );
        }
        return;
      }

      setSessionNamespace(getNamespace(ctx));
      pi.sendUserMessage(buildReorganizeMemoryPrompt(args));
    },
  });

  if (isDisabledByEnv()) return;

  pi.on("session_start", async (_event, ctx) => {
    if (!isMemoryEnabled(ctx)) return;
    setSessionNamespace(getNamespace(ctx));
    ensureToolsRegistered(pi, ctx);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    if (!isMemoryEnabled(ctx)) return;
    setSessionNamespace(getNamespace(ctx));
    if (!toolsRegistered) {
      ensureToolsRegistered(pi, ctx);
    }
    const appendix = await generateSystemPrompt();
    return {
      systemPrompt: event.systemPrompt + "\n\n" + appendix,
    };
  });
}
