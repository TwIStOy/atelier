import {
  DEFAULT_SPINNER,
  SPINNER_STYLES,
  type SpinnerStyle,
} from "@htwang-contrib/common";

/**
 * Terminal width (in columns) below which the working indicator is treated as
 * narrow (likely a phone). Picked because typical phone-in-landscape and very
 * small split panes fall below this, while a comfortable terminal does not.
 */
export const DEFAULT_NARROW_WIDTH_THRESHOLD = 50;

/**
 * Spinner preset used when the terminal goes narrow. `dots` is the default
 * spinner overall — width 1, a single braille glyph — so it stays readable on
 * the tightest screens.
 */
export const DEFAULT_NARROW_WIDTH_SPINNER = "dots";

export interface NarrowWidthOptions {
  /** True when the narrow-width override is enabled. */
  enabled: boolean;
  /** Column count at or below which the screen is considered narrow. */
  threshold: number;
  /** Spinner preset to use when narrow. */
  spinner: string;
}

export function normalizeNarrowWidthOptions(
  options: Partial<NarrowWidthOptions> | undefined,
): NarrowWidthOptions {
  const rawThreshold = options?.threshold;
  const threshold =
    typeof rawThreshold === "number" && Number.isFinite(rawThreshold)
      ? Math.max(1, Math.round(rawThreshold))
      : DEFAULT_NARROW_WIDTH_THRESHOLD;
  return {
    enabled: options?.enabled ?? true,
    threshold,
    spinner: options?.spinner ?? DEFAULT_NARROW_WIDTH_SPINNER,
  };
}

/**
 * True when the terminal is narrow enough that the indicator should switch to
 * the compact spinner. A non-finite or non-positive width is treated as wide —
 * we never want to downgrade based on missing size information.
 */
export function isNarrowWidth(
  width: number,
  options: NarrowWidthOptions | Partial<NarrowWidthOptions> | undefined,
): boolean {
  if (!Number.isFinite(width) || width <= 0) return false;
  const opts = normalizeNarrowWidthOptions(options);
  if (!opts.enabled) return false;
  return width <= opts.threshold;
}

/**
 * The spinner preset that should currently be shown. Returns `undefined` when
 * the resolved key has no style (so callers clear the indicator, matching the
 * existing `applySpinner` contract).
 */
export function resolveEffectiveSpinnerKey(
  configured: string,
  width: number,
  options: NarrowWidthOptions | Partial<NarrowWidthOptions> | undefined,
): string {
  if (isNarrowWidth(width, options)) {
    const opts = normalizeNarrowWidthOptions(options);
    return opts.spinner;
  }
  return configured;
}

export function resolveEffectiveSpinner(
  configured: string,
  width: number,
  options: NarrowWidthOptions | Partial<NarrowWidthOptions> | undefined,
): SpinnerStyle | undefined {
  const key = resolveEffectiveSpinnerKey(configured, width, options);
  return SPINNER_STYLES[key] ?? SPINNER_STYLES[DEFAULT_SPINNER];
}
