import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import type { Model, Message } from "@earendil-works/pi-ai";
import { executeSideCall } from "@htwang-contrib/common";
import type { SideCallResult } from "@htwang-contrib/common";
import {
  isGitRepo,
  stageAll,
  unstageAll,
  stageFiles,
  getDiff,
  commit,
  countChanges,
} from "./git.ts";
import {
  SINGLE_COMMIT_PROMPT,
  GROUPING_PROMPT,
  GROUPING_RETRY_PROMPT,
  MAX_DIFF_LENGTH,
  MAX_DIFF_LENGTH_SINGLE,
  MAX_GROUPING_RETRIES,
} from "./prompt.ts";
import type { CommitterProgress } from "./widget.ts";
import type { CommitterOverlayController } from "./widget.ts";
import { showCommitterOverlay } from "./widget.ts";
import { resolveCommitModel } from "./model-select.ts";

type AnyModel = Model<any>;

const GROUPING_THRESHOLD = 4;

export async function handleCommit(
  pi: ExtensionAPI,
  args: string,
  ctx: ExtensionCommandContext,
): Promise<void> {
  if (!ctx.hasUI) {
    ctx.ui.notify("/commit requires an interactive terminal.", "warning");
    return;
  }

  const cwd = ctx.cwd;
  if (!isGitRepo(cwd)) {
    ctx.ui.notify("Not a git repository.", "warning");
    return;
  }

  const changeCount = countChanges(cwd);
  if (changeCount === 0) {
    ctx.ui.notify("No changes to commit.", "warning");
    return;
  }

  const model = resolveCommitModel(ctx);
  if (!model) {
    ctx.ui.notify("No model available for commit generation.", "warning");
    return;
  }

  const controller = new AbortController();
  const progress: CommitterProgress = {
    phase: "preparing",
    statusMessage: "",
    model: `${model.provider}/${model.id}`,
    filesTotal: 0,
    commitsCompleted: 0,
    commitsTotal: 0,
    commitLog: [],
    startTime: Date.now(),
  };

  const { overlayPromise, ctrl } = await showCommitterOverlay(
    ctx,
    progress,
    controller,
  );

  try {
    if (controller.signal.aborted) return;

    progress.phase = "preparing";
    progress.statusMessage = "Staging changes...";
    ctrl.invalidate();

    stageAll(cwd);

    const diff = getDiff(cwd);
    progress.filesTotal = diff.files.length;
    progress.diffStat = diff.stat;
    ctrl.invalidate();

    if (controller.signal.aborted) return;

    const shouldGroup =
      diff.files.length >= GROUPING_THRESHOLD && !args.includes("--single");

    if (shouldGroup) {
      await commitGrouped(
        cwd,
        diff.diff,
        model,
        ctx,
        progress,
        ctrl,
        controller.signal,
      );
    } else {
      await commitSingle(
        cwd,
        diff.diff,
        model,
        ctx,
        progress,
        ctrl,
        controller.signal,
      );
    }
  } catch (err) {
    if (controller.signal.aborted) {
      progress.phase = "cancelled";
    } else {
      progress.phase = "error";
      progress.errorMessage = err instanceof Error ? err.message : String(err);
    }
    ctrl.invalidate();
  }

  await overlayPromise;
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

  const truncatedDiff = diffText.slice(0, MAX_DIFF_LENGTH_SINGLE);
  const prompt = SINGLE_COMMIT_PROMPT + truncatedDiff;

  const result: SideCallResult = await executeSideCall({
    model,
    modelRegistry: ctx.modelRegistry,
    systemPrompt:
      "You are a commit message generator. Output ONLY valid conventional commit messages.",
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

  try {
    const hash = commit(cwd, message);
    progress.commitLog.push({ hash, message, success: true });
    progress.commitsCompleted = 1;
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    progress.commitLog.push({ hash: "", message, success: false });
    progress.phase = "error";
    progress.errorMessage = `git commit failed: ${errMsg}`;
    ctrl.invalidate();
    return;
  }

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

  const { files: allFiles } = getDiff(cwd);
  const truncatedDiff = diffText.slice(0, MAX_DIFF_LENGTH);

  const groups = await groupingWithRetry(
    truncatedDiff,
    allFiles,
    model,
    ctx,
    progress,
    ctrl,
    signal,
  );

  if (signal.aborted) {
    progress.phase = "cancelled";
    ctrl.invalidate();
    return;
  }

  if (groups.length === 0) {
    await commitSingle(cwd, diffText, model, ctx, progress, ctrl, signal);
    return;
  }

  const assigned = new Set(groups.flatMap((g) => g.files));
  const unassigned = allFiles.filter((f) => !assigned.has(f));
  if (unassigned.length > 0 && groups.length > 0) {
    const last = groups[groups.length - 1]!;
    last.files = [...last.files, ...unassigned];
  }

  progress.phase = "committing";
  progress.commitsTotal = groups.length;
  ctrl.invalidate();

  for (let i = 0; i < groups.length; i++) {
    if (signal.aborted) {
      progress.phase = "cancelled";
      ctrl.invalidate();
      return;
    }

    const group = groups[i];
    unstageAll(cwd);
    stageFiles(cwd, group.files);

    try {
      const hash = commit(cwd, group.message);
      progress.commitLog.push({
        hash,
        message: group.message,
        success: true,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      progress.commitLog.push({
        hash: "",
        message: group.message,
        success: false,
      });
      progress.phase = "error";
      progress.errorMessage = `git commit failed on group ${i + 1}: ${errMsg}`;
      ctrl.invalidate();
      return;
    }

    progress.commitsCompleted = i + 1;
    ctrl.invalidate();
  }

  progress.phase = "done";
  ctrl.invalidate();
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
  const systemPrompt =
    "You are a commit message generator. Output ONLY the requested JSON array.";
  const changedFilesList = allFiles.join("\n");

  const firstPrompt =
    GROUPING_PROMPT.replace("{changed_files}", changedFilesList) + diffText;

  let messages: Message[] = [
    { role: "user" as const, content: firstPrompt, timestamp: Date.now() },
  ];

  for (let attempt = 0; attempt <= MAX_GROUPING_RETRIES; attempt++) {
    if (signal.aborted) return [];

    const attemptLabel =
      attempt === 0
        ? "Grouping changes into logical commits..."
        : `Retrying grouping (attempt ${attempt + 1}/${MAX_GROUPING_RETRIES})...`;
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

    if (attempt < MAX_GROUPING_RETRIES) {
      const retryPrompt = GROUPING_RETRY_PROMPT.replace(
        "{changed_files}",
        changedFilesList,
      )
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
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];

    const groups: CommitGroup[] = [];
    for (const item of parsed) {
      if (
        !item ||
        typeof item !== "object" ||
        !Array.isArray(item.files) ||
        typeof item.message !== "string"
      )
        continue;

      const files = item.files
        .map((f: unknown) => String(f))
        .filter((f: string) => f.length > 0);
      if (files.length === 0 || !item.message.trim()) continue;

      groups.push({ files, message: item.message.trim() });
    }

    return groups;
  } catch {
    return [];
  }
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
