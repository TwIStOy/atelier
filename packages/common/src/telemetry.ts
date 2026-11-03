import { formatElapsedSeconds, formatTokens } from "./format.ts";

/**
 * Turn-level generation telemetry for the agent loop.
 *
 * Measures tokens-per-second (TPS), time-to-first-token (TTFT), and detected
 * streaming stalls across an agent run, then aggregates per-turn results into a
 * single summary produced once the run has settled.
 *
 * Framework-agnostic: callers feed in a narrow stream of observations derived
 * from the host agent's lifecycle events. The measurement algorithm is adapted
 * from the open-source `pi-open-tui` telemetry tracker (MIT), which in turn
 * builds on `pi-tps`.
 *
 * ## Measurement model
 *
 * A *turn* is one assistant generation plus its tool results. A *delta* is a
 * streamed text/thinking/tool-call fragment. TPS is derived from the wall-clock
 * span between the first and last delta of a turn, minus time spent in stalls.
 *
 * Only turns that produced measurable streaming contribute to the aggregated
 * TPS, so an unmeasurable pure-tool turn never drags down the rate of a
 * measurable final response.
 */

export interface TelemetryModelRef {
  provider: string;
  model: string;
}

export interface TelemetryUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  /** Total list-price cost for the message (`usage.cost.total`). */
  cost: number;
}

export type TelemetryDeltaType = "text_delta" | "thinking_delta" | "toolcall_delta";

/** Aggregated telemetry for a complete agent run. */
export interface TurnTelemetry {
  /** Number of turns that produced assistant output. */
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
  /** Wall-clock duration of the whole agent run (ms). */
  durationMs: number;
  /** Time from turn start to first streamed token of the run (ms). */
  ttftMs: number | null;
  /** Number of distinct stall runs detected. */
  stalls: number;
  /** Total time spent stalled (ms). */
  stallMs: number;
  /** Weighted tokens-per-second across measurable turns, or null when unmeasurable. */
  tps: number | null;
}

export interface TelemetryFormatOptions {
  tps?: boolean;
  ttft?: boolean;
  duration?: boolean;
  tokens?: boolean;
  stalls?: boolean;
  cost?: boolean;
}

const MIN_STREAM_MS = 1;
const MIN_STREAM_UPDATES = 5;
const MIN_INTER_CHUNK_MS = 1;
const MIN_GENERATION_MS = 200;
const STALL_THRESHOLD_MS = 500;
/** Reject speeds above this as measurement artifacts. */
const MAX_PLAUSIBLE_TPS = 500;
/** When stalls dominate a turn this much, halve their subtraction in the fallback path. */
const STALL_DOMINANCE_RATIO = 0.5;

interface MessageTiming {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

interface TurnTiming {
  startMs: number;
  modelKey: string | null;
  isToolCall: boolean;
  firstTokenMs: number | null;
  lastUpdateMs: number | null;
  inStall: boolean;
  stallCount: number;
  stallMs: number;
  streamMs: number;
  streamIntervals: number;
  streamUpdateCount: number;
  generationMs: number;
  messages: MessageTiming[];
}

interface FinalizedTurn {
  modelKey: string | null;
  isToolCall: boolean;
  firstTokenMs: number | null;
  startMs: number;
  generationMs: number;
  stallCount: number;
  stallMs: number;
  streamMs: number;
  streamIntervals: number;
  streamUpdateCount: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
  tps: number | null;
  measurementMs: number | null;
  primary: boolean;
}

type Clock = () => number;

function modelKeyOf(ref: TelemetryModelRef): string {
  return `${ref.provider}:${ref.model}`;
}

/**
 * Stateful turn-telemetry tracker. Create one per session, feed it lifecycle
 * observations, and call {@link TurnTelemetryTracker.endAgent} when the run
 * settles to retrieve the aggregated summary.
 */
export class TurnTelemetryTracker {
  private readonly now: Clock;
  private agentStartMs: number | null = null;
  private readonly turns: FinalizedTurn[] = [];
  private current: TurnTiming | null = null;

  /** Best observed TPS per model key, learned from primary measurements. */
  private readonly tpsCaps = new Map<string, number>();

  constructor(now?: Clock) {
    this.now = now ?? (() => performance.now());
  }

