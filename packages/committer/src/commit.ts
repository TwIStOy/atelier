import type { Message, Model } from "@earendil-works/pi-ai";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { SideCallResult } from "@htwang-contrib/common";
import { executeSideCall } from "@htwang-contrib/common";
import {
  commit,
  countChanges,
  type DiffResult,
  getDiff,
  getRepoRoot,
  hasStagedChanges,
  stageAll,
  stageFiles,
  unstageAll,
} from "./git.ts";
import { loadConfig, resolveCommitModel } from "./model-select.ts";
import { GROUPING_PROMPT, GROUPING_RETRY_PROMPT, SINGLE_COMMIT_PROMPT } from "./prompt.ts";
import type { CommitterOverlayController, CommitterProgress } from "./widget.ts";
import { showCommitterOverlay } from "./widget.ts";

type AnyModel = Model<any>;

type PreparationFailure = { status: "aborted" } | { status: "error"; message: string };
type PreparationSuccess = { status: "ready"; repoRoot: string; model: AnyModel; diff: DiffResult };
type Preparation = PreparationFailure | PreparationSuccess;

export async function handleCommit(args: string, ctx: ExtensionCommandContext): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("/commit requires an interactive terminal.", "warning");
    return;
  }

  const controller = new AbortController();
  const progress = createProgress();
  const { overlayPromise, ctrl } = await showCommitterOverlay(ctx, progress, controller);

  try {
    const preparation = await prepareRun(ctx, progress, ctrl, controller.signal);
    if (preparation.status !== "ready") {
      await finishFailedPreparation(preparation, progress, ctrl, overlayPromise);
      return;
    }

    const shouldGroup = preparation.diff.files.length >= loadConfig().groupingThreshold && !args.includes("--single");
    if (shouldGroup) {
      await commitGrouped(
        preparation.repoRoot,
        preparation.diff.diff,
        preparation.model,
        ctx,
        progress,
        ctrl,
        controller.signal,
      );
    } else {
      await commitSingle(
        preparation.repoRoot,
        preparation.diff.diff,
        preparation.model,
        ctx,
        progress,
        ctrl,
        controller.signal,
      );
    }
  } catch (err) {
    reportRunError(err, progress, ctrl, controller.signal);
  }

  await overlayPromise;
}

function createProgress(): CommitterProgress {
  return {
    phase: "preparing",
    statusMessage: "",
    model: undefined,
    filesTotal: 0,
    commitsCompleted: 0,
    commitsTotal: 0,
    commitLog: [],
    startTime: Date.now(),
  };
}

async function finishFailedPreparation(
  preparation: PreparationFailure,
  progress: CommitterProgress,
  ctrl: CommitterOverlayController,
  overlayPromise: Promise<void>,
): Promise<void> {
  if (preparation.status === "aborted") return;
  progress.phase = "error";
  progress.errorMessage = preparation.message;
  ctrl.invalidate();
  await overlayPromise;
}

async function prepareRun(
  ctx: ExtensionCommandContext,
  progress: CommitterProgress,
  ctrl: CommitterOverlayController,
  signal: AbortSignal,
): Promise<Preparation> {
  if (signal.aborted) return { status: "aborted" };

  progress.statusMessage = "Checking repository...";
  ctrl.invalidate();

  const repoRoot = await getRepoRoot(ctx.cwd, signal);
  if (!repoRoot) return { status: "error", message: "Not a git repository." };

  progress.statusMessage = "Resolving model...";
  ctrl.invalidate();

  const model = resolveCommitModel(ctx);
  if (!model) return { status: "error", message: "No model available for commit generation." };
  progress.model = `${model.provider}/${model.id}`;

  return prepareChanges(repoRoot, model, progress, ctrl, signal);
}

async function prepareChanges(
  repoRoot: string,
  model: AnyModel,
  progress: CommitterProgress,
  ctrl: CommitterOverlayController,
  signal: AbortSignal,
): Promise<Preparation> {
  progress.statusMessage = "Checking changes...";
  ctrl.invalidate();

  const changeCount = await countChanges(repoRoot, signal);
  if (changeCount === 0) return { status: "error", message: "No changes to commit." };

  progress.statusMessage = "Staging changes...";
  ctrl.invalidate();

  await stageAll(repoRoot, signal);

  const diff = await getDiff(repoRoot, 1_000_000, signal);
  progress.filesTotal = diff.files.length;
  progress.diffStat = diff.stat;
  ctrl.invalidate();

  if (signal.aborted) return { status: "aborted" };

  return { status: "ready", repoRoot, model, diff };
}

