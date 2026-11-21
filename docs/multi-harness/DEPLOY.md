# Deploying to Other Harnesses

Operational guide for the Harness Overlay (`harness/`) and the deploy recipe. Design decisions: `CONTEXT.md` and ADRs 0001/0002 in this directory.

## Layout

Everything user-facing — skills and User-Invoked Skills alike — lives in `skills/` at the repo root. `harness/` holds only build artifacts for the Magpie OpenCode plugin:

```
skills/<name>/SKILL.md              # every skill, including former prompts
  └── references/...                # skill resources (brief formats, templates)
harness/opencode/plugins/magpie.ts  # Magpie provider registration + generate_image (opencode2 plugin API)
                                    # dist/magpie.js is the bun-built bundle (gitignored, deploy artifact)
```

Former prompt commands are User-Invoked Skills: `disable-model-invocation: true` (Pi, Cursor) plus `metadata.opencode/autoinvoke: false` (OpenCode), invoked as `/skill:name` on Pi and `/skill-name` on OpenCode/Cursor. Their resources live in each skill's `references/`; cross-skill references use the Stable Path `~/.agents/skills/<skill>/...`.

## What deploy does

`just deploy-harness` (`scripts/deploy-harness.mjs`) is idempotent and never edits OpenCode's config file:

- `~/.agents/skills/<name>` → this repo's `skills/<name>` (all skills, for Pi/OpenCode/Cursor user-level discovery).
- `$XDG_CONFIG_HOME/opencode/plugins/magpie.js` → a symlink to the bundle built from `harness/opencode/plugins/magpie.ts` with `bun build --target=bun` (output under `harness/opencode/plugins/dist/`, gitignored).
- `~/.cursor/skills/<name>` → this repo's `skills/<name>`, the same links as `~/.agents/skills`.

It also prunes links left by retired layouts — anything pointing into this repo's `harness/` under `~/.cursor/skills` or the OpenCode commands dir, and a `~/.agents/prompts-resource` symlink — without touching any other entry.

Existing links pointing at this checkout are kept, links pointing elsewhere are repointed, and real directories or files at a target path are skipped with a warning (never clobbered). Links are added and updated, never pruned outside the retired-layout cases above — remove a link by hand when a source skill goes away. Skills under the repo's `.agents/skills/` are Project-Local Skills (this repo only) and are not deployed.

## Magpie plugin

`harness/opencode/plugins/magpie.ts` targets the **opencode2 plugin API only** (`Plugin.define` from `@opencode/plugin`). It is self-contained — no config entries:

- **Provider**: on setup it fetches `<baseURL>/models` (10s timeout) and registers the `magpie` provider through `ctx.provider.transform`, with every chat model the gateway advertises — display names, context windows, pricing (USD per million tokens), and input/output modalities mapped from the same catalog Pi refreshes. `package` is `@opencode/ai/providers/openai-compatible`.
- **Tool**: `generate_image` is registered via `ctx.tool.transform` with a JSON-Schema input; generated files are saved in the project directory and returned both as text lines and as `file` content so multimodal models/UI see the image.

Gateway defaults match the Pi package: `http://poi.li-rankine.ts.net:3425` with key `magpie-private`; `MAGPIE_BASE_URL` / `MAGPIE_API_KEY` override them. A failed catalog fetch logs to stderr and registers the provider without models. Startup therefore makes one gateway request; the list is not cached across restarts.

## Caveats

- **opencode2 only**: the plugin needs the 2.x plugin runtime (`@opencode/plugin`). The pre-2.x line (`@opencode-ai/plugin`, V1 hooks) is deliberately unsupported. Nothing links or edits `opencode.json`.
- **Skill invocation syntax differs per harness**: Pi uses `/skill:name`, OpenCode and Cursor use `/skill-name`. Skill bodies say "the text typed alongside the invocation" and stay syntax-neutral.
- **Pi hides User-Invoked Skills from the model**: `disable-model-invocation: true` keeps them out of automatic selection; the `enableSkillCommands` setting controls whether they appear in interactive command discovery, and manually entered `/skill:name` always works.
- **Plugin reload**: OpenCode caches plugin builds by path — restart OpenCode after the deploy rebuilds `magpie.js` before verifying.
- **Cursor cloud sync does not follow symlinks** (community-reported): the linked skills work locally but do not sync to Cursor Cloud Agents. Copy instead of linking if that matters.
- **Cursor IDE symlink discovery** had a known bug (the CLI follows symlinks since June 2026); if skills do not appear, copy the directories.
