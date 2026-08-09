import { writeFileSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Container } from "@earendil-works/pi-tui";

interface ComponentStats {
  calls: number;
  totalMs: number;
  maxMs: number;
}

interface FrameSample {
  ms: number;
  lines: number;
}

const MAX_FRAME_SAMPLES = 20000;

let patched = false;
let originalRender: Container["render"] | undefined;
let renderDepth = 0;

let frames = 0;
let frameTotalMs = 0;
let frameMaxMs = 0;
let frameSamples: FrameSample[] = [];
let componentStats = new Map<string, ComponentStats>();

function resetStats(): void {
  frames = 0;
  frameTotalMs = 0;
  frameMaxMs = 0;
  frameSamples = [];
  componentStats = new Map();
}

function recordComponent(name: string, ms: number): void {
  const existing = componentStats.get(name);
  if (existing) {
    existing.calls++;
    existing.totalMs += ms;
    if (ms > existing.maxMs) existing.maxMs = ms;
  } else {
    componentStats.set(name, { calls: 1, totalMs: ms, maxMs: ms });
  }
}

function instrumentedRender(this: Container, width: number): string[] {
  const isOutermost = renderDepth === 0;
  renderDepth++;
  const t0 = performance.now();
  try {
    const lines: string[] = [];
    for (const child of this.children) {
      const childStart = performance.now();
      const childLines = child.render(width);
      recordComponent(child.constructor?.name ?? "<anonymous>", performance.now() - childStart);
      for (const line of childLines) {
        lines.push(line);
      }
    }
    if (isOutermost) {
      const ms = performance.now() - t0;
      frames++;
      frameTotalMs += ms;
      if (ms > frameMaxMs) frameMaxMs = ms;
      if (frameSamples.length < MAX_FRAME_SAMPLES) {
        frameSamples.push({ ms, lines: lines.length });
      }
    }
    return lines;
  } finally {
    renderDepth--;
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index] ?? 0;
}

function buildReport(): string {
  const sortedMs = frameSamples.map((s) => s.ms).sort((a, b) => a - b);
  const sortedLines = frameSamples.map((s) => s.lines).sort((a, b) => a - b);
  const avgMs = frames > 0 ? frameTotalMs / frames : 0;
  const out: string[] = [];
  out.push(`render-probe report (pid ${process.pid})`);
  out.push(`frames (outermost Container.render): ${frames}`);
  out.push(
    `frame ms: avg ${avgMs.toFixed(2)}  p50 ${percentile(sortedMs, 50).toFixed(2)}  p95 ${percentile(sortedMs, 95).toFixed(2)}  max ${frameMaxMs.toFixed(2)}`,
  );
  out.push(
    `frame lines: p50 ${percentile(sortedLines, 50)}  p95 ${percentile(sortedLines, 95)}  max ${sortedLines[sortedLines.length - 1] ?? 0}`,
  );
  out.push("");
  out.push("per-component (child render calls, time includes nested descendants):");
  out.push(`${"totalMs".padStart(10)} ${"maxMs".padStart(10)} ${"calls".padStart(8)}  name`);
  const rows = [...componentStats.entries()].sort((a, b) => b[1].totalMs - a[1].totalMs);
  for (const [name, s] of rows.slice(0, 25)) {
    out.push(
      `${s.totalMs.toFixed(1).padStart(10)} ${s.maxMs.toFixed(1).padStart(10)} ${String(s.calls).padStart(8)}  ${name}`,
    );
  }
  return out.join("\n");
}

function report(ctx: ExtensionContext): void {
  const text = buildReport();
  const path = `/tmp/render-probe-${process.pid}.log`;
  writeFileSync(path, text);
  const avgMs = frames > 0 ? frameTotalMs / frames : 0;
  ctx.ui.notify(
    `render-probe: ${frames} frames, avg ${avgMs.toFixed(1)}ms, max ${frameMaxMs.toFixed(1)}ms. Full report: ${path}`,
    "info",
  );
}

function installPatch(): void {
  if (patched) return;
  originalRender = Container.prototype.render;
  Container.prototype.render = instrumentedRender;
  patched = true;
}

function removePatch(): void {
  if (!patched || !originalRender) return;
  Container.prototype.render = originalRender;
  originalRender = undefined;
  patched = false;
}

export default function renderProbe(pi: ExtensionAPI): void {
  pi.registerCommand("render-probe", {
    description:
      "Diagnostic: instrument Container.render to measure per-frame render cost with per-component breakdown. Usage: /render-probe start | stop | report",
    async handler(args, ctx) {
      const sub = args.trim();
      if (sub === "start") {
        resetStats();
        installPatch();
        ctx.ui.notify("render-probe: sampling started. Type around, then /render-probe stop.", "info");
        return;
      }
      if (sub === "report") {
        if (!patched) {
          ctx.ui.notify("render-probe: not sampling. Run /render-probe start first.", "warning");
          return;
        }
        report(ctx);
        return;
      }
      if (sub === "stop") {
        if (!patched) {
          ctx.ui.notify("render-probe: not sampling.", "warning");
          return;
        }
        removePatch();
        report(ctx);
        return;
      }
      ctx.ui.notify("Usage: /render-probe start | stop | report", "info");
    },
  });

  pi.on("session_shutdown", () => {
    removePatch();
  });
}
