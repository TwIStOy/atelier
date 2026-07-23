# Changelog

## [Unreleased]

### Changed

- `catalog.ts` now applies per-family `compat` overrides based on model id (mirroring `inference-self-host`), instead of only special-casing `glm-5.2`. Covers GLM (base / standard / `glm-5.2`), DeepSeek, Moonshot/Kimi (incl. Kimi-K3), Qwen, MiMo, Hunyuan (`hy3`), and `grok-4.5` (responses API compat when the gateway advertises `openai-responses`).
- Fixed `glm-5.2` thinkingLevelMap to pi's official `{ minimal: null, low/medium/high: "high", max: "max" }`; the previous map used an invalid `xhigh` key and omitted `max`.

### Added

- Initial release. Registers the `inference-v2-self-host` provider pointing at a lite-gateway instance at `https://inference-v2.twistoy.cn/api/v1`, authenticated via `INFERENCE_V2_TWISTOY_API_KEY`.
- Uses the new provider API: empty baseline `models: []` populated dynamically by a `refreshModels` callback that lists models from the gateway's `GET /api/v1/models` endpoint and persists them through the provider-scoped `ModelsStore`. Maps gateway-provided `context_window`, `cost[]`, `capabilities`, and `supported_formats` directly onto pi model fields. Catalog refresh respects network/force/abort flags and a 4h freshness interval.
