# Changelog

## [Unreleased]

## [0.3.0] - 2026-07-23

### Added

- `kimi-k3` (prices synced from models.dev, Moonshot family).

### Changed

- Aligned every per-family `compat` override with pi's official model definitions (`@earendil-works/pi-ai` `models.generated`):
  - **GLM (ZAI)** split into base (`glm-4.5-air`, no `zaiToolStream`), standard (`zaiToolStream: true`), and `glm-5.2` (`supportsReasoningEffort: true`) variants; `glm-5.2` thinkingLevelMap is `{ minimal: null, low/medium/high: "high", max: "max" }`.
  - **DeepSeek** gained `supportsStore: false` and thinkingLevelMap `{ minimal/low/medium: null, high: "high", max: "max" }`.
  - **Moonshot (Kimi)** gained `supportsStore: false`, `supportsStrictMode: false`, `thinkingFormat: "deepseek"`.
  - **Qwen** gained `supportsStore: false`.
  - All families now set `supportsStore: false` / `supportsDeveloperRole: false` explicitly instead of relying on URL auto-detection.
- Added compat overrides that were previously missing: **MiMo (Xiaomi)** family now uses `thinkingFormat: "deepseek"` + `requiresReasoningContentOnAssistantMessages: true`; `hy3-preview` uses `{ supportsStore: false, supportsDeveloperRole: false }`; `glm-4.5` and the MiMo models that had no override now carry their family compat.
- `kimi-k3` uses the Kimi-K3-specific compat (`requiresReasoningContentOnAssistantMessages` + `thinkingFormat: "deepseek"` + `maxTokensField`/`supportsStrictMode`) and thinkingLevelMap where only `max` enables thinking. `deferredToolsMode: "kimi"` is intentionally omitted (gateway tool loading is static).
- `grok-4.5` switched to the `openai-responses` API with `supportsLongCacheRetention: false` and thinkingLevelMap `{ off: null, minimal: null }`, matching pi's xai definition.

## [0.2.5] - 2026-07-14

### Added

- GPT-5.6 family models: `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` (prices synced from models.dev).
- `grok-4.5` (prices synced from models.dev, provider `xai`).

## [0.2.4] - 2026-07-09

## [0.2.3] - 2026-07-09

## [0.2.2] - 2026-07-07

### Added

- Depends on `@htwang-contrib/common`. Emits an `extension loaded` log line when the extension initializes.

### Changed

- `fetchModels` "model not found" warnings now use the shared logger (`createLogger("inference-self-host")`, `logger.warn`) instead of `console.warn`, which corrupts the pi TUI.

## [0.2.1] - 2026-07-06

## [0.2.0] - 2026-07-06

### Added

- Initial release.
