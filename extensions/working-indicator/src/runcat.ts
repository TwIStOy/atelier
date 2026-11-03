export const RUNCAT_SPINNER_KEY = "runcat";

const DEFAULT_RUNCAT_SCALE = 6000;
const DEFAULT_RUNCAT_MIN_INTERVAL_MS = 50;
const DEFAULT_RUNCAT_MAX_INTERVAL_MS = 250;
const DEFAULT_RUNCAT_INTERVAL_MS = 167;
const DEFAULT_RUNCAT_INTERVAL_CHANGE_THRESHOLD_MS = 10;
const DEFAULT_RUNCAT_QUANTIZE_STEPS = 6;

export interface RuncatSpeedConfig {
  scale: number;
  minIntervalMs: number;
  maxIntervalMs: number;
  defaultIntervalMs: number;
  intervalChangeThresholdMs: number;
  quantizeSteps: number;
}

export const DEFAULT_RUNCAT_SPEED_CONFIG: RuncatSpeedConfig = {
  scale: DEFAULT_RUNCAT_SCALE,
  minIntervalMs: DEFAULT_RUNCAT_MIN_INTERVAL_MS,
  maxIntervalMs: DEFAULT_RUNCAT_MAX_INTERVAL_MS,
  defaultIntervalMs: DEFAULT_RUNCAT_INTERVAL_MS,
  intervalChangeThresholdMs: DEFAULT_RUNCAT_INTERVAL_CHANGE_THRESHOLD_MS,
  quantizeSteps: DEFAULT_RUNCAT_QUANTIZE_STEPS,
};

export function clampInterval(value: number, config: RuncatSpeedConfig = DEFAULT_RUNCAT_SPEED_CONFIG): number {
  const lower = Math.min(config.minIntervalMs, config.maxIntervalMs);
  const upper = Math.max(config.minIntervalMs, config.maxIntervalMs);
  return Math.max(lower, Math.min(upper, value));
}

export function runcatSpeedIntervalMs(
  speed: number | null,
  config: RuncatSpeedConfig = DEFAULT_RUNCAT_SPEED_CONFIG,
): number {
  if (speed === null || !Number.isFinite(speed) || speed <= 0) {
    return config.defaultIntervalMs;
  }
  return clampInterval(Math.round(config.scale / speed), config);
}

export function shouldUpdateInterval(
  currentMs: number,
  nextMs: number,
  config: RuncatSpeedConfig = DEFAULT_RUNCAT_SPEED_CONFIG,
): boolean {
  return Math.abs(nextMs - currentMs) >= config.intervalChangeThresholdMs;
}

export function shouldRefreshRuncatInterval(thinking: boolean): boolean {
  return !thinking;
}

export function quantizeInterval(intervalMs: number, config: RuncatSpeedConfig = DEFAULT_RUNCAT_SPEED_CONFIG): number {
  const steps = Math.max(1, Math.floor(config.quantizeSteps));
  if (steps === 1) return config.minIntervalMs;
  const lower = Math.min(config.minIntervalMs, config.maxIntervalMs);
  const upper = Math.max(config.minIntervalMs, config.maxIntervalMs);
  const clamped = Math.max(lower, Math.min(upper, intervalMs));
  const step = (upper - lower) / (steps - 1);
  const index = Math.round((clamped - lower) / step);
  return Math.round(lower + index * step);
}
