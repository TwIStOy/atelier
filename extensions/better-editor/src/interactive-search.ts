import { spawn } from "node:child_process";
import {
  DynamicBorder,
  type ExtensionContext,
  type KeybindingsManager,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import {
  Container,
  fuzzyFilter,
  Input,
  Spacer,
  Text,
  type TUI,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";

const SELECT_LIMIT = 60;
const SKIM_DEBOUNCE_MS = 70;
const SKIM_TIMEOUT_MS = 15_000;

const NF_ARROW_RIGHT = "\uf061";

type SkimResult = { ok: true; lines: string[] } | { ok: false; reason: string };

function skimExitResult(code: number | null, stdout: string): SkimResult {
  if (code !== 0 && code !== 1) {
    return { ok: false, reason: `exit ${code ?? "?"}` };
  }
  return { ok: true, lines: stdout.split("\n").filter(Boolean) };
}

function runSkimFilter(lines: string[], filter: string, cwd: string): Promise<SkimResult> {
  return new Promise((resolve) => {
    if (lines.length === 0) {
      resolve({ ok: true, lines: [] });
      return;
    }
    const child = spawn("sk", ["--filter", filter], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let settled = false;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      finish({ ok: false, reason: "timeout" });
    }, SKIM_TIMEOUT_MS);

    const finish = (r: SkimResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };

    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (c: string) => {
      stdout += c;
    });
    child.once("error", () => finish({ ok: false, reason: "sk not found" }));
    child.once("close", (code) => {
      if (settled) return;
      clearTimeout(timer);
      finish(skimExitResult(code, stdout));
    });
    child.stdin.end(`${lines.join("\n")}\n`, "utf8");
  });
}

