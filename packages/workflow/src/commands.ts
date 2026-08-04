import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { executeWorkflowRun } from "./run-executor.ts";
import { listRunRecords } from "./run-store.ts";
import { listSavedWorkflows, type SavedWorkflow } from "./script-store.ts";

function parseCommandArgs(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

async function runAndReport(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  name: string,
  opts: { script?: string; args?: unknown; resumeRunId?: string },
): Promise<void> {
  const result = await executeWorkflowRun(ctx, opts);
  ctx.ui.notify(
    `Workflow "${name}" ${result.ok ? "finished" : "failed"} — see chat for details.`,
    result.ok ? "info" : "error",
  );
  await pi.sendMessage(
    {
      customType: "workflow:run-result",
      content: result.text,
      display: true,
    },
    { triggerTurn: false, deliverAs: "nextTurn" },
  );
}

async function runSavedCommand(
  pi: ExtensionAPI,
  saved: SavedWorkflow,
  rawArgs: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  await runAndReport(pi, ctx, saved.name, { script: saved.script, args: parseCommandArgs(rawArgs) });
}

export function registerSavedWorkflowCommands(pi: ExtensionAPI, cwd: string): void {
  for (const saved of listSavedWorkflows(cwd)) {
    pi.registerCommand(saved.name, {
      description: `Workflow: ${saved.description} (${saved.scope} workflow, ${saved.sourcePath})`,
      handler: async (rawArgs, ctx) => {
        await runSavedCommand(pi, saved, rawArgs, ctx);
      },
    });
  }
}

export function registerWorkflowsCommand(pi: ExtensionAPI): void {
  pi.registerCommand("workflows", {
    description: "List saved workflow commands and resumable runs; run one or resume a paused run",
    handler: async (_args, ctx) => {
      const saved = listSavedWorkflows(ctx.cwd);
      const resumable = listRunRecords(10).filter((r) => r.status === "aborted" || r.status === "error");

      const options: string[] = [];
      const actions: Array<() => Promise<void>> = [];

      for (const w of saved) {
        options.push(`/${w.name} — ${w.description} [${w.scope}]`);
        actions.push(async () => {
          const input = await ctx.ui.input(`/${w.name} args`, 'JSON, e.g. {"issues": [1, 2]} (empty = no args)');
          if (input === undefined) return;
          await runSavedCommand(pi, w, input, ctx);
        });
      }
      for (const run of resumable) {
        const shortId = run.id.slice(0, 8);
        const when = new Date(run.startedAt).toLocaleString();
        options.push(`resume ${shortId}… — ${run.name} [${run.status}, ${run.agents.length} agents, ${when}]`);
        actions.push(async () => {
          await runAndReport(pi, ctx, run.name, { resumeRunId: run.id });
        });
      }

      if (options.length === 0) {
        ctx.ui.notify(
          "No saved workflows or resumable runs. Save one by calling the workflow tool with save_as.",
          "info",
        );
        return;
      }

      const picked = await ctx.ui.select("Workflows", options);
      if (picked === undefined) return;
      const idx = options.indexOf(picked);
      if (idx < 0) return;
      await actions[idx]?.();
    },
  });
}
