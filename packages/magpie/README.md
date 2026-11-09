# Magpie Extension

A pi extension that registers the `magpie` provider against a personal [magpie](https://github.com/yetone/magpie) gateway (default `http://100.65.0.3:3425`) and registers its decision models as native Pi classifier models.

## Configuration

`/config` → **Magpie** sets the gateway root, key, classifier model list, and classifier timeout/retries; `MAGPIE_BASE_URL` and `MAGPIE_API_KEY` override them. See [docs/magpie/README.md](../../docs/magpie/README.md) for the full table, the classifier registration, and how transcript annotations select a model. The default key is the Tailscale-only gateway key shipped with the extension; a stored `/login` credential does not replace it.

## Routing

- Provider `baseUrl`: `<Gateway URL>/v1`. pi's `openai-completions` api appends `/chat/completions`.
- `Authorization: Bearer <API Key>` is sent on every request, including the catalog fetch. A stored `/login` credential does not replace it.
- A model stays on Chat Completions when `native_endpoints` is absent (routing groups) or lists `/v1/chat/completions`. magpie then translates `reasoning_effort` to the upstream. If chat is not native, the model is asked on the first endpoint Pi can speak: `/v1/responses`, then `/v1/messages` (gateway root, because the Anthropic SDK appends `/v1/messages`), then Gemini `generateContent` (`/v1beta`). No per-family `thinkingFormat` override is applied.
- `compat.sendSessionAffinityHeaders` is set on each catalog model so pi sends its session-affinity headers. Requests also carry `x-magpie-session` set to the current pi session id, which magpie uses for routing-group route lookup.

## Commands

- `/refresh-magpie` — force-refresh the catalog now (bypasses the 4h window) and persist it to `~/.pi/agent/models-store.json`. `pi update --models` does not load extensions, so it never calls this provider's `refreshModels`.

## Model Catalog (dynamic)

Starts with an empty `models: []` baseline and is populated by `refreshModels`:

1. pi calls `refreshModels(context)` during startup and on `/model` refresh.
2. The callback (`src/catalog.ts` -> `refreshCatalog`) issues `GET <Gateway URL>/v1/models` with `Authorization: Bearer <API Key>` and maps each entry to a `ProviderModelConfig`.
3. The result is persisted through `context.publish` with a 4h freshness interval, so offline startup still sees the last known catalog.
4. `/refresh-magpie` calls `modelRegistry.refresh({ providers: ["magpie"], allowNetwork: true, force: true })`.

### Field mapping

| pi field | source |
| --- | --- |
| `id` | magpie `id` (`provider/model`, or a routing group id such as `group/cn-flagships`) |
| `name` | `display_name`, else `id` |
| `api` | `openai-completions` when `native_endpoints` is absent or includes `/v1/chat/completions`; otherwise `openai-responses`, `anthropic-messages`, or `google-generative-ai` from the native list |
| `reasoning` | `reasoning`, or true when the entry lists reasoning levels |
| `thinkingLevelMap` | `reasoning_levels`, else `supported_reasoning_levels[].effort`. Levels pi knows are passed through; missing levels are hidden. `off` maps to `none`. Vendor aliases `light` and `extra_high` are sent under those names. No map when magpie lists no levels. |
| `input` | `["text", "image"]` when `modalities.input` contains `image`, else `["text"]` |
| `cost` | `pricing` (OpenRouter shape, USD per token) converted to USD per million tokens. Missing price is `0`. |
| `contextWindow` | `context_window`, else `context_length`, else `200000` |
| `maxTokens` | `max_output_tokens`, else `16384` |
