import { readFile } from "node:fs/promises";
import { safeError } from "../secrets.ts";
import { encodeAudioBase64, inferAudioFormat } from "../base64.ts";

export type SttErrorCode =
  | "missing_api_key"
  | "network_error"
  | "auth_error"
  | "api_error"
  | "empty_transcript";

export class SttError extends Error {
  readonly code: SttErrorCode;

  constructor(code: SttErrorCode, message: string) {
    super(message);
    this.name = "SttError";
    this.code = code;
  }
}

export interface MimoSttConfig {
  baseUrl: string;
  model: string;
}

const TRANSCRIBE_PROMPT =
  "Transcribe the speech in this audio to text. Output only the transcribed text, no explanations. If no speech is detected, output [NO SPEECH].";

const NO_SPEECH = "[NO SPEECH]";

let _fetch: typeof fetch = fetch;
let _readFile: typeof readFile = readFile;

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string; reasoning_content?: string };
  }>;
}

export async function transcribeWithMimoChat(
  file: string,
  config: MimoSttConfig,
  apiKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const audio = await _readFile(file);
  const data = encodeAudioBase64(audio);
  const format = inferAudioFormat(file);

  let resp: Response;
  try {
    resp = await _fetch(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          {
            role: "user",
            content: [
              { type: "input_audio", input_audio: { format, data } },
              { type: "text", text: TRANSCRIBE_PROMPT },
            ],
          },
        ],
        max_completion_tokens: 4096,
      }),
      signal,
    });
  } catch (error) {
    if (error instanceof SttError) throw error;
    throw new SttError("network_error", safeError(error, [apiKey]));
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    const code: SttErrorCode =
      resp.status === 401 || resp.status === 403 ? "auth_error" : "api_error";
    throw new SttError(
      code,
      safeError(`STT request failed (${resp.status}): ${body}`, [apiKey]),
    );
  }

  const parsed = (await resp
    .json()
    .catch(() => ({}))) as ChatCompletionResponse;
  const message = parsed.choices?.[0]?.message;
  const text = (message?.content ?? message?.reasoning_content ?? "").trim();

  if (!text || text === NO_SPEECH) {
    throw new SttError("empty_transcript", "No speech detected.");
  }
  return text;
}

export function setHttpDeps(deps: {
  fetch?: typeof fetch;
  readFile?: typeof readFile;
}): void {
  if (deps.fetch) _fetch = deps.fetch;
  if (deps.readFile) _readFile = deps.readFile;
}

export function resetHttpDeps(): void {
  _fetch = fetch;
  _readFile = readFile;
}
