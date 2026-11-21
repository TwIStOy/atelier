# Deploying to Other Harnesses

Operational guide for the Harness Overlay (`harness/`) and the deploy recipe. Design decisions: `CONTEXT.md` and ADRs 0001/0002 in this directory.

## Layout

```
harness/
├── opencode/
│   ├── commands/<name>.md        # OpenCode command shells (thin, point at the shared BODY)
│   └── plugins/magpie.ts         # Magpie provider registration + generate_image (opencode2 plugin API)
│                                 # dist/magpie.js is the bun-built bundle (gitignored, deploy artifact)
└── cursor/
    └── skills/<name>/            # Cursor skill shells (disable-model-invocation)
        ├── SKILL.md
        └── BODY.md -> ../../../../prompts-resource/<name>/BODY.md
```

Prompt instruction text (the Prompt Body) lives in `prompts-resource/<name>/BODY.md` at the repo root — one body per prompt, three shells (Pi `prompts/`, OpenCode `harness/opencode/commands/`, Cursor `harness/cursor/skills/`). Pi and OpenCode shells reference the body through the Stable Path `~/.agents/prompts-resource/<name>/BODY.md`, a symlink the deploy script maintains, so no machine-specific path is written into any repo file. Cursor shells instead carry an in-skill `BODY.md` symlink, following the agentskills convention of skill-relative resources.

## What deploy does

`just deploy-harness` (`scripts/deploy-harness.mjs`) is idempotent and **never edits OpenCode's config file**:

- `~/.agents/skills/<name>` → this repo's `skills/<name>` (all skills, for Pi/OpenCode/Cursor user-level discovery).
- `~/.agents/prompts-resource` → this repo's `prompts-resource/`.
- `$XDG_CONFIG_HOME/opencode/commands/<name>.md` → `harness/opencode/commands/<name>.md`.
- `$XDG_CONFIG_HOME/opencode/plugins/magpie.js` → a symlink to the bundle built from `harness/opencode/plugins/magpie.ts` with `bun build --target=bun` (output under `harness/opencode/plugins/dist/`, gitignored).
- `~/.cursor/skills/<name>` → `harness/cursor/skills/<name>`.

Existing links pointing at this checkout are kept, links pointing elsewhere are repointed, and real directories or files at a target path are skipped with a warning (never clobbered). Links are added and updated, never pruned — remove a link by hand when a source skill goes away. Skills under the repo's `.agents/skills/` are Project-Local Skills (this repo only) and are not deployed. A failed plugin build fails the deploy after the other steps complete.

## Magpie plugin

`harness/opencode/plugins/magpie.ts` targets the **opencode2 plugin API only** (`Plugin.define` from `@opencode/plugin`). It is self-contained — no config entries:

- **Provider**: on setup it fetches `<baseURL>/models` (10s timeout) and registers the `magpie` provider through `ctx.provider.transform`, with every chat model the gateway advertises — display names, context windows, pricing (USD per million tokens), and input/output modalities mapped from the same catalog Pi refreshes. `package` is `@opencode/ai/providers/openai-compatible`.
- **Tool**: `generate_image` is registered via `ctx.tool.transform` with a JSON-Schema input; generated files are saved in the project directory and returned both as text lines and as `file` content so multimodal models/UI see the image.

Gateway defaults match the Pi package: `http://poi.li-rankine.ts.net:3425` with key `magpie-private`; `MAGPIE_BASE_URL` / `MAGPIE_API_KEY` override them. A failed catalog fetch logs to stderr and registers the provider without models. Startup therefore makes one gateway request; the list is not cached across restarts.

## Caveats

- **opencode2 only**: the plugin needs the 2.x plugin runtime (`@opencode/plugin`). The pre-2.x line (`@opencode-ai/plugin`, V1 hooks) is deliberately unsupported — its config-hook/provider-hook behavior differed and it required a `provider.magpie` entry in `opencode.json`. Nothing links or edits that file anymore.
- **Tool content**: image results are returned as `file` content with `file://` URIs; if a future runtime rejects that scheme, the text lines still carry the saved paths.
- **Plugin reload**: OpenCode caches plugin builds by path — restart OpenCode after the deploy rebuilds `magpie.js` before verifying.
- **Cursor cloud sync does not follow symlinks** (community-reported): the linked skills work locally but do not sync to Cursor Cloud Agents. Copy instead of linking if that matters.
- **Cursor IDE symlink discovery** had a known bug (the CLI follows symlinks since June 2026); if skills do not appear, copy the directories.
