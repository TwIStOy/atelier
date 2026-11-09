# Changelog

## [Unreleased]

### Added

- `generate_image` tool: draws through the gateway's image models (`POST /v1/images/generations`, or `/v1/images/edits` with `reference_images` as data URLs), saves each image to the working directory, and returns it as an image content block so the TUI renders it inline and multimodal models see the result. The tool self-renders its row (`renderShell: "self"`) in tool-display's style — bold verb header with the quoted prompt, collapsed one-line summary, expanded `saved <path>` lines — and pi appends the inline images below it; tool-display defers to the stock renderer for tools with their own renderers, so the images survive with it loaded. Parameters cover prompt, size, n, reference images, quality, background, and an optional magpie model or group; a new **Image Timeout (ms)** setting (default 300000) bounds the call.
- **Magpie** configuration section (`/config`) with Gateway URL, API Key, Classifier Models, Classifier Timeout (ms), and Classifier Max Retries, persisted under `magpie` in `extensions.json`; `MAGPIE_BASE_URL` and `MAGPIE_API_KEY` override the stored values.
- Native classifier registration: ids from **Classifier Models** (default `group/classifier`, the magpie decision group) become Pi classifier models (`magpie/<id>`, api `typesafe-system-one`) reachable through `modelRegistry.classify()`, codemode, and virtual-model routing. The provider registers the `magpieSystemOneClassifier` transport from `@htwang-contrib/magpie/classifier` (Pi's own `typesafe-system-one` module is not importable from extension code); it maps public `bool` questions to wire-level `noul`, parses choice/score answers and token usage into `ClassifierResult`, and applies the timeout/retry settings. `refreshCatalog` merges the classifier rows so catalog refreshes keep them.

### Changed

- The provider URL and key now come from the configuration section instead of package constants, and registration is repeated at `session_start` so edited connection values apply to the next session.
- Catalog refresh and the `/refresh-magpie` command handler now come from `@htwang-contrib/common`'s `gateway-provider` module instead of a package-private copy.

### Fixed

- Classifier requests no longer duplicate the `Authorization` header. Pi resolves the provider credential into `options.headers` while the transport added its own header with a different case; undici comma-joins case-variant duplicates, so magpie received `Bearer <key>, Bearer <key>` and answered every annotation request with HTTP 401. The transport now merges headers case-insensitively and only adds a bearer header when the caller supplied none.

### Removed

- Hardcoded `API_KEY` and `GATEWAY_V1_BASE_URL` exports from `catalog.ts`; callers use `magpieEndpoint()` instead.

## [0.7.0] - 2026-10-30

### Changed

- Models whose `native_endpoints` omit `/v1/chat/completions` are registered on the first native API Pi can speak (`/v1/responses`, then `/v1/messages`, then Gemini `generateContent`). Entries that list chat, or omit the field, stay on Chat Completions.

### Added

- Initial release. Registers the `magpie` provider against a personal [magpie](https://github.com/yetone/magpie) gateway at `http://100.65.0.3:3425/v1`. The gateway is Tailscale-only, so every request uses the fixed key `magpie-private`. The catalog starts empty and is filled by `refreshModels` from `GET /v1/models`.
- `/refresh-magpie` force-refreshes that catalog and writes `models-store.json`, bypassing the 4h freshness window.
- The extension self-registers into the shared child-extension registry, so child agent sessions can call magpie models when magpie is loaded in the parent session.
