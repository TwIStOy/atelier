# Toori Extension

A pi extension that registers the `toori` provider, proxying to a [lite-gateway](https://github.com/) instance at `https://toori.twistoy.cn/api/v1`.

## Configuration

Set this environment variable:

- `INFERENCE_V2_TWISTOY_API_KEY` - your gateway data-plane token (`sk-lg-...`)

## Routing

- Provider `baseUrl`: `https://toori.twistoy.cn/api/v1`. pi's `openai-completions` api appends `/chat/completions`, producing `/api/v1/chat/completions` (matches the gateway's relay route).
- `authHeader: true` sends `Authorization: Bearer <key>`.
- Anthropic models get a model-level `baseUrl` of `https://toori.twistoy.cn/api`; the Anthropic SDK appends `/v1/messages`, producing `/api/v1/messages`.

## Session affinity (lite-gateway)

Every request to this provider carries an `x-lite-session-id` header whose value is the current pi session id (`ctx.sessionManager.getSessionId()`). The lite-gateway uses this to pin requests from one pi session to the same upstream replica, maximizing prompt-cache locality (see lite-gateway issue [#24](https://github.com/TwIStOy/lite-gateway/issues/24)).

The header is injected via pi's `before_provider_headers` hook and scoped to `ctx.model.provider === "toori"`, so it is never sent to other providers. It applies to both `openai-completions` and `anthropic-messages` models served by the gateway.

## Commands

- `/refresh-toori` — force-refresh the gateway catalog now (bypasses the 4h window) and persist it to `~/.pi/agent/models-store.json`. Use this instead of `pi update --models`; that command does not load extensions, so it never calls this provider's `refreshModels`.

## Model Catalog (dynamic)

Starts with an empty `models: []` baseline and is populated by the new `refreshModels` provider API:

1. pi calls `refreshModels(context)` during startup and on `/model` refresh.
2. The callback (`src/catalog.ts` -> `refreshCatalog`) issues `GET https://toori.twistoy.cn/api/v1/models` with `Authorization: Bearer <key>` and maps each entry to a `ProviderModelConfig`.
3. The result is persisted through `context.store` (provider-scoped `ModelsStore`) with a 4h freshness interval, so offline startup still sees the last known catalog.
4. `/refresh-toori` calls `modelRegistry.refresh({ providers: ["toori"], allowNetwork: true, force: true })` so the same callback runs immediately.

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
