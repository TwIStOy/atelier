import type { Theme } from "@earendil-works/pi-coding-agent";
import { describe, expect, it } from "vitest";
import { createWaveBar, parseAnsiRgb, waveBrightness } from "../src/wave.ts";

function makeTheme(overrides?: Partial<Theme>): Theme {
  return {
    getFgAnsi: (color: string) => {
      if (color === "borderMuted") return "\x1b[38;2;80;80;80m";
      if (color === "text") return "\x1b[38;2;212;212;212m";
      throw new Error(`unexpected fg color: ${color}`);
    },
    getColorMode: () => "truecolor",
    ...overrides,
  } as unknown as Theme;
}

describe("parseAnsiRgb", () => {
  it("parses truecolor sequences", () => {
    expect(parseAnsiRgb("\x1b[38;2;80;90;100m")).toEqual({ r: 80, g: 90, b: 100 });
  });

  it("parses 256-color cube indexes", () => {
    expect(parseAnsiRgb("\x1b[38;5;21m")).toEqual({ r: 0, g: 0, b: 255 });
  });

  it("parses 256-color grayscale indexes", () => {
    const rgb = parseAnsiRgb("\x1b[38;5;232m");
    expect(rgb).toEqual({ r: 8, g: 8, b: 8 });
  });

  it("returns undefined for non-color sequences", () => {
    expect(parseAnsiRgb("\x1b[39m")).toBeUndefined();
  });
});

describe("waveBrightness", () => {
  it("stays within [0, 1]", () => {
    for (let frame = 0; frame < 50; frame++) {
      for (let row = 0; row < 16; row++) {
        const value = waveBrightness(frame, row, 16, 90);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it("varies across rows for a fixed frame", () => {
    const values = new Set<number>();
    for (let row = 0; row < 8; row++) values.add(waveBrightness(3, row, 8, 90));
    expect(values.size).toBeGreaterThan(1);
  });

  it("advances with the frame for a fixed row", () => {
    const values = new Set<number>();
    for (let frame = 0; frame < 8; frame++) values.add(waveBrightness(frame, 0, 8, 90));
    expect(values.size).toBeGreaterThan(1);
  });

  it("keeps the adjacent-row delta below grok's 19.5%", () => {
    for (const rows of [2, 3, 5, 8, 20, 60]) {
      for (let frame = 0; frame < 12; frame++) {
        for (let row = 0; row < rows - 1; row++) {
          const delta = Math.abs(waveBrightness(frame, row, rows, 45) - waveBrightness(frame, row + 1, rows, 45));
          expect(delta).toBeLessThanOrEqual(Math.sin(Math.PI / 16) + 1e-9);
        }
      }
    }
  });

  it("scales the peak with the widget row count", () => {
    const shortPeak = waveBrightness(0, 2, 4, 45);
    const tallPeak = waveBrightness(0, 8, 20, 45);
    expect(shortPeak).toBeLessThan(tallPeak);
    expect(tallPeak).toBe(1);
  });
});

describe("createWaveBar", () => {
  it("returns undefined when the theme lacks color accessors", () => {
    const theme = { fg: (_c: string, t: string) => t } as unknown as Theme;
    expect(createWaveBar(theme, () => 0, 90)).toBeUndefined();
  });

  it("produces per-row truecolor bars between trough and peak", () => {
    const bar = createWaveBar(makeTheme(), () => 0, 90);
    expect(bar).toBeTypeOf("function");
    const rows = new Set<string>();
    for (let row = 0; row < 8; row++) {
      const rendered = bar?.(row, 8) ?? "";
      expect(rendered).toContain("▌");
      expect(rendered).toMatch(/^\x1b\[38;2;\d+;\d+;\d+m/);
      expect(rendered).toMatch(/\x1b\[39m$/);
      rows.add(rendered);
    }
    expect(rows.size).toBeGreaterThan(1);
  });

  it("renders the exact borderMuted trough at zero brightness", () => {
    expect(createWaveBar(makeTheme(), () => 0, 90)?.(0, 8)).toBe("\x1b[38;2;80;80;80m▌\x1b[39m");
  });

  it("brightens the peak more for taller widgets", () => {
    const short = createWaveBar(makeTheme(), () => 0, 90)?.(2, 4) ?? "";
    const tall = createWaveBar(makeTheme(), () => 0, 90)?.(8, 20) ?? "";
    const shortRgb = parseAnsiRgb(short);
    const tallRgb = parseAnsiRgb(tall);
    expect(shortRgb).toBeDefined();
    expect(tallRgb).toEqual({ r: 212, g: 212, b: 212 });
    expect(shortRgb?.r ?? 0).toBeLessThan(tallRgb?.r ?? 0);
  });

  it("falls back to muted when text is the default foreground", () => {
    const theme = makeTheme({
      getFgAnsi: (color: string) => {
        if (color === "borderMuted") return "\x1b[38;2;49;50;68m";
        if (color === "text") return "\x1b[39m";
        if (color === "muted") return "\x1b[38;2;127;132;156m";
        throw new Error(`unexpected fg color: ${color}`);
      },
    } as Partial<Theme>);
    const bar = createWaveBar(theme, () => 0, 90);
    expect(bar).toBeTypeOf("function");
    expect(bar?.(8, 20)).toBe("\x1b[38;2;127;132;156m▌\x1b[39m");
  });

  it("reads the frame lazily so renders animate without rebuilding", () => {
    let frame = 0;
    const bar = createWaveBar(makeTheme(), () => frame, 90);
    const frames = new Set<string>();
    for (frame = 0; frame < 8; frame++) {
      frames.add(bar?.(0, 8) ?? "");
    }
    expect(frames.size).toBeGreaterThan(1);
  });

  it("quantizes to 256-color sequences in 256color mode", () => {
    const theme = makeTheme({
      getColorMode: () => "256color",
    } as Partial<Theme>);
    const rendered = createWaveBar(theme, () => 0, 90)?.(0, 8) ?? "";
    expect(rendered).toMatch(/^\x1b\[38;5;\d+m/);
  });
});
