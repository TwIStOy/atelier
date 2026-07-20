# Inference V2 (Self Host) Extension

A pi extension that registers the `inference-v2-self-host` provider, proxying to a [lite-gateway](https://github.com/) instance at `https://inference-v2.twistoy.cn/api/v1`.

## Configuration

Set this environment variable:

- `INFERENCE_V2_TWISTOY_API_KEY` - your gateway data-plane token (`sk-lg-...`)

## Routing

- Provider `baseUrl`: `https://inference-v2.twistoy.cn/api/v1`. pi's `openai-completions` api appends `/chat/completions`, producing `/api/v1/chat/completions` (matches the gateway's relay route).
- `authHeader: true` sends `Authorization: Bearer <key>`.
- Anthropic models get a model-level `baseUrl` of `https://inference-v2.twistoy.cn/api`; the Anthropic SDK appends `/v1/messages`, producing `/api/v1/messages`.

## Model Catalog (dynamic)

Starts with an empty `models: []` baseline and is populated by the new `refreshModels` provider API:

1. pi calls `refreshModels(context)` during startup and on `/model` refresh.
2. The callback (`src/catalog.ts` -> `refreshCatalog`) issues `GET https://inference-v2.twistoy.cn/api/v1/models` with `Authorization: Bearer <key>` and maps each entry to a `ProviderModelConfig`.
3. The result is persisted through `context.store` (provider-scoped `ModelsStore`) with a 4h freshness interval, so offline startup still sees the last known catalog.

### Field mapping (from the gateway's `ModelObject`)

| pi field         | source                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------- |
| `id` / `name`    | gateway `id`                                                                                    |
| `api`            | first entry of gateway `supported_formats` (`openai-completions` / `openai-responses` / `anthropic-messages`); defaults to `openai-completions` |
| `reasoning`      | `capabilities.supports_reasoning` (default `true`)                                              |
| `input`          | `["text", "image"]` when `capabilities.supported_input_modalities` contains `image`, else `["text"]` |
| `cost`           | first tier of gateway `cost[]`: `input`, `output`, `cache_read`; `cacheWrite` is `0` (gateway exposes no `cache_write`) |
| `contextWindow`  | gateway `context_window` (default `200000`)                                                     |
| `maxTokens`      | `128000` (gateway returns no max-output field)                                                  |

The token's `allowed_models` allowlist is enforced by the gateway: it filters the returned list rather than rejecting, so pi only ever sees models this token can call.

### Auth resolution for the fetch

`refreshCatalog` resolves the bearer key from `context.credential` (the stored api-key) first, falling back to `process.env.INFERENCE_V2_TWISTOY_API_KEY` when the credential is not yet stored (env-var-only setup).
