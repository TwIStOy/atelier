import {
  APIUserAbortError,
  type Fetch,
  type Questions,
  type RequestOptions,
  type SystemOneRequest,
  type SystemOneResult,
  TypeSafeClient,
  TypeSafeError,
} from "@typesafe-ai/sdk";
import { type ExtensionConfigSchema, readConfig, registerConfigItems } from "./config/index.ts";

export type {
  ChoiceQuestion as SystemOneChoiceQuestion,
  ChoiceResponse as SystemOneChoiceResponse,
  EntryType as SystemOneState,
  NoulQuestion as SystemOneNoulQuestion,
  NoulResponse as SystemOneNoulResponse,
  Question as SystemOneQuestion,
  Questions as SystemOneQuestions,
  ScoreQuestion as SystemOneScoreQuestion,
  ScoreResponse as SystemOneScoreResponse,
  SystemOneRequest,
  SystemOneResult,
  Usage as SystemOneUsage,
} from "@typesafe-ai/sdk";
export {
  APIConnectionError as SystemOneConnectionError,
  APIError as SystemOneAPIError,
  APITimeoutError as SystemOneTimeoutError,
  APIUserAbortError as SystemOneAbortError,
  choice as systemOneChoice,
  noul as systemOneNoul,
  score as systemOneScore,
  TypeSafeError as SystemOneError,
} from "@typesafe-ai/sdk";

export const SYSTEM_ONE_CONFIG_ID = "systemone";

export interface SystemOneConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
}

export interface SystemOneOptions extends RequestOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: Fetch;
}

const CONFIG_SCHEMA: ExtensionConfigSchema<SystemOneConfig> = {
  defaults: {
    apiKey: "",
    baseUrl: "https://api.typesafe.ai",
    model: "jev-latest",
    timeoutMs: 10_000,
    maxRetries: 2,
  },
};

export function loadSystemOneConfig(): SystemOneConfig {
  const config = readConfig(SYSTEM_ONE_CONFIG_ID, CONFIG_SCHEMA);
  return {
    ...config,
    apiKey: process.env.TYPESAFE_API_KEY?.trim() || config.apiKey,
    baseUrl: process.env.TYPESAFE_BASE_URL?.trim() || config.baseUrl,
    model: process.env.TYPESAFE_DEFAULT_MODEL?.trim() || config.model,
  };
}

export function registerSystemOneConfigItems(): void {
  registerConfigItems(SYSTEM_ONE_CONFIG_ID, [
    {
      key: "apiKey",
      type: "string",
      label: "API Key",
      value: () => loadSystemOneConfig().apiKey,
      description: "TypeSafe API key. TYPESAFE_API_KEY takes precedence over this setting.",
      extensionLabel: "System One",
      secret: true,
      envVar: "TYPESAFE_API_KEY",
      order: 0,
    },
    {
      key: "baseUrl",
      type: "string",
      label: "Base URL",
      value: () => loadSystemOneConfig().baseUrl,
      description: "API root, including any gateway prefix. Requests append /v1/systemone.",
      extensionLabel: "System One",
      envVar: "TYPESAFE_BASE_URL",
      order: 1,
    },
    {
      key: "model",
      type: "string",
      label: "Model",
      value: () => loadSystemOneConfig().model,
      description: "Default System One model. A request can override it.",
      extensionLabel: "System One",
      envVar: "TYPESAFE_DEFAULT_MODEL",
      order: 2,
    },
    {
      key: "timeoutMs",
      type: "number",
      label: "Timeout (ms)",
      value: () => loadSystemOneConfig().timeoutMs,
      description: "Timeout per attempt, including response body delivery. Retries have separate timeouts.",
      extensionLabel: "System One",
      min: 1,
      order: 3,
    },
    {
      key: "maxRetries",
      type: "number",
      label: "Max Retries",
      value: () => loadSystemOneConfig().maxRetries,
      description: "Retries after the initial attempt for transient failures. Zero disables retries.",
      extensionLabel: "System One",
      min: 0,
      order: 4,
    },
  ]);
}

export async function systemOne<const Q extends Questions>(
  request: SystemOneRequest<Q>,
  options: SystemOneOptions = {},
): Promise<SystemOneResult<Q>> {
  if (options.signal?.aborted) {
    throw new APIUserAbortError(undefined, { cause: options.signal.reason });
  }

  const config = loadSystemOneConfig();
  const apiKey = (options.apiKey ?? config.apiKey).trim();
  if (!apiKey) {
    throw new TypeSafeError("System One API key is missing. Set TYPESAFE_API_KEY or configure System One in /config.");
  }

  const client = new TypeSafeClient({
    apiKey,
    baseURL: (options.baseUrl ?? config.baseUrl).trim(),
    defaultModel: config.model,
    timeout: config.timeoutMs,
    retry: { maxRetries: config.maxRetries },
    fetch: options.fetch,
    logLevel: "off",
  });
  return client.systemOne(request, options);
}
