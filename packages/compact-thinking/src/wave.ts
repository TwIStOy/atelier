import type { Theme } from "@earendil-works/pi-coding-agent";

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

const WAVE_PERIOD_MS = 1400;
// Spatial wavelength in rows; adjacent-row delta = amplitude·sin(π/16) ≈ 0.195 (grok-build's value).
const WAVE_ROWS = 32;
// Rows at which the wave reaches full amplitude; shorter blocks stay subtle.
const FULL_AMPLITUDE_ROWS = 13;
const BAR = "┃";

const CUBE_VALUES = [0, 95, 135, 175, 215, 255];
const BASIC_PALETTE: Rgb[] = [
  { r: 0, g: 0, b: 0 },
  { r: 128, g: 0, b: 0 },
  { r: 0, g: 128, b: 0 },
  { r: 128, g: 128, b: 0 },
  { r: 0, g: 0, b: 128 },
  { r: 128, g: 0, b: 128 },
  { r: 0, g: 128, b: 128 },
  { r: 192, g: 192, b: 192 },
  { r: 128, g: 128, b: 128 },
  { r: 255, g: 0, b: 0 },
  { r: 0, g: 255, b: 0 },
  { r: 255, g: 255, b: 0 },
  { r: 0, g: 0, b: 255 },
  { r: 255, g: 0, b: 255 },
  { r: 0, g: 255, b: 255 },
  { r: 255, g: 255, b: 255 },
];

function indexToRgb(index: number): Rgb | undefined {
  if (index < 0 || index > 255) return undefined;
  if (index < 16) return BASIC_PALETTE[index];
  if (index < 232) {
    const n = index - 16;
    return { r: CUBE_VALUES[Math.floor(n / 36)], g: CUBE_VALUES[Math.floor((n % 36) / 6)], b: CUBE_VALUES[n % 6] };
  }
  const v = 8 + (index - 232) * 10;
  return { r: v, g: v, b: v };
}

export function parseAnsiRgb(ansi: string): Rgb | undefined {
  const truecolor = /\x1b\[(?:38|48);2;(\d+);(\d+);(\d+)m/.exec(ansi);
  if (truecolor) {
    return { r: Number(truecolor[1]), g: Number(truecolor[2]), b: Number(truecolor[3]) };
  }
  const indexed = /\x1b\[(?:38|48);5;(\d+)m/.exec(ansi);
  if (indexed) return indexToRgb(Number(indexed[1]));
  return undefined;
}

function colorDistance(a: Rgb, b: Rgb): number {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
}

function closestIndex(values: number[], value: number): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < values.length; i++) {
    const dist = Math.abs(values[i] - value);
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
    }
  }
  return best;
}

function rgbToIndex({ r, g, b }: Rgb): number {
  const ri = closestIndex(CUBE_VALUES, r);
  const gi = closestIndex(CUBE_VALUES, g);
  const bi = closestIndex(CUBE_VALUES, b);
  const cube: Rgb = { r: CUBE_VALUES[ri], g: CUBE_VALUES[gi], b: CUBE_VALUES[bi] };
  const cubeIndex = 16 + 36 * ri + 6 * gi + bi;

  const grayValue = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
  const gi2 = closestIndex(
    Array.from({ length: 24 }, (_, i) => 8 + i * 10),
    grayValue,
  );
  const gray = 8 + gi2 * 10;
  const grayIndex = 232 + gi2;

  const spread = Math.max(r, g, b) - Math.min(r, g, b);
  if (spread < 10 && colorDistance({ r: gray, g: gray, b: gray }, { r, g, b }) < colorDistance(cube, { r, g, b })) {
    return grayIndex;
  }
  return cubeIndex;
}

function lerpRgb(from: Rgb, to: Rgb, t: number): Rgb {
  return {
    r: Math.round(from.r + (to.r - from.r) * t),
    g: Math.round(from.g + (to.g - from.g) * t),
    b: Math.round(from.b + (to.b - from.b) * t),
  };
}

function fgSequence(rgb: Rgb, mode: "truecolor" | "256color"): string {
  if (mode === "truecolor") return `\x1b[38;2;${rgb.r};${rgb.g};${rgb.b}m`;
  return `\x1b[38;5;${rgbToIndex(rgb)}m`;
}

export function waveBrightness(frame: number, row: number, rows: number, intervalMs: number): number {
  const speed = (2 * Math.PI * intervalMs) / WAVE_PERIOD_MS;
  const amplitude = Math.min(1, rows / FULL_AMPLITUDE_ROWS);
  const phase = (row / WAVE_ROWS) * 2 * Math.PI;
  const value = Math.sin(frame * speed + phase);
  return amplitude * value * value;
}

export function createWaveBar(
  theme: Theme,
  frame: () => number,
  intervalMs: number,
): ((row: number, rows: number) => string) | undefined {
  if (typeof theme.getFgAnsi !== "function" || typeof theme.getColorMode !== "function") {
    return undefined;
  }
  const trough = parseAnsiRgb(theme.getFgAnsi("borderMuted"));
  // Themes may leave text empty (terminal default fg, e.g. catppuccin-mocha);
  // fall back through roles that always carry a concrete color.
  const peak =
    parseAnsiRgb(theme.getFgAnsi("text")) ??
    parseAnsiRgb(theme.getFgAnsi("muted")) ??
    parseAnsiRgb(theme.getFgAnsi("thinkingText"));
  if (!peak || !trough) return undefined;
  const mode = theme.getColorMode();
  return (row, rows) =>
    `${fgSequence(lerpRgb(trough, peak, waveBrightness(frame(), row, Math.max(1, rows), intervalMs)), mode)}${BAR}\x1b[39m`;
}
