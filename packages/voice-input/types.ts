export interface SttProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export type RecorderKind = "auto" | "ffmpeg" | "parecord" | "sox";

export interface VoiceInputConfig {
  provider: string;
  providers: Record<string, Partial<SttProviderConfig>>;
  recorder: RecorderKind;
  micDevice: string;
  transcribeTimeoutMs: number;
}
