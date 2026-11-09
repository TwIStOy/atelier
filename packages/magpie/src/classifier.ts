import type {
  ClassifierAnswer,
  ClassifierContext,
  ClassifierModel,
  ClassifierOptions,
  ClassifierQuestion,
  ClassifierResult,
  ProviderClassifier,
  Usage,
} from "@earendil-works/pi-ai";
import { loadMagpieConfig, type MagpieConfig } from "./config.ts";

export const MAGPIE_SYSTEM_ONE_API = "typesafe-system-one";

interface ClassifierErrorDetails {
  status?: number;
  body?: unknown;
  retryable?: boolean;
  cause?: unknown;
}

export class MagpieClassifierError extends Error {
  readonly status: number | undefined;
  readonly body: unknown;
  readonly retryable: boolean;

  constructor(message: string, details: ClassifierErrorDetails = {}) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = "MagpieClassifierError";
    this.status = details.status;
    this.body = details.body;
    this.retryable = details.retryable ?? false;
  }
}

type SystemOneModel = ClassifierModel<typeof MAGPIE_SYSTEM_ONE_API>;

function wireQuestions(context: ClassifierContext): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(context.questions).map(([id, question]) => [
      id,
      question.type === "bool" ? { ...question, type: "noul" } : question,
    ]),
  );
}

function requiredNumber(label: string, value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new MagpieClassifierError(`${label} returned an invalid ${field}`);
  }
  return value;
}

function parseAnswer(id: string, question: ClassifierQuestion, value: unknown): ClassifierAnswer {
  if (typeof value !== "object" || value === null) {
    throw new MagpieClassifierError(`Magpie classifier did not return an answer for ${id}`);
  }
  const answer = value as Record<string, unknown>;
  if (question.type === "bool") {
    if (answer.type !== "noul") throw new MagpieClassifierError(`Magpie classifier returned no bool answer for ${id}`);
    return { type: "bool", probability: requiredNumber("Magpie classifier", answer.noul, `probability for ${id}`) };
  }
  if (question.type === "choice") {
    if (answer.type !== "choice" || typeof answer.choice !== "string") {
      throw new MagpieClassifierError(`Magpie classifier returned no choice answer for ${id}`);
    }
    const probabilities = answer.probabilities;
    if (typeof probabilities !== "object" || probabilities === null) {
      throw new MagpieClassifierError(`Magpie classifier returned invalid probabilities for ${id}`);
    }
    return {
      type: "choice",
      choice: answer.choice,
      probabilities: Object.fromEntries(
        Object.entries(probabilities).map(([key, probability]) => [
          key,
          requiredNumber("Magpie classifier", probability, `probability for ${id}.${key}`),
        ]),
      ),
      confidence: requiredNumber("Magpie classifier", answer.confidence, `confidence for ${id}`),
    };
  }
  if (answer.type !== "score") throw new MagpieClassifierError(`Magpie classifier returned no score answer for ${id}`);
  return {
    type: "score",
    score: requiredNumber("Magpie classifier", answer.score, `score for ${id}`),
    confidence: requiredNumber("Magpie classifier", answer.confidence, `confidence for ${id}`),
  };
}