  onAgentStart(): void {
    this.agentStartMs = this.now();
    this.turns.length = 0;
    this.current = null;
  }

  onTurnStart(): void {
    this.current = {
      startMs: this.now(),
      modelKey: null,
      isToolCall: false,
      firstTokenMs: null,
      lastUpdateMs: null,
      inStall: false,
      stallCount: 0,
      stallMs: 0,
      streamMs: 0,
      streamIntervals: 0,
      streamUpdateCount: 0,
      generationMs: 0,
      messages: [],
    };
  }

  onMessageStart(model: TelemetryModelRef | null): void {
    const turn = this.current;
    if (!turn || !model) return;
    if (turn.modelKey === null) turn.modelKey = modelKeyOf(model);
  }

  onMessageDelta(type: TelemetryDeltaType, delta: string): void {
    void type;
    const turn = this.current;
    if (!turn) return;
    if (delta.length === 0) return;

    const now = this.now();
    if (turn.firstTokenMs === null) turn.firstTokenMs = now;

    if (turn.lastUpdateMs !== null) {
      const gap = now - turn.lastUpdateMs;
      if (gap >= STALL_THRESHOLD_MS) {
        if (!turn.inStall) turn.stallCount += 1;
        turn.inStall = true;
        turn.stallMs += gap;
      } else {
        turn.inStall = false;
      }
      turn.streamMs += gap;
      turn.streamIntervals += 1;
    }
    turn.lastUpdateMs = now;
    turn.streamUpdateCount += 1;
  }

  onMessageEnd(usage: TelemetryUsage | null): void {
    const turn = this.current;
    if (!turn || !usage) return;
    turn.messages.push({
      input: usage.input,
      output: usage.output,
      cacheRead: usage.cacheRead,
      cacheWrite: usage.cacheWrite,
      cost: usage.cost,
    });
  }

  onToolExecutionStart(): void {
    const turn = this.current;
    if (!turn) return;
    turn.isToolCall = true;
  }

  onTurnEnd(): void {
    const turn = this.current;
    if (!turn) return;
    this.current = null;
    turn.generationMs = this.now() - turn.startMs;
    const finalized = finalizeTurn(turn, this.tpsCaps);
    if (finalized) this.turns.push(finalized);
  }

