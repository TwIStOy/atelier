import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Minimal TUI surface `editWithExternalEditor` drives. The full pi-tui `TUI` satisfies
 * this; the narrow interface keeps the function unit-testable with a fake.
 */
export interface ExternalEditorTui {
  stop(): void;
  start(): void;
  requestRender(force?: boolean): void;
}

function spawnEditor(editor: string, args: readonly string[], file: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(editor, [...args, file], {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const reason = signal ? `signal ${signal}` : `exit code ${code ?? "unknown"}`;
      reject(new Error(`External editor exited with ${reason}`));
    });
  });
}

/**
 * Edit a custom-answer draft with Pi's configured external-editor command. Writes the
 * current draft to a temp file, tears the TUI down so the editor owns the terminal,
 * then restores the TUI and forces a re-render on the way out (even on failure). A
 * single trailing newline is stripped so an editor that appends one does not smuggle a
 * blank line into the draft.
 *
 * Rejects on a non-zero / signalled / failed-to-spawn editor; the caller decides whether
 * to keep the original draft.
 */
export async function editWithExternalEditor(tui: ExternalEditorTui, command: string, value: string): Promise<string> {
  // Parse up front so a missing/misconfigured editor rejects BEFORE the TUI is torn
  // down — never stop the terminal just to report a config error.
  const [editor, ...args] = command.trim().split(/\s+/);
  if (!editor) return Promise.reject(new Error("External editor command is empty"));

  const tempDir = mkdtempSync(join(tmpdir(), "auq-ask-user-question-"));
  const tempFile = join(tempDir, "answer.md");
  let tuiStopped = false;

  try {
    writeFileSync(tempFile, value, "utf8");
    tui.stop();
    tuiStopped = true;
    process.stdout.write(`Launching external editor: ${command}\nPi will resume when the editor exits.\n`);
    await spawnEditor(editor, args, tempFile);
    return readFileSync(tempFile, "utf8").replace(/\r?\n$/, "");
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Temp cleanup is best effort; never leave the TUI stopped because it failed.
    }
    if (tuiStopped) {
      tui.start();
      tui.requestRender(true);
    }
  }
}