function parseUsage(value: unknown): Usage | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const usage = value as Record<string, unknown>;
  const input = usage.input_tokens;
  const output = usage.output_tokens;
  if (typeof input !== "number" || !Number.isFinite(input)) return undefined;
  const outputTokens = typeof output === "number" && Number.isFinite(output) ? output : 0;
  const total = input + outputTokens;
  return {
    input,
    output: outputTokens,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: total,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const BACKOFF_BASE_MS = 250;

async function postOnce(
  url: URL,
  body: string,
  apiKey: string,
  headers: Record<string, string>,
  timeoutMs: number,
  fetchImpl: typeof globalThis.fetch,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  if (signal?.aborted) {
    throw new MagpieClassifierError("Magpie classifier request aborted", { cause: signal.reason });
  }
  const timeout = AbortSignal.timeout(timeoutMs);
  const attemptSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const requestHeaders = new Headers(headers);
  if (!requestHeaders.has("content-type")) requestHeaders.set("content-type", "application/json");
  if (!requestHeaders.has("authorization")) requestHeaders.set("authorization", `Bearer ${apiKey}`);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: requestHeaders,
      body,
      signal: attemptSignal,
    });
    const payload = await response.json().catch(() => undefined);
    if (!response.ok) {
      throw new MagpieClassifierError(`Magpie classifier HTTP ${response.status}`, {
        status: response.status,
        body: payload,
        retryable: RETRYABLE_STATUS.has(response.status),
      });
    }
    if (typeof payload !== "object" || payload === null) {
      throw new MagpieClassifierError("Magpie classifier returned an invalid response body");
    }
    return payload;
  } catch (error) {
    if (signal?.aborted) {
      throw new MagpieClassifierError("Magpie classifier request aborted", { cause: signal.reason });
    }
    if (timeout.aborted) {
      throw new MagpieClassifierError(`Magpie classifier timed out after ${timeoutMs}ms`, { retryable: true });
    }
    if (error instanceof MagpieClassifierError) throw error;
    throw new MagpieClassifierError(`Magpie classifier request failed: ${String(error)}`, {
      retryable: true,
      cause: error,
    });
  }
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () =>
      reject(new MagpieClassifierError("Magpie classifier request aborted", { cause: signal?.reason }));
    if (signal?.aborted) {
      abort();
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        abort();
      },
      { once: true },
    );
  });
}

function callerHeaders(options: ClassifierOptions): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.headers ?? {})) {
    if (typeof value === "string") headers[key] = value;
  }
  return headers;
}

export const magpieSystemOneClassifier: ProviderClassifier = {
  async classify(
    model: SystemOneModel,
    context: ClassifierContext,
    options: ClassifierOptions = {},
  ): Promise<ClassifierResult> {
    const config: MagpieConfig = loadMagpieConfig();
    const apiKey = options.apiKey?.trim() || config.apiKey;
    const headers = callerHeaders(options);
    if (!apiKey.trim() && !new Headers(headers).has("authorization")) {
      throw new MagpieClassifierError(
        "Magpie API key is missing. Set MAGPIE_API_KEY or configure the Magpie API key in /config.",
      );
    }
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (!fetchImpl) throw new MagpieClassifierError("No fetch implementation is available for Magpie.");

    const url = new URL("systemone", `${model.baseUrl.replace(/\/+$/, "")}/`);
    const body = JSON.stringify({
      model: model.id,
      state: context.state,
      questions: wireQuestions(context),
    });
    const timeoutMs = options.timeoutMs ?? config.classifierTimeoutMs;
    const attempts = Math.max(0, options.maxRetries ?? config.classifierMaxRetries) + 1;

    let payload: unknown;
    for (let attempt = 1; ; attempt++) {
      try {
        payload = await postOnce(url, body, apiKey, headers, timeoutMs, fetchImpl, options.signal);
        break;
      } catch (error) {
        if (attempt >= attempts || !(error instanceof MagpieClassifierError) || !error.retryable) throw error;
      }
      await delay(BACKOFF_BASE_MS * 2 ** (attempt - 1), options.signal);
    }

    const answers = (payload as { answers?: unknown }).answers;
    if (typeof answers !== "object" || answers === null) {
      throw new MagpieClassifierError("Magpie classifier returned no answers");
    }
    const answerRecords = answers as Record<string, unknown>;
    const parsed = Object.fromEntries(
      Object.entries(context.questions).map(([id, question]) => [id, parseAnswer(id, question, answerRecords[id])]),
    );

    const result: ClassifierResult = {
      api: model.api,
      provider: model.provider,
      model: model.id,
      answers: parsed,
      stopReason: "stop",
      timestamp: Date.now(),
    };
    const usage = parseUsage((payload as { usage?: unknown }).usage);
    if (usage) result.usage = usage;
    return result;
  },
};
