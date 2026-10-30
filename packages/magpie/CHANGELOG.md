# Changelog

## [Unreleased]

## [0.7.0] - 2026-10-30

### Changed

- Models whose `native_endpoints` omit `/v1/chat/completions` are registered on the first native API Pi can speak (`/v1/responses`, then `/v1/messages`, then Gemini `generateContent`). Entries that list chat, or omit the field, stay on Chat Completions.

### Added

- Initial release. Registers the `magpie` provider against a personal [magpie](https://github.com/yetone/magpie) gateway at `http://100.65.0.3:3425/v1`. The gateway is Tailscale-only, so every request uses the fixed key `magpie-private`. The catalog starts empty and is filled by `refreshModels` from `GET /v1/models`.
- `/refresh-magpie` force-refreshes that catalog and writes `models-store.json`, bypassing the 4h freshness window.
- The extension self-registers into the shared child-extension registry, so child agent sessions can call magpie models when magpie is loaded in the parent session.