function reportRunError(
  err: unknown,
  progress: CommitterProgress,
  ctrl: CommitterOverlayController,
  signal: AbortSignal,
): void {
  if (signal.aborted) {
    progress.phase = "cancelled";
  } else {
    progress.phase = "error";
    progress.errorMessage = err instanceof Error ? err.message : String(err);
  }
  ctrl.invalidate();
}

async function commitTracked(
  cwd: string,
  message: string,
  signal: AbortSignal,
  progress: CommitterProgress,
  ctrl: CommitterOverlayController,
  failureLabel: string,
): Promise<boolean> {
  try {
    const hash = await commit(cwd, message, signal);
    progress.commitLog.push({ hash, message, success: true });
    return true;
  } catch (err) {
    if (signal.aborted) {
      progress.phase = "cancelled";
      ctrl.invalidate();
      return false;
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    progress.commitLog.push({ hash: "", message, success: false });
    progress.phase = "error";
    progress.errorMessage = `${failureLabel}: ${errMsg}`;
    ctrl.invalidate();
    return false;
  }
}

async function commitSingle(
  cwd: string,
  diffText: string,
  model: AnyModel,
  ctx: ExtensionCommandContext,
  progress: CommitterProgress,
  ctrl: CommitterOverlayController,
  signal: AbortSignal,
): Promise<void> {
  progress.phase = "generating";
  progress.statusMessage = "Generating commit message...";
  progress.commitsTotal = 1;
  ctrl.invalidate();

  const truncatedDiff = diffText.slice(0, loadConfig().maxDiffLengthSingle);
  const prompt = SINGLE_COMMIT_PROMPT + truncatedDiff;

  const result: SideCallResult = await executeSideCall({
    model,
    modelRegistry: ctx.modelRegistry,
    systemPrompt: "You are a commit message generator. Output ONLY valid conventional commit messages.",
    messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
    signal,
    commandName: "/commit",
  });

  if (signal.aborted) {
    progress.phase = "cancelled";
    ctrl.invalidate();
    return;
  }

  if (!result.ok) {
    progress.phase = "error";
    progress.errorMessage = "aborted" in result ? "Aborted." : result.error;
    ctrl.invalidate();
    return;
  }

  const message = result.answer.trim();
  progress.generatedMessage = message;
  progress.phase = "committing";
  ctrl.invalidate();

  if (signal.aborted) {
    progress.phase = "cancelled";
    ctrl.invalidate();
    return;
  }

  if (!(await commitTracked(cwd, message, signal, progress, ctrl, "git commit failed"))) return;
  progress.commitsCompleted = 1;

  progress.phase = "done";
  ctrl.invalidate();
}

async function commitGrouped(
  cwd: string,
  diffText: string,
  model: AnyModel,
  ctx: ExtensionCommandContext,
  progress: CommitterProgress,
  ctrl: CommitterOverlayController,
  signal: AbortSignal,
): Promise<void> {
  progress.phase = "generating";
  progress.statusMessage = "Grouping changes into logical commits...";
  ctrl.invalidate();

  const { files: allFiles } = await getDiff(cwd, 1_000_000, signal);
  const truncatedDiff = diffText.slice(0, loadConfig().maxDiffLength);

  const groups = await groupingWithRetry(truncatedDiff, allFiles, model, ctx, progress, ctrl, signal);

  if (signal.aborted) {
    progress.phase = "cancelled";
    ctrl.invalidate();
    return;
  }

  const validGroups = sanitizeGroups(groups, allFiles);

  if (validGroups.length === 0) {
    await commitSingle(cwd, diffText, model, ctx, progress, ctrl, signal);
    return;
  }

  const assigned = new Set(validGroups.flatMap((g) => g.files));
  const unassigned = allFiles.filter((f) => !assigned.has(f));
  if (unassigned.length > 0) {
    const last = validGroups[validGroups.length - 1]!;
    last.files = [...last.files, ...unassigned];
  }

  progress.phase = "committing";
  progress.commitsTotal = validGroups.length;
  ctrl.invalidate();

  for (let i = 0; i < validGroups.length; i++) {
    if (signal.aborted) {
      progress.phase = "cancelled";
      ctrl.invalidate();
      return;
    }

    const group = validGroups[i]!;
    await unstageAll(cwd, signal);
    await stageFiles(cwd, group.files, signal);

    if (!(await hasStagedChanges(cwd, signal))) {
      progress.commitLog.push({ hash: "", message: group.message, success: false });
      progress.phase = "error";
      progress.errorMessage = `nothing staged for group ${i + 1}; its files may have been committed by another process: ${group.files.join(", ")}`;
      ctrl.invalidate();
      return;
    }

    if (!(await commitTracked(cwd, group.message, signal, progress, ctrl, `git commit failed on group ${i + 1}`))) {
      return;
    }

    progress.commitsCompleted = i + 1;
    ctrl.invalidate();
  }

  progress.phase = "done";
  ctrl.invalidate();
}

function sanitizeGroups(groups: CommitGroup[], allFiles: string[]): CommitGroup[] {
  const changed = new Set(allFiles);
  const seen = new Set<string>();
  const valid: CommitGroup[] = [];

  for (const group of groups) {
    const files = group.files.filter((f) => {
      if (!changed.has(f) || seen.has(f)) return false;
      seen.add(f);
      return true;
    });
    if (files.length > 0) valid.push({ files, message: group.message });
  }

  return valid;
}

async function groupingWithRetry(
  diffText: string,
  allFiles: string[],
  model: AnyModel,
  ctx: ExtensionCommandContext,
  progress: CommitterProgress,
  ctrl: CommitterOverlayController,
  signal: AbortSignal,
): Promise<CommitGroup[]> {
  const systemPrompt = "You are a commit message generator. Output ONLY the requested JSON array.";
  const changedFilesList = allFiles.join("\n");

  const firstPrompt = GROUPING_PROMPT.replace("{changed_files}", changedFilesList) + diffText;

  let messages: Message[] = [{ role: "user" as const, content: firstPrompt, timestamp: Date.now() }];

  const maxRetries = loadConfig().maxGroupingRetries;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal.aborted) return [];

    const attemptLabel =
      attempt === 0
        ? "Grouping changes into logical commits..."
        : `Retrying grouping (attempt ${attempt + 1}/${maxRetries})...`;
    progress.statusMessage = attemptLabel;
    ctrl.invalidate();

    const result: SideCallResult = await executeSideCall({
      model,
      modelRegistry: ctx.modelRegistry,
      systemPrompt,
      messages,
      signal,
      commandName: "/commit",
    });

    if (signal.aborted) return [];
    if (!result.ok) return [];

    const groups = parseGroups(result.answer);
    if (groups.length === 0) continue;

    const assigned = new Set(groups.flatMap((g) => g.files));
    const missing = allFiles.filter((f) => !assigned.has(f));
    if (missing.length === 0) return groups;

    if (attempt < maxRetries) {
      const retryPrompt = GROUPING_RETRY_PROMPT.replace("{changed_files}", changedFilesList)
        .replace("{missing_files}", missing.join("\n"))
        .replace("{previous_groups}", JSON.stringify(groups, null, 2));
      messages = [
        ...messages,
        result.assistantMessage,
        { role: "user" as const, content: retryPrompt, timestamp: Date.now() },
      ];
    }
  }

  return [];
}

