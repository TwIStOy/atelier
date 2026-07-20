# Changelog

## [Unreleased]

### Added

- Initial release. Registers the `inference-v2-self-host` provider pointing at a lite-gateway instance at `https://inference-v2.twistoy.cn/api/v1`, authenticated via `INFERENCE_V2_TWISTOY_API_KEY`.
- Uses the new provider API: empty baseline `models: []` populated dynamically by a `refreshModels` callback that lists models from the gateway's `GET /api/v1/models` endpoint and persists them through the provider-scoped `ModelsStore`. Maps gateway-provided `context_window`, `cost[]`, `capabilities`, and `supported_formats` directly onto pi model fields. Catalog refresh respects network/force/abort flags and a 4h freshness interval.
