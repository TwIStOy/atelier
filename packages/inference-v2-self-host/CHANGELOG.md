# Changelog

## [Unreleased]

### Fixed

- DeepSeek models (`deepseek-v4-pro`, `deepseek-v4-flash`) now advertise `maxTokens: 65536`. The gateway's `openai-responses` endpoint caps their output at 65536 tokens, so the previous catalog default of 128000 made every request fail with `max_tokens (128000) exceeds model's maximum output tokens (65536)`.

### Changed

- `glm-5.3` now shares `glm-5.2`'s reasoning-effort family: `compat` with `supportsReasoningEffort: true` and thinkingLevelMap `{ minimal: null, low/medium/high: "high", max: "max" }`. Family constants renamed accordingly (`ZAI_COMPAT_REASONING_EFFORT`, `GLM_REASONING_EFFORT_MAP`, `GLM_REASONING_EFFORT_IDS`).

## [0.5.0] - 2026-08-12

### Changed

- `kimi-k3` now uses the `anthropic-messages` API (against the gateway root base URL) with `headers: { "User-Agent": "KimiCLI/1.5" }` and `compat: { allowEmptySignature: true, forceAdaptiveThinking: true }`, mirroring pi's built-in `kimi-coding` provider. Its `thinkingLevelMap` now enables `low`/`high`/`max` to match the built-in `k3` model.
- GLM models (incl. `glm-5.2`) now set `compat.maxTokensField: "max_tokens"`, matching pi's built-in `zai` / `zai-coding-cn` catalog entries.

## [0.4.0] - 2026-07-31

### Changed

- The extension now skips all registration (tools, commands, event handlers, providers) when disabled via the file-based disable flag (`isExtensionDisabled` from `@htwang-contrib/common`). See `docs/extension-disable/` for file locations and schema.

## [0.3.1] - 2026-07-30

### Added

- Catalog models now derive a human-readable display `name` from their id instead of echoing the raw id (e.g. `glm-5.2` -> `GLM 5.2`, `claude-sonnet-4-6` -> `Claude Sonnet 4.6`, `gpt-5.6-sol` -> `GPT 5.6 Sol`). Brand tokens (GLM, GPT, Claude, DeepSeek, Kimi, Qwen, MIMO, HY3, Grok) are mapped to their canonical casing, trailing numeric segments are merged into a dotted version (`4-6` -> `4.6`), and other segments are title-cased.

## [0.3.0] - 2026-07-23

### Changed

- `catalog.ts` now applies per-family `compat` overrides based on model id (mirroring `inference-self-host`), instead of only special-casing `glm-5.2`. Covers GLM (base / standard / `glm-5.2`), DeepSeek, Moonshot/Kimi (incl. Kimi-K3), Qwen, MiMo, Hunyuan (`hy3`), and `grok-4.5` (responses API compat when the gateway advertises `openai-responses`).
- Fixed `glm-5.2` thinkingLevelMap to pi's official `{ minimal: null, low/medium/high: "high", max: "max" }`; the previous map used an invalid `xhigh` key and omitted `max`.

### Added

- Session affinity: every request now carries an `x-lite-session-id` header set to the current pi session id, so the lite-gateway can pin a session to one upstream replica for prompt-cache locality (lite-gateway issue [#24](https://github.com/TwIStOy/lite-gateway/issues/24)). Injected via the `before_provider_headers` hook and scoped to this provider only; applies to both `openai-completions` and `anthropic-messages` models.
- Initial release. Registers the `inference-v2-self-host` provider pointing at a lite-gateway instance at `https://inference-v2.twistoy.cn/api/v1`, authenticated via `INFERENCE_V2_TWISTOY_API_KEY`.
- Uses the new provider API: empty baseline `models: []` populated dynamically by a `refreshModels` callback that lists models from the gateway's `GET /api/v1/models` endpoint and persists them through the provider-scoped `ModelsStore`. Maps gateway-provided `context_window`, `cost[]`, `capabilities`, and `supported_formats` directly onto pi model fields. Catalog refresh respects network/force/abort flags and a 4h freshness interval.
