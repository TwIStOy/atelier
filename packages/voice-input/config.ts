import {
  readConfig,
  registerConfigItems,
  type ExtensionConfigSchema,
} from "@htwang-contrib/common";
import { findPreset, STT_PROVIDER_PRESETS } from "./providers/presets.ts";
import type {
  RecorderKind,
  SttProviderConfig,
  VoiceInputConfig,
} from "./types.ts";

export const DEFAULT_PROVIDER = "inference-self-host";
export const DEFAULT_TRANSCRIBE_TIMEOUT_MS = 60_000;

export const CONFIG_SCHEMA: ExtensionConfigSchema<VoiceInputConfig> = {
  defaults: {
    provider: DEFAULT_PROVIDER,
    providers: {},
    recorder: "auto",
    micDevice: "",
    transcribeTimeoutMs: DEFAULT_TRANSCRIBE_TIMEOUT_MS,
  },
};

export function loadConfig(): VoiceInputConfig {
  return readConfig("voice-input", CONFIG_SCHEMA);
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
  ]);
}