export class InteractiveHistorySearch extends Container {
  private readonly queryInput: Input;
  private readonly listText: Text;
  private readonly statusText: Text;
  private readonly keybindings: KeybindingsManager;
  private readonly tui: TUI;
  private readonly theme: Theme;
  private readonly ctx: ExtensionContext;
  private readonly history: string[];
  private readonly done: (result: string | undefined) => void;
  private matches: string[] = [];
  private selectedIndex = 0;
  private skimCache: { query: string; lines: string[] } | undefined;
  private skimSeq = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private _focused = false;

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.queryInput.focused = value;
  }

  constructor(opts: {
    tui: TUI;
    theme: Theme;
    keybindings: KeybindingsManager;
    ctx: ExtensionContext;
    history: string[];
    done: (result: string | undefined) => void;
  }) {
    super();
    this.tui = opts.tui;
    this.theme = opts.theme;
    this.keybindings = opts.keybindings;
    this.ctx = opts.ctx;
    this.history = opts.history;
    this.done = opts.done;
    this.addChild(new DynamicBorder());
    this.addChild(new Spacer(1));
    this.addChild(new Text(this.theme.fg("accent", "Search prompt history (Ctrl+R)"), 1, 0));
    this.addChild(new Spacer(1));
    this.addChild(new Text(this.theme.fg("muted", "Query"), 1, 0));
    this.queryInput = new Input();
    this.queryInput.onSubmit = () => this.commit();
    this.addChild(this.queryInput);
    this.addChild(new Spacer(1));
    this.statusText = new Text("", 1, 0);
    this.addChild(this.statusText);
    this.listText = new Text("", 0, 0);
    this.addChild(this.listText);
    this.addChild(new Spacer(1));
    this.addChild(
      new Text(
        this.theme.fg("muted", "↑↓ choose · Enter confirm · Esc cancel · type to filter (skim ranks matches)"),
        1,
        0,
      ),
    );
    this.addChild(new Spacer(1));
    this.addChild(new DynamicBorder());
    this.rebuildMatches();
    this.updateListText();
    this.scheduleSkim(this.queryInput.getValue());
  }

  dispose(): void {
    if (this.debounceTimer !== undefined) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.skimSeq++;
  }

  handleInput(data: string): void {
    if (this.keybindings.matches(data, "tui.select.cancel")) {
      this.done(undefined);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.up")) {
      this.moveSelection(-1);
      return;
    }
    if (this.keybindings.matches(data, "tui.select.down")) {
      this.moveSelection(1);
      return;
    }
    this.queryInput.handleInput(data);
    this.rebuildMatches();
    this.updateListText();
    this.scheduleSkim(this.queryInput.getValue());
    this.tui.requestRender();
  }

  private moveSelection(delta: number): void {
    if (this.matches.length === 0) return;
    this.selectedIndex = (this.selectedIndex + delta + this.matches.length) % this.matches.length;
    this.updateListText();
    this.tui.requestRender();
  }

  private commit(): void {
    if (this.matches.length === 0) {
      this.done(undefined);
      return;
    }
    const idx = Math.min(this.selectedIndex, this.matches.length - 1);
    this.done(this.matches[idx]);
  }

  private scheduleSkim(rawQuery: string): void {
    if (this.debounceTimer !== undefined) clearTimeout(this.debounceTimer);
    const q = rawQuery.trim();
    if (!q) {
      this.debounceTimer = undefined;
      this.skimCache = undefined;
      this.statusText.setText(this.theme.fg("muted", "skim: —"));
      this.rebuildMatches();
      this.updateListText();
      this.tui.requestRender();
      return;
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = undefined;
      void this.runSkim(q);
    }, SKIM_DEBOUNCE_MS);
  }

  private skimResultStatus(res: SkimResult, q: string): string {
    if (!res.ok) {
      return `skim: ${res.reason} — using built-in fuzzy until \`sk\` works`;
    }
    const n = res.lines.length;
    if (n === 0) {
      return `skim: no matches for “${q}”`;
    }
    return `skim: ${n} match${n === 1 ? "" : "es"} for “${q}”`;
  }

  private applySkimResult(res: SkimResult, q: string): void {
    if (res.ok) {
      this.skimCache = { query: q, lines: res.lines };
    } else {
      this.skimCache = undefined;
    }
    this.statusText.setText(this.theme.fg("muted", this.skimResultStatus(res, q)));
  }

  private applySkimError(): void {
    this.skimCache = undefined;
    this.statusText.setText(this.theme.fg("muted", "skim: error — using built-in fuzzy"));
  }

  private async runSkim(q: string): Promise<void> {
    const seq = ++this.skimSeq;
    try {
      const res = await runSkimFilter(this.history, q, this.ctx.cwd);
      if (seq !== this.skimSeq) return;
      this.applySkimResult(res, q);
    } catch {
      if (seq !== this.skimSeq) return;
      this.applySkimError();
    }
    this.rebuildMatches();
    this.updateListText();
    this.tui.requestRender();
  }

  private candidateList(q: string): string[] {
    if (this.skimCache?.query === q) {
      return this.skimCache.lines;
    }
    return fuzzyFilter(this.history, q, (x) => x);
  }

  private clampSelection(): void {
    if (this.selectedIndex >= this.matches.length) {
      this.selectedIndex = Math.max(0, this.matches.length - 1);
    }
  }

  private rebuildMatches(): void {
    const q = this.queryInput.getValue().trim();
    if (!q) {
      this.matches = this.history.slice(0, SELECT_LIMIT);
      this.selectedIndex = Math.min(this.selectedIndex, Math.max(0, this.matches.length - 1));
      return;
    }
    let list = this.candidateList(q);
    if (list.length > SELECT_LIMIT * 2) list = list.slice(0, SELECT_LIMIT * 2);
    this.matches = list.slice(0, SELECT_LIMIT);
    this.clampSelection();
  }

  private updateListText(): void {
    const width = Math.max(20, this.tui.terminal.columns);
    const rows = Math.max(3, Math.min(16, this.tui.terminal.rows - 10));
    const lines: string[] = [];
    for (let i = 0; i < Math.min(rows, this.matches.length); i++) {
      const line = this.matches[i]!;
      const prefix =
        i === this.selectedIndex ? this.theme.fg("accent", `${NF_ARROW_RIGHT} `) : this.theme.fg("muted", "  ");
      const inner = Math.max(4, width - visibleWidth(prefix) - 1);
      const body = truncateToWidth(line, inner, "…");
      lines.push(prefix + body);
    }
    if (this.matches.length === 0) {
      lines.push(this.theme.fg("muted", "(no matches)"));
    }
    this.listText.setText(lines.join("\n"));
  }
}
