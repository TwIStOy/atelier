export interface SttProviderPreset {
  name: string;
  label: string;
  baseUrl: string;
  defaultModel: string;
  envVar: string;
  protocol: "chat-multimodal";
}

export const STT_PROVIDER_PRESETS: readonly SttProviderPreset[] = [
  {
    name: "inference-self-host",
    label: "Inference Self-Host",
    baseUrl: "https://inference.twistoy.cn/v1",
    defaultModel: "mimo-v2.5",
    envVar: "INFERENCE_TWISTOY_API_KEY",
    protocol: "chat-multimodal",
  },
];

export function findPreset(name: string): SttProviderPreset | undefined {
  return STT_PROVIDER_PRESETS.find((p) => p.name === name);
}
