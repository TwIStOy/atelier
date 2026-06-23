import { describe, expect, test } from "vitest";
import { DEFAULT_SPINNER } from "@htwang-contrib/common";
import {
  DEFAULT_NARROW_WIDTH_SPINNER,
  DEFAULT_NARROW_WIDTH_THRESHOLD,
  isNarrowWidth,
  normalizeNarrowWidthOptions,
  resolveEffectiveSpinner,
  resolveEffectiveSpinnerKey,
} from "./narrow-screen.ts";

describe("DEFAULT constants", () => {
  test("threshold is 50 and fallback spinner is dots", () => {
    expect(DEFAULT_NARROW_WIDTH_THRESHOLD).toBe(50);
    expect(DEFAULT_NARROW_WIDTH_SPINNER).toBe("dots");
  });
});

describe("isNarrowWidth", () => {
  test("treats width at the threshold as narrow (inclusive)", () => {
    expect(isNarrowWidth(50, undefined)).toBe(true);
  });

  test("treats width just above the threshold as wide", () => {
    expect(isNarrowWidth(51, undefined)).toBe(false);
  });

  test("treats very small width as narrow", () => {
    expect(isNarrowWidth(20, undefined)).toBe(true);
    expect(isNarrowWidth(1, undefined)).toBe(true);
  });

  test("returns false when disabled even at width 1", () => {
    expect(isNarrowWidth(1, { enabled: false })).toBe(false);
  });

  test("returns false for non-finite or non-positive width", () => {
    expect(isNarrowWidth(NaN, undefined)).toBe(false);
    expect(isNarrowWidth(Infinity, undefined)).toBe(false);
    expect(isNarrowWidth(0, undefined)).toBe(false);
    expect(isNarrowWidth(-10, undefined)).toBe(false);
  });

  test("respects a custom threshold", () => {
    expect(isNarrowWidth(60, { threshold: 60 })).toBe(true);
    expect(isNarrowWidth(61, { threshold: 60 })).toBe(false);
  });
});

describe("normalizeNarrowWidthOptions", () => {
  test("fills defaults from undefined", () => {
    expect(normalizeNarrowWidthOptions(undefined)).toEqual({
      enabled: true,
      threshold: DEFAULT_NARROW_WIDTH_THRESHOLD,
      spinner: DEFAULT_NARROW_WIDTH_SPINNER,
    });
  });

  test("clamps non-finite threshold to the default and floors it to 1", () => {
    expect(normalizeNarrowWidthOptions({ threshold: NaN }).threshold).toBe(
      DEFAULT_NARROW_WIDTH_THRESHOLD,
    );
    expect(normalizeNarrowWidthOptions({ threshold: 0 }).threshold).toBe(1);
    expect(normalizeNarrowWidthOptions({ threshold: -5 }).threshold).toBe(1);
  });

  test("rounds a fractional threshold", () => {
    expect(normalizeNarrowWidthOptions({ threshold: 42.7 }).threshold).toBe(43);
  });
});

describe("resolveEffectiveSpinnerKey", () => {
  test("returns the configured key on a wide terminal", () => {
    expect(resolveEffectiveSpinnerKey("runcat", 120, undefined)).toBe("runcat");
  });

  test("returns the narrow key on a narrow terminal", () => {
    expect(resolveEffectiveSpinnerKey("runcat", 30, undefined)).toBe("dots");
  });

  test("keeps the configured key when the override is disabled", () => {
    expect(resolveEffectiveSpinnerKey("runcat", 30, { enabled: false })).toBe(
      "runcat",
    );
  });

  test("uses a custom narrow spinner", () => {
    expect(resolveEffectiveSpinnerKey("runcat", 30, { spinner: "moon" })).toBe(
      "moon",
    );
  });

  test("treats the boundary as narrow", () => {
    expect(resolveEffectiveSpinnerKey("moon", 50, undefined)).toBe("dots");
  });
});

describe("resolveEffectiveSpinner", () => {
  test("returns the configured style when wide", () => {
    const style = resolveEffectiveSpinner("dots", 120, undefined);
    expect(style?.frames).toEqual(
      // mirroring the dots preset from SPINNER_STYLES without importing it
      ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    );
  });

  test("falls back to the default style for an unknown resolved key", () => {
    const style = resolveEffectiveSpinner("does-not-exist", 120, undefined);
    expect(style).toBeDefined();
    expect(style).toBe(
      // unknown key resolves to DEFAULT_SPINNER
      resolveEffectiveSpinner(DEFAULT_SPINNER, 9999, undefined),
    );
  });

  test("resolves the narrow style when narrow", () => {
    const style = resolveEffectiveSpinner("runcat", 20, undefined);
    expect(style?.frames).toEqual([
      "⠋",
      "⠙",
      "⠹",
      "⠸",
      "⠼",
      "⠴",
      "⠦",
      "⠧",
      "⠇",
      "⠏",
    ]);
  });
});
