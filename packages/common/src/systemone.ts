import {
  APIUserAbortError,
  type EntryType,
  type Fetch,
  type Questions,
  type RequestOptions,
  type SystemOneResult,
  TypeSafeClient,
  TypeSafeError,
  type SystemOneRequest as TypeSafeSystemOneRequest,
} from "@typesafe-ai/sdk";
import {
  type ExtensionConfigSchema,
  getConfigEnvVar,
  readConfig,
  registerConfigItems,
  resolveConfigValue,
} from "./config/index.ts";

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
  SystemOneResult,
  Usage as SystemOneUsage,
} from "@typesafe-ai/sdk";

export type SystemOneRequest<Q extends Questions = Questions> = Omit<TypeSafeSystemOneRequest<Q>, "state"> & {
  state: EntryType | null;
};
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
  const apiKey = resolveConfigValue(config.apiKey);
  return {
    ...config,
    apiKey: getConfigEnvVar(config.apiKey) === undefined ? process.env.TYPESAFE_API_KEY?.trim() || apiKey : apiKey,
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
      value: () => readConfig(SYSTEM_ONE_CONFIG_ID, CONFIG_SCHEMA).apiKey,
      description:
        "API key or $VAR / {env:VAR} reference. References take precedence; otherwise TYPESAFE_API_KEY overrides a literal key.",
      extensionLabel: "System One",
      secret: true,
      envVar: "TYPESAFE_API_KEY",
      placeholder: "$MY_TYPESAFE_KEY or {env:MY_TYPESAFE_KEY}",
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

const NULL_STATE_SENTINEL = "__PI_SYSTEMONE_NULL_STATE__";

export async function systemOne<const Q extends Questions>(
  request: SystemOneRequest<Q>,
  options: SystemOneOptions = {},
): Promise<SystemOneResult<Q>> {
  if (options.signal?.aborted) {
    throw new APIUserAbortError(undefined, { cause: options.signal.reason });
  }

  const config = loadSystemOneConfig();
  const apiKey = options.apiKey === undefined ? config.apiKey : resolveConfigValue(options.apiKey);
  if (!apiKey) {
    throw new TypeSafeError(
      "System One API key is missing. Check the referenced environment variable, set TYPESAFE_API_KEY, or configure System One in /config.",
    );
  }

  const fetchForClient =
    request.state === null
      ? (((input: string, init?: RequestInit) => {
          const forwarded = options.fetch ?? globalThis.fetch;
          if (!forwarded) {
            return Promise.reject(new TypeSafeError("No fetch implementation is available for System One."));
          }
          const body = init?.body;
          if (typeof body !== "string") {
            return forwarded(input, init);
          }
          try {
            const payload = JSON.parse(body);
            if (payload && typeof payload === "object" && "state" in payload && payload.state === NULL_STATE_SENTINEL) {
              payload.state = null;
              return forwarded(input, { ...init, body: JSON.stringify(payload) });
            }
          } catch {
            // The body is not JSON; fall through to the original request.
          }
          return forwarded(input, init);
        }) satisfies Fetch)
      : options.fetch;

  const client = new TypeSafeClient({
    apiKey,
    baseURL: (options.baseUrl ?? config.baseUrl).trim(),
    defaultModel: config.model,
    timeout: config.timeoutMs,
    retry: { maxRetries: config.maxRetries },
    fetch: fetchForClient,
    logLevel: "off",
  });

  const requestForClient =
    request.state === null
      ? ({ ...request, state: NULL_STATE_SENTINEL } as TypeSafeSystemOneRequest<Q>)
      : (request as TypeSafeSystemOneRequest<Q>);

  return client.systemOne(requestForClient, options);
}
