import {
  type AssistantMessage,
  completeSimple,
  type Message,
  type Model,
  type StopReason,
} from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import { assistantMessageText } from "./message-text.ts";

type AnyModel = Model<any>;

export type SideCallResult =
  | {
      ok: true;
      answer: string;
      assistantMessage: AssistantMessage;
      stopReason: StopReason;
    }
  | { ok: false; error: string; stopReason?: StopReason }
  | { ok: false; aborted: true; stopReason: StopReason };

export async function executeSideCall(opts: {
  model: AnyModel;
  modelRegistry: ModelRegistry;
  systemPrompt: string;
  messages: Message[];
  signal: AbortSignal;
  commandName: string;
}): Promise<SideCallResult> {
  const { model, modelRegistry, systemPrompt, messages, signal, commandName } = opts;
  const modelLabel = `${model.provider}:${model.id}`;

  const auth = await modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) {
    return {
      ok: false,
      error: `${commandName} model (${modelLabel}) is misconfigured: ${auth.error}`,
    };
  }
  if (!auth.apiKey) {
    return {
      ok: false,
      error: `${commandName} model (${modelLabel}) has no API key available.`,
    };
  }

  try {
    const response = await completeSimple(
      model,
      { systemPrompt, messages, tools: [] },
      { apiKey: auth.apiKey, headers: auth.headers, signal },
    );

    if (response.stopReason === "aborted") {
      return { ok: false, aborted: true, stopReason: response.stopReason };
    }
    if (response.stopReason === "error") {
      return {
        ok: false,
        error: `${commandName} call failed: ${response.errorMessage ?? "unknown error"}`,
        stopReason: response.stopReason,
      };
    }

    const answerText = assistantMessageText(response).trim();
    if (!answerText) {
      return {
        ok: false,
        error: `${commandName} returned no text content.`,
        stopReason: response.stopReason,
      };
    }

    return {
      ok: true,
      answer: answerText,
      assistantMessage: response,
      stopReason: response.stopReason,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (signal.aborted) {
      return { ok: false, aborted: true, stopReason: "aborted" as const };
    }
    return { ok: false, error: `${commandName} call threw: ${message}` };
  }
}
