import { resolveApiKey, resolveProviderConfig } from "../config.ts";
import { SttError, transcribeWithMimoChat } from "./mimo-stt.ts";

export interface SttProvider {
  transcribe(file: string, signal?: AbortSignal): Promise<string>;
}

export type { MimoSttConfig, SttErrorCode } from "./mimo-stt.ts";
export { SttError } from "./mimo-stt.ts";

export async function createSttProvider(providerName: string): Promise<SttProvider> {
  const config = resolveProviderConfig(providerName);
  const apiKey = resolveApiKey(providerName);
  if (!apiKey) {
    throw new SttError(
      "missing_api_key",
      `No API key for STT provider "${providerName}". Configure it via /config or set the provider's env var.`,
    );
  }
  return {
    transcribe: (file, signal) => transcribeWithMimoChat(file, config, apiKey, signal),
  };
}
