import { randomUUID } from "node:crypto";
import type { AgentToolUpdateCallback, ExtensionContext, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import { runChildAgent } from "@htwang-contrib/common";
import extraTools from "@htwang-contrib/extra-tools";
import inferenceSelfHost from "@htwang-contrib/inference-self-host";
import inferenceV2SelfHost from "@htwang-contrib/inference-v2-self-host";
import protectSecrets from "@htwang-contrib/protect-secrets";
import webTools from "@htwang-contrib/web-tools";
import { Type } from "typebox";
import { loadWorkflowConfig } from "./config.ts";
import { createStreamingWorkflowDisplay, createWidgetWorkflowDisplay, type WorkflowDisplay } from "./display.ts";
import { type ResumeState, runWorkflow, type WorkflowAgentRunner } from "./engine.ts";
import { WORKFLOW_SESSION_DIR } from "./paths.ts";
import {
  listRunRecords,
  loadRunRecord,
  pruneRunRecords,
  resumeCheckpoint,
  type WorkflowRunRecord,
  writeRunRecord,
} from "./run-store.ts";
import { parseWorkflowScript } from "./script.ts";
import { type SavedWorkflowScope, saveWorkflowScript } from "./script-store.ts";

const WORKFLOW_CHILD_FACTORIES: ExtensionFactory[] = [
  protectSecrets,
  extraTools,
  webTools,
  inferenceSelfHost,
  inferenceV2SelfHost,
];

export type ExecuteWorkflowOptions = {
  script?: string;
  args?: unknown;
  resumeRunId?: string;
  saveAs?: string;
  saveScope?: SavedWorkflowScope;
  signal?: AbortSignal;
  onUpdate?: AgentToolUpdateCallback<unknown>;
};

export type ExecuteWorkflowResult = {
  ok: boolean;
  text: string;
  details: Record<string, unknown>;
};

function buildRunner(ctx: ExtensionContext): WorkflowAgentRunner {
  return async (call, { signal, onProgress }) => {
    const result = await runChildAgent(
      ctx,
      {
        task: call.task,
        model: call.model,
        thinking: call.thinking,
        inherit_context: call.inherit_context,
        isolated: call.isolated,
        max_turns: call.max_turns,
        agent_type: call.agent_type,
        extensionFactories: WORKFLOW_CHILD_FACTORIES,
        sessionDir: WORKFLOW_SESSION_DIR,
        outputSchema: call.schema ? Type.Unsafe(call.schema) : undefined,
        onProgress: (p) => onProgress(p.tool_calls),
      },
      signal,
    );
    return {
      ok: !result.isError,
      value: result.value,
      text: result.text,
      error: result.errorMessage,
    };
  };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "undefined";
  } catch {
    return String(value);
  }
}

function failure(text: string, extra?: Record<string, unknown>): ExecuteWorkflowResult {
  return { ok: false, text, details: { ok: false, error: text, ...extra } };
}

export async function executeWorkflowRun(
  ctx: ExtensionContext,
  opts: ExecuteWorkflowOptions,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.model) {
    return failure("workflow: parent session has no active model; select a model first.");
  }

  let script: string;
  let args: unknown;
  let runId: string;
  let resume: ResumeState | undefined;

  if (opts.resumeRunId) {
    const prior = loadRunRecord(opts.resumeRunId);
    if (!prior) {
      const known = listRunRecords(10).map((r) => `${r.id} (${r.name}, ${r.status})`);
      return failure(
        `workflow: no run record found for id "${opts.resumeRunId}".` +
          (known.length ? ` Recent runs: ${known.join(", ")}` : " No recorded runs exist."),
      );
    }
    script = prior.script;
    args = prior.args;
    runId = prior.id;
    resume = { agents: prior.agents, cutoff: resumeCheckpoint(prior.agents) };
  } else {
    if (!opts.script?.trim()) {
      return failure("workflow: `script` is required unless `resume_run_id` is given.");
    }
    script = opts.script;
    args = opts.args;
    runId = randomUUID();
  }

  const parsed = parseWorkflowScript(script);
  if (!parsed.ok) {
    return failure(`workflow: script rejected — ${parsed.error}\n\nFix the script and try again.`, {
      run_id: runId,
    });
  }

  const record: WorkflowRunRecord = {
    id: runId,
    name: parsed.script.meta.name,
    script,
    status: "running",
    startedAt: Date.now(),
    agents: [],
  };
  if (args !== undefined) record.args = args;
  writeRunRecord(record);

  const config = loadWorkflowConfig();
  const display: WorkflowDisplay = ctx.hasUI
    ? createWidgetWorkflowDisplay(ctx.ui)
    : createStreamingWorkflowDisplay(opts.onUpdate);
  const signal = opts.signal ? (ctx.signal ? AbortSignal.any([opts.signal, ctx.signal]) : opts.signal) : ctx.signal;

  const result = await runWorkflow(script, {
    args,
    signal,
    runAgent: buildRunner(ctx),
    maxConcurrency: config.maxConcurrency,
    maxAgents: config.maxAgents,
    resume,
    onAgentSettled: (settled) => {
      const idx = record.agents.findIndex((a) => a.seq === settled.seq);
      if (idx >= 0) record.agents[idx] = settled;
      else record.agents.push(settled);
      writeRunRecord(record);
    },
    onSnapshot: (snapshot) => display.update(snapshot),
  });
  display.finish(result.snapshot);

  record.status = result.snapshot.status;
  record.endedAt = Date.now();
  if (result.error) record.error = result.error;
  writeRunRecord(record);
  pruneRunRecords();

  let savedAs: { name: string; path: string } | undefined;
  let saveError: string | undefined;
  if (opts.saveAs && result.ok) {
    try {
      savedAs = saveWorkflowScript(opts.saveAs, script, opts.saveScope ?? "user", ctx.cwd);
    } catch (e) {
      saveError = e instanceof Error ? e.message : String(e);
    }
  }

  const summary = {
    ok: result.ok,
    error: result.error,
    run_id: runId,
    resumed: resume !== undefined,
    value: result.value,
    agents: result.snapshot.agents.map((a) => ({
      label: a.label,
      status: a.status,
      cached: a.cached === true ? true : undefined,
      toolCalls: a.toolCalls,
      detail: a.detail,
    })),
    saved_as: savedAs,
    save_error: saveError,
  };
  const trunc = truncateHead(safeStringify(summary), {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  let text = trunc.content;
  if (trunc.truncated) {
    text += `\n\n[Output truncated: ${trunc.outputLines} of ${trunc.totalLines} lines (${formatSize(trunc.outputBytes)} of ${formatSize(trunc.totalBytes)}).]`;
  }
  if (result.snapshot.status === "aborted") {
    text += `\n\nThe run was paused. Completed agents are cached; resume it by calling the workflow tool with resume_run_id "${runId}" (no script needed), or via /workflows.`;
  } else if (!result.ok) {
    text += `\n\nThe run failed. Fix the script or failing agents and try again; resume_run_id "${runId}" replays agents that completed before the failure.`;
  }
  if (savedAs) {
    text += `\n\nSaved as command /${savedAs.name} (${savedAs.path}). It takes effect after /reload.`;
  }
  if (saveError) {
    text += `\n\nFailed to save the workflow: ${saveError}`;
  }

  return {
    ok: result.ok,
    text,
    details: {
      ok: result.ok,
      error: result.error,
      run_id: runId,
      workflow: result.snapshot,
    },
  };
}
