import { describe, expect, test } from "vitest";
import { formatTurnTelemetry, TurnTelemetryTracker } from "../src/telemetry.ts";

const USAGE = (output: number, cost = 0) => ({
  input: 100,
  output,
  cacheRead: 0,
  cacheWrite: 0,
  cost,
});

const MODEL = { provider: "p", model: "m" };

function trackerWith(ticks: number[]) {
  let i = 0;
  const now = () => ticks[Math.min(i++, ticks.length - 1)];
  return new TurnTelemetryTracker(now);
}

function streamDeltas(t: TurnTelemetryTracker, n: number, text = "x") {
  for (let k = 0; k < n; k++) t.onMessageDelta("text_delta", text);
}

describe("TurnTelemetryTracker", () => {
  test("clean streaming turn yields a primary TPS measurement", () => {
    // 6 deltas over 500ms, 120 output tokens -> 240 tok/s (plausible).
    const t = trackerWith([0, 1000, 1100, 1200, 1300, 1400, 1500, 1600]);
    t.onAgentStart();
    t.onTurnStart();
    t.onMessageStart(MODEL);
    streamDeltas(t, 6);
    t.onMessageEnd(USAGE(120));
    t.onTurnEnd();
    const result = t.endAgent();

    expect(result).not.toBeUndefined();
    expect(result?.tps).toBe(240);
    expect(result?.outputTokens).toBe(120);
    expect(result?.stalls).toBe(0);
  });

  test("skips turns with no output tokens", () => {
    const t = trackerWith([0, 100, 200, 300]);
    t.onAgentStart();
    t.onTurnStart();
    t.onMessageStart(MODEL);
    streamDeltas(t, 3);
    t.onMessageEnd(USAGE(0));
    t.onTurnEnd();
    const result = t.endAgent();
    expect(result?.turns).toBe(0);
    expect(result?.tps).toBeNull();
  });

  test("empty deltas do not produce a streaming measurement", () => {
    const t = trackerWith([0, 100, 200, 300, 400]);
    t.onAgentStart();
    t.onTurnStart();
    t.onMessageStart(MODEL);
    for (let k = 0; k < 4; k++) t.onMessageDelta("text_delta", "");
    t.onMessageEnd(USAGE(120));
    t.onTurnEnd();
    const result = t.endAgent();
    expect(result?.turns).toBe(1);
    expect(result?.tps).toBeNull();
  });

  test("groups consecutive stall gaps into a single stall count", () => {
    // 7 deltas: three normal, then a 600ms gap (stall start), then a 1200ms gap
    // (still stalled, same run), then recovery.
    const t = trackerWith([0, 1000, 1050, 1100, 1150, 1750, 2950, 3000, 3050]);
    t.onAgentStart();
    t.onTurnStart();
    t.onMessageStart(MODEL);
    streamDeltas(t, 7);
    t.onMessageEnd(USAGE(120));
    t.onTurnEnd();
    const result = t.endAgent();
    expect(result?.stalls).toBe(1);
    expect(result?.stallMs).toBeGreaterThanOrEqual(1800);
  });

  test("tool-call turn is clamped to the model's best observed TPS", () => {
    // One tracker instance so the learned cap survives across agent runs.
    const ticks = [
      // Run 1: measurable non-tool turn, 120 tokens over 500ms -> 240 tok/s.
      0, 1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700, 1700,
      // Run 2: tool-call turn, 120 tokens over 300ms -> 400 tok/s, clamped to 240.
      2000, 2100, 2160, 2220, 2280, 2340, 2400, 2460, 2500, 2500,
    ];
    const t = trackerWith(ticks);

    t.onAgentStart();
    t.onTurnStart();
    t.onMessageStart(MODEL);
    streamDeltas(t, 6);
    t.onMessageEnd(USAGE(120));
    t.onTurnEnd();
    const first = t.endAgent();
    expect(first?.tps).toBe(240);
    const cap = first!.tps!;

    t.onAgentStart();
    t.onTurnStart();
    t.onMessageStart(MODEL);
    streamDeltas(t, 6);
    t.onMessageEnd(USAGE(120));
    t.onToolExecutionStart();
    t.onTurnEnd();
    const second = t.endAgent();

    expect(second?.tps).not.toBeNull();
    expect(second?.tps).toBeLessThanOrEqual(cap);
  });

  test("unmeasurable tool turn does not hide a measurable response turn", () => {
    const t = trackerWith([0, 100, 150, 180, 200, 400, 1100, 1200, 1300, 1400, 1500, 1600, 1700]);
    t.onAgentStart();

    // Turn A: short tool turn (2 deltas, <200ms generation) -> unmeasurable.
    t.onTurnStart();
    t.onMessageStart(MODEL);
    streamDeltas(t, 2);
    t.onMessageEnd(USAGE(50));
    t.onToolExecutionStart();
    t.onTurnEnd();

    // Turn B: measurable response turn.
    t.onTurnStart();
    t.onMessageStart(MODEL);
    streamDeltas(t, 6); // 1100..1600 -> 500ms span -> 240 tok/s
    t.onMessageEnd(USAGE(120));
    t.onTurnEnd();

    const result = t.endAgent();
    expect(result?.turns).toBe(2);
    expect(result?.tps).toBe(240);
    expect(result?.outputTokens).toBe(170);
  });

  test("ttft is measured from turn start to first delta", () => {
    const t = trackerWith([0, 1000, 1250, 1350, 1450, 1550, 1650, 1750, 1850]);
    t.onAgentStart();
    t.onTurnStart();
    t.onMessageStart(MODEL);
    streamDeltas(t, 6);
    t.onMessageEnd(USAGE(120));
    t.onTurnEnd();
    const result = t.endAgent();
    expect(result?.ttftMs).toBe(250);
  });
});

describe("formatTurnTelemetry", () => {
  const base = {
    turns: 1,
    inputTokens: 567,
    outputTokens: 1200,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0.00432,
    durationMs: 29700,
    ttftMs: 1200,
    stalls: 1,
    stallMs: 4300,
    tps: 42.5,
  };

  test("renders all segments by default", () => {
    const out = formatTurnTelemetry(base);
    expect(out.startsWith("> ")).toBe(true);
    expect(out).toContain("TPS 42.5 tok/s");
    expect(out).toContain("TTFT 1.2s");
    expect(out).toContain("+29.7s");
    expect(out).toContain("↑567 ↓1.2k");
    expect(out).toContain("stall 1x/4.3s");
    expect(out).toContain("$3.60/M");
  });

  test("hides segments via options", () => {
    const out = formatTurnTelemetry(base, { tps: false, stalls: false, cost: false });
    expect(out).not.toContain("TPS");
    expect(out).not.toContain("stall");
    expect(out).not.toContain("/M");
    expect(out).toContain("TTFT");
  });

  test("omits stalls when zero and cost when no tokens", () => {
    const out = formatTurnTelemetry({ ...base, stalls: 0, stallMs: 0, outputTokens: 0, cost: 0 });
    expect(out).not.toContain("stall");
    expect(out).not.toContain("/M");
  });

  test("returns empty string when nothing is shown", () => {
    const out = formatTurnTelemetry(base, {
      tps: false,
      ttft: false,
      duration: false,
      tokens: false,
      stalls: false,
      cost: false,
    });
    expect(out).toBe("");
  });
});
