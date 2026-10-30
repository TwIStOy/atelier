export type EscapeOutcome = "abort" | "dismiss" | "arm";

export interface EscapeDecisionInput {
  autocompleteShowing: boolean;
  streaming: boolean;
  armed: boolean;
}

export function decideEscape(input: EscapeDecisionInput): EscapeOutcome {
  if (input.autocompleteShowing) return "dismiss";
  if (!input.streaming) return "abort";
  if (input.armed) return "abort";
  return "arm";
}

export interface DoubleEscapeDeps {
  isStreaming: () => boolean;
  isShowingAutocomplete: () => boolean;
  debounceMs: () => number;
  onChange: () => void;
}

export class DoubleEscapeController {
  private armed = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly deps: DoubleEscapeDeps;

  constructor(deps: DoubleEscapeDeps) {
    this.deps = deps;
  }

  isArmed(): boolean {
    return this.armed;
  }

  handleEscape(): EscapeOutcome {
    const outcome = decideEscape({
      autocompleteShowing: this.deps.isShowingAutocomplete(),
      streaming: this.deps.isStreaming(),
      armed: this.armed,
    });
    if (outcome === "arm") {
      this.arm();
    } else if (outcome === "abort") {
      this.reset();
    }
    return outcome;
  }

  reset(): void {
    this.clearTimer();
    if (this.armed) {
      this.armed = false;
      this.deps.onChange();
    }
  }

  private arm(): void {
    this.clearTimer();
    this.armed = true;
    this.timer = setTimeout(() => {
      this.armed = false;
      this.timer = undefined;
      this.deps.onChange();
    }, this.deps.debounceMs());
    this.deps.onChange();
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