  endAgent(): TurnTelemetry | undefined {
    const start = this.agentStartMs;
    if (start === null) return undefined;
    const durationMs = this.now() - start;
    this.agentStartMs = null;

    if (this.turns.length === 0) {
      return {
        turns: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0,
        durationMs,
        ttftMs: null,
        stalls: 0,
        stallMs: 0,
        tps: null,
      };
    }

    let input = 0;
    let output = 0;
    let cacheRead = 0;
    let cacheWrite = 0;
    let cost = 0;
    let stalls = 0;
    let stallMs = 0;
    let measuredOutput = 0;
    let measuredMs = 0;
    let ttftMs: number | null = null;

    for (const turn of this.turns) {
      input += turn.input;
      output += turn.output;
      cacheRead += turn.cacheRead;
      cacheWrite += turn.cacheWrite;
      cost += turn.cost;
      stalls += turn.stallCount;
      stallMs += turn.stallMs;
      if (turn.measurementMs !== null) {
        measuredOutput += turn.output;
        measuredMs += turn.measurementMs;
      }
      if (ttftMs === null && turn.firstTokenMs !== null) {
        ttftMs = turn.firstTokenMs - turn.startMs;
      }
    }

    const tps = measuredMs > 0 ? round1(measuredOutput / (measuredMs / 1000)) : null;

    return {
      turns: this.turns.length,
      inputTokens: input,
      outputTokens: output,
      cacheReadTokens: cacheRead,
      cacheWriteTokens: cacheWrite,
      cost,
      durationMs,
      ttftMs,
      stalls,
      stallMs,
      tps,
    };
  }
}

function finalizeTurn(turn: TurnTiming, caps: Map<string, number>): FinalizedTurn | null {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;
  for (const m of turn.messages) {
    input += m.input;
    output += m.output;
    cacheRead += m.cacheRead;
    cacheWrite += m.cacheWrite;
    cost += m.cost;
  }

  if (output <= 0 || turn.modelKey === null) return null;

  const hasStream = turn.streamUpdateCount > 0;
  const streamMs = hasStream ? turn.streamMs : null;
  const averageGapMs = turn.streamIntervals > 0 ? turn.streamMs / turn.streamIntervals : 0;

  let tps: number | null = null;
  let measurementMs: number | null = null;
  let primary = false;

  if (
    streamMs !== null &&
    streamMs >= MIN_STREAM_MS &&
    turn.streamUpdateCount >= MIN_STREAM_UPDATES &&
    averageGapMs >= MIN_INTER_CHUNK_MS &&
    turn.stallMs < streamMs &&
    streamMs - turn.stallMs >= MIN_GENERATION_MS &&
    turn.stallMs < streamMs - turn.stallMs
  ) {
    measurementMs = streamMs - turn.stallMs;
    tps = round1(output / (measurementMs / 1000));
    primary = true;
  } else if (turn.streamUpdateCount >= 2 && turn.generationMs >= MIN_GENERATION_MS) {
    let activeMs = turn.generationMs - turn.stallMs;
    if (activeMs < MIN_GENERATION_MS || turn.stallMs > turn.generationMs * STALL_DOMINANCE_RATIO) {
      activeMs = turn.generationMs - turn.stallMs / 2;
    }
    measurementMs = Math.max(activeMs, MIN_GENERATION_MS);
    tps = round1(output / (measurementMs / 1000));
  }

  if (tps !== null && tps > MAX_PLAUSIBLE_TPS) {
    tps = null;
    measurementMs = null;
    primary = false;
  }

  if (turn.isToolCall && tps !== null) {
    const cap = caps.get(turn.modelKey ?? "");
    if (cap !== undefined && tps > cap) {
      tps = cap;
      measurementMs = Math.max(measurementMs ?? 0, (output * 1000) / cap);
    } else if (cap === undefined) {
      tps = null;
      measurementMs = null;
    }
  }

  if (primary && !turn.isToolCall && tps !== null && turn.modelKey !== null) {
    const prev = caps.get(turn.modelKey);
    if (prev === undefined || tps > prev) caps.set(turn.modelKey, tps);
  }

  return {
    modelKey: turn.modelKey,
    isToolCall: turn.isToolCall,
    firstTokenMs: turn.firstTokenMs,
    startMs: turn.startMs,
    generationMs: turn.generationMs,
    stallCount: turn.stallCount,
    stallMs: turn.stallMs,
    streamMs: turn.streamMs,
    streamIntervals: turn.streamIntervals,
    streamUpdateCount: turn.streamUpdateCount,
    input,
    output,
    cacheRead,
    cacheWrite,
    cost,
    tps,
    measurementMs,
    primary,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Render a telemetry summary as a single notification line. Each segment is
 * independently gated by {@link TelemetryFormatOptions}; omitted options
 * default to shown.
 *
 * Example: `> TPS 42.5 tok/s · TTFT 1.2s · +29.7s · ↑567 ↓1.2k · stall 1x/4.3s · $3.60/M`
 */
export function formatTurnTelemetry(t: TurnTelemetry, options?: TelemetryFormatOptions): string {
  const opts = {
    tps: true,
    ttft: true,
    duration: true,
    tokens: true,
    stalls: true,
    cost: true,
    ...options,
  };

  const segments: string[] = [];

  if (opts.tps && t.tps !== null) {
    segments.push(`TPS ${t.tps} tok/s`);
  }
  if (opts.ttft && t.ttftMs !== null) {
    segments.push(`TTFT ${formatMs(t.ttftMs)}`);
  }
  if (opts.duration) {
    segments.push(`+${formatMs(t.durationMs)}`);
  }
  if (opts.tokens) {
    segments.push(`↑${formatTokens(t.inputTokens)} ↓${formatTokens(t.outputTokens)}`);
  }
  if (opts.stalls && t.stalls > 0) {
    segments.push(`stall ${t.stalls}x/${formatMs(t.stallMs)}`);
  }
  if (opts.cost && t.cost > 0 && t.outputTokens > 0) {
    const perM = (t.cost * 1_000_000) / t.outputTokens;
    segments.push(`$${perM.toFixed(2)}/M`);
  }

  if (segments.length === 0) return "";
  return `> ${segments.join(" · ")}`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return formatElapsedSeconds(seconds);
}
