/**
 * Thin client around the herdr CLI.
 *
 * Only the side-effecting helpers (`resolveHerdrBinary`, `runHerdrJson`,
 * `isActivePane`, `renameTab`) are impure; everything else is pure and
 * unit-testable. The orchestration layer passes the actual `exec` function so
 * tests can stub it.
 */
import type {
  ExecOptions,
  ExecResult,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";

/** Public pane id such as `w1:p1`, read from the herdr-injected env. */
export type PaneId = string;

/** Public tab id such as `w1:t1`, read from the herdr-injected env. */
export type TabId = string;

export interface HerdrEnv {
  paneId?: PaneId;
  tabId?: TabId;
  binary?: string;
  socketPath?: string;
  session?: string;
}

/**
 * Read the herdr-managed environment injected into managed pane processes.
 * Returns `undefined` for the pane id when pi is not running inside herdr.
 */
export function readHerdrEnv(env: NodeJS.ProcessEnv = process.env): HerdrEnv {
  return {
    paneId: env.HERDR_PANE_ID?.trim() || undefined,
    tabId: env.HERDR_TAB_ID?.trim() || undefined,
    binary: env.HERDR_BIN_PATH?.trim() || undefined,
    socketPath: env.HERDR_SOCKET_PATH?.trim() || undefined,
    session: env.HERDR_SESSION?.trim() || undefined,
  };
}

/** True only when herdr is actively managing this pane process. */
export function isInsideHerdr(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.HERDR_ENV === "1" && !!readHerdrEnv(env).paneId;
}

/** Resolve the herdr binary path, preferring the injected `HERDR_BIN_PATH`. */
export function resolveHerdrBinary(
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env.HERDR_BIN_PATH?.trim() || "herdr";
}

/** Shape of the `pane.get` JSON `result.pane` object we care about. */
export interface PaneInfo {
  pane_id?: string;
  focused?: boolean;
  workspace_id?: string;
  tab_id?: string;
}

/**
 * Parse the JSON envelope returned by herdr CLI commands.
 *
 * herdr prints a single JSON object per response, like
 * `{"id":..., "result":{"type":"pane_info","pane":{...}}}` or
 * `{"id":..., "error":{"code":"...","message":"..."}}`.
 * Returns `null` on any parse failure.
 */
export function parseHerdrResponse(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const firstLine = trimmed.split(/\r?\n/, 1)[0];
    if (!firstLine) return null;
    try {
      return JSON.parse(firstLine);
    } catch {
      return null;
    }
  }
}

/** Extract the `result` object from a herdr JSON envelope. */
export function extractResult(envelope: unknown): unknown {
  if (!envelope || typeof envelope !== "object") return null;
  const obj = envelope as { result?: unknown; error?: unknown };
  if (obj.error !== undefined) return null;
  return obj.result ?? null;
}

/** Return the `result.pane` object from a `pane.get` / `pane.current` response. */
export function parsePaneInfo(envelope: unknown): PaneInfo | null {
  const result = extractResult(envelope);
  if (!result || typeof result !== "object") return null;
  const pane = (result as { pane?: unknown }).pane;
  if (!pane || typeof pane !== "object") return null;
  return pane as PaneInfo;
}

/** A pane is "active" only when herdr reports it as focused. */
export function paneIsActive(pane: PaneInfo | null): boolean {
  return !!pane?.focused;
}

export type ExecFn = (
  command: string,
  args: string[],
  options?: ExecOptions,
) => Promise<ExecResult>;

function binaryFor(
  pi: ExtensionAPI | undefined,
  env: NodeJS.ProcessEnv,
): string {
  if (pi && typeof pi.exec === "function") {
    // The caller controls the binary; default resolution still happens here.
  }
  return resolveHerdrBinary(env);
}

/**
 * Run a herdr subcommand and parse its JSON response.
 *
 * Uses `pi.exec` when available so output is captured + cancellable; falls back
 * to throwing if exec is missing (caller error).
 */
export async function runHerdrJson(
  pi: ExtensionAPI,
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  execOptions: ExecOptions = {},
): Promise<unknown> {
  void env; // herdr inherits the pi process env (HERDR_* vars) automatically.
  const binary = binaryFor(pi, env);
  const result = await pi.exec(binary, args, execOptions);
  if (result.code !== 0) {
    throw new Error(
      `herdr ${args.join(" ")} exited with code ${result.code}: ${result.stderr.trim() || result.stdout.trim()}`,
    );
  }
  return parseHerdrResponse(result.stdout);
}

/**
 * Fetch our own pane info. Uses an explicit pane id so the result reflects
 * *this* pane regardless of which pane herdr considers focused server-wide.
 */
export async function getOurPane(
  pi: ExtensionAPI,
  paneId: PaneId,
  env: NodeJS.ProcessEnv = process.env,
): Promise<PaneInfo | null> {
  const envelope = await runHerdrJson(
    pi,
    ["pane", "get", paneId, "--json"],
    env,
  );
  return parsePaneInfo(envelope);
}

/** Returns true when our pane is herdr's currently focused pane. */
export async function isActivePane(
  pi: ExtensionAPI,
  paneId: PaneId,
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const pane = await getOurPane(pi, paneId, env);
  return paneIsActive(pane);
}

/**
 * Rename a herdr tab. herdr normalizes/caps the label at 80 chars; we clip
 * beforehand to keep the CLI call tidy.
 */
export async function renameTab(
  pi: ExtensionAPI,
  tabId: TabId,
  label: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const clipped = label.trim().slice(0, 80);
  if (!clipped) return;
  await runHerdrJson(pi, ["tab", "rename", tabId, clipped], env);
}
