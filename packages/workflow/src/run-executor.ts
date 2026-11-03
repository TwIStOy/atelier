import { randomUUID } from "node:crypto";
import type { AgentToolUpdateCallback, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "@earendil-works/pi-coding-agent";
import { runChildAgent } from "@htwang-contrib/common";
import { Type } from "typebox";
import { loadWorkflowConfig } from "./config.ts";
import { createStreamingWorkflowDisplay, createWidgetWorkflowDisplay, type WorkflowDisplay } from "./display.ts";
import {
  type AgentSettledRecord,
  type ResumeState,
  runWorkflow,
  type WorkflowAgentRunner,
  type WorkflowAgentSnapshot,
  type WorkflowRunResult,
} from "./engine.ts";
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

type PreparedRun = {
  script: string;
  args: unknown;
  runId: string;
  resume: ResumeState | undefined;
};

type RunPreparation = ({ ok: true } & PreparedRun) | { ok: false; result: ExecuteWorkflowResult };

function prepareResume(resumeRunId: string): RunPreparation {
  const prior = loadRunRecord(resumeRunId);
  if (prior) {
    return {
      ok: true,
      script: prior.script,
      args: prior.args,
      runId: prior.id,
      resume: { agents: prior.agents, cutoff: resumeCheckpoint(prior.agents) },
    };
  }
  const known = listRunRecords(10).map((r) => `${r.id} (${r.name}, ${r.status})`);
  return {
    ok: false,
    result: failure(
      `workflow: no run record found for id "${resumeRunId}".` +
        (known.length ? ` Recent runs: ${known.join(", ")}` : " No recorded runs exist."),
    ),
  };
}

function prepareRun(opts: ExecuteWorkflowOptions): RunPreparation {
  if (opts.resumeRunId) {
    return prepareResume(opts.resumeRunId);
  }
  if (!opts.script?.trim()) {
    return { ok: false, result: failure("workflow: `script` is required unless `resume_run_id` is given.") };
  }
  return { ok: true, script: opts.script, args: opts.args, runId: randomUUID(), resume: undefined };
}

function startRunRecord(runId: string, name: string, script: string, args: unknown): WorkflowRunRecord {
  const record: WorkflowRunRecord = {
    id: runId,
    name,
    script,
    status: "running",
    startedAt: Date.now(),
    agents: [],
  };
  if (args !== undefined) record.args = args;
  writeRunRecord(record);
  return record;
}

function finalizeRecord(record: WorkflowRunRecord, result: WorkflowRunResult): void {
  record.status = result.snapshot.status;
  record.endedAt = Date.now();
  if (result.error) record.error = result.error;
  writeRunRecord(record);
  pruneRunRecords();
}

function mergeSignals(optSignal: AbortSignal | undefined, ctxSignal: AbortSignal | undefined) {
  return optSignal ? (ctxSignal ? AbortSignal.any([optSignal, ctxSignal]) : optSignal) : ctxSignal;
}

function recordSettledAgent(record: WorkflowRunRecord, settled: AgentSettledRecord): void {
  const idx = record.agents.findIndex((a) => a.seq === settled.seq);
  if (idx >= 0) record.agents[idx] = settled;
  else record.agents.push(settled);
  writeRunRecord(record);
}

async function runPreparedWorkflow(
  ctx: ExtensionContext,
  opts: ExecuteWorkflowOptions,
  prep: PreparedRun,
  record: WorkflowRunRecord,
): Promise<WorkflowRunResult> {
  const config = loadWorkflowConfig();
  const display: WorkflowDisplay = ctx.hasUI
    ? createWidgetWorkflowDisplay(ctx.ui)
    : createStreamingWorkflowDisplay(opts.onUpdate);
  const signal = mergeSignals(opts.signal, ctx.signal);
  const result = await runWorkflow(prep.script, {
    args: prep.args,
    signal,
    runAgent: buildRunner(ctx),
    maxConcurrency: config.maxConcurrency,
    maxAgents: config.maxAgents,
    resume: prep.resume,
    onAgentSettled: (settled) => recordSettledAgent(record, settled),
    onSnapshot: (snapshot) => display.update(snapshot),
  });
  display.finish(result.snapshot);
  return result;
}

type SaveOutcome = {
  savedAs?: { name: string; path: string };
  saveError?: string;
};

function trySaveWorkflow(opts: ExecuteWorkflowOptions, script: string, cwd: string): SaveOutcome {
  try {
    return { savedAs: saveWorkflowScript(opts.saveAs as string, script, opts.saveScope ?? "user", cwd) };
  } catch (e) {
    return { saveError: e instanceof Error ? e.message : String(e) };
  }
}

function maybeSaveWorkflow(opts: ExecuteWorkflowOptions, script: string, ok: boolean, cwd: string): SaveOutcome {
  if (!opts.saveAs || !ok) return {};
  return trySaveWorkflow(opts, script, cwd);
}

function agentSummary(a: WorkflowAgentSnapshot) {
  return {
    label: a.label,
    status: a.status,
    cached: a.cached === true ? true : undefined,
    toolCalls: a.toolCalls,
    detail: a.detail,
  };
}

function buildSummary(result: WorkflowRunResult, runId: string, resumed: boolean, save: SaveOutcome) {
  return {
    ok: result.ok,
    error: result.error,
    run_id: runId,
    resumed,
    value: result.value,
    agents: result.snapshot.agents.map(agentSummary),
    saved_as: save.savedAs,
    save_error: save.saveError,
  };
}

function statusSuffix(result: WorkflowRunResult, runId: string): string {
  if (result.snapshot.status === "aborted") {
    return `\n\nThe run was paused. Completed agents are cached; resume it by calling the workflow tool with resume_run_id "${runId}" (no script needed), or via /workflows.`;
  }
  if (!result.ok) {
    return `\n\nThe run failed. Fix the script or failing agents and try again; resume_run_id "${runId}" replays agents that completed before the failure.`;
  }
  return "";
}

function saveSuffix(save: SaveOutcome): string {
  let text = "";
  if (save.savedAs) {
    text += `\n\nSaved as command /${save.savedAs.name} (${save.savedAs.path}). It takes effect after /reload.`;
  }
  if (save.saveError) {
    text += `\n\nFailed to save the workflow: ${save.saveError}`;
  }
  return text;
}

function buildResultText(result: WorkflowRunResult, runId: string, resumed: boolean, save: SaveOutcome): string {
  const summary = buildSummary(result, runId, resumed, save);
  const trunc = truncateHead(safeStringify(summary), {
    maxLines: DEFAULT_MAX_LINES,
    maxBytes: DEFAULT_MAX_BYTES,
  });
  let text = trunc.content;
  if (trunc.truncated) {
    text += `\n\n[Output truncated: ${trunc.outputLines} of ${trunc.totalLines} lines (${formatSize(trunc.outputBytes)} of ${formatSize(trunc.totalBytes)}).]`;
  }
  return text + statusSuffix(result, runId) + saveSuffix(save);
}

export async function executeWorkflowRun(
  ctx: ExtensionContext,
  opts: ExecuteWorkflowOptions,
): Promise<ExecuteWorkflowResult> {
  if (!ctx.model) {
    return failure("workflow: parent session has no active model; select a model first.");
  }

  const prep = prepareRun(opts);
  if (!prep.ok) return prep.result;

  const parsed = parseWorkflowScript(prep.script);
  if (!parsed.ok) {
    return failure(`workflow: script rejected — ${parsed.error}\n\nFix the script and try again.`, {
      run_id: prep.runId,
    });
  }

  const record = startRunRecord(prep.runId, parsed.script.meta.name, prep.script, prep.args);
  const result = await runPreparedWorkflow(ctx, opts, prep, record);
  finalizeRecord(record, result);

  const save = maybeSaveWorkflow(opts, prep.script, result.ok, ctx.cwd);
  const text = buildResultText(result, prep.runId, prep.resume !== undefined, save);

  return {
    ok: result.ok,
    text,
    details: {
      ok: result.ok,
      error: result.error,
      run_id: prep.runId,
      workflow: result.snapshot,
    },
  };
}