interface CommitGroup {
  files: string[];
  message: string;
}

function parseGroups(response: string): CommitGroup[] {
  const json = extractJson(response);
  if (!json) return [];

  try {
    return parseGroupItems(JSON.parse(json));
  } catch {
    return [];
  }
}

function parseGroupItems(parsed: unknown): CommitGroup[] {
  if (!Array.isArray(parsed)) return [];
  const groups: CommitGroup[] = [];
  for (const item of parsed) {
    const group = parseGroupItem(item);
    if (group !== null) groups.push(group);
  }
  return groups;
}

function isGroupItem(item: unknown): item is { files: unknown[]; message: string } {
  if (typeof item !== "object" || item === null) return false;
  const candidate = item as { files?: unknown; message?: unknown };
  return Array.isArray(candidate.files) && typeof candidate.message === "string";
}

function parseGroupItem(item: unknown): CommitGroup | null {
  if (!isGroupItem(item)) return null;
  const files = item.files.map((f: unknown) => String(f)).filter((f: string) => f.length > 0);
  const message = item.message.trim();
  if (files.length === 0 || !message) return null;
  return { files, message };
}

function extractJson(text: string): string | null {
  const trimmed = text.trim();

  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1]!.trim();

  if (trimmed.startsWith("[")) {
    const end = trimmed.lastIndexOf("]");
    if (end !== -1) return trimmed.slice(0, end + 1);
  }

  const arrStart = trimmed.indexOf("[");
  const arrEnd = trimmed.lastIndexOf("]");
  if (arrStart !== -1 && arrEnd > arrStart) {
    return trimmed.slice(arrStart, arrEnd + 1);
  }

  return null;
}
