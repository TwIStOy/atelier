# Experience — Research Notes

Findings from investigating pi internals while building the `hide-models` feature. Captured so future features in `packages/experience` (and other extensions touching the model registry or config) don't have to re-derive these.

All paths are relative to `node_modules/@earendil-works/pi-coding-agent/dist/` unless noted. Verified against pi-coding-agent `0.85.1` (originally `0.80.3`; see the regression note below for what changed in between).

---

## 1. Filtering / hiding models from the picker

### There is no filter API or event

Every model-list consumer reads `session.modelRuntime` directly:

```
modes/interactive/components/model-selector.js:104   this.modelRuntime.getAvailableSnapshot()
modes/interactive/interactive-mode.js:421,3775,4059,4087,4093,4197,4267,4746   this.session.modelRuntime.getAvailableSnapshot()
modes/rpc/rpc-mode.js:368,384                        session.modelRuntime.getAvailableSnapshot()
cli/list-models.js:41                                await modelRuntime.getAvailable()
```

`ExtensionAPI` exposes only `registerProvider` / `unregisterProvider` / `setModel` — no list, no filter, no `model_list` event. `unregisterProvider` does not remove built-in providers/models. **The only way to hide models is to wrap the runtime's accessor methods.**

### `ModelRegistry` is a facade; `ModelRuntime` is the real surface

```ts
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
```

- `ModelRuntime` (`core/model-runtime.js`) owns the model catalog: `getAvailableSnapshot()` returns the sync `snapshot.available` array (**what the picker renders**), `getAvailable(providerId?)` is the async path used by `pi --list-models`, `getModels()`/`getModel()` resolve specific models (unpatched — current/default model resolution must keep working).
- `ModelRegistry` (`core/model-registry.js`) is a per-extension compatibility facade whose methods delegate to `this.runtime` (public field in JS, `private` in the .d.ts). Its own doc comment: "Coding-agent internals use ModelRuntime directly."

**Regression note (0.80 → 0.85):** the original `hide-models` implementation patched `ModelRegistry.prototype.getAvailable`/`getAll`, which intercepted every consumer on ≤0.80. pi then moved internals to `ModelRuntime` and kept `ModelRegistry` only as the extension-facing facade — the prototype patch kept installing cleanly but nothing called it anymore, so hide rules silently stopped filtering anything. The shape canary in `model-patch.test.ts` exists to fail loudly if this drift happens again.

`Model` (`@earendil-works/pi-ai`) carries `id: string`, `provider: ProviderId`, `name`, `api`, `baseUrl`, … Match hide rules against `provider` + `id`.

### Patch shape used by `hide-models`

- Patch `ModelRuntime.prototype.getAvailableSnapshot` + `getAvailable`; all instances share the prototype, so every consumer above is covered.
- Store the original methods on the prototype under `Symbol.for("experience.modelRuntime.originals")` so the patch is **idempotent across `/reload`** (re-importing the extension module finds the stored originals instead of re-wrapping its own previous wrapper → no double-filter / lost ref).
- The runtime `suppress` flag lives on the prototype too (`Symbol.for("experience.modelRuntime.suppress")`), not in module state — a re-evaluated module's `setSuppress` would otherwise write a fresh closure variable the surviving wrapper never reads. `reset` (temporary pass-through) therefore survives `/reload`.
- The wrapper **re-reads config on every call** (`readConfig` does fresh `readFileSync`), so edits from `/config` or `add`/`remove` apply on the next picker open with no re-patch needed.
- Internal bookkeeping that reads `this.snapshot` directly (e.g. `registerProvider`) stays unfiltered by design; only the accessor methods are wrapped.

See `packages/experience/src/hide-models/model-patch.ts`.

### Getting a runtime instance inside an extension

`ExtensionContext.modelRegistry` (and `ExtensionCommandContext.modelRegistry`) is the facade; its `.runtime` field is the live `ModelRuntime`. Capture it in `session_start` (`ctx.modelRegistry`) so ConfigItem option builders — which receive no `ctx` — can enumerate models later. For unfiltered listings (the `/config` multiselect must still show hidden models so they can be un-hidden), call the stored-original `getAvailableSnapshot` via the helpers in `model-patch.ts`.

