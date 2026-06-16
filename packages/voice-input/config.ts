import {
  readConfig,
  registerConfigItems,
  type ExtensionConfigSchema,
} from "@htwang-contrib/common";
import { findPreset, STT_PROVIDER_PRESETS } from "./providers/presets.ts";
import type {
  RecorderKind,
  SttProviderConfig,
  VadConfig,
  VoiceInputConfig,
} from "./types.ts";

export const DEFAULT_PROVIDER = "inference-self-host";
export const DEFAULT_TRANSCRIBE_TIMEOUT_MS = 60_000;

export const DEFAULT_VAD_CONFIG: VadConfig = {
  enabled: false,
  threshold: 0.5,
  minSpeechMs: 250,
  minSilenceMs: 500,
  maxSpeechMs: 30_000,
};

export const CONFIG_SCHEMA: ExtensionConfigSchema<VoiceInputConfig> = {
  defaults: {
    provider: DEFAULT_PROVIDER,
    providers: {},
    recorder: "auto",
    micDevice: "",
    transcribeTimeoutMs: DEFAULT_TRANSCRIBE_TIMEOUT_MS,
    vad: { ...DEFAULT_VAD_CONFIG },
  },
};

export function loadConfig(): VoiceInputConfig {
  const config = readConfig("voice-input", CONFIG_SCHEMA);
  return {
    ...config,
    vad: { ...DEFAULT_VAD_CONFIG, ...(config.vad ?? {}) },
  };
}

export function resolveApiKey(providerName: string): string | undefined {
  const config = loadConfig();
  const provider = config.providers[providerName];
  if (provider?.apiKey?.trim()) return provider.apiKey.trim();
  const preset = findPreset(providerName);
  if (preset?.envVar) {
    const env = process.env[preset.envVar]?.trim();
    if (env) return env;
  }
  return undefined;
}

export function resolveProviderConfig(
  providerName: string,
): Pick<SttProviderConfig, "baseUrl" | "model"> {
  const config = loadConfig();
  const provider = config.providers[providerName] ?? {};
  const preset = findPreset(providerName);
  return {
    baseUrl: provider.baseUrl?.trim() || preset?.baseUrl || "",
    model: provider.model?.trim() || preset?.defaultModel || "",
  };
}

export function registerVoiceInputConfigItems(): void {
  const RECORDER_OPTIONS: Array<{ label: string; value: RecorderKind }> = [
    { label: "Auto detect", value: "auto" },
    { label: "ffmpeg", value: "ffmpeg" },
    { label: "parecord", value: "parecord" },
    { label: "sox", value: "sox" },
  ];

  registerConfigItems("voice-input", [
    {
      key: "provider",
      type: "select",
      label: "STT Provider",
      value: () => loadConfig().provider,
      options: () =>
        STT_PROVIDER_PRESETS.map((p) => ({
          label: resolveApiKey(p.name) ? `${p.label} ✓` : `${p.label} ✗`,
          value: p.name,
        })),
      description:
        "Provider used for speech-to-text (inference-self-host with mimo-v2.5).",
      extensionLabel: "Voice Input",
      order: 0,
    },
    ...STT_PROVIDER_PRESETS.flatMap((p, i) => [
      {
        key: `providers.${p.name}.baseUrl`,
        type: "string" as const,
        label: `${p.label} Base URL`,
        value: () => loadConfig().providers[p.name]?.baseUrl ?? p.baseUrl,
        description: `${p.label} API base URL.`,
        extensionLabel: "Voice Input",
        order: 10 + i * 3,
        placeholder: p.baseUrl,
      },
      {
        key: `providers.${p.name}.apiKey`,
        type: "string" as const,
        label: `${p.label} API Key`,
        value: () => resolveApiKey(p.name) ?? "",
        description: `${p.label} API key (env: ${p.envVar}).`,
        extensionLabel: "Voice Input",
        order: 11 + i * 3,
        secret: true,
        placeholder: p.envVar,
        envVar: p.envVar,
      },
      {
        key: `providers.${p.name}.model`,
        type: "string" as const,
        label: `${p.label} Model`,
        value: () => loadConfig().providers[p.name]?.model ?? p.defaultModel,
        description: `${p.label} STT model.`,
        extensionLabel: "Voice Input",
        order: 12 + i * 3,
        placeholder: p.defaultModel,
      },
    ]),
    {
      key: "recorder",
      type: "select",
      label: "Recorder",
      value: () => loadConfig().recorder,
      options: RECORDER_OPTIONS,
      description:
        "Recording backend. Auto detects per platform (parecord on Linux PulseAudio, ffmpeg elsewhere).",
      extensionLabel: "Voice Input",
      order: 100,
    },
    {
      key: "micDevice",
      type: "string",
      label: "Mic Device Override",
      value: () => loadConfig().micDevice,
      description:
        'Override the default mic device (e.g. ":0" on macOS avfoundation, "default" on PulseAudio). Empty = platform default.',
      extensionLabel: "Voice Input",
      order: 101,
      placeholder: "platform default",
    },
    {
      key: "transcribeTimeoutMs",
      type: "number",
      label: "Transcribe Timeout (ms)",
      value: () => loadConfig().transcribeTimeoutMs,
      description: "Abort transcription after this many milliseconds.",
      extensionLabel: "Voice Input",
      order: 102,
      min: 5_000,
      max: 300_000,
    },
    {
      key: "vad.enabled",
      type: "boolean",
      label: "VAD Segmentation",
      value: () => loadConfig().vad.enabled,
      description:
        "Stream audio through Silero VAD: auto-split utterances by silence and transcribe each segment as you speak. Falls back to whole-file recording if the model fails to load.",
      extensionLabel: "Voice Input",
      order: 200,
    },
    {
      key: "vad.threshold",
      type: "number",
      label: "VAD Speech Threshold",
      value: () => loadConfig().vad.threshold,
      description:
        "Probability above which a frame counts as speech (0–1). Higher = stricter.",
      extensionLabel: "Voice Input",
      order: 201,
      min: 0,
      max: 1,
    },
    {
      key: "vad.minSpeechMs",
      type: "number",
      label: "VAD Min Speech (ms)",
      value: () => loadConfig().vad.minSpeechMs,
      description:
        "Minimum speech duration to open a segment. Filters out brief noises.",
      extensionLabel: "Voice Input",
      order: 202,
      min: 50,
      max: 5_000,
    },
    {
      key: "vad.minSilenceMs",
      type: "number",
      label: "VAD Min Silence (ms)",
      value: () => loadConfig().vad.minSilenceMs,
      description:
        "Silence duration that closes a segment and triggers transcription.",
      extensionLabel: "Voice Input",
      order: 203,
      min: 100,
      max: 5_000,
    },
    {
      key: "vad.maxSpeechMs",
      type: "number",
      label: "VAD Max Speech (ms)",
      value: () => loadConfig().vad.maxSpeechMs,
      description:
        "Hard cap on a single segment length. Forces a split at this duration.",
      extensionLabel: "Voice Input",
      order: 204,
      min: 1_000,
      max: 120_000,
    },
  ]);
}