---

## 2. ConfigItem mechanism (`@htwang-contrib/common`)

- `registerConfigItems(extensionId, items[])` registers items surfaced in `/config` (rendered by `packages/extension-config-ui`). Call once at init.
- Item `value` is a **getter** `() => T` (or a literal). There is **no setter** — writes happen through the config-file helpers, not the item.
- Persistence path: `~/.config/pi/extensions.json` (`$XDG_CONFIG_HOME/pi` if set). Section key = `extensionId`. File: `packages/common/src/config/extension-config.ts`.
  - `readConfig(id, schema)` → `{ ...defaults, ...section }`, re-reads file every call.
  - `writeConfig`, `updateConfig(id, schema, patch)`, `setConfigKey(id, key, value)` (dotted path), `deleteConfigKey`, `deleteConfigSection`, `readRawConfig`.
- **How `/config` writes back**: `packages/extension-config-ui/src/config-registry.ts` `saveSetting(row, value)` → `setConfigKey(row.extensionId, row.item.key, value)`. So an item's `key` is the persistence field name; choose it to match what your `loadConfig` reads.
- `select` / `multiselect` / `reorderable` items take `options: ConfigItemSelectOption[] | LazyOptions<T>` where `LazyOptions<T> = () => ConfigItemSelectOption<T>[]`. A lazy getter lets options be generated at render time from the live registry.
- Item types: `string`, `number`, `boolean`, `select`, `multiselect`, `reorderable`, `color` (`packages/common/src/config/config-item.ts`).
- The `multiselect` UI already exists in `extension-config-ui` (`popup.ts`, `render/setting-list.ts`) — reuse it instead of building a custom TUI.

### Pattern: one command verb + ConfigItem editor, same persisted state

`hide-models` writes rules through `updateConfig` (`add`/`remove`) and the `/config` multiselect writes through `setConfigKey`. Both target `extensions.json["experience"]["hiddenRules"]`, and the patch reads that field live. Result: two editing surfaces, one source of truth, immediate effect.

---

## 3. Command & UI primitives

- `pi.registerCommand(name, { description, handler })` where `handler: (args: string, ctx: ExtensionCommandContext) => Promise<void>`. `args` is the raw string after the command name (parse it yourself).
- Command output: `ctx.ui.notify(message, "info" | "warning" | "error")`. Accepts multi-line strings (`"\n"`). There is **no return value** — the handler is `Promise<void>`.
- `ExtensionCommandContext` adds `waitForIdle`, `newSession`, `fork`, `navigateTree`, `switchSession`, `reload` on top of `ExtensionContext`.
- `ctx.ui` modal primitives: `select(title, options[], opts?)` (single-select, returns `string | undefined`), `confirm`, `input`, `editor` (multiline). **No built-in multi-select dialog.**
- For a custom modal picker: `ctx.ui.custom<T>(factory, { overlay, overlayOptions })` — factory receives `(tui, theme, keybindings, done)` and returns a Component. This is how `ask-user-question` builds its TUI. Heavier than reusing the `/config` multiselect.
- There is **no public API to programmatically open `/config`** or jump to a section.

---

## 4. Decisions specific to `hide-models`

- Rule canonical form: whole-provider → `provider` (e.g. `ollama`); `provider/*` and `provider/` normalize to `provider`; specific model → `provider/model` (e.g. `openrouter/cheap-model`). Stored as `string[]` under `experience.hiddenRules`.
- Provider ids matched case-insensitively (lowercased); model ids matched case-sensitively (registry ids are exact). Split target on the **first** `/`, so model ids containing slashes work.
- `reset` is runtime-only: sets a suppress flag so the wrapper returns the unfiltered list. Rules stay persisted and re-apply on next `add`/`remove` or reload. There is intentionally no persistent "clear" verb — clearing is done by deselecting in `/config`.
- Config: `enabled` (boolean master toggle) + `hiddenRules` (multiselect). Both under config id `experience`, label `Experience`.
